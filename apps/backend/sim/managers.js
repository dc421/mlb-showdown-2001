// The two managers the simulator plays with. Both are built from policy.js; only the parameters
// (or, where needed, whole decision functions) differ.
//
//  - opponent: how the league's OTHER managers actually play, calibrated against past game logs
//              (node sim/calibrate.js). Changes here should be justified by the logs.
//  - boston:   the policy we want Boston to follow, tuned for win% (node sim/optimize.js).
const { makePolicy } = require('./policy');

const DEFAULT_PINCH_HIT = makePolicy().pinchHit;
const DEFAULT_ROTATION = makePolicy().rotation;
const DEFAULT_SEND_RUNNER = makePolicy().sendRunner;
const DEFAULT_PINCH_RUN = makePolicy().pinchRun;
const { REPLACEMENT_PITCHER, REPLACEMENT_HITTER } = require('./cards');
const { effectiveControl, matchupLW, canTakeSpot, getStats, canRemovePitcher, eligible, defenseRatings } = require('./rules');
const wpTable = require('../services/wpTable.json');
const { lookupWP } = require('../services/winProbabilityModel');

// How much one run changes the chance of winning at the start of this half-inning, from the league's
// own win-probability table (built from completed games). ~0.09 in a tied 1st, ~0.27 down one in
// the bottom of the 9th, ~0.005 down 12 in the 3rd.
const leverageCache = new Map();
function runValue(inning, isTop, homeMinusAway) {
  const key = `${inning}|${isTop}|${homeMinusAway}`;
  if (!leverageCache.has(key)) {
    const wp = (d) => lookupWP(wpTable, { inning, isTop, outs: 0, base: 0, home: Math.max(d, 0), away: Math.max(-d, 0) });
    leverageCache.set(key, Math.abs(wp(homeMinusAway + 1) - wp(homeMinusAway - 1)) / 2);
  }
  return leverageCache.get(key);
}

const mean = (arr, f) => arr.reduce((s, x) => s + f(x), 0) / (arr.length || 1);

// Pick index k of a best-first list with probability proportional to decay^k.
function pickRanked(list, decay, rng) {
  const weights = list.map((_, k) => decay ** k);
  let x = rng() * weights.reduce((s, w) => s + w, 0);
  for (let k = 0; k < list.length; k++) { x -= weights[k]; if (x <= 0) return list[k]; }
  return list[list.length - 1];
}

// ---- Opponent pitching (assumptions 1 + 2), fit to 153 opposing side-games (exits forced by a
// pinch hitter excluded) -----------------------
// Logs: an untired starter is essentially never pulled. A tired pitcher is pulled ~72% of the time
// within 4 runs, about half the time at 5-6, and in a 7+ run game the starter is mostly left to absorb
// innings (20%; relievers 44%). The best available reliever comes in 64% of the time in the 8th or
// later from down 2 to up 3 (protecting a lead or tie; in the 7th it's only ~37%, no more than other
// spots), ~29% elsewhere. In a 5+ run game it's the other way round: the worst available arm comes in
// 38% of the time, the best 14% (mop-up). A tired reliever enters only when no fresh one is left (1%
// of real entries with a fresh arm available). The replacement pitcher shows up only at 6+ runs from
// the 5th on: ~10% of changes at 6-7, ~40% at 8+.
// No mid-inning changes (0.12 a game in the logs, with no clear trigger).
function opponentPitchingChange({ g, def, off, inningStart, mustChange }) {
  const p = this.params.oppPitching;
  if (!mustChange && !inningStart) return null;
  const lead = g.score[def.idx] - g.score[off.idx];
  const margin = Math.abs(lead);

  if (!mustChange) {
    const cur = def.pitcher;
    const tired = effectiveControl(def, cur, g.inning) < cur.ctrl;
    const role = def.pitcherIsStarter ? 'starter' : 'reliever';
    const state = margin >= p.blowoutMargin ? 'blowout' : margin >= p.midMargin ? 'mid' : 'close';
    const pull = !tired ? p.pullUntired[role] : p.pullTired[role][state];
    if (g.rng() >= pull) return null;
  }

  if (g.inning >= p.replacement.fromInning) {
    const tier = p.replacement.byMargin.filter((t) => margin >= t.minMargin).pop();
    if (tier && g.rng() < tier.p) return REPLACEMENT_PITCHER;
  }
  const batters = off.lineup.map((s) => s.card);
  const all = def.pen.map((c) => {
    const ctrl = effectiveControl(def, c, g.inning);
    return { card: c, tired: ctrl < c.ctrl, q: mean(batters, (b) => matchupLW(b, c, ctrl)) };
  });
  if (all.length === 0) return mustChange ? REPLACEMENT_PITCHER : null;
  const fresh = all.filter((o) => !o.tired);
  const options = (fresh.length ? fresh : all).sort((a, b) => a.q - b.q); // best first
  if (margin >= p.mopUpMargin) return pickRanked(options.reverse(), p.otherDecay, g.rng).card;
  const hl = p.highLeverage;
  const highLeverage = g.inning >= hl.fromInning && lead >= hl.minLead && lead <= hl.maxLead;
  return pickRanked(options, highLeverage ? hl.decay : p.otherDecay, g.rng).card;
}

// ---- Opponent pinch hitting (assumption 6), fit to 200 pitcher-spot PAs in no-DH games ----------
// A removable starter is hit for 72% of the time when he'd be tired next inning (6% when he
// wouldn't); a reliever ~68% of the time. Score barely matters. Position players are essentially
// never pinch-hit for (one instance in 96 games).
function opponentPinchHit({ g, off, def, spotIdx, batter }) {
  if (!batter.isPitcher) return null;
  const p = this.params.oppPinchHit;
  const nextDefInning = g.top ? g.inning : g.inning + 1;
  const tiredNext = batter.id > 0 && effectiveControl(off, batter, nextDefInning) < batter.ctrl;
  const prob = off.pitcherIsStarter ? (tiredNext ? p.starterTiredNext : p.starterFresh) : p.reliever;
  if (g.rng() >= prob) return null;
  const ctrl = effectiveControl(def, def.pitcher, g.inning);
  return off.bench.filter((c) => canTakeSpot(g, off, c, spotIdx))
    .sort((a, b) => matchupLW(b, def.pitcher, ctrl) - matchupLW(a, def.pitcher, ctrl))[0] || null;
}

// ---- Lineups (assumption 4) ---------------------------------------------------------------------
// Fielders come from the roster's position assignments (real lineups match them 95-100%). The batting
// order ranks the nine hitters (by `key`) and puts rank slotRanks[i] in slot i+1; in a no-DH game the
// pitcher bats in `pitcherSlot` and the eight hitters keep the same pattern around him.
function orderedLineup({ key = 'value', slotRanks = [1, 2, 3, 4, 5, 6, 7, 8, 9], pitcherSlot = 9 } = {}) {
  return function buildLineup(team, useDh, ref) {
    const refPitcher = { chartLW: ref.pitcherLW };
    const score = key === 'points' ? (c) => c.points : (c) => matchupLW(c, refPitcher, ref.pitcherCtrl);
    const spots = FIELD_POSITIONS.map((pos) => ({ pos, card: team.fielders[pos] || REPLACEMENT_HITTER }));
    if (useDh) {
      const bestBench = [...team.bench].sort((x, y) => score(y) - score(x))[0];
      spots.push({ pos: 'DH', card: team.dh || bestBench || REPLACEMENT_HITTER });
    }
    const ranked = [...spots].sort((x, y) => score(y.card) - score(x.card));
    const ranks = slotRanks.filter((r) => r <= ranked.length);
    const order = ranks.map((r) => ranked[r - 1]);
    if (!useDh) order.splice(Math.min(pitcherSlot, 9) - 1, 0, { pos: 'P', card: null });
    return order;
  };
}
const FIELD_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];

// Boston: pick the best nine for each game type instead of following roster assignments. Every legal
// alignment is tried (anyone may play 1B out of position at -1, or -2 for a DH-only bat; backups can
// DH but not field before the 7th) and scored as runs per game: hitting (runs per PA vs a league-
// average pitcher x ~2.5, measured in the sim) plus defense (0.045 per infield point, 0.073 per
// outfield point, ~0.01 per catcher-arm point, also measured). In a DH game all nine bat, so the
// choice is the best glove alignment; in a no-DH game the hitter who costs least, bat and glove
// together, sits. Batting order is best to worst.
const LINEUP_WEIGHTS = { hitting: 2.5, infield: 0.045, outfield: 0.073, catcher: 0.01 };
function bestLineup(team, useDh, ref) {
  const refPitcher = { chartLW: ref.pitcherLW };
  const bat = (c) => matchupLW(c, refPitcher, ref.pitcherCtrl);
  const hitters = team.hitters;
  const canField = (c) => !team.restricted.has(c.id);
  // positions with few eligible players first, 1B (anyone can play it) last
  const order = ['C', 'SS', '2B', 'CF', '3B', 'LF', 'RF', '1B'];
  const eligibleFor = (pos) => hitters.filter((c) => canField(c) && eligible(c, pos));
  let best = null; let bestScore = -Infinity;
  const used = new Set();
  const spots = [];
  const score = (lineup) => {
    const d = defenseRatings(lineup);
    return LINEUP_WEIGHTS.hitting * lineup.reduce((t, s) => t + bat(s.card), 0)
      + LINEUP_WEIGHTS.infield * d.IF + LINEUP_WEIGHTS.outfield * d.OF + LINEUP_WEIGHTS.catcher * d.C;
  };
  const finish = () => {
    let options = [[...spots]];
    if (useDh) {
      const dhs = hitters.filter((c) => !used.has(c.id));
      options = dhs.length ? dhs.map((c) => [...spots, { pos: 'DH', card: c }]) : [[...spots, { pos: 'DH', card: REPLACEMENT_HITTER }]];
    }
    for (const lineup of options) {
      const v = score(lineup);
      if (v > bestScore) { bestScore = v; best = lineup; }
    }
  };
  const place = (k) => {
    if (k === order.length) { finish(); return; }
    const pos = order[k];
    const cands = eligibleFor(pos).filter((c) => !used.has(c.id));
    if (!cands.length) { spots.push({ pos, card: REPLACEMENT_HITTER }); place(k + 1); spots.pop(); return; }
    for (const c of cands) { used.add(c.id); spots.push({ pos, card: c }); place(k + 1); spots.pop(); used.delete(c.id); }
  };
  place(0);
  const lineup = [...best].sort((x, y) => bat(y.card) - bat(x.card));
  if (!useDh) lineup.push({ pos: 'P', card: null });
  return lineup;
}

// Opponents choose who plays where the same bat + glove way as Boston (so a DH-only slugger plays
// 1B in no-DH games and DHs when a real first baseman is on hand — the logs' assignments mostly
// matched because this round's rosters rarely called for the swap), but keep their own batting
// habits: point-value order (puts 52% of hitters in their exact real slot, vs 24% for hitting value),
// pitcher 8th for Ann Arbor and New York, 9th for Detroit and Los Angeles.
function opponentBuildLineup(team, useDh, ref) {
  const slot = this.params.oppLineup.pitcherSlot[team.name] || 9;
  const hitters = bestLineup(team, useDh, ref).filter((s) => s.pos !== 'P').sort((x, y) => y.card.points - x.card.points);
  if (!useDh) hitters.splice(Math.min(slot, 9) - 1, 0, { pos: 'P', card: null });
  return hitters;
}

// ---- Opponent infield in (assumption 11), fit to 246 runner-on-third, < 2 out spots -------------
// About 20% overall. Mostly a question of the double play: with first base open they bring it in
// 33-46% of the time, with a runner on first 5-12%. Most often when tied, least when trailing by 3+;
// inning barely matters. On a grounder they send the runner only with plenty of safe faces (sent once,
// at 10; held at 8 and below, in 7 cases).
function opponentInfieldIn({ g, def }) {
  const p = this.params.oppInfieldIn;
  const l = g.score[def.idx] - g.score[1 - def.idx];
  const base = p.base[g.outs][g.bases[1] ? 'firstOccupied' : 'firstOpen'];
  const factor = l <= -3 ? p.score.trail3 : l < 0 ? p.score.trail1 : l === 0 ? p.score.tied : l <= 2 ? p.score.lead1 : p.score.lead3;
  return g.rng() < base * factor;
}

// ---- Opponent baserunning sends (assumption 9), fit to 649 real runner decisions -----------------
// Going home it's mostly safe faces (runner speed + bonuses - outfield defense): ~always at 15+,
// ~70% at 13-14, ~30% at 10-12, never below 10 — a bit warier with nobody out, bolder with two out,
// and about half as willing late in a game that isn't close. Going to third is rare: under ~15% unless
// 17+ faces, and almost never with two out. (Tags to second use policy.js's default.)
function opponentSendRunner(ctx) {
  const { g, to, faces, off } = ctx;
  const p = this.params.oppSend;
  let prob;
  if (to === 4) {
    prob = faces >= 15 ? p.home.at15 : faces >= 13 ? p.home.at13[g.outs] : faces >= 10 ? p.home.at10[g.outs] : 0;
    const margin = Math.abs(g.score[off.idx] - g.score[1 - off.idx]);
    if (g.inning >= 7 && margin >= 2 && faces < 15) prob *= p.lateNotCloseFactor;
  } else if (to === 3) {
    const t = g.outs === 2 ? p.thirdTwoOut : p.third;
    prob = faces >= t.highFaces ? t.high : faces >= 13 ? t.mid : faces >= 10 ? t.low : 0;
  } else {
    return DEFAULT_SEND_RUNNER.call(this, ctx);
  }
  return g.rng() < prob;
}

// ---- Opponent pinch running (assumption 7) ------------------------------------------------------
// Rare: 10 in 96 games, always a speed-A bench player for a speed-10/15 runner, 7th inning or later,
// within 2 runs. Teams carrying such a player used him in ~3% of those chances.
function opponentPinchRun(ctx) {
  if (ctx.g.rng() >= this.params.oppPinchRun.rate) return null;
  return DEFAULT_PINCH_RUN.call(this, ctx);
}

// ---- Opponent bunts (assumption 12) -------------------------------------------------------------
// 14 bunts in 96 games, 9 of them a pitcher at bat (no DH) with a runner on first, third open and
// fewer than two out — done ~36% of the time in that spot, varying by team (Ann Arbor never; LA and
// NY about half the time). Position-player bunts and intentional walks are too rare to model (3
// walks in ~7,700 PAs).
function opponentBunt({ g, off, batter }) {
  if (!batter.isPitcher || !g.bases[1] || g.bases[3] || g.outs >= 2) return false;
  const rate = this.params.oppBunt.pitcherRate[off.team.name];
  return g.rng() < (rate === undefined ? this.params.oppBunt.defaultRate : rate);
}

// ---- Opponent steals (assumption 8), fit to 1,433 runner-on-first opportunities --------------
// Only speed-A runners run, and only for second. Rate depends on the catcher's arm (about half the
// time vs arm <= 7, ~1/3 vs 8, ~1/8 vs 9) and almost never with a runner on third; score and outs
// barely matter. Los Angeles runs far more than the others.
function opponentSteal({ g, off, def }) {
  const p = this.params.oppSteal;
  const r1 = g.bases[1];
  if (!r1 || g.bases[2] || r1.speed < 20 || r1.card.isPitcher) return 0;
  const arm = def.def.C;
  const armFactor = arm <= 7 ? 1 : arm === 8 ? p.armFactor8 : arm === 9 ? p.armFactor9 : p.armFactor10;
  const teamRate = p.teamRate[off.team.name] !== undefined ? p.teamRate[off.team.name] : p.defaultRate;
  let base = teamRate * armFactor;
  // Below arm 6 (barely any real data) assume they run more as getting caught gets less likely: the
  // chance of holding shrinks with the caught-stealing chance, (arm + 1) / 20 vs 7/20 at arm 6,
  // raised to weakArmExponent (3 puts a typical team at ~75% vs arm 4, ~55% vs arm 5).
  if (p.extrapolateWeakArms && arm < 6) base = 1 - (1 - base) * Math.pow(Math.max(0, arm + 1) / 7, p.weakArmExponent);
  const prob = base * (g.bases[3] ? p.thirdOccupiedFactor : 1);
  return g.rng() < prob ? 1 : 0;
}

const OPPONENT = {
  params: {
    oppPitching: {
      pullUntired: { starter: 0.01, reliever: 0 },
      pullTired: {
        starter: { close: 0.73, mid: 0.52, blowout: 0.2 },
        reliever: { close: 0.72, mid: 0.55, blowout: 0.44 },
      },
      midMargin: 5, blowoutMargin: 7,
      highLeverage: { fromInning: 8, minLead: -2, maxLead: 3, decay: 0.25 }, // ~68% best arm, 24% second
      otherDecay: 0.75, // ~30% best, flatter after
      mopUpMargin: 5,   // from here, worst first (with otherDecay)
      replacement: { fromInning: 5, byMargin: [{ minMargin: 6, p: 0.1 }, { minMargin: 8, p: 0.4 }] },
    },
    oppPinchHit: { starterTiredNext: 0.72, starterFresh: 0.06, reliever: 0.68 },
    oppPinchRun: { rate: 0.03 },
    oppBunt: { pitcherRate: { 'Ann Arbor': 0, Detroit: 0.5, 'Los Angeles': 0.57, 'New York': 0.5 }, defaultRate: 0.36 },
    pinchRun: { enabled: true, fromInning: 7, maxDeficit: 2, maxLead: 2, runnerMaxSpeed: 15, minGain: 5 },
    oppLineup: { pitcherSlot: { 'Ann Arbor': 8, 'New York': 8, Detroit: 9, 'Los Angeles': 9 } },
    oppInfieldIn: {
      base: { 0: { firstOpen: 0.33, firstOccupied: 0.12 }, 1: { firstOpen: 0.46, firstOccupied: 0.05 } },
      score: { trail3: 0.5, trail1: 0.95, tied: 1.65, lead1: 0.8, lead3: 1.05 }, // relative to the 20% average
    },
    infieldIn: { sendFaces: 10, throwHomeMinOut: 0.35 },
    // Throw choice when two runners go (assumption 10): lead runner unless the trailer is ~0.25+
    // likelier out (19 real throws: 14 at the lead runner).
    throwChoice: { leadBias: 0.25 },
    oppSend: {
      home: { at15: 0.95, at13: { 0: 0.57, 1: 0.77, 2: 1 }, at10: { 0: 0.11, 1: 0.32, 2: 0.5 } },
      lateNotCloseFactor: 0.5,
      third: { low: 0.07, mid: 0.2, high: 0.63, highFaces: 17 },
      thirdTwoOut: { low: 0.1, mid: 0.08, high: 0.6, highFaces: 19 },
    },
    oppSteal: {
      // attempt rate per PA for a speed-A runner on first vs arm <= 7, by team
      teamRate: { 'Ann Arbor': 0.29, Detroit: 0.33, 'Los Angeles': 0.88, 'New York': 0.34 },
      defaultRate: 0.49,
      armFactor8: 0.73, armFactor9: 0.26, armFactor10: 0.15,
      thirdOccupiedFactor: 0.15,
      extrapolateWeakArms: true, // an assumption: the logs have almost no catchers below arm 6
      weakArmExponent: 3,        // a guess: how fast attempts climb below arm 6 (1 = proportional)
    },
  },
  // DH choice (13) uses policy.js's default rule for everyone: DH when yours is better.
  fns: {
    pitchingChange: opponentPitchingChange, pinchHit: opponentPinchHit, steal: opponentSteal,
    buildLineup: opponentBuildLineup, infieldIn: opponentInfieldIn, sendRunner: opponentSendRunner,
    pinchRun: opponentPinchRun, bunt: opponentBunt,
  },
};

// ---- Boston pitching: plan the rest of the game (assumptions 1 + 2) ------------------------------
// At the start of each half-inning, list every inning each available arm could still throw — the
// current pitcher's next innings get worse as he tires; each reliever is fresh up to his IP, then
// tired — and score each by expected runs per PA against the opposing lineup at that fatigue. The
// best innings cover the rest of the game. The current pitcher stays only if his next inning makes
// that cut; otherwise the best arm in the plan comes in. A bullpen inning also carries a charge for
// the fatigue it adds to later games in the series (seriesCost, the one tuned number).
//
// So the decision follows the actual pitchers: a weak, cheap starter leaves as soon as he's
// removable if the pen can cover the game; an ace stays while his tired innings still beat what the
// pen can supply; a thin pen keeps starters in longer.
function plannedInnings(side, card, inning, quality, cost, maxInnings, maxPenalty, secondInningBias = 0) {
  const out = [];
  if (card.id < 0) { // replacement pitcher never tires
    for (let j = 0; j < maxInnings; j++) out.push({ card, j, v: quality(card, card.ctrl) + cost });
    return out;
  }
  const st = getStats(side, card);
  const before = [...st.innings].filter((i) => i !== inning).length;
  // Every 3 runs charged so far costs an inning of IP (as in the app). Projecting runs he might
  // allow later doesn't change the decision: it only worsens his later innings, which already rank
  // behind this one, and the keep/pull call turns on this inning alone.
  const threshold = card.ip + st.mod - Math.floor(st.runs / 3);
  for (let j = 0; j < maxInnings; j++) {
    const penalty = Math.max(0, before + j + 1 - threshold);
    if (penalty > maxPenalty) break;
    // secondInningBias: extra weight on a reliever pitching past his IP in this game (negative =
    // prefer one reliever going two innings over spreading the fatigue across two relievers).
    const beyondIp = card.ip <= 3 && before + j + 1 > card.ip ? secondInningBias : 0;
    out.push({ card, j, v: quality(card, card.ctrl - penalty) + cost + beyondIp });
  }
  return out;
}
// Every inning each available arm of `side` could throw from `inning` to the end of the game, scored
// against `batters` (expected runs per PA, plus the bullpen charge), best first.
function inningPool(p, side, batters, inning, isTop, score) {
  const quality = (c, ctrl) => mean(batters, (b) => matchupLW(b, c, ctrl));
  const remaining = inning >= 9 ? 1 : 10 - inning;
  const plan = (c, cost) => plannedInnings(side, c, inning, quality, cost, remaining, p.maxPenalty, p.secondInningBias || 0);
  // Bullpen innings are scarcer for a small pen: the charge per inning is scarcity / (pen's total IP).
  let seriesCost = p.scarcity !== undefined
    ? p.scarcity / Math.max(1, side.team.relievers.reduce((t, c) => t + c.ip, 0))
    : p.seriesCost;
  // Runs allowed now are worth what they do to this game's win chances; the fatigue charge is paid
  // in later games, at a typical game's run value. So in a blowout the charge dominates (save the
  // pen), and in a close, late game it barely registers.
  const now = Math.max(p.minRunValue || 0.002, runValue(inning, isTop, score[1] - score[0]));
  if (p.leverage) seriesCost *= p.typicalRunValue / now;
  const pool = [];
  if (side.pitcher) pool.push(...plan(side.pitcher, 0));
  for (const c of side.pen) pool.push(...plan(c, seriesCost));
  if (p.allowReplacementPitcher) pool.push(...plan(REPLACEMENT_PITCHER, p.replacementCost));
  pool.sort((a, b) => a.v - b.v);
  return { pool, remaining, runValue: now };
}

function planPitchingChange({ g, def, off, inningStart, mustChange }) {
  const p = this.params.plan;
  if (!mustChange && !inningStart) return null;
  const cur = def.pitcher;
  const { pool, remaining } = inningPool(p, def, off.lineup.map((s) => s.card), g.inning, g.top, g.score);
  const best = pool.slice(0, remaining);
  if (cur && best.some((x) => x.card === cur && x.j === 0)) return null; // he's part of the best plan
  // Who goes first among the arms in the plan: the best now (default), or the weakest first so the
  // best are saved for later innings ('worst'), or weakest first until the late innings ('late').
  const inPlan = best.filter((x) => x.card !== cur && x.j === 0);
  const saveBest = p.order === 'worst' || (p.order === 'late' && g.inning < (p.lateFrom || 8));
  const incoming = (saveBest ? inPlan[inPlan.length - 1] : inPlan[0]) || pool.find((x) => x.card !== cur);
  return incoming ? incoming.card : null;
}

// ---- Boston pinch hitting for the pitcher (assumption 6) ----------------------------------------
// Hit for him when the at-bat gained is worth more than losing him: gain = (bench bat's expected runs
// - pitcher's, this PA, vs the pitcher on the mound) x what a run is worth now; cost = how much worse
// the best rest-of-game pitching plan gets without him (x ~4.3 PAs an inning) x what a run is worth
// next half-inning. If the plan would pull him anyway the cost is ~0. benchCost charges for spending
// the bench bat (he can't hit later). Position players are hit for only by the default rule.
const PAS_PER_INNING = 4.3;
function planPinchHit(ctx) {
  const { g, off, def, spotIdx, batter } = ctx;
  if (!batter.isPitcher) return DEFAULT_PINCH_HIT.call(this, ctx);
  if (!canRemovePitcher(g, off, true)) return null;
  const ctrl = effectiveControl(def, def.pitcher, g.inning);
  const value = (c) => matchupLW(c, def.pitcher, ctrl);
  const bench = off.bench.filter((c) => canTakeSpot(g, off, c, spotIdx)).sort((a, b) => value(b) - value(a));
  if (!bench.length) return null;
  const nowValue = Math.max(0.002, runValue(g.inning, g.top, g.score[1] - g.score[0]));
  const gain = (value(bench[0]) - value(batter)) * nowValue;

  const p = this.params.plan;
  const nextInning = g.top ? g.inning : g.inning + 1;
  const { pool, remaining, runValue: nextValue } = inningPool(p, off, def.lineup.map((s) => s.card), nextInning, !g.top, g.score);
  const sum = (list) => list.slice(0, remaining).reduce((t, x) => t + x.v, 0);
  const cost = (sum(pool.filter((x) => x.card !== batter)) - sum(pool)) * PAS_PER_INNING * nextValue;
  return gain - cost > this.params.phPlan.benchCost * nowValue ? bench[0] : null;
}

// ---- Win-probability steal rule (assumption 8) ----------------------------------------------------
// Run only when it raises the chance of winning, from the league's win-probability table: compare
// staying put with (chance safe x win% with the runner on second) + (chance caught x win% with one
// more out and first base empty). Safe iff speed beats arm + d20, so P(safe) = (speed - arm - 1)/20.
function offenseWP(g, offIdx, outs, base) {
  const home = lookupWP(wpTable, { inning: g.inning, isTop: g.top, outs, base, home: g.score[1], away: g.score[0] });
  return offIdx === 1 ? home : 1 - home;
}
function wpSteal({ g, off, def }) {
  const r1 = g.bases[1];
  if (!r1 || g.bases[2] || r1.card.isPitcher) return 0;
  const pSafe = Math.max(0, Math.min(20, r1.speed - def.def.C - 1)) / 20;
  if (pSafe <= 0) return 0;
  const third = g.bases[3] ? 4 : 0;
  const stay = offenseWP(g, off.idx, g.outs, 1 | third);
  const safe = offenseWP(g, off.idx, g.outs, 2 | third);
  const caught = offenseWP(g, off.idx, g.outs + 1, third);
  return pSafe * safe + (1 - pSafe) * caught - stay > this.params.wpSteal.minGain ? 1 : 0;
}

// ---- Sending the runner on a grounder to a drawn-in infield (assumption 11) ---------------------
// From the league's win-probability table, at the actual outs, runners and score: holding = batter
// out, runner stays on third; sending = the defense picks the worse for us of throwing home (safe
// with chance faces/20: run scores, batter on first; else runner out, batter on first) or taking the
// out at first (run scores, batter out). Send when that beats holding. A runner on first moves up
// either way. Comes up about once every 19 Boston games.
function wpInfieldInSend({ g, off, faces }) {
  const after = (g.bases[1] ? 2 : 0) | (g.bases[2] ? 2 : 0);
  const wp = (outs, base, extraRuns) => {
    const score = [...g.score]; score[off.idx] += extraRuns;
    const home = lookupWP(wpTable, { inning: g.inning, isTop: g.top, outs, base, home: score[1], away: score[0] });
    return off.idx === 1 ? home : 1 - home;
  };
  const p = faces / 20;
  const hold = wp(g.outs + 1, 4 | after, 0);
  const throwHome = p * wp(g.outs, 1 | after, 1) + (1 - p) * wp(g.outs + 1, 1 | after, 0);
  const throwFirst = wp(g.outs + 1, after, 1);
  return Math.min(throwHome, throwFirst) > hold;
}

// ---- Series-aware rotation (assumption 5) -------------------------------------------------------
// Knowing the opponent and who hosts each game, work out each game's DH rule (both teams' choices
// follow the shared rule) and the lineup the opponent will field, then try all 24 orders of the four
// starters (slots: games 1&5, 2&6, 3&7, 4) and keep the one with the fewest expected runs allowed.
// A starter covers about his IP; the pen (its average quality vs that lineup) covers the rest.
function seriesRotation(team, ref, ctx) {
  const starters = [...team.starters];
  while (starters.length < 4) starters.push(REPLACEMENT_PITCHER);
  if (!ctx || !ctx.opponent) return DEFAULT_ROTATION.call(this, team, ref);
  const { opponent, opponentPolicy: oppPolicy, isSeriesHome, policy } = ctx;
  const oppRotation = oppPolicy.rotation(opponent, ref);
  const games = [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const weHost = [3, 4, 5].includes(n) ? !isSeriesHome : isSeriesHome;
    const dh = weHost ? !!policy.wantsDh(team, { opponent, ref }) : !!oppPolicy.wantsDh(opponent, { opponent: team, ref });
    const lineup = oppPolicy.buildLineup(opponent, dh, ref).map((s) => s.card || oppRotation[(n - 1) % 4]);
    return { lineup };
  });
  const quality = (c, lineup) => mean(lineup, (h) => matchupLW(h, c, c.ctrl));
  const runs = games.map(({ lineup }) => {
    const pen = team.relievers.length ? mean(team.relievers, (r) => quality(r, lineup)) : quality(REPLACEMENT_PITCHER, lineup);
    return starters.map((c) => { const share = Math.min(9, c.id < 0 ? 1 : c.ip) / 9; return share * quality(c, lineup) + (1 - share) * pen; });
  });
  const slotOf = [0, 1, 2, 3, 0, 1, 2];
  let best = null; let bestRuns = Infinity;
  const perm = (arr, k = 0) => {
    if (k === arr.length) {
      const total = slotOf.reduce((t, slot, g) => t + runs[g][arr[slot]], 0);
      if (total < bestRuns - 1e-12) { bestRuns = total; best = [...arr]; }
      return;
    }
    for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
  };
  perm(starters.slice(0, 4).map((_, i) => i));
  return best.map((i) => starters[i]);
}

// ---- Boston bunts (assumption 12): the pitcher sacrifices with a runner on first, third open and
// fewer than two out. A batting pitcher never wins the advantage, so he swings on the opposing
// pitcher's chart — mostly outs, and a grounder with a runner on first is a likely double play
// (infield + d20 vs his speed 10). The bunt trades that for a sure out and a runner in scoring position.
function bostonBunt({ g, batter }) {
  return batter.isPitcher && !!g.bases[1] && !g.bases[3] && g.outs < 2;
}

// ---- Boston -----------------------------------------------------------------------------------
// Pitching (1 + 2): the rest-of-game plan above, with each bullpen inning charged 0.07 / (the pen's
// total IP) runs per PA for the fatigue it carries into later games — so a short pen is spent more
// carefully. Tested on five versions of the Boston roster (current, Pedro for Dotel, cheap rotation,
// 4-man pen, elite pen) against the league-typical style and the earlier fixed-margin policy: it
// tied on the current and Pedro rosters and won by +0.65 to +2.1 on the others
// (node sim/compare-policies.js). Mid-inning changes aren't planned.
// DH (13): the shared rule — use it when Boston's DH out-hits the opponent's (policy.js default).
// Lineup (4): bestLineup — for each game type, the nine (or eight) and positions with the best bat +
// glove total, ignoring roster assignments (e.g. a DH-only slugger plays 1B in no-DH games but DHs
// when a real first baseman can take 1B). +0.54 on a Thomas-at-1B / Segui-at-DH roster; no change on
// the current one. Batting order best to worst. Every sensible order tested (point value, Boston's real 2-4-5-1-3 pattern, the sabermetric
// 3-1-5-2-4 pattern, pitcher 8th or 9th) landed within ~0.15 points of it; only worst-to-best cost
// real ground (~1 point). Batting order isn't worth optimizing (node sim/compare-policies.js lineup).
// Rotation (5): policy.js's default — best to worst, so the worst starter takes game 4 (the one who
// pitches once). The order of games 1-3 made no difference (all within ~0.2); giving the single start
// to anyone but the worst starter cost 1-2.5 points (node sim/compare-policies.js rotation).
// Infield in (11): bring it in whenever there's a runner on third, fewer than two outs and first base
// open — any inning, any score. +0.3-0.4 over "8th+, within a run" (which was no better than never),
// confirmed at 20,000 series per opponent on two rosters. With a runner on first, play back for the
// double play. On offense, send the runner on a grounder to a drawn-in infield at 8+ safe faces
// (policy.js default). The win-probability table's break-evens (wpInfieldInSend: nearly always with
// one out and nobody else on, ~7-12 faces with another runner aboard and nobody out) tested worse
// than the flat 8+ rule (53.99% vs 54.32%, 15,000 series per opponent) — as with steals, the league
// table misjudges these small baserunning calls. Comes up about once every 19 games. The throw-home
// choice made no reliable difference (node sim/compare-policies.js infield).
// Baserunning sends (9): policy.js's default, i.e. research.R's running rules — going home: nobody out
// only when automatic, 1 out at 15+ safe faces, 2 out always; going to third at 15+, never with 2
// out. Best or tied of everything tested; the league habit cost ~0.85 points, sending home with
// nobody out at 15+ cost ~0.4, going to third at 12+ cost ~0.5. Inning and score made no difference
// (late/close, late/not close, trailing, early variants all within ~0.1) (compare-policies.js send).
// Multiple runners: deciding each runner on his own odds tied sending the trailer as a decoy whenever
// the lead runner goes (~29 extra decoys per 100 games) and never sending him; on defense, throwing at
// the likelier out tied always-lead and always-trailer (within ~0.15).
// Pinch running (7): policy.js's default — 8th inning on, tied or down one, a speed-A backup for a
// speed-10 runner. Tied "9th only, within 1" and "7th+, within 2" (+0.2 over never, on a roster with
// Cairo/Shumpert as backups); running for speed-15 runners too cost ~0.4, any-score ~0.8 — the bat
// you give up outweighs the speed (node sim/compare-policies.js pinchrun).
// Bunts and intentional walks (12): bunt with the pitcher (bostonBunt: runner on first, third open,
// < 2 out) — +0.3 over never (+0.2 with nobody out only; the league's 36% habit +0.1); adding weak
// position hitters late and close gained nothing. Never walk anyone intentionally: walking the 8th
// hitter to face the pitcher cost 2.3 points (0.3 even with two out only), walking a much better
// hitter late and close cost 0.6.
// Steals (8): policy.js's default, i.e. the stated rules from research.R (A runners vs arm <= 5, or
// in a tie game vs 10/7/8 by outs) — which in this league (catcher arms 6-11) means running only in
// tie games. On rosters with speed-A runners it tied "never steal" and beat every looser rule
// (arm <= 6 to <= 9, the league-typical habit, a win-probability rule) by 0.2-2.3 points: a 50-65%
// success rate doesn't pay in this run environment (node sim/compare-policies.js steal).
// Pinch hitting (6): planPinchHit — hit for the pitcher when the at-bat gained beats what losing him
// costs the rest-of-game pitching plan, both in win-probability terms. Never pinch-hitting cost
// 0.7-1.2 points and always hitting for him cost 0.2-0.6; the planner tied the simple default
// (tired next inning, or 7th+ when not leading) on both rosters tested and is kept because it
// follows the actual pitchers (node sim/compare-policies.js pinchhit). Position players: default
// rule, which in practice never fires — backups rarely out-hit a starter they can replace.
const BOSTON = {
  params: {
    plan: {
      scarcity: 0.07, replacementCost: 0, allowReplacementPitcher: true, maxPenalty: 3,
      leverage: true, typicalRunValue: 0.0857, minRunValue: 0.002, // 0.0857 = one run's value in a tied 1st
    },
    phPlan: { benchCost: 0 },
    infieldIn: { fromInning: 1, minLead: -99, maxLead: 99, firstBaseOpenOnly: true, sendFaces: 8, throwHomeMinOut: 0.35 },
  },
  fns: { pitchingChange: planPitchingChange, pinchHit: planPinchHit, buildLineup: bestLineup, bunt: bostonBunt },
};

const opponentPolicy = () => makePolicy(OPPONENT);
const bostonPolicy = () => makePolicy(BOSTON);

module.exports = { OPPONENT, BOSTON, opponentPolicy, bostonPolicy, planPitchingChange, wpSteal, planPinchHit, orderedLineup, seriesRotation, wpInfieldInSend, bestLineup, opponentBunt };
