// Monte Carlo evaluation of one roster against another: many seven-game series, summarized.
const { makeRng, simulateSeries } = require('./engine');

// a / b: { team, policy }. Home field alternates: a hosts games 1, 2, 6, 7 in even-numbered series.
function evaluateMatchup(a, b, { nSeries, seed, ref }) {
  const rng = makeRng(seed);
  let games = 0; let wins = 0; let runsFor = 0; let runsAgainst = 0; let bestOf7 = 0;
  let sumSeriesWins = 0; let sumSqSeriesWins = 0;
  for (let s = 0; s < nSeries; s++) {
    const results = simulateSeries({ a, b, aIsSeriesHome: s % 2 === 0, rng, ref });
    let w = 0; let l = 0; let decided = false;
    for (const r of results) {
      games++; runsFor += r.aRuns; runsAgainst += r.bRuns;
      if (r.aRuns > r.bRuns) { wins++; w++; } else l++;
      if (!decided && (w === 4 || l === 4)) { decided = true; if (w === 4) bestOf7++; }
    }
    sumSeriesWins += w; sumSqSeriesWins += w * w;
  }
  const winsPer7 = sumSeriesWins / nSeries;
  // Standard errors come from series-level variance: games within a series share bullpen fatigue.
  const seWinsPer7 = Math.sqrt(Math.max(0, sumSqSeriesWins / nSeries - winsPer7 * winsPer7) / nSeries);
  const p7 = bestOf7 / nSeries;
  return {
    nSeries, games,
    winPct: wins / games, seWinPct: seWinsPer7 / 7,
    winsPer7, seWinsPer7,
    bestOf7: p7, seBestOf7: Math.sqrt(p7 * (1 - p7) / nSeries),
    runsFor: runsFor / games, runsAgainst: runsAgainst / games,
  };
}

module.exports = { evaluateMatchup };
