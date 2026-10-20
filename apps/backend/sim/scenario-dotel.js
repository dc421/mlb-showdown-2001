/* eslint-disable no-console */
// Walk a scenario through the Boston pitching planner inning by inning: Dotel starts and has given
// up 12 runs in two innings. Each inning, the chosen pitcher throws a scoreless inning (so the score
// stays put) and the planner decides again. Compares the planner with and without win-probability
// weighting.
const { loadCards } = require('./cards');
const { loadTeam } = require('./teams');
const { makePolicy } = require('./policy');
const { BOSTON, opponentPolicy } = require('./managers');
const { effectiveControl } = require('./rules');

const pool = loadCards();
const bos = loadTeam('Boston', pool);
const opp = loadTeam('Detroit', pool);
const dotel = bos.starters.find((c) => c.name.startsWith('Octavio Dotel'));

function walk(label, policy, bostonRuns, oppRuns) {
  const def = {
    idx: 1, team: bos, pen: [...bos.relievers], pitcher: dotel, pitcherIsStarter: true,
    pstats: new Map([[dotel.id, { innings: new Set([1, 2]), runs: oppRuns, bf: 15, outs: 6, tired: false, mod: 0 }]]),
  };
  const off = { idx: 0, lineup: opponentPolicy().buildLineup(opp, true, pool.ref) };
  const steps = [];
  for (let inning = 3; inning <= 9; inning++) {
    const g = { inning, top: true, score: [oppRuns, bostonRuns], rng: Math.random };
    const tired = effectiveControl(def, def.pitcher, inning) < def.pitcher.ctrl;
    const removable = !def.pitcherIsStarter || tired || def.pstats.get(def.pitcher.id).outs >= 12;
    const next = removable ? policy.pitchingChange({ g, def, off, inningStart: true, mustChange: false }) : null;
    if (next) { def.pen = def.pen.filter((c) => c !== next); def.pitcher = next; def.pitcherIsStarter = false; }
    const st = def.pstats.get(def.pitcher.id) || { innings: new Set(), runs: 0, bf: 0, outs: 0, mod: 0 };
    st.innings.add(inning); st.outs += 3; def.pstats.set(def.pitcher.id, st);
    steps.push(`${inning}: ${def.pitcher.name}${next ? '' : ' (stays)'}`);
  }
  console.log(`\n${label}\n  ${steps.join('\n  ')}`);
}

const without = makePolicy({ params: { ...BOSTON.params, plan: { ...BOSTON.params.plan, leverage: false } }, fns: BOSTON.fns });
const withLev = makePolicy({ params: BOSTON.params, fns: BOSTON.fns });
walk('Down 12-0 after two (Boston home), runs only:', without, 0, 12);
walk('Down 12-0 after two, win-probability weighted:', withLev, 0, 12);
walk('Down 12-10 after two (a slugfest), win-probability weighted:', withLev, 10, 12);
