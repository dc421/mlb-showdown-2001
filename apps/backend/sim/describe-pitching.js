/* eslint-disable no-console */
// Pitching changes, three ways side by side: how the league's other managers actually manage, how
// Boston has actually managed (both from game logs), and how the optimized Boston policy manages in
// simulation (Boston vs each opponent).
//
// Usage (from apps/backend):  node sim/describe-pitching.js [--series 300]
const { historyRecords } = require('./calibrate');
const { loadCards } = require('./cards');
const { loadTeam, leagueCities } = require('./teams');
const { bostonPolicy, opponentPolicy } = require('./managers');
const { makeRng, simulateSeries } = require('./engine');

const i = process.argv.indexOf('--series');
const nSeries = i >= 0 ? parseInt(process.argv[i + 1], 10) : 300;
const pool = loadCards();

function bostonSim() {
  const boston = loadTeam('Boston', pool);
  const trace = [];
  const rng = makeRng(7);
  leagueCities().filter((c) => c !== 'Boston').forEach((city, k) => {
    const opp = loadTeam(city, pool);
    for (let s = 0; s < nSeries; s++) {
      simulateSeries({ a: { team: boston, policy: bostonPolicy() }, b: { team: opp, policy: opponentPolicy() },
        aIsSeriesHome: s % 2 === 0, rng, ref: pool.ref, trace, key: `${k}-${s}` });
    }
  });
  return trace.filter((r) => r.defTeam === 'Boston');
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
function describe(recs) {
  const sides = Object.values(recs.reduce((m, r) => { (m[r.def] = m[r.def] || []).push(r); return m; }, {}));
  const opp = recs.filter((r) => r.halfStart && r.incumbent !== undefined && r.incLegal && !r.forced);
  const pulled = (f) => { const c = opp.filter(f); return `${pct(c.filter((r) => r.pitcher !== r.incumbent).length, c.length)} (${c.length})`; };
  const blow = (r) => Math.abs(r.lead) >= 5;
  const entries = recs.filter((r) => r.entry);
  const ranked = entries.filter((r) => !r.entry.replacement);
  const hi = (r) => Math.abs(r.lead) <= 2 && r.inning >= 7;
  const best = (f) => { const c = ranked.filter(f); return `${pct(c.filter((r) => r.entry.rank === 0).length, c.length)} (${c.length})`; };
  const blowEntries = entries.filter((r) => Math.abs(r.lead) >= 6 && r.inning >= 5);
  const mean = (f) => (sides.reduce((s, x) => s + f(x), 0) / sides.length).toFixed(2);
  return {
    'games': sides.length,
    'untired starter pulled': pulled((r) => r.incStarter && r.incPenalty === 0),
    'tired starter pulled, close (within 4)': pulled((r) => r.incStarter && r.incPenalty > 0 && !blow(r)),
    'tired starter pulled, blowout (5+)': pulled((r) => r.incStarter && r.incPenalty > 0 && blow(r)),
    'untired reliever pulled': pulled((r) => !r.incStarter && r.incPenalty === 0),
    'tired reliever pulled, close': pulled((r) => !r.incStarter && r.incPenalty > 0 && !blow(r)),
    'tired reliever pulled, blowout': pulled((r) => !r.incStarter && r.incPenalty > 0 && blow(r)),
    'best arm used: close & 7th+': best(hi),
    'best arm used: other spots': best((r) => !hi(r)),
    'reliever entered tired': `${pct(ranked.filter((r) => r.entry.tired).length, ranked.length)}`,
    '...while a fresh arm was available': `${pct(ranked.filter((r) => r.entry.tired && r.entry.freshAvailable > 0).length, ranked.length)}`,
    'replacement pitcher, of changes in 6+ run games': `${pct(blowEntries.filter((r) => r.entry.replacement).length, blowEntries.length)} (${blowEntries.length})`,
    'starter innings per game': mean((x) => new Set(x.filter((r) => r.starter).map((r) => r.inning)).size),
    'relievers per game': mean((x) => new Set(x.filter((r) => !r.starter).map((r) => r.pitcher)).size),
    'PAs thrown by a tired pitcher': pct(recs.filter((r) => r.penalty > 0).length, recs.length),
    'mid-inning changes per game': mean((x) => x.filter((r, k) => k > 0 && !r.halfStart && r.pitcher !== x[k - 1].pitcher).length),
  };
}

const real = historyRecords();
const cols = {
  'Opponents (real)': describe(real.filter((r) => !r.isBoston)),
  'Boston (real)': describe(real.filter((r) => r.isBoston)),
  'Boston optimized (sim)': describe(bostonSim()),
};
const rows = {};
for (const k of Object.keys(cols['Opponents (real)'])) rows[k] = Object.fromEntries(Object.entries(cols).map(([c, v]) => [c, v[k]]));
console.log('Pulled = share of half-innings where the pitcher was replaced, among those where he could legally');
console.log('be and wasn\'t hit for. (n) = number of such spots. "Best arm" ranks available relievers by');
console.log('quality at current fatigue.');
console.table(rows);
