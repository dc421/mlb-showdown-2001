const fs = require('fs');

const gameViewPath = 'apps/frontend/src/views/GameView.vue';
let content = fs.readFileSync(gameViewPath, 'utf8');

content = content.replace(
  `  const homeWins = series.home_wins;
  const awayWins = series.away_wins;`,
  `  const isHomeTeamSeriesHome = homeTeam.userId === series.series_home_user_id;
  const homeWins = isHomeTeamSeriesHome ? series.home_wins : series.away_wins;
  const awayWins = isHomeTeamSeriesHome ? series.away_wins : series.home_wins;`
);

content = content.replace(
  `  const homeWins = series.home_wins;
  const awayWins = series.away_wins;`,
  `  const isHomeTeamSeriesHome = homeTeam.userId === series.series_home_user_id;
  const homeWins = isHomeTeamSeriesHome ? series.home_wins : series.away_wins;
  const awayWins = isHomeTeamSeriesHome ? series.away_wins : series.home_wins;`
);

fs.writeFileSync(gameViewPath, content);
