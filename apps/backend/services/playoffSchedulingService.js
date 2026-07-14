// Auto-creates the Golden Spaceship (top 2 play each other) and Wooden Spoon (bottom 2) series for a
// season as soon as the playoff field is mathematically clinched — i.e. both spaceship seeds and both
// spoon seeds have locked (the x-/z- clinch letters), even if regular-season games remain.
//
// We always create BOTH series together. Creating just one would make calculateStandings treat the
// season as "postseason set" and stop computing odds, which would hide the other field's clinch and
// prevent it from ever scheduling. So we wait until the whole field is determined, then create both.

const { pool } = require('../db');
const { calculateStandings } = require('../utils/standingsUtils');
const { resolveSeriesResultUpdate } = require('../utils/seriesUtils');

const PLAYOFF_ROUNDS = ['Golden Spaceship', 'Wooden Spoon'];

// Rounds that are NOT regular-season play, so auto-stop must never touch them (freezing a Spaceship/
// Spoon/etc. to 0-0 "not required" would wipe the matchup). Broader than PLAYOFF_ROUNDS to be safe.
const NON_REGULAR_ROUNDS = ['Golden Spaceship', 'Wooden Spoon', 'Silver Submarine', 'Semifinal', 'Semi-Final', 'Play-In', 'Final'];

// Finalize one still-open regular-season series: an in-progress one freezes at its current game tally
// (winner normalized into the winning_* slot) and its leftover empty game shells are dropped; a
// never-launched one becomes a 0-0 "not required" row that contributes nothing to standings.
async function stopOneSeries(db, sr) {
    const liveRes = await db.query(
        `SELECT id, home_wins, away_wins, series_home_user_id, series_away_user_id, status
         FROM series WHERE series_result_id = $1 ORDER BY id DESC LIMIT 1`,
        [sr.id]
    );
    if (liveRes.rows.length > 0 && liveRes.rows[0].status !== 'completed') {
        const s = liveRes.rows[0];
        const teamRows = await db.query('SELECT user_id, team_id FROM teams WHERE user_id = ANY($1)', [[s.series_home_user_id, s.series_away_user_id]]);
        const homeTeam = teamRows.rows.find(t => t.user_id === s.series_home_user_id);
        const awayTeam = teamRows.rows.find(t => t.user_id === s.series_away_user_id);
        const update = resolveSeriesResultUpdate(sr, {
            homeTeamId: homeTeam ? homeTeam.team_id : null,
            awayTeamId: awayTeam ? awayTeam.team_id : null,
            homeGames: s.home_wins, awayGames: s.away_wins, isOver: true,
        });
        await db.query(
            `UPDATE series_results SET status=$1, result_source=$2, winning_team_id=$3, winning_team_name=$4, winning_score=$5, losing_team_id=$6, losing_team_name=$7, losing_score=$8 WHERE id=$9`,
            [update.status, update.result_source, update.winning_team_id, update.winning_team_name, update.winning_score, update.losing_team_id, update.losing_team_name, update.losing_score, sr.id]
        );
        await db.query(`UPDATE series SET status='completed' WHERE id = $1`, [s.id]);
        await db.query(
            `DELETE FROM games g WHERE g.series_id = $1 AND g.status <> 'completed'
               AND NOT EXISTS (SELECT 1 FROM game_events e WHERE e.game_id = g.game_id)`,
            [s.id]
        );
    } else {
        await db.query(
            `UPDATE series_results SET status='completed', result_source='auto', winning_score=0, losing_score=0,
             notes='Not required — playoff seeds clinched' WHERE id = $1`,
            [sr.id]
        );
    }
}

// The moment the field clinches, every remaining regular-season series is meaningless — auto-finalize
// them all (no manual "stop" action needed). Skips the playoff series themselves. Returns the count.
async function autoStopRemainingSeries(db, seasonName) {
    const openRes = await db.query(
        `SELECT id, round, winning_team_id, winning_team_name, losing_team_id, losing_team_name
         FROM series_results
         WHERE season_name = $1 AND style IS DISTINCT FROM 'Classic' AND status <> 'completed'
           AND (round IS NULL OR NOT (round = ANY($2::text[])))
         FOR UPDATE`,
        [seasonName, NON_REGULAR_ROUNDS]
    );
    for (const sr of openRes.rows) await stopOneSeries(db, sr);
    return openRes.rows.length;
}

// Creates one playoff series row (scores empty). Callers guard against re-creation via the existing
// rounds, so a plain parameterized INSERT is enough (and avoids the parameter-type ambiguity an
// INSERT ... SELECT ... WHERE NOT EXISTS hits by reusing the same placeholder in two positions).
function insertSeries(db, seasonName, round, seeds) {
    return db.query(
        `INSERT INTO series_results
            (season_name, round, date, winning_team_id, losing_team_id, winning_team_name, losing_team_name, winning_score, losing_score, status)
         VALUES ($1, $2, now(), $3, $4, $5, $6, NULL, NULL, 'scheduled')`,
        [seasonName, round, seeds[0].team_id, seeds[1].team_id, seeds[0].name, seeds[1].name]
    );
}

// Creates the playoff series for `seasonName` if the field has clinched and they don't exist yet.
// `standings`/`seriesResults` may be passed in (the league routes already have them) to avoid
// re-fetching; otherwise they're computed from the DB. Best-effort — never throws. Returns whether
// it created anything.
async function schedulePlayoffsIfClinched(db = pool, seasonName, { precomputedOdds = null, standings = null, seriesResults = null } = {}) {
    if (!seasonName) return false;
    try {
        if (!standings || !seriesResults) {
            const currentTeams = (await db.query('SELECT team_id, name, city, logo_url FROM teams')).rows;
            seriesResults = (await db.query(
                "SELECT * FROM series_results WHERE style IS DISTINCT FROM 'Classic' AND season_name = $1",
                [seasonName]
            )).rows;
            standings = calculateStandings(seriesResults, currentTeams, false, precomputedOdds ? { precomputedOdds } : {});
        }

        const have = new Set(seriesResults.filter(r => PLAYOFF_ROUNDS.includes(r.round)).map(r => r.round));
        if (have.has('Golden Spaceship') && have.has('Wooden Spoon')) return false;

        // Clinch letters mirror the odds (set in calculateStandings): x- = guaranteed spaceship,
        // z- = guaranteed spoon. The field is set once both seats of each are locked.
        const spaceshipSeeds = standings.filter(s => s.clinch === 'x-');
        const spoonSeeds = standings.filter(s => s.clinch === 'z-');
        const spoonSpots = standings.length >= 4 ? 2 : 1;
        if (spaceshipSeeds.length !== 2 || spoonSeeds.length !== spoonSpots) return false;

        let created = false;
        if (!have.has('Golden Spaceship')) { await insertSeries(db, seasonName, 'Golden Spaceship', spaceshipSeeds); created = true; }
        if (!have.has('Wooden Spoon')) { await insertSeries(db, seasonName, 'Wooden Spoon', spoonSeeds); created = true; }
        if (created) {
            console.log(`[playoffs] scheduled Golden Spaceship & Wooden Spoon for "${seasonName}"`);
            // The field just locked: auto-finalize every remaining (now-meaningless) regular-season series.
            const stopped = await autoStopRemainingSeries(db, seasonName);
            if (stopped) console.log(`[playoffs] auto-stopped ${stopped} remaining regular-season series for "${seasonName}"`);
        }
        return created;
    } catch (err) {
        console.error(`[playoffs] scheduling failed for "${seasonName}":`, err.message);
        return false;
    }
}

module.exports = { schedulePlayoffsIfClinched, autoStopRemainingSeries };
