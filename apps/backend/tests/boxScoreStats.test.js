const { applyOutcome, recordRunForPitcher, getPitcherKey } = require('../gameLogic');

describe('getPitcherKey idempotency (malformed-key prevention)', () => {
  const state = { isTopInning: false, homeTeam: { userId: 5 }, awayTeam: { userId: 4 } };

  test('builds owner_card from a normal numeric card_id', () => {
    expect(getPitcherKey(state, { card_id: 614 })).toBe('4_614');
  });

  test('does not double-prefix an already-composite card_id', () => {
    // The pre-fix bug produced "4_4_614" here, splitting a pitcher's outs across two keys.
    expect(getPitcherKey(state, { card_id: '4_614' })).toBe('4_614');
  });

  test('returns a runner\'s pitcherOfRecordId unchanged', () => {
    expect(getPitcherKey(state, { card_id: 575, pitcherOfRecordId: '4_614' })).toBe('4_614');
  });
});

// Minimal away-batting state (top of the 1st). Home pitches, so the pitcher key is keyed to the
// home user id. Bases are passed per-test.
function makeState({ bases = { first: null, second: null, third: null }, outs = 0, advantage = 'batter', infieldIn = false } = {}) {
  return {
    inning: 1,
    isTopInning: true,
    awayScore: 0,
    homeScore: 0,
    outs,
    bases,
    pitcherStats: {},
    atBatLog: [],
    homeTeam: { userId: 100 },
    awayTeam: { userId: 200 },
    currentAtBat: {
      pitchRollResult: { advantage },
      infieldIn,
      basesBeforePlay: bases,
      outsBeforePlay: outs,
    },
  };
}

const batter = { card_id: 1, name: 'Test Batter', displayName: 'Test Batter', control: null };
const pitcher = { card_id: 9, name: 'Test Pitcher', displayName: 'Test Pitcher', control: 4 };
const runner = (card_id, name) => ({ card_id, name, displayName: name, speed: 10 });
const getSpeedValue = (p) => p.speed || 10;

function run(state, outcome, opts = {}) {
  return applyOutcome(state, outcome, batter, pitcher, opts.infieldDefense || 0, opts.outfieldDefense || 0, getSpeedValue, opts.swingRoll || 10, null, {});
}

describe('box-score stat accumulation in applyOutcome', () => {
  test('single with a runner on third: 1 AB, 1 H, 1 RBI, runner credited a run', () => {
    const state = makeState({ bases: { first: null, second: null, third: runner(7, 'Speedy') } });
    const { newState } = run(state, '1B');
    const entry = newState.atBatLog[0];
    expect(entry.batterId).toBe(1);
    expect(entry.batterTeam).toBe('away');
    expect(entry.pitcherKey).toBe('100_9');
    expect(entry).toMatchObject({ ab: 1, h: 1, double: 0, triple: 0, hr: 0, bb: 0, so: 0, rbi: 1 });
    expect(entry.scoredRunnerIds).toEqual([7]);
    expect(entry.advantage).toBe('batter');
  });

  test('home run with two on: 1 H, 1 HR, 3 RBI, three runs credited (incl. batter)', () => {
    const state = makeState({ bases: { first: runner(7, 'A'), second: runner(8, 'B'), third: null } });
    const { newState } = run(state, 'HR');
    const entry = newState.atBatLog[0];
    expect(entry).toMatchObject({ ab: 1, h: 1, hr: 1, rbi: 3 });
    // Two baserunners plus the batter all score.
    expect(entry.scoredRunnerIds.sort()).toEqual([1, 7, 8]);
  });

  test('walk is a plate appearance but not an at-bat', () => {
    const { newState } = run(makeState(), 'BB');
    expect(newState.atBatLog[0]).toMatchObject({ ab: 0, bb: 1, h: 0 });
  });

  test('strikeout is an at-bat with a K', () => {
    const { newState } = run(makeState({ advantage: 'pitcher' }), 'SO');
    const entry = newState.atBatLog[0];
    expect(entry).toMatchObject({ ab: 1, so: 1, h: 0 });
    expect(entry.advantage).toBe('pitcher');
  });

  test('double credits two total bases (recorded via the double flag)', () => {
    const { newState } = run(makeState(), '2B');
    expect(newState.atBatLog[0]).toMatchObject({ ab: 1, h: 1, double: 1 });
  });

  test('a run that scores on a deferred baserunning decision is attributed to the at-bat', () => {
    // Single with a speed-15 runner on first: advancing to third needs a manual decision, so the
    // engine leaves an ADVANCE play pending (the run has NOT scored yet).
    const onFirst = { card_id: 7, name: 'Wheels', displayName: 'Wheels', speed: 15 };
    const state = makeState({ bases: { first: onFirst, second: null, third: null } });
    const { newState } = run(state, '1B', { outfieldDefense: 0 });
    const entry = newState.atBatLog[0];
    expect(newState.currentPlay?.type).toBe('ADVANCE');
    expect(entry).toMatchObject({ ab: 1, h: 1, rbi: 0 });
    expect(entry.scoredRunnerIds).toEqual([]);
    expect(typeof newState.currentAtBat.atBatIndex).toBe('number');

    // Now the server resolves the decision and the runner scores home — it flows through the same
    // recordRunForPitcher chokepoint the deferred handlers use.
    const runnerOnBase = { ...onFirst, pitcherOfRecordId: entry.pitcherKey };
    recordRunForPitcher(newState, runnerOnBase, pitcher);
    expect(newState.atBatLog[0].rbi).toBe(1);
    expect(newState.atBatLog[0].scoredRunnerIds).toEqual([7]);
  });

  test('GIDP scores a run but credits no RBI', () => {
    const state = makeState({ bases: { first: runner(7, 'A'), second: null, third: runner(8, 'B') }, outs: 0 });
    // High infield defense vs slow batter forces the double play.
    const { newState } = run(state, 'GB', { infieldDefense: 20 });
    const entry = newState.atBatLog[0];
    expect(entry.rbi).toBe(0);
    // The runner from third still scores (a run, just not an RBI).
    expect(entry.scoredRunnerIds).toContain(8);
  });
});

// The spoiler-hidden box score backs a not-yet-revealed PA out of the live pitcherStats aggregate
// using entry.pitcherDeltas, so those deltas must exactly mirror what the PA added to pitcherStats.
describe('pitcherDeltas mirror the PA contribution to pitcherStats', () => {
  // Sum outs/runs/bf per pitcher key from a single-PA state's pitcherStats and from its atBatLog
  // entry's pitcherDeltas; starting from empty pitcherStats they must match key-for-key.
  const fromStats = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) =>
    [k, { outs: v.outs_recorded || 0, runs: v.runs || 0, bf: v.batters_faced || 0 }]));

  test('strikeout: 1 out, 0 runs, 1 bf on the pitcher', () => {
    const { newState } = run(makeState({ advantage: 'pitcher' }), 'SO');
    expect(newState.atBatLog[0].pitcherDeltas).toEqual(fromStats(newState.pitcherStats));
    expect(newState.atBatLog[0].pitcherDeltas['100_9']).toEqual({ outs: 1, runs: 0, bf: 1 });
  });

  test('walk: 0 outs, 0 runs, 1 bf', () => {
    const { newState } = run(makeState(), 'BB');
    expect(newState.atBatLog[0].pitcherDeltas).toEqual(fromStats(newState.pitcherStats));
    expect(newState.atBatLog[0].pitcherDeltas['100_9']).toEqual({ outs: 0, runs: 0, bf: 1 });
  });

  test('3-run homer: 3 runs charged, 1 bf, 0 outs', () => {
    const state = makeState({ bases: { first: runner(7, 'A'), second: runner(8, 'B'), third: null } });
    const { newState } = run(state, 'HR');
    expect(newState.atBatLog[0].pitcherDeltas).toEqual(fromStats(newState.pitcherStats));
    expect(newState.atBatLog[0].pitcherDeltas['100_9']).toEqual({ outs: 0, runs: 3, bf: 1 });
  });

  test('GIDP: two outs and the run both land on the delta', () => {
    const state = makeState({ bases: { first: runner(7, 'A'), second: null, third: runner(8, 'B') }, outs: 0 });
    const { newState } = run(state, 'GB', { infieldDefense: 20 });
    expect(newState.atBatLog[0].pitcherDeltas).toEqual(fromStats(newState.pitcherStats));
    expect(newState.atBatLog[0].pitcherDeltas['100_9']).toEqual({ outs: 2, runs: 1, bf: 1 });
  });

  test('deferred run charged to an inherited pitcher lands on the delta for that pitcher', () => {
    const onFirst = { card_id: 7, name: 'Wheels', displayName: 'Wheels', speed: 15 };
    const state = makeState({ bases: { first: onFirst, second: null, third: null } });
    const { newState } = run(state, '1B', { outfieldDefense: 0 });
    // Deferred: the runner later scores, charged to a different (inherited) pitcher key.
    const inheritedKey = '100_42';
    recordRunForPitcher(newState, { ...onFirst, pitcherOfRecordId: inheritedKey }, pitcher);
    expect(newState.atBatLog[0].pitcherDeltas).toEqual(fromStats(newState.pitcherStats));
    expect(newState.atBatLog[0].pitcherDeltas[inheritedKey]).toEqual({ outs: 0, runs: 1, bf: 0 });
    // The batter's pitcher still logged the batter faced.
    expect(newState.atBatLog[0].pitcherDeltas['100_9'].bf).toBe(1);
  });
});
