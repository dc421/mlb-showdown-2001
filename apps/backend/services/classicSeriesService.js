// Ties in-app Classic series to their Classic so results show on the Classic page. A Classic series is
// created ad hoc from the dashboard (no scheduled row), so once both teams are known we give it a
// Classic series_results row for its bracket round and link the two — from then on the normal
// series_result_id write-back in handleSeriesProgression keeps that row's score current.

const { getClassicSeeding } = require('./classicSeedingService');
const { classicRoundForPair } = require('../utils/seriesUtils');

// Season label for a Classic's result rows: whatever its earlier rows used, else the Classic's own
// name. Never the current league season's name — that would merge Classic rows into league views.
async function classicSeasonName(db, classic) {
    const res = await db.query(
        `SELECT season_name FROM series_results
         WHERE style = 'Classic' AND classic_id = $1 AND season_name IS NOT NULL
         ORDER BY date LIMIT 1`,
        [classic.id]
    );
    return res.rows.length > 0 ? res.rows[0].season_name : classic.name;
}

// Returns the new series_results id, or null when the series isn't a bracket matchup of the Classic
// (unseeded team, or that matchup already has a recorded result).
async function linkClassicSeries(db, seriesId, homeUserId, awayUserId) {
    const seriesRes = await db.query('SELECT classic_id FROM series WHERE id = $1', [seriesId]);
    const classicId = seriesRes.rows[0] && seriesRes.rows[0].classic_id;
    const classicRes = classicId
        ? await db.query('SELECT * FROM classics WHERE id = $1', [classicId])
        : await db.query('SELECT * FROM classics WHERE is_active = true LIMIT 1');
    const classic = classicRes.rows[0];
    if (!classic) return null;

    const seeding = await getClassicSeeding(classic, db);
    const round = classicRoundForPair(seeding, homeUserId, awayUserId);
    if (!round) return null;

    const teamsRes = await db.query(
        'SELECT team_id, user_id, city, name FROM teams WHERE user_id = ANY($1)',
        [[homeUserId, awayUserId]]
    );
    const home = teamsRes.rows.find(t => t.user_id === homeUserId);
    const away = teamsRes.rows.find(t => t.user_id === awayUserId);
    if (!home || !away) return null;

    // Already recorded (e.g. entered by hand) — don't add a second result for the same matchup.
    const existing = await db.query(
        `SELECT 1 FROM series_results
         WHERE style = 'Classic' AND classic_id = $1
           AND ((winning_team_id = $2 AND losing_team_id = $3) OR (winning_team_id = $3 AND losing_team_id = $2))
         LIMIT 1`,
        [classic.id, home.team_id, away.team_id]
    );
    if (existing.rows.length > 0) return null;

    const seasonName = await classicSeasonName(db, classic);
    // Same orientation as a scheduled row: home in the winning_* slot until the series is decided.
    const inserted = await db.query(
        `INSERT INTO series_results (
            date, season_name, style, round,
            winning_team_name, losing_team_name, winning_team_id, losing_team_id,
            winning_score, losing_score, status, result_source, classic_id
         ) VALUES (NOW(), $1, 'Classic', $2, $3, $4, $5, $6, 0, 0, 'in_progress', 'in_app', $7)
         RETURNING id`,
        [seasonName, round, `${home.city} ${home.name}`, `${away.city} ${away.name}`, home.team_id, away.team_id, classic.id]
    );
    const seriesResultId = inserted.rows[0].id;
    await db.query(
        'UPDATE series SET classic_id = $1, series_result_id = $2 WHERE id = $3',
        [classic.id, seriesResultId, seriesId]
    );
    return seriesResultId;
}

module.exports = { linkClassicSeries, classicSeasonName };
