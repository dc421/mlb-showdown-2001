/* eslint-disable no-console */
// Snapshot the card pool and the current league rosters into sim/data/*.json so the simulator
// runs offline. Read-only: prefers PROD_DATABASE_URL, falls back to the local DB with --local.
//
// Usage (from apps/backend):  node sim/fetch-data.js [--local]
require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { sortSeasons } = require('../utils/seasonUtils');

const useLocal = process.argv.includes('--local');

function makePool() {
  if (!useLocal && process.env.PROD_DATABASE_URL) {
    return new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return new Pool({
    user: process.env.DB_USER || process.env.PGUSER,
    host: process.env.DB_HOST || process.env.PGHOST,
    database: process.env.DB_DATABASE || process.env.PGDATABASE,
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
    port: process.env.DB_PORT || process.env.PGPORT,
  });
}

(async () => {
  const pool = makePool();
  const client = await pool.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const cards = await client.query(`
      SELECT cp.card_id, trim(cp.name) AS name, cp.display_name, cp.team, cp.set_name, cp.card_number,
             cp.on_base, cp.control, cp.ip, cp.speed, cp.fielding_ratings, cp.chart_data,
             (SELECT ppv.points FROM player_point_values ppv
                JOIN point_sets ps ON ps.point_set_id = ppv.point_set_id
               WHERE ppv.card_id = cp.card_id AND ps.name = 'Upcoming Season') AS points
      FROM cards_player cp ORDER BY cp.card_id`);
    const rosters = await client.query(`
      SELECT t.city AS team, rc.card_id, rc.assignment
      FROM teams t
      JOIN rosters r ON r.user_id = t.user_id AND r.roster_type = 'league'
      JOIN roster_cards rc ON rc.roster_id = r.roster_id
      WHERE t.user_id IS NOT NULL
      ORDER BY t.city, rc.card_id`);
    // Each team's most recent end-of-draft snapshot, used when its current roster is incomplete.
    const history = await client.query(`
      SELECT t.city AS team, hr.season, hr.card_id, hr.position AS assignment
      FROM teams t
      JOIN historical_rosters hr ON hr.team_name LIKE t.city || '%' AND hr.card_id IS NOT NULL
      WHERE t.user_id IS NOT NULL
      ORDER BY t.city, hr.card_id`);
    const previous = [];
    for (const city of new Set(history.rows.map((r) => r.team))) {
      const rows = history.rows.filter((r) => r.team === city);
      const latest = sortSeasons([...new Set(rows.map((r) => r.season))])[0];
      previous.push(...rows.filter((r) => r.season === latest));
    }
    const dir = path.join(__dirname, 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cards.json'), JSON.stringify(cards.rows));
    fs.writeFileSync(path.join(dir, 'league-rosters.json'), JSON.stringify(rosters.rows, null, 1));
    fs.writeFileSync(path.join(dir, 'previous-rosters.json'), JSON.stringify(previous, null, 1));
    console.log(`Wrote ${cards.rows.length} cards, ${rosters.rows.length} league roster rows and ${previous.length} previous-season rows to ${dir}`);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
