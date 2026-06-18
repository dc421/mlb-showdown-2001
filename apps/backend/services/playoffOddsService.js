// Precomputes and caches the Monte Carlo spaceship/spoon odds for a season so the
// league page never runs the simulation on the request path.
//
// The cache (playoff_odds_cache) is keyed by season and stamped with a `signature`
// derived from that season's result rows. On read we recompute the signature from the
// live rows: if it matches the cached one we serve the stored odds, otherwise we
// recompute, store, and serve (self-healing). The result-entry endpoint also calls
// recomputeOdds() right after a save so the cache is warm before anyone loads the page.

const crypto = require('crypto');
const { pool } = require('../db');
const { calculateStandings } = require('../utils/standingsUtils');

// The same row set the league page builds standings/odds from (Classic excluded).
async function fetchSeasonData(db, seasonName) {
    const teamsRes = await db.query('SELECT team_id, name, city, logo_url FROM teams');
    const resultsRes = await db.query(
        `SELECT * FROM series_results
         WHERE style IS DISTINCT FROM 'Classic' AND season_name = $1
         ORDER BY date DESC`,
        [seasonName]
    );
    return { currentTeams: teamsRes.rows, seriesResults: resultsRes.rows };
}

// Order-independent hash of every field that can change the odds. Any edited/added/
// removed result row changes this, which invalidates the cache.
function computeSignature(seriesResults) {
    const parts = seriesResults
        .map(r => [
            r.id, r.round,
            r.winning_team_id, r.losing_team_id,
            r.winning_team_name, r.losing_team_name,
            r.winning_score, r.losing_score
        ].join(':'))
        .sort();
    return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

// Pull the odds off a computed standings array into a map keyed the same way
// calculateStandings keys its internal teamStats ("ID-<id>" / "NAME-<name>").
function extractOddsMap(standings) {
    const map = {};
    for (const s of standings) {
        if (s.spaceshipOdds === undefined) continue;
        const key = s.team_id ? `ID-${s.team_id}` : `NAME-${s.name}`;
        map[key] = { spaceshipOdds: s.spaceshipOdds, spoonOdds: s.spoonOdds };
    }
    return map;
}

async function storeOdds(db, seasonName, signature, oddsMap, numSims) {
    await db.query(
        `INSERT INTO playoff_odds_cache (season_name, signature, odds, num_sims, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (season_name)
         DO UPDATE SET signature = $2, odds = $3, num_sims = $4, updated_at = now()`,
        [seasonName, signature, JSON.stringify(oddsMap), numSims]
    );
}

// Runs the simulation for `seriesResults` and returns the odds map (no DB access).
const NUM_SIMS = 50000;
function simulate(seriesResults, currentTeams) {
    const standings = calculateStandings(seriesResults, currentTeams, false, { numSims: NUM_SIMS });
    return extractOddsMap(standings);
}

// Recompute from scratch and persist. Called after a result is entered/edited.
// Never throws into the caller — odds are a non-critical, self-healing cache.
async function recomputeOdds(db = pool, seasonName) {
    if (!seasonName) return null;
    try {
        const { seriesResults, currentTeams } = await fetchSeasonData(db, seasonName);
        const oddsMap = simulate(seriesResults, currentTeams);
        await storeOdds(db, seasonName, computeSignature(seriesResults), oddsMap, NUM_SIMS);
        return oddsMap;
    } catch (err) {
        console.error(`[playoffOdds] recompute failed for "${seasonName}":`, err.message);
        return null;
    }
}

// Read path: return the cached odds map if it matches the live rows, otherwise
// recompute synchronously, store, and return. `seriesResults`/`currentTeams` are the
// rows the caller already fetched, so a cache hit costs just one small SELECT.
async function getCachedOddsMap(db, seasonName, seriesResults, currentTeams) {
    const signature = computeSignature(seriesResults);
    try {
        const cached = await db.query(
            'SELECT signature, odds FROM playoff_odds_cache WHERE season_name = $1',
            [seasonName]
        );
        if (cached.rows[0] && cached.rows[0].signature === signature) {
            return cached.rows[0].odds;
        }
        const oddsMap = simulate(seriesResults, currentTeams);
        await storeOdds(db, seasonName, signature, oddsMap, NUM_SIMS);
        return oddsMap;
    } catch (err) {
        // On any failure, fall back to computing without caching so the page still works.
        console.error(`[playoffOdds] cache read failed for "${seasonName}":`, err.message);
        return simulate(seriesResults, currentTeams);
    }
}

module.exports = { recomputeOdds, getCachedOddsMap, computeSignature };
