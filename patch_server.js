const fs = require('fs');

const serverPath = 'apps/backend/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

const searchBlock = `  if (game.series_id) {
      const seriesResult = await dbClient.query('SELECT * FROM series WHERE id = $1', [game.series_id]);
      series = seriesResult.rows[0];
  }`;

const replaceBlock = `  if (game.series_id) {
      const seriesResult = await dbClient.query('SELECT * FROM series WHERE id = $1', [game.series_id]);
      series = seriesResult.rows[0];

      // Re-calculate historical series score up to this game
      if (series && game.status === 'completed') {
          try {
              const prevGamesResult = await dbClient.query(\`
                  SELECT g.game_id, g.home_team_user_id,
                         (SELECT state_data->>'winningTeam' FROM game_states gs WHERE gs.game_id = g.game_id ORDER BY turn_number DESC LIMIT 1) as winning_team,
                         (SELECT user_id FROM game_participants gp WHERE gp.game_id = g.game_id AND gp.user_id != g.home_team_user_id LIMIT 1) as away_team_user_id
                  FROM games g
                  WHERE g.series_id = $1 AND g.game_in_series <= $2 AND g.status = 'completed'
              \`, [game.series_id, game.game_in_series]);

              let histHomeWins = 0;
              let histAwayWins = 0;

              for (const row of prevGamesResult.rows) {
                  const winnerId = row.winning_team === 'home' ? row.home_team_user_id : row.away_team_user_id;
                  if (winnerId === series.series_home_user_id) {
                      histHomeWins++;
                  } else if (winnerId === series.series_away_user_id) {
                      histAwayWins++;
                  }
              }

              series.historical_home_wins = histHomeWins;
              series.historical_away_wins = histAwayWins;
          } catch (e) {
              console.error("Error calculating historical series score:", e);
          }
      }
  }`;

if (content.includes(searchBlock)) {
    content = content.replace(searchBlock, replaceBlock);
    fs.writeFileSync(serverPath, content);
    console.log("Success");
} else {
    console.log("Failed to find block");
}
