const fs = require('fs');

const serverPath = 'apps/backend/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

const searchBlock = `              for (const row of prevGamesResult.rows) {
                  const winnerId = row.winning_team === 'home' ? row.home_team_user_id : row.away_team_user_id;
                  if (winnerId === series.series_home_user_id) {
                      histHomeWins++;
                  } else if (winnerId === series.series_away_user_id) {
                      histAwayWins++;
                  }
              }`;

const replaceBlock = `              for (const row of prevGamesResult.rows) {
                  const winnerId = row.winning_team === 'home' ? row.home_team_user_id : row.away_team_user_id;
                  if (winnerId === series.series_home_user_id) {
                      histHomeWins++;
                  } else {
                      histAwayWins++;
                  }
              }`;

if (content.includes(searchBlock)) {
    content = content.replace(searchBlock, replaceBlock);
    fs.writeFileSync(serverPath, content);
    console.log("Success");
} else {
    console.log("Failed to find block");
}
