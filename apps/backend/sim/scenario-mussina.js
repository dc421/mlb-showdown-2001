/* eslint-disable no-console */
// Should Boston pull Mussina after four innings when the pen is fresh? Roster: current Boston with
// Mike Remlinger in for Chuck Knoblauch. Compares the current planner with a forced rule: at the
// first inning start after Mussina has 12 outs, if at least N relievers are fully fresh (unused today,
// no carryover fatigue), he comes out and the planner runs the pen from there.
const { loadCards } = require('./cards');
const { loadTeam, leagueCities } = require('./teams');
const { makePolicy } = require('./policy');
const { BOSTON, opponentPolicy, planPitchingChange } = require('./managers');
const { evaluateMatchup } = require('./evaluate');
const { getStats } = require('./rules');

const i = process.argv.indexOf('--series');
const nSeries = i >= 0 ? parseInt(process.argv[i + 1], 10) : 3000;
const pool = loadCards();
const base = loadTeam('Boston', pool);
const knob = base.hitters.find((c) => c.name.startsWith('Chuck Knoblauch'));
const remlinger = pool.cards.find((c) => c.name === 'Mike Remlinger');
const team = {
  ...base,
  hitters: base.hitters.filter((c) => c !== knob),
  bench: base.bench.filter((c) => c !== knob),
  relievers: [...base.relievers, remlinger],
};
const isMussina = (c) => c && c.name.startsWith('Mike Mussina');

const stats = {};
function forced(minFresh, label) {
  const s = (stats[label] = { pulls: 0, chances: 0 });
  return function pitchingChange(ctx) {
    const { g, def, inningStart } = ctx;
    const cur = def.pitcher;
    if (inningStart && def.pitcherIsStarter && isMussina(cur) && getStats(def, cur).outs >= 12 && !def.mussinaChecked) {
      def.mussinaChecked = true;
      s.chances++;
      const fresh = def.pen.filter((c) => !((def.pstats.get(c.id) || {}).mod < 0)).length;
      if (fresh >= minFresh) {
        s.pulls++;
        return planPitchingChange.call(this, { ...ctx, def: { ...def, pitcher: null }, mustChange: true });
      }
    }
    return planPitchingChange.call(this, ctx);
  };
}

// The current planner, logging the inning Mussina leaves in (he's removable from 12 outs on).
const exits = {};
function logged(ctx) {
  const cur = ctx.def.pitcher;
  const next = planPitchingChange.call(this, ctx);
  if (next && ctx.def.pitcherIsStarter && isMussina(cur)) exits[ctx.g.inning] = (exits[ctx.g.inning] || 0) + 1;
  if (ctx.inningStart && ctx.def.pitcherIsStarter && isMussina(cur) && ctx.g.inning === 5 && getStats(ctx.def, cur).outs >= 12) exits.at5 = (exits.at5 || 0) + 1;
  return next;
}

// Track Mussina-start outcomes via a lightweight wrapper on the rotation.
const VARIANTS = [
  ['current planner', { pitchingChange: logged }],
  ['pull after 4 if 5+ fresh', { pitchingChange: forced(5, 'pull after 4 if 5+ fresh') }],
  ['pull after 4 if 6+ fresh', { pitchingChange: forced(6, 'pull after 4 if 6+ fresh') }],
  ['pull after 4 if 7 fresh', { pitchingChange: forced(7, 'pull after 4 if 7 fresh') }],
  ['pull after 4 always', { pitchingChange: forced(0, 'pull after 4 always') }],
];

const opponents = leagueCities().filter((c) => c !== 'Boston').map((c) => loadTeam(c, pool));
const table = {};
const t0 = Date.now();
for (const [label, fns] of VARIANTS) {
  const policy = makePolicy({ params: BOSTON.params, fns: { ...BOSTON.fns, ...fns } });
  const rows = opponents.map((opp, k) => evaluateMatchup({ team, policy }, { team: opp, policy: opponentPolicy() }, { nSeries, seed: 900 + k, ref: pool.ref }));
  const wp = rows.reduce((s, r) => s + r.winPct, 0) / rows.length;
  const se = Math.sqrt(rows.reduce((s, r) => s + r.seWinPct ** 2, 0)) / rows.length;
  const st = stats[label];
  table[label] = {
    'win%': `${(100 * wp).toFixed(2)}%`, '±1se': `${(100 * se).toFixed(2)}`,
    'RA/g': (rows.reduce((s, r) => s + r.runsAgainst, 0) / rows.length).toFixed(3),
    'RS/g': (rows.reduce((s, r) => s + r.runsFor, 0) / rows.length).toFixed(3),
    ...Object.fromEntries(opponents.map((o, k) => [o.name, `${(100 * rows[k].winPct).toFixed(1)}`])),
    'pulled/eligible': st ? `${st.pulls}/${st.chances}` : '',
  };
}
console.log(`Boston (Remlinger for Knoblauch), ${nSeries} series per opponent, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.table(table);
console.log('Current planner: inning Mussina left in (count), and times he started the 5th with 12+ outs:', exits);
