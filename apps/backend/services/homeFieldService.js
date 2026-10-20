// Decides how a game's setup screen picks the home team (see homeFieldRule):
//   'roll'   — regular-season series: both players roll, high roll is home
//   'seed'   — Spaceship/Spoon/Classic: the higher seed is home automatically (seededHomeUserId)
//   'choose' — everything else: declare or roll
// Only game 1 of a series goes through this; later games have their home team preset by the series.

const { pool } = require('../db');
const { homeFieldRule, higherClassicSeedUserId } = require('../utils/seriesUtils');
const { getClassicSeeding } = require('./classicSeedingService');

async function resolveHomeField(gameId, db = pool) {
    const gameRes = await db.query(
        `SELECT g.game_in_series, s.series_type, s.classic_id AS series_classic_id,
                sr.winning_team_id, sr.losing_team_id, sr.classic_id AS result_classic_id
         FROM games g
         LEFT JOIN series s ON s.id = g.series_id
         LEFT JOIN series_results sr ON sr.id = s.series_result_id
         WHERE g.game_id = $1`,
        [gameId]
    );
    const game = gameRes.rows[0];
    if (!game || !game.series_type || Number(game.game_in_series) !== 1) return { rule: 'choose', seededHomeUserId: null };

    const rule = homeFieldRule(game.series_type);
    if (rule !== 'seed') return { rule, seededHomeUserId: null };

    const participants = (await db.query(
        `SELECT gp.user_id, u.team_id FROM game_participants gp JOIN users u ON u.user_id = gp.user_id WHERE gp.game_id = $1`,
        [gameId]
    )).rows;
    if (participants.length !== 2) return { rule, seededHomeUserId: null };

    let seededHomeUserId = null;
    if (game.series_type === 'classic') {
        const classicId = game.series_classic_id || game.result_classic_id;
        const classicRes = classicId
            ? await db.query('SELECT * FROM classics WHERE id = $1', [classicId])
            : await db.query('SELECT * FROM classics WHERE is_active = true LIMIT 1');
        if (classicRes.rows.length > 0) {
            const seeding = await getClassicSeeding(classicRes.rows[0], db);
            seededHomeUserId = higherClassicSeedUserId(seeding, participants[0].user_id, participants[1].user_id);
        }
    } else if (game.winning_team_id) {
        // Spaceship/Spoon rows are scheduled with the higher seed in the winning_* slot, and game 1's
        // setup runs before any result can reorder them.
        const top = participants.find(p => p.team_id === game.winning_team_id);
        if (top && participants.some(p => p.team_id === game.losing_team_id)) seededHomeUserId = top.user_id;
    }

    // Seeds unknown (e.g. an unseeded Classic team) → let the players decide.
    if (!seededHomeUserId) return { rule: 'choose', seededHomeUserId: null };
    return { rule, seededHomeUserId };
}

module.exports = { resolveHomeField };
