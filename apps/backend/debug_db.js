const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("--- TEAMS ---");
    const teams = await client.query('SELECT team_id, name, city, user_id FROM teams');
    console.table(teams.rows);

    console.log("\n--- DRAFT HISTORY (Top 10) ---");
    const history = await client.query('SELECT * FROM draft_history ORDER BY created_at DESC LIMIT 10');
    console.table(history.rows);

    console.log("\n--- RANDOM REMOVALS (Top 10) ---");
    const rr = await client.query('SELECT * FROM random_removals LIMIT 10');
    console.table(rr.rows);

    console.log("\n--- HISTORICAL ROSTERS (Top 5) ---");
    const hr = await client.query('SELECT * FROM historical_rosters LIMIT 5');
    console.table(hr.rows);

  } catch (e) {
    console.error(e);
  } finally {
    client.release();
    pool.end();
  }
}

run();
