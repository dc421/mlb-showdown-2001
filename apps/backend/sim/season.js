/* eslint-disable no-console */
// Simulate whole league seasons: a single round robin of fixed seven-game series (record = game
// wins), then the top two play the Golden Spaceship and the bottom two the Wooden Spoon (best of 7,
// better seed is series home; the Spoon's loser earns it). Ties in the standings break on
// head-to-head, then a coin flip.
//
// Usage (from apps/backend):  node sim/season.js [--seasons 20000] [--seed 1] [--previous]
// --previous plays every team's end-of-last-season roster (sim/data/previous-rosters.json) instead.
const { loadCards } = require('./cards');
const { loadTeam, buildTeam, leagueCities, rosterWarnings } = require('./teams');
const { bostonPolicy, opponentPolicy } = require('./managers');
const { makeRng, simulateSeries } = require('./engine');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const nSeasons = parseInt(flag('seasons', '20000'), 10);
const seed = parseInt(flag('seed', '1'), 10);

const pool = loadCards();
const previous = args.includes('--previous') && require('./data/previous-rosters.json');
const teams = leagueCities().map((city) => (previous
  ? buildTeam(city, previous.filter((r) => r.team === city).map((r) => ({ card: pool.byId.get(r.card_id), role: r.assignment })))
  : loadTeam(city, pool)));
if (previous) console.log(`Rosters: ${[...new Set(previous.map((r) => r.season))].join(', ')}`);
for (const t of teams) for (const w of rosterWarnings(t)) console.warn(`! ${t.name}: ${w}`);
const sides = teams.map((team) => ({ team, policy: team.name.toLowerCase() === 'boston' ? bostonPolicy() : opponentPolicy() }));
const n = teams.length;
const pairs = [];
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);

const rng = makeRng(seed);
const seriesWins = (i, j, aIsSeriesHome, games) => {
  let w = 0; let l = 0;
  for (const r of simulateSeries({ a: sides[i], b: sides[j], aIsSeriesHome, rng, ref: pool.ref, games })) {
    if (r.aRuns > r.bRuns) w++; else l++;
  }
  return [w, l];
};
// Best of 7 (the engine plays all seven; the series ends at the first to four).
const bestOf7 = (hi, lo) => {
  let w = 0; let l = 0;
  for (const r of simulateSeries({ a: sides[hi], b: sides[lo], aIsSeriesHome: true, rng, ref: pool.ref })) {
    if (r.aRuns > r.bRuns) w++; else l++;
    if (w === 4) return hi;
    if (l === 4) return lo;
  }
  return w > l ? hi : lo;
};

const agg = teams.map(() => ({ wins: 0, sqWins: 0, seed: new Array(n).fill(0), inShip: 0, ship: 0, inSpoon: 0, spoon: 0 }));
const t0 = Date.now();
for (let s = 0; s < nSeasons; s++) {
  const wins = new Array(n).fill(0);
  const h2h = teams.map(() => new Array(n).fill(0));
  for (const [i, j] of pairs) {
    const [w, l] = seriesWins(i, j, rng() < 0.5, 7);
    wins[i] += w; wins[j] += l; h2h[i][j] += w; h2h[j][i] += l;
  }
  const tiebreak = teams.map(() => rng());
  const order = [...Array(n).keys()].sort((a, b) => {
    if (wins[a] !== wins[b]) return wins[b] - wins[a];
    // Head-to-head among the tied group: wins against everyone else on the same record.
    const tied = [...Array(n).keys()].filter((k) => wins[k] === wins[a]);
    const h = (x) => tied.reduce((sum, k) => sum + h2h[x][k], 0);
    return h(b) - h(a) || tiebreak[a] - tiebreak[b];
  });
  order.forEach((t, rank) => {
    agg[t].seed[rank]++; agg[t].wins += wins[t]; agg[t].sqWins += wins[t] * wins[t];
  });
  const [s1, s2] = order; const [b2, b1] = order.slice(-2); // b1 = last place
  agg[s1].inShip++; agg[s2].inShip++; agg[b1].inSpoon++; agg[b2].inSpoon++;
  agg[bestOf7(s1, s2)].ship++;
  const spoonWinner = bestOf7(b2, b1);
  agg[spoonWinner === b1 ? b2 : b1].spoon++;
}

const games = 7 * (n - 1);
const pct = (x) => `${(100 * x / nSeasons).toFixed(1)}%`;
console.log(`\n${nSeasons} simulated seasons (${games} games each, seed ${seed}, ${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
const rows = teams.map((t, k) => {
  const a = agg[k]; const w = a.wins / nSeasons;
  const sd = Math.sqrt(Math.max(0, a.sqWins / nSeasons - w * w));
  return {
    team: t.name, w, row: {
      'W-L': `${w.toFixed(1)}-${(games - w).toFixed(1)}`, 'W sd': sd.toFixed(1),
      ...Object.fromEntries(a.seed.map((c, r) => [`#${r + 1}`, pct(c)])),
      'in Spaceship': pct(a.inShip), 'wins Spaceship': pct(a.ship),
      'in Spoon series': pct(a.inSpoon), 'gets Spoon': pct(a.spoon),
    },
  };
}).sort((x, y) => y.w - x.w);
console.table(Object.fromEntries(rows.map((r) => [r.team, r.row])));
