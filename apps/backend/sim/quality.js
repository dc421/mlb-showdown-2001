/* eslint-disable no-console */
// Team quality: a roster's simulated game win percentage against the rest of the league, each
// opponent weighted equally (25% each with four opponents).
//
// Usage (from apps/backend):
//   node sim/quality.js <roster> [--as Boston] [--series 2000] [--seed 1] [--json]
//
// <roster> is a league city or a CSV (see run.js). The opponents are every league team except the
// one this roster stands in for: the roster's own city, or --as when the roster comes from a CSV.
// Opponents use their current roster if complete, otherwise last season's (see teams.js).
const { loadCards } = require('./cards');
const { loadTeam, rosterWarnings, leagueCities } = require('./teams');
const { bostonPolicy, opponentPolicy } = require('./managers');
const { evaluateMatchup } = require('./evaluate');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const valueFlags = ['as', 'series', 'seed'];
const specs = args.filter((a, i) => !a.startsWith('--') && !valueFlags.includes((args[i - 1] || '').slice(2)));
if (specs.length !== 1) {
  console.error('Usage: node sim/quality.js <roster> [--as Boston] [--series 2000] [--seed 1] [--json]');
  process.exit(1);
}
const nSeries = parseInt(flag('series', '2000'), 10);
const seed = parseInt(flag('seed', '1'), 10);
const asJson = args.includes('--json');

const pool = loadCards();
const team = loadTeam(specs[0], pool);
const cities = leagueCities();
const self = cities.find((c) => c.toLowerCase() === flag('as', team.name).toLowerCase());
if (!self) {
  console.error(`Which league team does "${team.name}" stand in for? Pass --as <${cities.join(' | ')}>`);
  process.exit(1);
}
const opponents = cities.filter((c) => c !== self).map((c) => loadTeam(c, pool));

// The roster being scored is managed the Boston way; opponents the way the league's other managers play.
const a = { team, policy: bostonPolicy() };
const rows = opponents.map((opp, i) => ({
  opponent: opp.name, source: opp.source,
  // A different seed per opponent keeps the four estimates independent.
  ...evaluateMatchup(a, { team: opp, policy: opponentPolicy() }, { nSeries, seed: seed + i, ref: pool.ref }),
}));
const quality = rows.reduce((s, r) => s + r.winPct, 0) / rows.length;
const se = Math.sqrt(rows.reduce((s, r) => s + r.seWinPct ** 2, 0)) / rows.length;

if (asJson) {
  console.log(JSON.stringify({ team: team.name, quality, se, opponents: rows }));
} else {
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  for (const w of rosterWarnings(team)) console.warn(`! ${team.name}: ${w}`);
  console.log(`\n${team.name}${team.source ? ` (${team.source})` : ''} — ${nSeries} seven-game series per opponent`);
  console.table(Object.fromEntries(rows.map((r) => [r.opponent, {
    'win%': pct(r.winPct), '±': pct(r.seWinPct), 'runs for': r.runsFor.toFixed(2), 'runs against': r.runsAgainst.toFixed(2), 'opponent roster': r.source,
  }])));
  console.log(`Team quality (equal-weight win%): ${pct(quality)} ± ${pct(se)}`);
}
