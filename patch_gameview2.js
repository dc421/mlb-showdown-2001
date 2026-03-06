const fs = require('fs');

const gameViewPath = 'apps/frontend/src/views/GameView.vue';
let content = fs.readFileSync(gameViewPath, 'utf8');

const searchBlock = `  const isHomeTeamSeriesHome = homeTeam.userId === series.series_home_user_id;
  const homeWins = isHomeTeamSeriesHome ? series.home_wins : series.away_wins;
  const awayWins = isHomeTeamSeriesHome ? series.away_wins : series.home_wins;`;

const replaceBlock = `  const isHomeTeamSeriesHome = homeTeam.userId === series.series_home_user_id;

  let sHomeWins = series.home_wins;
  let sAwayWins = series.away_wins;

  if (isGameOver.value && series.historical_home_wins !== undefined && series.historical_away_wins !== undefined) {
      sHomeWins = series.historical_home_wins;
      sAwayWins = series.historical_away_wins;
  }

  const homeWins = isHomeTeamSeriesHome ? sHomeWins : sAwayWins;
  const awayWins = isHomeTeamSeriesHome ? sAwayWins : sHomeWins;`;

content = content.replace(searchBlock, replaceBlock);
content = content.replace(searchBlock, replaceBlock); // run twice for seriesStatusText

fs.writeFileSync(gameViewPath, content);
console.log("Updated GameView.vue");
