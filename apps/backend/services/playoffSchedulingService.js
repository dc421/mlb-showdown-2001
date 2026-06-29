// Auto-creates the Golden Spaceship (top 2 play each other) and Wooden Spoon (bottom 2) series for a
// season as soon as the playoff field is mathematically clinched — i.e. both spaceship seeds and both
// spoon seeds have locked (the x-/z- clinch letters), even if regular-season games remain.
//
// We always create BOTH series together. Creating just one would make calculateStandings treat the
// season as "postseason set" and stop computing odds, which would hide the other field's clinch and
// prevent it from ever scheduling. So we wait until the whole field is determined, then create both.

const { pool } = require('../db');
const { calculateStandings } = require('../utils/standingsUtils');

const PLAYOFF_ROUNDS = ['Golden Spaceship', 'Wooden Spoon'];

// Creates one playoff series row (scores empty). Callers guard against re-creation via the existing
// rounds, so a plain parameterized INSERT is enough (and avoids the parameter-type ambiguity an
// INSERT ... SELECT ... WHERE NOT EXISTS hits by reusing the same placeholder in two positions).
function insertSeries(db, seasonName, round, seeds) {
    return db.query(
        `INSERT INTO series_results
            (season_name, round, date, winning_team_id, losing_team_id, winning_team_name, losing_team_name, winning_score, losing_score)
         VALUES ($1, $2, now(), $3, $4, $5, $6, NULL, NULL)`,
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
        if (created) console.log(`[playoffs] scheduled Golden Spaceship & Wooden Spoon for "${seasonName}"`);
        return created;
    } catch (err) {
        console.error(`[playoffs] scheduling failed for "${seasonName}":`, err.message);
        return false;
    }
}

module.exports = { schedulePlayoffsIfClinched };
