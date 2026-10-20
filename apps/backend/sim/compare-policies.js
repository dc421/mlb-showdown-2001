/* eslint-disable no-console */
// Does a Boston policy hold up when the roster changes? Scores each policy on several versions of
// the Boston roster (team quality = equal-weight win% vs the four opponents).
//
// Usage (from apps/backend):  node sim/compare-policies.js [pitching|steal|pinchhit|lineup|rotation|infield|send|pinchrun] [--series 2000]
const { loadCards } = require('./cards');
const { loadTeam, leagueCities } = require('./teams');
const { makePolicy } = require('./policy');
const { OPPONENT, BOSTON, opponentPolicy, planPitchingChange, wpSteal, planPinchHit, orderedLineup, seriesRotation } = require('./managers');
const { evaluateMatchup } = require('./evaluate');
const { matchupLW } = require('./rules');

const area = process.argv.slice(2).find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || 'pitching';
const i = process.argv.indexOf('--series');
const nSeries = i >= 0 ? parseInt(process.argv[i + 1], 10) : 2000;
const pool = loadCards();
const card = (name) => {
  const c = pool.cards.find((x) => x.name === name);
  if (!c) throw new Error(`no card ${name}`);
  return c;
};
const swap = (list, outName, inName) => list.map((c) => (c.name === outName ? card(inName) : c));

const base = loadTeam('Boston', pool);
const variant = (name, f) => {
  const t = { ...base, fielders: { ...base.fielders }, hitters: [...base.hitters], starters: [...base.starters], relievers: [...base.relievers] };
  f(t); t.name = 'Boston'; t.label = name; return t;
};
const swapHitter = (t, pos, inName) => {
  const out = t.fielders[pos]; const c = card(inName);
  t.fielders[pos] = c; t.hitters = t.hitters.map((h) => (h === out ? c : h));
};
const ROSTERS = [
  variant('current', () => {}),
  variant('ace: Pedro for Dotel', (t) => { t.starters = swap(t.starters, 'Octavio Dotel (SP)', 'Pedro Martinez'); }),
  variant('cheap rotation (Wood/Stein/Politte + Dotel)', (t) => {
    t.starters = swap(swap(swap(t.starters, 'Tony Armas Jr.', 'Kerry Wood'), "Jeff D'Amico", 'Blake Stein'), 'Paul Abbott', 'Cliff Politte');
  }),
  variant('thin pen (4 relievers)', (t) => { t.relievers = t.relievers.filter((c) => !['Mike Remlinger', 'Ray King', 'Curtis Leskanic'].includes(c.name)); }),
  variant('elite pen (Nen/Gordon/Rivera/White)', (t) => {
    t.relievers = swap(swap(swap(swap(t.relievers, 'Mike Remlinger', 'Robb Nen'), 'Ray King', 'Tom Gordon'), 'Curtis Leskanic', 'Mariano Rivera'), 'Dan Miceli', 'Gabe White');
  }),
];

// Boston has no speed-A runners, so steal policy can only be judged on versions that do.
const FAST_ROSTERS = [
  variant('fast: Andruw Jones CF, Alomar 2B', (t) => { swapHitter(t, 'CF', 'Andruw Jones'); swapHitter(t, '2B', 'Roberto Alomar'); }),
  variant('very fast: + Erstad RF, Jeter SS', (t) => {
    swapHitter(t, 'CF', 'Andruw Jones'); swapHitter(t, '2B', 'Roberto Alomar'); swapHitter(t, 'RF', 'Darin Erstad'); swapHitter(t, 'SS', 'Derek Jeter');
  }),
];

// Boston carries no true bench; pinch hitting is judged on the current roster (whose only spare bat
// is the DH in road games without one) and on a version with two backups in place of two relievers.
const BENCH_ROSTERS = [
  variant('current (bench = DH on the road)', () => {}),
  variant('bench: Casey + Saenz for King + Leskanic', (t) => {
    t.relievers = t.relievers.filter((c) => !['Ray King', 'Curtis Leskanic'].includes(c.name));
    const bats = [card('Sean Casey'), card('Olmedo Saenz')];
    t.hitters = [...t.hitters, ...bats]; t.bench = [...t.bench, ...bats];
    t.restricted = new Set([...t.restricted, ...bats.map((c) => c.id)]);
  }),
];

const SPEED_BENCH_ROSTERS = [
  variant('speed bench: Cairo + Shumpert (backups) for King + Leskanic', (t) => {
    t.relievers = t.relievers.filter((c) => !['Ray King', 'Curtis Leskanic'].includes(c.name));
    const bats = [card('Miguel Cairo'), card('Terry Shumpert')];
    t.hitters = [...t.hitters, ...bats]; t.bench = [...t.bench, ...bats];
    t.restricted = new Set([...t.restricted, ...bats.map((c) => c.id)]);
  }),
];

module.exports = { ROSTERS, FAST_ROSTERS, BENCH_ROSTERS, SPEED_BENCH_ROSTERS };
if (require.main !== module) return;

const plan = (seriesCost, extra = {}) => ({ params: { plan: { seriesCost, replacementCost: 0, allowReplacementPitcher: true, maxPenalty: 3, ...extra } }, fns: { pitchingChange: planPitchingChange } });
const scaled = (scarcity, extra = {}) => plan(undefined, { scarcity, typicalRunValue: 0.0857, minRunValue: 0.002, ...extra });
const cur = (extra) => scaled(0.07, { leverage: true, ...extra });
const steal = (over) => ({ params: { steal: { minSpeed: 20, maxArm: 5, tieGameMaxArm: null, maxArmByOuts: null, holdWithRunnerOnThird: false, stealThird: false, ...over } } });
const STEAL_POLICIES = [
  ['never steal', steal({ minSpeed: 99 })],
  ['stated rules (arm <= 5; tie game 10/7/8 by outs)', steal({ tieGameMaxArm: { 0: 10, 1: 7, 2: 8 } })],
  ['league-typical (opponent habit)', { params: { oppSteal: OPPONENT.params.oppSteal }, fns: { steal: OPPONENT.fns.steal } }],
  ['vs arm <= 6', steal({ maxArm: 6 })],
  ['vs arm <= 7', steal({ maxArm: 7 })],
  ['vs arm <= 8', steal({ maxArm: 8 })],
  ['vs arm <= 9', steal({ maxArm: 9 })],
  ['vs arm <= 7, hold with runner on 3rd', steal({ maxArm: 7, holdWithRunnerOnThird: true })],
  ['by outs: 6 / 7 / 8', steal({ maxArmByOuts: { 0: 6, 1: 7, 2: 8 } })],
  ['by outs: 7 / 7 / 9', steal({ maxArmByOuts: { 0: 7, 1: 7, 2: 9 } })],
  ['win-probability rule (any gain)', { params: { wpSteal: { minGain: 0 } }, fns: { steal: wpSteal } }],
  ['win-probability rule (gain > 0.5%)', { params: { wpSteal: { minGain: 0.005 } }, fns: { steal: wpSteal } }],
];
const ph = (over) => ({ params: { pinchHit: { ...over } } });
const phPlan = (benchCost) => ({ params: { phPlan: { benchCost } }, fns: { pinchHit: planPinchHit } });
const PINCH_HIT_POLICIES = [
  ['default rule (current Boston)', {}],
  ['league-typical (opponent habit)', { params: { oppPinchHit: OPPONENT.params.oppPinchHit }, fns: { pinchHit: OPPONENT.fns.pinchHit } }],
  ['never pinch-hit', { fns: { pinchHit: () => null } }],
  ['always hit for the pitcher when allowed', ph({ forPitcherFromInning: 1, forPitcherMaxLead: 99, forHitterFromInning: 99 })],
  ['planner, no bench charge', phPlan(0)],
  ['planner, bench charge 0.03 runs', phPlan(0.03)],
  ['planner, bench charge 0.08 runs', phPlan(0.08)],
  ['default, never for position players', ph({ forHitterFromInning: 99 })],
];
const lu = (o) => ({ fns: { buildLineup: orderedLineup(o) } });
const LINEUP_POLICIES = [
  ['best to worst by hitting value, P 9th (current)', lu({})],
  ['best to worst, P 8th', lu({ pitcherSlot: 8 })],
  ['by point value (league habit), P 9th', lu({ key: 'points' })],
  ["Boston's real pattern (2,4,5,1,3,...), P 8th", lu({ slotRanks: [2, 4, 5, 1, 3, 6, 7, 8, 9], pitcherSlot: 8 })],
  ['sabermetric (3,1,5,2,4,...), P 9th', lu({ slotRanks: [3, 1, 5, 2, 4, 6, 7, 8, 9] })],
  ['sabermetric, P 8th', lu({ slotRanks: [3, 1, 5, 2, 4, 6, 7, 8, 9], pitcherSlot: 8 })],
  ['worst to best (sanity check)', lu({ slotRanks: [9, 8, 7, 6, 5, 4, 3, 2, 1] })],
];
// Rotation: games 1-3 starters repeat in games 5-7; game 4's starter pitches once. `order` lists the
// quality ranks (1 = best of the four) for games 1, 2, 3, 4.
const rot = (order) => ({ fns: { rotation(team, ref) {
  const refHitter = { ob: ref.hitterOB, chartLW: ref.hitterLW, isPitcher: false };
  const ranked = [...team.starters].sort((a, b) => matchupLW(refHitter, a, a.ctrl) - matchupLW(refHitter, b, b.ctrl));
  return order.map((r) => ranked[r - 1]);
} } });
const ROTATION_POLICIES = [
  ['best first, worst in game 4 (1-2-3-4, current)', rot([1, 2, 3, 4])],
  ['best in game 2 (2-1-3-4)', rot([2, 1, 3, 4])],
  ['best in game 3 (2-3-1-4, Ann Arbor style)', rot([2, 3, 1, 4])],
  ["Boston's habit (1-3-2-4)", rot([1, 3, 2, 4])],
  ['worst pitches twice (1-2-4-3)', rot([1, 2, 4, 3])],
  ['best pitches once (2-3-4-1)', rot([2, 3, 4, 1])],
  ['series-aware (DH rule, opponent lineup, IP)', { fns: { rotation: seriesRotation } }],
];
const ifin = (over) => ({ params: { infieldIn: { fromInning: 8, minLead: -1, maxLead: 1, firstBaseOpenOnly: false, sendFaces: 8, throwHomeMinOut: 0.35, ...over } } });
const INFIELD_POLICIES = [
  ['never bring it in', ifin({ fromInning: 99 })],
  ['8th+, within 1 run (current)', ifin({})],
  ['8th+, within 1 run, 1st base open', ifin({ firstBaseOpenOnly: true })],
  ['7th+, within 1 run, 1st base open', ifin({ fromInning: 7, firstBaseOpenOnly: true })],
  ['any inning, tied, 1st base open', ifin({ fromInning: 1, minLead: 0, maxLead: 0, firstBaseOpenOnly: true })],
  ['any inning, within 1, 1st base open', ifin({ fromInning: 1, firstBaseOpenOnly: true })],
  ['any inning, within 2, 1st base open', ifin({ fromInning: 1, minLead: -2, maxLead: 2, firstBaseOpenOnly: true })],
  ['always with 1st base open', ifin({ fromInning: 1, minLead: -99, maxLead: 99, firstBaseOpenOnly: true })],
  ['league habit', { params: { oppInfieldIn: OPPONENT.params.oppInfieldIn }, fns: { infieldIn: OPPONENT.fns.infieldIn } }],
  ['current + send runner only at 12+ safe faces', ifin({ sendFaces: 12 })],
  ['current + never send the runner', ifin({ sendFaces: 21 })],
  ['current + send at 4+ safe faces', ifin({ sendFaces: 4 })],
  ['current + throw home only if 50%+ to get him', ifin({ throwHomeMinOut: 0.5 })],
  ['current + always throw home', ifin({ throwHomeMinOut: 0 })],
];
// Baserunning sends: thresholds are safe faces needed (21 = only when automatic, 0 = always).
const send = (home, extra = { 0: 15, 1: 15, 2: 15 }, thirdWithTwoOut = false) => ({ params: { send: { home, extraBase: extra, thirdWithTwoOut } } });
const SEND_POLICIES = [
  ['current (research.R): home 0 out auto-only / 1 out 15+ / 2 out always; 3rd 15+, not w/ 2 out', send({ 0: 21, 1: 15, 2: 0 })],
  ['league habit', { params: { oppSend: OPPONENT.params.oppSend }, fns: { sendRunner: OPPONENT.fns.sendRunner } }],
  ['home 0 out 15+', send({ 0: 15, 1: 15, 2: 0 })],
  ['home 0 out 13+, 1 out 13+', send({ 0: 13, 1: 13, 2: 0 })],
  ['home 0 out 17+, 1 out 13+', send({ 0: 17, 1: 13, 2: 0 })],
  ['home 1 out 17+', send({ 0: 21, 1: 17, 2: 0 })],
  ['home 1 out 11+', send({ 0: 21, 1: 11, 2: 0 })],
  ['home 2 out 10+ (not always)', send({ 0: 21, 1: 15, 2: 10 })],
  ['home 2 out 14+', send({ 0: 21, 1: 15, 2: 14 })],
  ['3rd: never', send({ 0: 21, 1: 15, 2: 0 }, { 0: 21, 1: 21, 2: 21 })],
  ['3rd: 17+', send({ 0: 21, 1: 15, 2: 0 }, { 0: 17, 1: 17, 2: 17 })],
  ['3rd: 12+', send({ 0: 21, 1: 15, 2: 0 }, { 0: 12, 1: 12, 2: 12 })],
  ['3rd: 15+, also with 2 out', send({ 0: 21, 1: 15, 2: 0 }, { 0: 15, 1: 15, 2: 15 }, true)],
];
const pr = (over) => ({ params: { pinchRun: { enabled: true, fromInning: 8, maxDeficit: 1, maxLead: 0, runnerMaxSpeed: 10, minGain: 5, ...over } } });
const PINCH_RUN_POLICIES = [
  ['never', pr({ enabled: false })],
  ['8th+, tied or down 1, for speed-10 runners (current)', pr({})],
  ['league habit (3% of 7th+ / within-2 chances)', { params: { oppPinchRun: OPPONENT.params.oppPinchRun, pinchRun: OPPONENT.params.pinchRun }, fns: { pinchRun: OPPONENT.fns.pinchRun } }],
  ['always: 7th+, within 2, speed-10/15 runners', pr({ fromInning: 7, maxDeficit: 2, maxLead: 2, runnerMaxSpeed: 15 })],
  ['always: 7th+, within 2, speed-10 runners only', pr({ fromInning: 7, maxDeficit: 2, maxLead: 2 })],
  ['always: 9th only, within 1', pr({ fromInning: 9, maxDeficit: 1, maxLead: 1, runnerMaxSpeed: 15 })],
  ['always: 7th+, any score', pr({ fromInning: 7, maxDeficit: 99, maxLead: 99, runnerMaxSpeed: 15 })],
];
const PITCHING_POLICIES = [
  ['current Boston (best arm first)', cur({})],
  ['order: weakest planned arm first', cur({ order: 'worst' })],
  ['order: weakest first until 8th, then best', cur({ order: 'late', lateFrom: 8 })],
  ['order: weakest first until 7th, then best', cur({ order: 'late', lateFrom: 7 })],
  ['2nd inning bias -0.02 (concentrate fatigue)', cur({ secondInningBias: -0.02 })],
  ['2nd inning bias -0.01', cur({ secondInningBias: -0.01 })],
  ['2nd inning bias +0.01', cur({ secondInningBias: 0.01 })],
  ['2nd inning bias +0.02 (spread fatigue)', cur({ secondInningBias: 0.02 })],
];

const opponents = leagueCities().filter((c) => c !== 'Boston').map((c) => loadTeam(c, pool));
const quality = (team, spec) => {
  const policy = makePolicy({ params: { ...BOSTON.params, ...spec.params }, fns: { ...BOSTON.fns, ...spec.fns } });
  const rows = opponents.map((opp, k) => evaluateMatchup({ team, policy }, { team: opp, policy: opponentPolicy() }, { nSeries, seed: 500 + k, ref: pool.ref }));
  return rows.reduce((s, r) => s + r.winPct, 0) / rows.length;
};

const [POLICIES, rosters] = {
  steal: [STEAL_POLICIES, FAST_ROSTERS], pinchhit: [PINCH_HIT_POLICIES, BENCH_ROSTERS], lineup: [LINEUP_POLICIES, [ROSTERS[0], FAST_ROSTERS[0]]],
  infield: [INFIELD_POLICIES, [ROSTERS[0], FAST_ROSTERS[0]]],
  send: [SEND_POLICIES, [ROSTERS[0], FAST_ROSTERS[0]]],
  pinchrun: [PINCH_RUN_POLICIES, SPEED_BENCH_ROSTERS],
  rotation: [ROTATION_POLICIES, [...ROSTERS.slice(0, 3),
    variant('mixed IP: Matt Morris (5 IP) for Abbott', (t) => { t.starters = swap(t.starters, 'Paul Abbott', 'Matt Morris'); })]],
}[area] || [PITCHING_POLICIES, ROSTERS];
const t0 = Date.now();
const table = {};
for (const [label, spec] of POLICIES) {
  table[label] = {};
  for (const r of rosters) table[label][r.label] = `${(100 * quality(r, spec)).toFixed(2)}%`;
}
console.log(`Team quality by Boston ${area} policy (rows) and roster (columns); ${nSeries} series per opponent, ±~0.2; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.table(table);
