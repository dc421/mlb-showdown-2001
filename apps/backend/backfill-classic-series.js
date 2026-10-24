// One-off: link in-app Classic series that were played before handleSeriesProgression learned to tie
// them to their Classic, and write their current score through. Dry run (rolled back) by default;
// pass --apply to commit.
//   node backfill-classic-series.js [--apply]

const { pool } = require('./db');
const { linkClassicSeries } = require('./services/classicSeriesService');
const { resolveSeriesResultUpdate } = require('./utils/seriesUtils');

async function main() {
    const apply = process.argv.includes('--apply');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Only the active Classic's era: older unlinked series predate the bracket being played in-app.
        const candidates = (await client.query(`
            SELECT s.id, s.series_home_user_id, s.series_away_user_id, s.home_wins, s.away_wins, s.status
            FROM series s
            JOIN classics c ON c.is_active = true
            WHERE s.series_type = 'classic' AND s.series_result_id IS NULL
              AND s.series_away_user_id IS NOT NULL AND s.created_at >= c.created_at
              AND EXISTS (SELECT 1 FROM games g WHERE g.series_id = s.id AND g.status = 'completed')
            ORDER BY s.id`)).rows;

        for (const s of candidates) {
            const resultId = await linkClassicSeries(client, s.id, s.series_home_user_id, s.series_away_user_id);
            if (!resultId) {
                console.log(`series ${s.id}: skipped (not a bracket matchup, or already recorded)`);
                continue;
            }
            const row = (await client.query('SELECT * FROM series_results WHERE id = $1', [resultId])).rows[0];
            const teams = (await client.query('SELECT user_id, team_id FROM teams WHERE user_id = ANY($1)',
                [[s.series_home_user_id, s.series_away_user_id]])).rows;
            const update = resolveSeriesResultUpdate(row, {
                homeTeamId: teams.find(t => t.user_id === s.series_home_user_id).team_id,
                awayTeamId: teams.find(t => t.user_id === s.series_away_user_id).team_id,
                homeGames: s.home_wins,
                awayGames: s.away_wins,
                isOver: s.status === 'completed',
            });
            await client.query(
                `UPDATE series_results SET
                    status = $1, result_source = $2,
                    winning_team_id = $3, winning_team_name = $4, winning_score = $5,
                    losing_team_id = $6, losing_team_name = $7, losing_score = $8
                 WHERE id = $9`,
                [update.status, update.result_source,
                 update.winning_team_id, update.winning_team_name, update.winning_score,
                 update.losing_team_id, update.losing_team_name, update.losing_score, resultId]
            );
            console.log(`series ${s.id}: ${row.round} (${row.season_name}) → ${update.winning_team_name} ${update.winning_score}-${update.losing_score} ${update.losing_team_name} [${update.status}], series_results ${resultId}`);
        }

        await client.query(apply ? 'COMMIT' : 'ROLLBACK');
        console.log(apply ? 'Committed.' : 'Dry run — rolled back. Pass --apply to commit.');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
