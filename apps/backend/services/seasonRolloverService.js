const { getSeasonName, sortSeasons } = require('../utils/seasonUtils');

/**
 * Snapshots current league rosters to historical_rosters table.
 * @param {Object} client - Database client (transactional)
 * @param {string} seasonName - The season name to tag these records with (e.g. "Winter 2026")
 */
async function snapshotRosters(client, seasonName) {
    const query = `
        INSERT INTO historical_rosters (season, team_name, player_name, position, points, card_id)
        SELECT
            $1 as season,
            COALESCE(t.city || ' ' || t.name, 'Unknown Team') as team_name,
            COALESCE(cp.display_name, cp.name) as player_name,
            CASE
                WHEN rc.assignment = 'BENCH' THEN 'BENCH'
                WHEN rc.assignment = 'PITCHING_STAFF' THEN (CASE WHEN cp.ip > 3 THEN 'SP' ELSE 'RP' END)
                ELSE rc.assignment
            END as position,
            COALESCE(ppv.points, 0) as points,
            rc.card_id
        FROM roster_cards rc
        JOIN rosters r ON rc.roster_id = r.roster_id
        JOIN teams t ON r.user_id = t.user_id
        JOIN cards_player cp ON rc.card_id = cp.card_id
        LEFT JOIN point_sets ps ON ps.name = 'Upcoming Season'
        LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = ps.point_set_id
        WHERE r.roster_type = 'league'
    `;

    await client.query(query, [seasonName]);
}

/**
 * Generates empty series_results for the schedule.
 * @param {Object} client
 * @param {string} seasonName
 * @param {Array<number>} teamIds
 */
async function generateSchedule(client, seasonName, teamIds) {
    if (!teamIds || teamIds.length < 2) return;

    // Fetch team cities
    const teamRes = await client.query(
        `SELECT team_id, city FROM teams WHERE team_id = ANY($1)`,
        [teamIds]
    );
    const teamCityMap = {};
    teamRes.rows.forEach(r => teamCityMap[r.team_id] = r.city);

    const matchups = [];
    for (let i = 0; i < teamIds.length; i++) {
        for (let j = i + 1; j < teamIds.length; j++) {
            matchups.push({ home: teamIds[i], away: teamIds[j] });
        }
    }

    const today = new Date(); // Use current date/time

    for (const m of matchups) {
        await client.query(
            `INSERT INTO series_results (season_name, round, date, winning_team_id, losing_team_id, winning_team_name, losing_team_name, winning_score, losing_score)
             VALUES ($1, 'Regular Season', $2, $3, $4, $5, $6, NULL, NULL)`,
            [seasonName, today, m.home, m.away, teamCityMap[m.home], teamCityMap[m.away]]
        );
    }
}

/**
 * Rolls over point sets:
 * 1. Renames 'Upcoming Season' -> currentSeasonName
 * 2. Creates new 'Upcoming Season'
 * 3. Calculates new points
 * @param {Object} client
 * @param {string} currentSeasonName - The season just finished drafting (e.g. "Winter 2026")
 */
async function rolloverPointSets(client, currentSeasonName) {
    // 1. Rename existing "Upcoming Season" to the season name (e.g. "Winter 2026")
    const renameRes = await client.query(
        `UPDATE point_sets SET name = $1 WHERE name = 'Upcoming Season' RETURNING point_set_id`,
        [currentSeasonName]
    );

    if (renameRes.rowCount === 0) {
        console.warn("Could not find 'Upcoming Season' point set to rename. Skipping point set rollover.");
        return;
    }
    const oldPointSetId = renameRes.rows[0].point_set_id;

    // 2. Create NEW "Upcoming Season"
    const createRes = await client.query(
        `INSERT INTO point_sets (name) VALUES ('Upcoming Season') RETURNING point_set_id`
    );
    const newPointSetId = createRes.rows[0].point_set_id;

    // 3. Determine Previous Season
    const histRes = await client.query(`SELECT DISTINCT season FROM historical_rosters`);
    const allSeasons = histRes.rows.map(r => r.season);
    const sortedSeasons = sortSeasons(allSeasons);
    const idx = sortedSeasons.indexOf(currentSeasonName);
    let prevSeasonName = null;
    if (idx !== -1 && idx < sortedSeasons.length - 1) {
        prevSeasonName = sortedSeasons[idx + 1];
    }

    // 4. Calculate Points
    const basePointsRes = await client.query(
        `SELECT card_id, points FROM player_point_values WHERE point_set_id = $1`,
        [oldPointSetId]
    );
    const basePoints = {};
    basePointsRes.rows.forEach(r => basePoints[r.card_id] = r.points);

    async function getRosterIds(season) {
        if (!season) return new Set();
        const r = await client.query(`SELECT card_id FROM historical_rosters WHERE season = $1`, [season]);
        return new Set(r.rows.map(row => row.card_id));
    }

    const currentRosterIds = await getRosterIds(currentSeasonName);
    const prevRosterIds = await getRosterIds(prevSeasonName);
    const allHistoryRes = await client.query(`SELECT DISTINCT card_id FROM historical_rosters`);
    const allHistoryIds = new Set(allHistoryRes.rows.map(r => r.card_id));

    for (const [cardIdStr, points] of Object.entries(basePoints)) {
        const cardId = parseInt(cardIdStr);
        let newPoints = points;
        const isCurrent = currentRosterIds.has(cardId);
        const isPrev = prevRosterIds.has(cardId);
        const everRostered = allHistoryIds.has(cardId);

        if (isCurrent) {
            if (isPrev) newPoints += 10;
        } else {
            newPoints -= 10;
        }

        if (everRostered && newPoints < 10) newPoints = 10;

        await client.query(
            `INSERT INTO player_point_values (point_set_id, card_id, points) VALUES ($1, $2, $3)`,
            [newPointSetId, cardId, newPoints]
        );
    }
}

/**
 * Checks if a specific team has played (finished) any game in the given season.
 * @param {Object} client
 * @param {number} userId - The user ID of the team owner
 * @param {string} seasonName
 * @returns {Promise<boolean>}
 */
async function checkTeamHasPlayed(client, userId, seasonName) {
    if (!seasonName) return false;

    // Get Team ID
    const teamRes = await client.query('SELECT team_id FROM teams WHERE user_id = $1', [userId]);
    if (teamRes.rows.length === 0) return false;
    const teamId = teamRes.rows[0].team_id;

    // Check for any completed game (score is not null)
    const gameRes = await client.query(
        `SELECT 1 FROM series_results
         WHERE season_name = $1
           AND (winning_team_id = $2 OR losing_team_id = $2)
           AND winning_score IS NOT NULL
         LIMIT 1`,
        [seasonName, teamId]
    );

    return gameRes.rows.length > 0;
}

/**
 * Checks if ALL teams scheduled in a season have finished at least one game.
 * @param {Object} client
 * @param {string} seasonName
 * @returns {Promise<boolean>}
 */
async function checkAllTeamsPlayed(client, seasonName) {
    if (!seasonName) return false;

    // Get all teams involved in this season
    const teamsRes = await client.query(
        `SELECT DISTINCT winning_team_id as id FROM series_results WHERE season_name = $1
         UNION
         SELECT DISTINCT losing_team_id as id FROM series_results WHERE season_name = $1`,
        [seasonName]
    );
    const allTeams = teamsRes.rows.map(r => r.id).filter(id => id !== null);

    if (allTeams.length === 0) return false;

    // Check for teams that have NOT played (have NO finished games)
    const unplayedRes = await client.query(
        `SELECT team_id FROM (
            SELECT unnest($1::int[]) as team_id
         ) as t
         WHERE NOT EXISTS (
            SELECT 1 FROM series_results sr
            WHERE sr.season_name = $2
              AND (sr.winning_team_id = t.team_id OR sr.losing_team_id = t.team_id)
              AND sr.winning_score IS NOT NULL
         )`,
        [allTeams, seasonName]
    );

    return unplayedRes.rows.length === 0;
}

module.exports = {
    snapshotRosters,
    generateSchedule,
    rolloverPointSets,
    checkTeamHasPlayed,
    checkAllTeamsPlayed
};
