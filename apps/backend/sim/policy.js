// MANAGER POLICY — every judgment call the simulator makes on a manager's behalf lives in this file.
//
// The engine (engine.js) only rolls dice and enforces rules. Whenever a real manager would have a
// choice, it calls one of the functions below. The 13 numbered sections are the 13 assumptions we
// agreed to make explicit; each has tunable numbers in DEFAULT_PARAMS and a function you can
// replace outright:
//
//   const policy = makePolicy({ params: { steal: { maxArm: 7 } } });           // tweak a number
//   const policy = makePolicy({ fns: { bunt(ctx) { return ...; } } });          // swap the logic
//
// Each team gets its own policy object, so the two managers need not behave alike (assumption 3).
//
// ctx fields: g = game ({ inning, top, outs, bases[1..3], score[away, home] }), off / def = the
// batting / fielding side ({ team, lineup, bench, pen, pitcher, def: { IF, OF, C }, ... }).
// Scores from a side's point of view: g.score[side.idx].
const { REPLACEMENT_HITTER, REPLACEMENT_PITCHER } = require('./cards');
const { effectiveControl, canRemovePitcher, canTakeSpot, matchupLW } = require('./rules');

const FIELD_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];

const DEFAULT_PARAMS = {
  // 1. Pitching changes. Pitchers are compared by expected linear-weight runs per PA against the
  // opposing lineup at their current effective control ("quality", lower is better).
  pitching: {
    starterPullMargin: 0.04,   // an UNTIRED starter is pulled only if the best option is this much better
    relieverPullMargin: 0.04,  // same, for an untired reliever
    tiredPullMargin: 0,        // a TIRED pitcher is pulled as soon as any option is better by this much
    midInningChanges: false,   // false = only change pitchers at the start of a half-inning
    midInningMargin: 0.03,     // required edge for a mid-inning change (entering mid-inning burns an inning)
    blowoutMargin: 5,          // score gap at which the best arms are held back
    protectTopRelievers: 2,    // how many of the best available arms to hold back in a blowout
    allowReplacementPitcher: true, // replacement pitcher (control -1, never tires) is always an option
  },
  // 5. Lineup construction.
  lineup: { order: 'value' },  // 'value' = best hitter first, pitcher ninth
  // 6. Rotation.
  rotation: { order: 'quality' }, // 'quality' = best starter first; 'listed' = roster order
  // 4. Pinch hitting.
  pinchHit: {
    forPitcherFromInning: 7,   // hit for an effective pitcher from this inning on...
    forPitcherMaxLead: 0,      // ...but only when leading by no more than this (0 = tied or trailing)
    forHitterFromInning: 7,
    closeMargin: 3,            // only hit for position players when the game is within this many runs
    hitterMargin: 0.05,        // required matchup edge (LW/PA) of the bench bat over the scheduled hitter
  },
  // 9. Pinch running and defensive replacements. (+DH defense bumps)
  pinchRun: {
    enabled: true,
    fromInning: 8,
    maxDeficit: 1,             // only when trailing by at most this...
    maxLead: 0,                // ...or leading by at most this
    runnerMaxSpeed: 10,        // only run for C-speed runners
    minGain: 5,                // replacement must be at least this much faster
    emergencyFielderOk: false, // true = run for anyone, even if it means an emergency fielder after
  },
  defensiveReplacements: false,
  // 3. Steals (research.R: "take 2nd with A vs +5 or worse; tie game: 0 outs vs anyone but Blanco,
  // 1 out vs +7 or worse, 2 outs vs +8 or worse").
  steal: {
    minSpeed: 20,
    maxArm: 5,
    tieGameMaxArm: { 0: 10, 1: 7, 2: 8 }, // Blanco is the only +11 (null = no tie-game rule)
    maxArmByOuts: null,          // optional { 0, 1, 2 } overriding maxArm by outs
    holdWithRunnerOnThird: false,
    stealThird: false,
  },
  // 5. Sending runners. Thresholds are "safe faces": how many of the 20 die faces leave the runner
  // safe. 21 = only when automatic, 0 = always. (research.R: "0 outs only if given, 1 out need 15 or
  // higher, 2 outs always go; take 2nd/3rd on 15 or higher, except 3rd with 2 out".) For tag-ups,
  // outs are counted after the catch.
  send: {
    home: { 0: 21, 1: 15, 2: 0 },
    extraBase: { 0: 15, 1: 15, 2: 15 },
    thirdWithTwoOut: false,
  },
  // 8. Which runner the defense throws at when several are sent.
  throwChoice: { leadBias: 0.15 }, // prefer the lead runner unless a trailer is this much likelier out
  // 7. Infield in.
  infieldIn: {
    fromInning: 8,
    minLead: -1,               // fielding team's lead must be within [minLead, maxLead]
    maxLead: 1,
    firstBaseOpenOnly: false,  // true = never with a runner on first (play for the double play)
    sendFaces: 8,              // offense sends the runner home on a grounder with at least this many safe faces
    throwHomeMinOut: 0.35,     // defense throws home when the out chance is at least this
  },
  // 10. Bunts and intentional walks.
  bunt: { enabled: false },
  intentionalWalk: { enabled: false },
  // 2. DH at home. 'better' = the league's standard practice: use the DH when your DH out-hits the
  // opponent's (matched 88% of opponents' and 100% of Boston's real home decisions). true / false
  // force it either way.
  dh: 'better',
};

const mean = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / (arr.length || 1);

// How well a team's DH hits a league-average pitcher: its assigned DH, else its best bench bat.
function dhValue(team, ref) {
  const refPitcher = { chartLW: ref.pitcherLW };
  const value = (c) => matchupLW(c, refPitcher, ref.pitcherCtrl);
  const dh = team.dh || [...team.bench].sort((a, b) => value(b) - value(a))[0] || REPLACEMENT_HITTER;
  return value(dh);
}
const lead = (g, side) => g.score[side.idx] - g.score[1 - side.idx];

const DEFAULT_FNS = {
  // ---- 4. Starting lineup and batting order -------------------------------------------------
  // Returns nine { pos, card } spots in batting order. In a no-DH game the last spot is { pos: 'P' }
  // and the engine drops the starter into it.
  buildLineup(team, useDh, ref) {
    const refPitcher = { chartLW: ref.pitcherLW };
    const value = (c) => matchupLW(c, refPitcher, ref.pitcherCtrl);
    const spots = FIELD_POSITIONS.map((pos) => ({ pos, card: team.fielders[pos] || REPLACEMENT_HITTER }));
    if (useDh) {
      const bestBench = [...team.bench].sort((a, b) => value(b) - value(a))[0];
      spots.push({ pos: 'DH', card: team.dh || bestBench || REPLACEMENT_HITTER });
    }
    spots.sort((a, b) => value(b.card) - value(a.card));
    if (!useDh) spots.push({ pos: 'P', card: null });
    return spots;
  },

  // ---- 5. Rotation ----------------------------------------------------------------------------
  // Returns the four starters in the order they pitch (game 5 goes back to the first).
  rotation(team, ref) {
    const refHitter = { ob: ref.hitterOB, chartLW: ref.hitterLW, isPitcher: false };
    const starters = [...team.starters];
    if (this.params.rotation.order === 'quality') {
      starters.sort((a, b) => matchupLW(refHitter, a, a.ctrl) - matchupLW(refHitter, b, b.ctrl));
    }
    while (starters.length < 4) starters.push(REPLACEMENT_PITCHER);
    return starters.slice(0, 4);
  },

  // ---- 1 + 2. Pulling the pitcher and choosing his replacement --------------------------------
  // Called before each plate appearance when a change is legal. Return the incoming pitcher (from
  // def.pen, or REPLACEMENT_PITCHER) or null to stay. mustChange = the pitcher was hit for.
  pitchingChange({ g, def, off, inningStart, mustChange }) {
    const p = this.params.pitching;
    if (!mustChange && !inningStart && !p.midInningChanges) return null;
    const batters = off.lineup.map((s) => s.card);
    const quality = (pitcher, ctrl) => mean(batters, (b) => matchupLW(b, pitcher, ctrl));

    const options = def.pen.map((c) => ({ card: c, q: quality(c, effectiveControl(def, c, g.inning)) }));
    if (p.allowReplacementPitcher) options.push({ card: REPLACEMENT_PITCHER, q: quality(REPLACEMENT_PITCHER, REPLACEMENT_PITCHER.ctrl) });
    if (options.length === 0) return null;
    options.sort((a, b) => a.q - b.q);
    const blowout = Math.abs(lead(g, def)) >= p.blowoutMargin;
    const pool = blowout && options.length > p.protectTopRelievers ? options.slice(p.protectTopRelievers) : options;
    const best = pool[0];
    if (mustChange) return best.card;

    const cur = def.pitcher;
    const curCtrl = effectiveControl(def, cur, g.inning);
    const tired = curCtrl < cur.ctrl;
    let margin;
    if (!inningStart) margin = p.midInningMargin;
    else if (tired) margin = p.tiredPullMargin;
    else margin = def.pitcherIsStarter ? p.starterPullMargin : p.relieverPullMargin;
    return quality(cur, curCtrl) - best.q > margin ? best.card : null;
  },

  // ---- 6. Pinch hitting -----------------------------------------------------------------------
  // Called as each batter comes up. Return a card from off.bench or null.
  pinchHit({ g, off, def, spotIdx, batter }) {
    const p = this.params.pinchHit;
    const pitcher = def.pitcher;
    const ctrl = effectiveControl(def, pitcher, g.inning);
    const value = (c) => matchupLW(c, pitcher, ctrl);
    const best = off.bench.filter((c) => canTakeSpot(g, off, c, spotIdx)).sort((a, b) => value(b) - value(a))[0];
    if (!best) return null;

    if (batter.isPitcher) {
      if (!canRemovePitcher(g, off, true)) return null;
      const nextDefInning = g.top ? g.inning : g.inning + 1;
      const done = effectiveControl(off, batter, nextDefInning) < batter.ctrl; // would be tired next time out
      if (done) return best;
      return g.inning >= p.forPitcherFromInning && lead(g, off) <= p.forPitcherMaxLead ? best : null;
    }
    if (g.inning < p.forHitterFromInning || Math.abs(lead(g, off)) > p.closeMargin) return null;
    return value(best) - value(batter) > p.hitterMargin ? best : null;
  },

  // ---- 7. Pinch running and defensive replacements --------------------------------------------
  // Return { base, card } (card from off.bench) or null.
  pinchRun({ g, off }) {
    const p = this.params.pinchRun;
    const l = lead(g, off);
    if (!p.enabled || g.inning < p.fromInning || l < -p.maxDeficit || l > p.maxLead) return null;
    for (const base of [2, 1]) {
      const r = g.bases[base];
      if (!r || r.card.isPitcher || r.speed > p.runnerMaxSpeed) continue;
      const spotIdx = off.lineup.findIndex((s) => s.card === r.card);
      if (spotIdx < 0) continue;
      const card = off.bench
        .filter((c) => c.speed - r.speed >= p.minGain && (p.emergencyFielderOk || canTakeSpot(g, off, c, spotIdx)))
        .sort((a, b) => b.speed - a.speed)[0];
      if (card) return { base, card };
    }
    return null;
  },
  // Called when a side takes the field. Return [{ spotIdx, card }] swaps; none by default.
  defensiveReplacements() {
    return [];
  },

  // ---- 8. Steals ------------------------------------------------------------------------------
  // Called before each pitch (repeatedly, so a runner can go again). Return the base to steal FROM
  // (1 or 2), or 0.
  steal({ g, off, def }) {
    const p = this.params.steal;
    const arm = def.def.C;
    const r1 = g.bases[1];
    if (r1 && !g.bases[2] && r1.speed >= p.minSpeed && !(p.holdWithRunnerOnThird && g.bases[3])) {
      let maxArm = p.maxArmByOuts ? p.maxArmByOuts[g.outs] : p.maxArm;
      if (p.tieGameMaxArm && lead(g, off) === 0) maxArm = p.tieGameMaxArm[g.outs];
      if (arm <= maxArm) return 1;
    }
    if (p.stealThird && g.bases[2] && !g.bases[3] && g.bases[2].speed >= p.minSpeed && arm + 5 <= p.maxArm) return 2;
    return 0;
  },

  // ---- 9. Sending runners on hits and fly balls -----------------------------------------------
  // kind = 'hit' | 'tag'; to = base the runner is trying for (4 = home); faces = safe die faces (0-20).
  sendRunner({ g, to, faces }) {
    const p = this.params.send;
    if (to === 4) return faces >= p.home[g.outs];
    if (to === 3 && g.outs === 2 && !p.thirdWithTwoOut) return false;
    return faces >= p.extraBase[g.outs];
  },

  // ---- 10. Which runner the defense throws at -------------------------------------------------
  // candidates = [{ to, pOut }], lead runner first. Return the index to throw at.
  throwTarget({ candidates }) {
    let bestIdx = 0; let bestScore = -1;
    candidates.forEach((c, i) => {
      const score = c.pOut + (i === 0 ? this.params.throwChoice.leadBias : 0);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    });
    return bestIdx;
  },

  // ---- 11. Infield in -------------------------------------------------------------------------
  // Asked with a runner on third and fewer than two outs.
  infieldIn({ g, def }) {
    const p = this.params.infieldIn;
    const l = lead(g, def);
    if (p.firstBaseOpenOnly && g.bases[1]) return false;
    return g.inning >= p.fromInning && l >= p.minLead && l <= p.maxLead;
  },
  // Grounder to a drawn-in infield: does the offense send the runner from third?
  infieldInSend({ faces }) {
    return faces >= this.params.infieldIn.sendFaces;
  },
  // He was sent: does the defense throw home (true) or take the out at first and concede the run?
  infieldInThrowHome({ pOut }) {
    return pOut >= this.params.infieldIn.throwHomeMinOut;
  },

  // ---- 12. Bunts and intentional walks --------------------------------------------------------
  bunt() {
    return this.params.bunt.enabled && false; // no default bunting logic; replace this fn to add some
  },
  intentionalWalk() {
    return this.params.intentionalWalk.enabled && false; // likewise
  },

  // ---- 13. DH rule when this team is the home team --------------------------------------------
  // Called once per home stretch with { rng, opponent, gameNumber }. (Who is home alternates by
  // series in run.js / quality.js.)
  wantsDh(team, { opponent, ref }) {
    if (this.params.dh !== 'better') return !!this.params.dh;
    return dhValue(team, ref) > dhValue(opponent, ref);
  },
};

function mergeParams(base, over) {
  const out = { ...base };
  for (const k in over || {}) {
    const isObj = over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]);
    out[k] = isObj ? mergeParams(base[k] || {}, over[k]) : over[k];
  }
  return out;
}

function makePolicy({ params, fns } = {}) {
  return { ...DEFAULT_FNS, ...fns, params: mergeParams(DEFAULT_PARAMS, params) };
}

module.exports = { makePolicy, DEFAULT_PARAMS, FIELD_POSITIONS };
