/* eslint-disable no-console */
// Simulate many seven-game series between two rosters.
//
// Usage (from apps/backend):
//   node sim/run.js <rosterA> <rosterB> [--series 2000] [--seed 1]
//
// A roster is a league city from the snapshot ("Boston"), a CSV with Player and Pos columns, or
// "file.csv:Team" for a CSV that holds several teams. Run `node sim/fetch-data.js` first to
// snapshot the card pool and league rosters.
//
// Boston is managed by the Boston policy and everyone else by the calibrated opponent policy (both
// in managers.js, built on the 13 decision functions in policy.js).
const { loadCards } = require('./cards');
const { loadTeam, rosterWarnings } = require('./teams');
const { bostonPolicy, opponentPolicy } = require('./managers');
const { evaluateMatchup } = require('./evaluate');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const flagNames = ['series', 'seed'];
const specs = args.filter((a, i) => !a.startsWith('--') && !flagNames.includes((args[i - 1] || '').slice(2)));
if (specs.length !== 2) {
  console.error('Usage: node sim/run.js <rosterA> <rosterB> [--series 2000] [--seed 1]');
  process.exit(1);
}
const nSeries = parseInt(flag('series', '2000'), 10);
const seed = parseInt(flag('seed', '1'), 10);

const pool = loadCards();
const [teamA, teamB] = specs.map((s) => loadTeam(s, pool));
for (const t of [teamA, teamB]) {
  if (t.source) console.log(`${t.name}: ${t.source}`);
  for (const w of rosterWarnings(t)) console.warn(`! ${t.name}: ${w}`);
}

// Boston is managed with the Boston policy, everyone else with the league's typical (opponent) policy.
const policyFor = (team) => (team.name.toLowerCase() === 'boston' ? bostonPolicy() : opponentPolicy());
const a = { team: teamA, policy: policyFor(teamA) };
const b = { team: teamB, policy: policyFor(teamB) };

const t0 = Date.now();
const r = evaluateMatchup(a, b, { nSeries, seed, ref: pool.ref });

const pct = (x) => `${(100 * x).toFixed(1)}%`;
console.log(`\n${teamA.name} vs ${teamB.name} — ${nSeries} seven-game series (${r.games} games, seed ${seed}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.table({
  [teamA.name]: { 'game win%': pct(r.winPct), 'runs/game': r.runsFor.toFixed(2), 'wins per 7': r.winsPer7.toFixed(2), 'best-of-7 win%': pct(r.bestOf7) },
  [teamB.name]: { 'game win%': pct(1 - r.winPct), 'runs/game': r.runsAgainst.toFixed(2), 'wins per 7': (7 - r.winsPer7).toFixed(2), 'best-of-7 win%': pct(1 - r.bestOf7) },
});
console.log(`Uncertainty (1 s.e.): game win% ±${pct(r.seWinPct)}, wins per 7 ±${r.seWinsPer7.toFixed(2)}, best-of-7 ±${pct(r.seBestOf7)}`);
