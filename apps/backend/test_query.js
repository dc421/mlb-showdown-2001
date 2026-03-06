const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://myuser:mypassword@localhost:5432/mydatabase'
});

async function run() {
  const result = await pool.query(`
    SELECT g.game_id, g.game_in_series, g.home_team_user_id, g.status,
           (SELECT state_data->>'winningTeam' FROM game_states gs WHERE gs.game_id = g.game_id ORDER BY turn_number DESC LIMIT 1) as winning_team,
           (SELECT user_id FROM game_participants gp WHERE gp.game_id = g.game_id AND gp.user_id != g.home_team_user_id LIMIT 1) as away_team_user_id
    FROM games g
    LIMIT 5
  `);
  console.log(result.rows);
  pool.end();
}
run();
