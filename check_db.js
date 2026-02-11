const { Pool } = require('pg');
require('dotenv').config({ path: 'apps/backend/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function check() {
  try {
    const res = await pool.query('SELECT count(*) FROM series_results');
    console.log('Series Results:', res.rows[0].count);
    const teams = await pool.query('SELECT count(*) FROM teams');
    console.log('Teams:', teams.rows[0].count);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
check();
