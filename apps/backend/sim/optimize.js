/* eslint-disable no-console */
// Score candidate Boston policies by team quality (equal-weight game win% vs every other league
// team, opponents managed by the calibrated opponent policy).
//
// Usage (from apps/backend):  node sim/optimize.js <area> [--series 3000] [--roster Boston]
//
// Every candidate is played on the same dice seeds, so differences between candidates are less
// noisy than each candidate's own ± suggests (though policies that consume different numbers of
// rolls drift apart).
const { loadCards } = require('./cards');
const { loadTeam, leagueCities } = require('./teams');
const { makePolicy } = require('./policy');
const { OPPONENT, BOSTON, opponentPolicy } = require('./managers');
const { evaluateMatchup } = require('./evaluate');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const area = args.find((a, i) => !a.startsWith('--') && !['series', 'roster'].includes((args[i - 1] || '').slice(2)));
const nSeries = parseInt(flag('series', '3000'), 10);
const rosterSpec = flag('roster', 'Boston');

const merge = (base, over) => ({ params: { ...base.params, ...over.params }, fns: { ...base.fns, ...over.fns } });
const deep = (o) => JSON.parse(JSON.stringify(o));

// Candidate sets per decision area. Each is { label, spec } where spec overrides BOSTON.
const AREAS = {
  pitching() {
    const out = [
      { label: 'league-typical (opponent) style', spec: { params: OPPONENT.params, fns: OPPONENT.fns } },
      { label: 'default quality-based', spec: {} },
    ];
    for (const starterPullMargin of [0, 0.02, 0.04, Infinity]) {
      for (const tiredPullMargin of [-0.02, 0, 0.02]) {
        out.push({
          label: `starterPull ${starterPullMargin} / tiredPull ${tiredPullMargin}`,
          spec: { params: { pitching: { starterPullMargin, relieverPullMargin: starterPullMargin, tiredPullMargin } } },
        });
      }
    }
    for (const protectTopRelievers of [0, 1, 3]) out.push({ label: `protect top ${protectTopRelievers} in blowouts`, spec: { params: { pitching: { protectTopRelievers } } } });
    for (const blowoutMargin of [3, 7, 99]) out.push({ label: `blowout margin ${blowoutMargin}`, spec: { params: { pitching: { blowoutMargin } } } });
    out.push({ label: 'no replacement pitcher', spec: { params: { pitching: { allowReplacementPitcher: false } } } });
    out.push({ label: 'mid-inning changes on (margin .03)', spec: { params: { pitching: { midInningChanges: true } } } });
    out.push({ label: 'mid-inning changes on (margin .06)', spec: { params: { pitching: { midInningChanges: true, midInningMargin: 0.06 } } } });
    return out;
  },
  // Second round: combine the first round's winners.
  pitching2() {
    const p0 = { protectTopRelievers: 0 };
    const c = (label, pitching) => ({ label, spec: { params: { pitching: { ...p0, ...pitching } } } });
    return [
      { label: 'league-typical (opponent) style', spec: { params: OPPONENT.params, fns: OPPONENT.fns } },
      { label: 'default quality-based', spec: {} },
      c('A: never hold back best arms', {}),
      c('A + mid-inning .06', { midInningChanges: true, midInningMargin: 0.06 }),
      c('A + mid-inning .08', { midInningChanges: true, midInningMargin: 0.08 }),
      c('A + mid-inning .10', { midInningChanges: true, midInningMargin: 0.10 }),
      c('A + mid-inning .06 + untired starters stay', { midInningChanges: true, midInningMargin: 0.06, starterPullMargin: Infinity }),
      c('A + tiredPull -0.02', { tiredPullMargin: -0.02 }),
      c('A + starter/reliever pull .06', { starterPullMargin: 0.06, relieverPullMargin: 0.06 }),
      c('A + reliever pull Infinity (untired relievers stay)', { relieverPullMargin: Infinity }),
    ];
  },
  // 13. DH at home. Per-opponent columns show where Boston would rather play without it.
  dh() {
    return [
      { label: 'DH when ours is better (rule)', spec: {} },
      { label: 'always DH', spec: { params: { dh: true } } },
      { label: 'never DH', spec: { params: { dh: false } } },
    ];
  },
  // 6. Pinch hitting (for the pitcher in no-DH games, and for position players late).
  pinchhit() {
    const c = (label, pinchHit) => ({ label, spec: { params: { pinchHit } } });
    return [
      { label: 'league-typical (opponent) style', spec: { params: { oppPinchHit: OPPONENT.params.oppPinchHit }, fns: { pinchHit: OPPONENT.fns.pinchHit } } },
      { label: 'default', spec: {} },
      c('for pitcher only when he would be tired', { forPitcherFromInning: 99 }),
      c('for pitcher from 6th if not leading', { forPitcherFromInning: 6 }),
      c('for pitcher from 8th if not leading', { forPitcherFromInning: 8 }),
      c('for pitcher from 7th if leading by <= 2', { forPitcherMaxLead: 2 }),
      c('for pitcher from 7th regardless of score', { forPitcherMaxLead: 99 }),
      c('never for position players', { forHitterFromInning: 99 }),
      c('for position players at edge .03', { hitterMargin: 0.03 }),
      c('for position players at edge .08', { hitterMargin: 0.08 }),
      c('for position players from 6th', { forHitterFromInning: 6 }),
    ];
  },
  // Decompose league-typical -> optimized: switch on one habit at a time.
  pitchingparts() {
    const typical = OPPONENT.params.oppPitching;
    const v = (label, over) => ({ label, spec: { params: { oppPitching: mergeDeep(typical, over) }, fns: { pitchingChange: OPPONENT.fns.pitchingChange } } });
    const always = { starter: { close: 1, mid: 1, blowout: 1 }, reliever: { close: 1, mid: 1, blowout: 1 } };
    return [
      v('league-typical', {}),
      { label: 'optimized (Boston policy)', spec: {} },
      v('typical + always pull tired pitchers', { pullTired: always }),
      v('typical + always pull tired, close games only', { pullTired: { starter: { close: 1, mid: 1 }, reliever: { close: 1, mid: 1 } } }),
      v('typical + always bring in best arm', { highLeverage: { decay: 0.001 }, otherDecay: 0.001 }),
      v('typical + no replacement pitcher', { replacement: { byMargin: [] } }),
      v('typical + pull tired + best arm', { pullTired: always, highLeverage: { decay: 0.001 }, otherDecay: 0.001 }),
      v('typical + pull tired + best arm + no replacement', { pullTired: always, highLeverage: { decay: 0.001 }, otherDecay: 0.001, replacement: { byMargin: [] } }),
    ];
  },
};

if (!AREAS[area]) { console.error(`Usage: node sim/optimize.js <${Object.keys(AREAS).join('|')}> [--series N]`); process.exit(1); }

const pool = loadCards();
const team = loadTeam(rosterSpec, pool);
const opponents = leagueCities().filter((c) => c !== team.name).map((c) => loadTeam(c, pool));

function quality(spec) {
  const s = merge(deep({ params: BOSTON.params }), {});
  const policy = makePolicy({ params: { ...s.params, ...mergeDeep(BOSTON.params, spec.params || {}) }, fns: { ...BOSTON.fns, ...(spec.fns || {}) } });
  const rows = opponents.map((opp, i) => evaluateMatchup(
    { team, policy }, { team: opp, policy: opponentPolicy() }, { nSeries, seed: 1000 + i, ref: pool.ref },
  ));
  const q = rows.reduce((t, r) => t + r.winPct, 0) / rows.length;
  const se = Math.sqrt(rows.reduce((t, r) => t + r.seWinPct ** 2, 0)) / rows.length;
  return { q, se, rows };
}
function mergeDeep(a, b) {
  const out = { ...a };
  for (const k in b) out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? mergeDeep(a[k] || {}, b[k]) : b[k];
  return out;
}

const t0 = Date.now();
const results = AREAS[area]().map((c) => ({ label: c.label, ...quality(c.spec) }));
const base = results.find((r) => /optimized|^default/.test(r.label)) ? results.find((r) => /optimized|^default/.test(r.label)).q : results[0].q;
console.log(`\n${team.name} (${team.source}), area "${area}", ${nSeries} series per opponent, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.table(Object.fromEntries(results.sort((a, b) => b.q - a.q).map((r) => [r.label, {
  'team quality': `${(100 * r.q).toFixed(2)}%`, '±': `${(100 * r.se).toFixed(2)}%`, 'vs default': `${r.q >= base ? '+' : ''}${(100 * (r.q - base)).toFixed(2)}`,
  ...Object.fromEntries(r.rows.map((x, i) => [opponents[i].name, `${(100 * x.winPct).toFixed(1)}%`])),
}])));
