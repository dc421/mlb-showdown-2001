const { getSeasonName, sortSeasons } = require('../utils/seasonUtils');

/**
 * Snapshots current league rosters to historical_rosters table.
 * @param {Object} client - Database client (transactional)
 * @param {string} seasonName - The season name to tag these records with (e.g. "Winter 2026")
 */
async function snapshotRosters(client, seasonName) {
    // We want to capture the state of 'league' rosters right now.
    // Join rosters -> roster_cards -> cards_player to get all details.
    // Also need team name (from teams table via roster.user_id -> teams.user_id)
    // Actually, roster table has user_id. teams table has user_id.

    const query = `
        INSERT INTO historical_rosters (season, team_name, player_name, position, points, card_id)
        SELECT
            $1 as season,
            COALESCE(t.city || ' ' || t.name, 'Unknown Team') as team_name,
            COALESCE(cp.display_name, cp.name) as player_name,
            CASE
                WHEN cp.control IS NOT NULL THEN (CASE WHEN cp.ip > 3 THEN 'SP' ELSE 'RP' END)
                ELSE array_to_string(ARRAY(SELECT jsonb_object_keys(cp.fielding_ratings)), '/')
            END as position,
            COALESCE(ppv.points, 0) as points,
            rc.card_id
        FROM roster_cards rc
        JOIN rosters r ON rc.roster_id = r.roster_id
        JOIN teams t ON r.user_id = t.user_id
        JOIN cards_player cp ON rc.card_id = cp.card_id
        LEFT JOIN point_sets ps ON ps.name = 'Upcoming Season' -- We use current point values for the snapshot? Or the ones about to be rolled? Usually snapshot implies "what they were during this draft/season". Since we are at END of draft, "Upcoming Season" is actually the set used for this draft.
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
    // 5 teams, round robin = 10 pairings.
    // teamIds is array of 5 integers.

    if (!teamIds || teamIds.length < 2) return;

    const matchups = [];
    for (let i = 0; i < teamIds.length; i++) {
        for (let j = i + 1; j < teamIds.length; j++) {
            matchups.push({ home: teamIds[i], away: teamIds[j] });
        }
    }

    const today = new Date(); // Use current date/time

    for (const m of matchups) {
        await client.query(
            `INSERT INTO series_results (season_name, round, date, winning_team_id, losing_team_id, winning_score, losing_score)
             VALUES ($1, 'Regular Season', $2, $3, $4, NULL, NULL)`,
            [seasonName, today, m.home, m.away]
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
    // This preserves the point values used for that draft.
    const renameRes = await client.query(
        `UPDATE point_sets SET name = $1 WHERE name = 'Upcoming Season' RETURNING point_set_id`,
        [currentSeasonName]
    );

    if (renameRes.rowCount === 0) {
        throw new Error("Could not find 'Upcoming Season' point set to rename.");
    }
    const oldPointSetId = renameRes.rows[0].point_set_id;

    // 2. Create NEW "Upcoming Season"
    const createRes = await client.query(
        `INSERT INTO point_sets (name) VALUES ('Upcoming Season') RETURNING point_set_id`
    );
    const newPointSetId = createRes.rows[0].point_set_id;

    // 3. Determine Previous Season
    // Fetch all seasons from historical_rosters distinct
    const histRes = await client.query(`SELECT DISTINCT season FROM historical_rosters`);
    const allSeasons = histRes.rows.map(r => r.season);

    // Add currentSeasonName to list for sorting context (it might not be in hist yet if snapshot happened in same transaction but we can't see it? Wait, snapshot IS in same transaction, so it should be visible if we select?)
    // Actually, we just called snapshotRosters in the same transaction, so yes, currentSeasonName should be in historical_rosters now.

    // Sort
    const sortedSeasons = sortSeasons(allSeasons);

    // Find currentSeasonName index
    const idx = sortedSeasons.indexOf(currentSeasonName);
    let prevSeasonName = null;
    if (idx !== -1 && idx < sortedSeasons.length - 1) {
        prevSeasonName = sortedSeasons[idx + 1]; // Next one in list is previous chronologically (descending sort)
    }

    // 4. Calculate Points
    // We need:
    // - Base points (from oldPointSetId)
    // - Set of card_ids in currentSeasonName roster (from historical_rosters)
    // - Set of card_ids in prevSeasonName roster (from historical_rosters)
    // - Set of card_ids EVER in historical_rosters

    // Fetch Base Points
    const basePointsRes = await client.query(
        `SELECT card_id, points FROM player_point_values WHERE point_set_id = $1`,
        [oldPointSetId]
    );
    const basePoints = {}; // card_id -> points
    basePointsRes.rows.forEach(r => basePoints[r.card_id] = r.points);

    // Helper to get roster IDs
    async function getRosterIds(season) {
        if (!season) return new Set();
        const r = await client.query(`SELECT card_id FROM historical_rosters WHERE season = $1`, [season]);
        return new Set(r.rows.map(row => row.card_id));
    }

    const currentRosterIds = await getRosterIds(currentSeasonName);
    const prevRosterIds = await getRosterIds(prevSeasonName);

    // Fetch ALL historical IDs (for the "never on roster" check)
    // This includes current season since we just snapshotted it.
    const allHistoryRes = await client.query(`SELECT DISTINCT card_id FROM historical_rosters`);
    const allHistoryIds = new Set(allHistoryRes.rows.map(r => r.card_id));

    // Calculate new values
    // Iterate over all cards that have base points
    for (const [cardIdStr, points] of Object.entries(basePoints)) {
        const cardId = parseInt(cardIdStr);
        let newPoints = points;

        const isCurrent = currentRosterIds.has(cardId);
        const isPrev = prevRosterIds.has(cardId);
        const everRostered = allHistoryIds.has(cardId);

        if (isCurrent) {
            if (isPrev) {
                // Consecutive seasons -> +10
                newPoints += 10;
            }
            // If current but not prev -> No change (neutral)
        } else {
            // Not in current -> -10
            newPoints -= 10;
        }

        // Floor Logic
        // "players can only be valued at less than 10 points if they have never been on a league roster."
        // Meaning: If everRostered is true, min points = 10.
        if (everRostered) {
            if (newPoints < 10) newPoints = 10;
        }

        // Insert into new point set
        await client.query(
            `INSERT INTO player_point_values (point_set_id, card_id, points) VALUES ($1, $2, $3)`,
            [newPointSetId, cardId, newPoints]
        );
    }
}

module.exports = {
    snapshotRosters,
    generateSchedule,
    rolloverPointSets
};
