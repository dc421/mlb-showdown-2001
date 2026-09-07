require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await pool.query(`
    SELECT count(*) rows,
           pg_size_pretty(sum(octet_length(state_data::text))::bigint) uncompressed_text,
           avg(octet_length(state_data::text))::bigint avg_text_bytes
    FROM game_states WHERE game_id IN (
      SELECT g.game_id FROM games g JOIN series s ON g.series_id=s.id JOIN series_results sr ON s.series_result_id=sr.id
      WHERE g.status='completed' AND sr.season_name='Spring 2026')`);
  console.table(r.rows);
  const k = await pool.query(`
    SELECT key, pg_size_pretty(sum(octet_length(value::text))::bigint) total
    FROM game_states gs, jsonb_each(gs.state_data)
    WHERE gs.game_id IN (SELECT g.game_id FROM games g JOIN series s ON g.series_id=s.id JOIN series_results sr ON s.series_result_id=sr.id
      WHERE g.status='completed' AND sr.season_name='Spring 2026')
    GROUP BY key ORDER BY sum(octet_length(value::text)) DESC LIMIT 12`);
  console.log('\nlargest keys inside state_data (season-wide):');
  console.table(k.rows);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
