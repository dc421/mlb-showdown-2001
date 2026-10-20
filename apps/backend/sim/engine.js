// Headless MLB Showdown game engine for Monte Carlo simulation.
//
// This is a lean re-implementation of the live game's rules (gameLogic.js applyOutcome / resolveThrow
// / calculateStealResult plus the pitch, steal, throw, infield-in, substitution and series-fatigue
// logic in server.js) with no DB, no cloning and no UI state. Rules are mirrored as the app plays
// them; every managerial choice is delegated to the side's policy (see policy.js).
const { REPLACEMENT_PITCHER, REPLACEMENT_HITTER } = require('./cards');
const {
  clamp, eligible, defenseRatings, getStats, effectiveControl, canRemovePitcher, canTakeSpot, matchupLW,
} = require('./rules');

// For calibration traces: how the incoming pitcher ranked among the arms available (by quality
// against a league-average hitter at current fatigue; rank 0 = best), and whether he came in tired.
function entryInfo(g, def, next) {
  if (next.id < 0) return { replacement: true };
  const refHitter = { ob: g.ref.hitterOB, chartLW: g.ref.hitterLW, isPitcher: false };
  const opts = def.pen.map((c) => {
    const ctrl = effectiveControl(def, c, g.inning);
    return { c, tired: ctrl < c.ctrl, q: matchupLW(refHitter, c, ctrl) };
  });
  const me = opts.find((o) => o.c === next);
  return { rank: opts.filter((o) => o.q < me.q - 1e-9).length, available: opts.length, tired: me.tired, freshAvailable: opts.filter((o) => !o.tired).length };
}

// Rule switches for what-if testing; the defaults are the app's rules.
//   infieldInSingles: how many of the chart's highest GB results become singles vs a drawn-in infield.
//   infieldInMode: 'app' (as the app plays it) or 'speedCheck' (no infield singles; on a grounder the
//     runner on third holds and the batter is out only if infield + d20 beats his speed).
const RULES = { infieldInSingles: 1, infieldInMode: 'app' };

// Small seedable RNG so runs are reproducible.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const d20 = (g) => 1 + Math.floor(g.rng() * 20);

function makeSide(idx, team, policy, useDh, starter, mods, ref) {
  const lineup = policy.buildLineup(team, useDh, ref).map((s) => ({ ...s }));
  const pitcherSpot = lineup.findIndex((s) => s.pos === 'P');
  if (pitcherSpot >= 0) lineup[pitcherSpot].card = starter;
  const inLineup = new Set(lineup.map((s) => s.card.id));
  const side = {
    idx, team, policy, lineup, pitcherSpot,
    batIdx: 0,
    pitcher: starter,
    pitcherIsStarter: true,
    bench: team.hitters.filter((c) => !inLineup.has(c.id)),
    pen: [...team.relievers],
    pstats: new Map(),
    def: defenseRatings(lineup),
  };
  for (const [id, mod] of mods || []) {
    if (mod) side.pstats.set(id, { innings: new Set(), runs: 0, bf: 0, outs: 0, tired: false, mod });
  }
  return side;
}

// force: count the run even after a walk-off (every run counts on a game-ending home run).
function scoreRun(g, off, runner, force = false) {
  if (g.over && !force) return;
  g.score[off.idx]++;
  if (runner.por) runner.por.runs++; // charged to whoever was pitching when he reached
  if (!g.top && g.inning >= 9 && g.score[1] > g.score[0]) g.over = true; // walk-off
}

function bringInPitcher(def, pitcher) {
  def.pen = def.pen.filter((c) => c !== pitcher);
  def.pitcher = pitcher;
  def.pitcherIsStarter = false;
  if (def.pitcherSpot >= 0) def.lineup[def.pitcherSpot] = { pos: 'P', card: pitcher };
}

function managePitching(g, def, off, inningStart) {
  const mustChange = !def.pitcher;
  if (!mustChange && !canRemovePitcher(g, def, false)) return;
  let next = def.policy.pitchingChange({ g, def, off, inningStart, mustChange });
  if (next && next !== REPLACEMENT_PITCHER && !def.pen.includes(next)) next = null; // illegal pick
  if (!next && mustChange) next = def.pen[0] || REPLACEMENT_PITCHER;
  if (next) {
    if (g.trace) g.entryInfo = entryInfo(g, def, next);
    bringInPitcher(def, next);
    if (mustChange) g.forcedChange = true;
  }
}

function manageDefense(g, def) {
  // Anyone left in a position he can't play (a pinch runner who doesn't play the runner's position,
  // or a backup before the 7th) gives way to the best eligible bench player, else the emergency
  // fielder (the replacement hitter: +0 everywhere, arm 0 at catcher), who takes over his lineup spot.
  let fixed = false;
  def.lineup.forEach((spot, idx) => {
    if (idx === def.pitcherSpot || spot.pos === 'DH' || spot.pos === 'P' || spot.pos === 'PH') return;
    const blocked = (c) => def.team.restricted.has(c.id) && g.inning < 7;
    if (eligible(spot.card, spot.pos) && !blocked(spot.card)) return;
    const sub = def.bench.filter((c) => eligible(c, spot.pos) && !blocked(c))
      .sort((x, y) => (y.fld[spot.pos] || 0) - (x.fld[spot.pos] || 0))[0];
    if (sub) def.bench = def.bench.filter((c) => c !== sub);
    spot.card = sub || REPLACEMENT_HITTER;
    fixed = true;
  });
  if (fixed) def.def = defenseRatings(def.lineup);
  const swaps = def.policy.defensiveReplacements({ g, def }) || [];
  for (const { spotIdx, card } of swaps) {
    const spot = def.lineup[spotIdx];
    if (!spot || spotIdx === def.pitcherSpot || !def.bench.includes(card) || !eligible(card, spot.pos)) continue;
    if (spot.pos !== 'DH' && def.team.restricted.has(card.id) && g.inning < 7) continue;
    spot.card = card;
    def.bench = def.bench.filter((c) => c !== card);
  }
  if (swaps.length) def.def = defenseRatings(def.lineup);
}

function manageOffense(g, off, def) {
  const spotIdx = off.batIdx;
  const spot = off.lineup[spotIdx];
  if (off.bench.length) {
    const ph = off.policy.pinchHit({ g, off, def, spotIdx, batter: spot.card });
    const forPitcher = spot.card.isPitcher;
    if (ph && off.bench.includes(ph) && canTakeSpot(g, off, ph, spotIdx) && (!forPitcher || canRemovePitcher(g, off, true))) {
      off.bench = off.bench.filter((c) => c !== ph);
      if (forPitcher) {
        off.lineup[spotIdx] = { pos: 'PH', card: ph };
        off.hitFor = { card: off.pitcher, starter: off.pitcherIsStarter }; // for calibration traces
        off.pitcher = null; // a new pitcher must come in when this side takes the field
      } else {
        spot.card = ph;
        off.def = defenseRatings(off.lineup);
      }
    }
  }
  if (off.bench.length) {
    const pr = off.policy.pinchRun({ g, off, def });
    const old = pr && g.bases[pr.base];
    if (old && !old.card.isPitcher && off.bench.includes(pr.card)) {
      // Legal for anyone (as in the app); if he can't play the position, manageDefense fixes it
      // when this side takes the field.
      const prSpot = off.lineup.findIndex((s) => s.card === old.card);
      if (prSpot >= 0 && prSpot !== off.pitcherSpot) {
        off.bench = off.bench.filter((c) => c !== pr.card);
        off.lineup[prSpot].card = pr.card;
        off.def = defenseRatings(off.lineup);
        g.bases[pr.base] = { card: pr.card, speed: pr.card.speed, por: old.por };
      }
    }
  }
}

// Stolen-base attempts before the pitch. Safe only if speed beats arm + roll (ties to the catcher);
// going for third costs the runner 5.
function runSteals(g, off, def, pst) {
  // For calibration: one record per plate appearance that starts with a runner on 1st and 2nd open
  // (kept on trace.steals so the per-PA records stay uniform).
  const opp = g.trace && g.bases[1] && !g.bases[2]
    ? { team: off.team.name, speed: g.bases[1].speed, arm: def.def.C, outs: g.outs, b3: !!g.bases[3], lead: g.score[off.idx] - g.score[def.idx], inning: g.inning, attempt: false, safe: null }
    : null;
  if (opp) (g.trace.steals = g.trace.steals || []).push(opp);
  for (let attempts = 0; attempts < 2 && g.outs < 3; attempts++) {
    const from = off.policy.steal({ g, off, def });
    const runner = from === 1 || from === 2 ? g.bases[from] : null;
    if (!runner || g.bases[from + 1]) return;
    const speed = runner.speed - (from === 2 ? 5 : 0);
    g.bases[from] = null;
    const safe = speed > def.def.C + d20(g);
    if (opp && from === 1 && attempts === 0) { opp.attempt = true; opp.safe = safe; }
    if (safe) g.bases[from + 1] = runner;
    else { g.outs++; pst.outs++; }
  }
}

// Runners trying for an extra base. The defense picks ONE to throw at; the rest advance freely.
// Safe if (adjusted speed) >= outfield + roll — ties go to the runner.
function resolveSends(g, off, def, pst, sent) {
  if (sent.length === 0) return;
  const OF = def.def.OF;
  let target = 0;
  if (sent.length > 1) {
    const candidates = sent.map((s) => ({ to: s.to, pOut: 1 - clamp(s.eff - OF, 0, 20) / 20 }));
    target = clamp(def.policy.throwTarget({ g, off, def, candidates }) | 0, 0, sent.length - 1);
  }
  sent.forEach((s, i) => {
    const safe = i !== target || s.eff >= OF + d20(g);
    if (!safe) { g.outs++; pst.outs++; } else if (s.to === 4) scoreRun(g, off, s.runner);
    else g.bases[s.to] = s.runner;
  });
}

function walk(g, off, batterRunner) {
  const b = g.bases;
  if (b[1] && b[2] && b[3]) scoreRun(g, off, b[3]);
  if (b[1] && b[2]) b[3] = b[2];
  if (b[1]) b[2] = b[1];
  b[1] = batterRunner;
}

function bunt(g, pst) {
  const b = g.bases;
  g.outs++; pst.outs++;
  if (b[1] && b[2] && b[3]) return 'FC_HOME'; // caller places the batter
  if (g.outs >= 3 || b[3]) {
    if (g.outs < 3 && b[3] && b[1] && !b[2]) { b[2] = b[1]; b[1] = null; }
    return null;
  }
  if (b[2]) { b[3] = b[2]; b[2] = null; }
  if (b[1]) { b[2] = b[1]; b[1] = null; }
  return null;
}

function groundBall(g, off, def, pst, B, infieldIn) {
  const b = g.bases;
  const [, r1, r2, r3] = b;
  const out = (n) => { g.outs += n; pst.outs += n; };

  if (infieldIn && r3) {
    if (r1 && r2) { // bases loaded: force at home
      out(1);
      if (g.outs < 3) { b[3] = r2; b[2] = r1; b[1] = B; }
      return;
    }
    if (RULES.infieldInMode === 'speedCheck') {
      // The runner on third holds; the batter is out at first only if infield + d20 beats his speed.
      // (Not loaded, so with a runner on first, second is open and he moves up either way.)
      const batterOut = def.def.IF + d20(g) > B.speed;
      if (r1) b[2] = r1;
      b[1] = batterOut ? null : B;
      if (batterOut) out(1);
      return;
    }
    const faces = clamp(r3.speed - def.def.IF, 0, 20);
    if (!off.policy.infieldInSend({ g, off, def, runner: r3, faces })) {
      out(1); // batter out at first, runner on third holds
      if (g.outs < 3 && r1) { b[2] = r1; b[1] = null; }
    } else if (def.policy.infieldInThrowHome({ g, off, def, runner: r3, pOut: 1 - faces / 20 })) {
      b[3] = null;
      if (r1) b[2] = r1;
      b[1] = B; // batter reaches on the fielder's choice
      if (r3.speed >= def.def.IF + d20(g)) scoreRun(g, off, r3);
      else out(1);
    } else {
      out(1); // take the out at first, concede the run (unless that out ends the inning — possible
      // when a caught stealing after the infield came in left two out)
      if (g.outs < 3) scoreRun(g, off, r3);
      b[3] = null;
      if (g.outs < 3 && r1) { b[2] = r1; b[1] = null; }
    }
    return;
  }

  if (g.outs <= 1 && r1) {
    // Double-play attempt: runner from first is always out; batter is out too if IF + roll beats his speed.
    const isDP = def.def.IF + d20(g) > B.speed;
    out(isDP ? 2 : 1);
    if (g.outs < 3) {
      if (r3) { scoreRun(g, off, r3); b[3] = null; }
      if (r2) { b[3] = r2; b[2] = null; }
    }
    b[1] = isDP ? null : B;
    return;
  }

  out(1);
  if (g.outs < 3) {
    if (r3) { scoreRun(g, off, r3); b[3] = null; }
    if (r2) { b[3] = r2; b[2] = null; }
  }
}

function flyBall(g, off, def, pst) {
  g.outs++; pst.outs++;
  if (g.outs >= 3) return;
  const b = g.bases;
  const OF = def.def.OF;
  const sent = [];
  let aheadOpen = true; // is the base this runner wants vacant?
  for (const from of [3, 2, 1]) {
    const r = b[from];
    if (!r) { aheadOpen = true; continue; }
    const to = from + 1;
    const eff = r.speed + (to === 4 ? 5 : 0) - (to === 2 ? 5 : 0);
    const mustHold = (r.speed === 10 && (to === 2 || to === 3)) || (r.speed === 15 && to === 2);
    if (aheadOpen && eff >= OF + 20) { // advances without a throw
      b[from] = null;
      if (to === 4) scoreRun(g, off, r); else b[to] = r;
    } else if (aheadOpen && !mustHold
      && off.policy.sendRunner({ g, off, def, kind: 'tag', runner: r, to, faces: clamp(eff - OF, 0, 20), leadSent: sent.length > 0, leadFaces: sent.length ? clamp(sent[sent.length - 1].eff - OF, 0, 20) : null })) {
      b[from] = null;
      sent.push({ runner: r, to, eff });
    }
    aheadOpen = !b[from];
  }
  resolveSends(g, off, def, pst, sent);
}

function single(g, off, def, pst, B, outcome) {
  const [, r1, r2, r3] = g.bases;
  const OF = def.def.OF;
  if (r3) scoreRun(g, off, r3);
  // Everyone moves up one; r2 and r1 may then try for one more.
  const b = g.bases;
  b[3] = r2; b[2] = r1; b[1] = B;
  if (g.over) return;
  const twoOut = g.outs === 2 ? 5 : 0;
  const sent = [];
  if (r2) {
    const eff = r2.speed + 5 + twoOut;
    if (eff >= OF + 20) { b[3] = null; scoreRun(g, off, r2); }
    else if (off.policy.sendRunner({ g, off, def, kind: 'hit', runner: r2, to: 4, faces: clamp(eff - OF, 0, 20) })) {
      b[3] = null;
      sent.push({ runner: r2, to: 4, eff });
    }
  }
  if (r1 && !b[3] && !g.over) {
    const eff = r1.speed + twoOut;
    const mustHold = r1.speed === 10 && outcome !== '1B+';
    if (eff >= OF + 20) { b[2] = null; b[3] = r1; }
    else if (!mustHold && off.policy.sendRunner({ g, off, def, kind: 'hit', runner: r1, to: 3, faces: clamp(eff - OF, 0, 20), leadSent: sent.length > 0, leadFaces: sent.length ? clamp(sent[0].eff - OF, 0, 20) : null })) {
      b[2] = null;
      sent.push({ runner: r1, to: 3, eff });
    }
  }
  resolveSends(g, off, def, pst, sent);
  if (outcome === '1B+' && !b[2] && b[1] === B) { b[2] = B; b[1] = null; } // takes second without a throw
}

function double(g, off, def, pst, B) {
  const [, r1, r2, r3] = g.bases;
  const b = g.bases;
  if (r3) scoreRun(g, off, r3);
  if (r2) scoreRun(g, off, r2);
  b[3] = null; b[2] = B; b[1] = null;
  if (!r1 || g.over) return;
  const OF = def.def.OF;
  const eff = r1.speed + 5 + (g.outs === 2 ? 5 : 0);
  if (eff >= OF + 20) scoreRun(g, off, r1);
  else if (off.policy.sendRunner({ g, off, def, kind: 'hit', runner: r1, to: 4, faces: clamp(eff - OF, 0, 20) })) {
    resolveSends(g, off, def, pst, [{ runner: r1, to: 4, eff }]);
  } else b[3] = r1;
}

function plateAppearance(g, off, def, infieldIn) {
  const batter = off.lineup[off.batIdx].card;
  const pitcher = def.pitcher;
  const pst = getStats(def, pitcher);
  const B = { card: batter, speed: batter.speed, por: pst };
  const b = g.bases;
  pst.bf++;

  if (def.policy.intentionalWalk({ g, off, def, batter })) { walk(g, off, B); return; }
  if (off.policy.bunt({ g, off, def, batter })) {
    const [, r1, r2] = b;
    if (bunt(g, pst) === 'FC_HOME' && g.outs < 3) { b[3] = r2; b[2] = r1; b[1] = B; }
    return;
  }

  // The pitch: roll + effective control must BEAT on-base. A batting pitcher never has the advantage.
  const ctrl = effectiveControl(def, pitcher, g.inning);
  if (ctrl < pitcher.ctrl) pst.tired = true;
  if (g.trace) {
    g.trace.push({
      game: g.key, def: `${g.key}:${def.idx}`, defTeam: def.team.name, inning: g.inning, top: g.top,
      pitcher: pitcher.id, starter: def.pitcherIsStarter, replacement: pitcher.id < 0,
      penalty: pitcher.ctrl - ctrl, lead: g.score[def.idx] - g.score[off.idx],
      halfStart: g.halfStart, forced: g.halfStart && !!g.forcedChange, ...(g.halfStart ? g.halfInfo : null),
      outs: g.outs, b1: !!g.bases[1], b3: !!g.bases[3], infieldIn,
    });
  }
  if (g.trace && g.entryInfo) { g.trace[g.trace.length - 1].entry = g.entryInfo; g.entryInfo = null; }
  g.halfStart = false;
  const pitchRoll = d20(g);
  const pitcherAdv = batter.isPitcher || pitchRoll + ctrl > batter.ob;
  const holder = pitcherAdv ? pitcher : batter;
  const swing = d20(g);
  let outcome = holder.chart[swing];
  // Drawn-in infield: the highest GB result on the chart sneaks through for a single.
  if (outcome === 'GB' && infieldIn && RULES.infieldInMode === 'app' && holder.gbRolls.slice(0, RULES.infieldInSingles).includes(swing)) outcome = '1B';

  const runsBefore = g.score[off.idx];
  switch (outcome) {
    case 'GB': groundBall(g, off, def, pst, B, infieldIn); break;
    case 'FB': flyBall(g, off, def, pst); break;
    case '1B': case '1B+': single(g, off, def, pst, B, outcome); break;
    case '2B': double(g, off, def, pst, B); break;
    case '3B':
      for (const from of [3, 2, 1]) if (b[from]) { scoreRun(g, off, b[from]); b[from] = null; }
      b[3] = B;
      break;
    case 'HR':
      for (const from of [3, 2, 1]) if (b[from]) { scoreRun(g, off, b[from], true); b[from] = null; }
      scoreRun(g, off, B, true);
      break;
    case 'BB': walk(g, off, B); break;
    default: g.outs++; pst.outs++; // SO, PU
  }
  if (g.trace) g.trace[g.trace.length - 1].runsOnPA = g.score[off.idx] - runsBefore;
}

function playHalfInning(g) {
  const off = g.sides[g.top ? 0 : 1];
  const def = g.sides[g.top ? 1 : 0];
  g.outs = 0;
  g.bases = [null, null, null, null];
  manageDefense(g, def);
  g.halfStart = true;
  g.forcedChange = false;
  // For calibration: the state of the pitcher who would start this half if nobody intervened.
  const inc = def.pitcher || (def.hitFor && def.hitFor.card);
  g.halfInfo = g.trace && inc ? {
    incumbent: inc.id, incStarter: def.pitcher ? def.pitcherIsStarter : def.hitFor.starter,
    incPenalty: inc.ctrl - effectiveControl(def, inc, g.inning),
    incLegal: def.pitcher ? canRemovePitcher(g, def, false) : true,
  } : null;
  def.hitFor = null;
  runHalfInning(g, true);
}

// Play out the current half-inning from whatever state g is in (used to start mid-inning in
// scenario tests). inningStart = whether pitching changes for a fresh half-inning are allowed.
function runHalfInning(g, inningStart) {
  const off = g.sides[g.top ? 0 : 1];
  const def = g.sides[g.top ? 1 : 0];
  while (g.outs < 3 && !g.over) {
    managePitching(g, def, off, inningStart);
    inningStart = false;
    manageOffense(g, off, def);
    const pst = getStats(def, def.pitcher);
    if (def.pitcher.id > 0) pst.innings.add(g.inning); // an inning is banked once he's on the mound for a batter
    const infieldIn = !!g.bases[3] && g.outs < 2 && !!def.policy.infieldIn({ g, off, def });
    runSteals(g, off, def, pst);
    if (g.outs >= 3) break; // caught stealing ended it: same batter leads off next time
    plateAppearance(g, off, def, infieldIn);
    off.batIdx = (off.batIdx + 1) % 9;
  }
}

// Play one game. home/away: { team, policy, starter, mods } where mods is a Map of
// card id -> series fatigue modifier (<= 0) for relievers. Returns the final score and both sides
// (for reliever usage).
// trace (optional array) collects one record per plate appearance for calibration.
function simulateGame({ home, away, useDh, rng, ref, trace, key }) {
  const g = {
    inning: 1, top: true, outs: 0, bases: [null, null, null, null], score: [0, 0], over: false, rng, trace, key, ref,
    sides: [
      makeSide(0, away.team, away.policy, useDh, away.starter, away.mods, ref),
      makeSide(1, home.team, home.policy, useDh, home.starter, home.mods, ref),
    ],
  };
  while (!g.over) {
    playHalfInning(g);
    if (g.over) break;
    if (g.inning >= 9 && ((g.top && g.score[1] > g.score[0]) || (!g.top && g.score[1] !== g.score[0]))) break;
    if (g.top) g.top = false; else { g.top = true; g.inning++; }
  }
  return { awayScore: g.score[0], homeScore: g.score[1], innings: g.inning, sides: g.sides };
}

// Series reliever fatigue, mirroring initializePitcherFatigue: each reliever (IP <= 3) carries a
// score that rises by innings pitched (plus runs/3 if he pitched tired), falls by one for each game
// or travel day he sits, and costs IP once it exceeds (IP - 1).
function updateFatigue(scores, team, side, gameNumber) {
  for (const r of team.relievers) {
    const st = side.pstats.get(r.id);
    const innings = st ? st.innings.size : 0;
    const faced = !!st && st.bf > 0;
    let score = scores.get(r.id) || 0;
    if (innings > 0 || faced) score += Math.max(innings, faced ? 1 : 0) + (st.tired ? Math.floor(st.runs / 3) : 0);
    else score = Math.max(0, score - 1);
    if (gameNumber === 2 || gameNumber === 5) score = Math.max(0, score - 1); // travel day
    scores.set(r.id, score);
  }
}

function fatigueMods(scores, team) {
  const mods = new Map();
  for (const r of team.relievers) {
    const penalty = Math.max(0, (scores.get(r.id) || 0) - Math.max(0, r.ip - 1));
    if (penalty > 0) mods.set(r.id, -penalty);
  }
  return mods;
}

// Play a full seven-game series (all seven, as in the regular season; read the first team to four
// wins for a playoff series). a/b: { team, policy }. aIsSeriesHome: a hosts games 1, 2, 6, 7.
// The home team's policy picks the DH rule for each game. Returns per-game results from a's side.
function simulateSeries({ a, b, aIsSeriesHome, rng, ref, games = 7, trace, key = 's' }) {
  // Each manager sets a rotation knowing the opponent and who hosts games 1, 2, 6, 7.
  const ctx = [a, b].map((x, k) => {
    const other = k === 0 ? b : a;
    const isSeriesHome = k === 0 ? aIsSeriesHome : !aIsSeriesHome;
    return { ...x, rotation: x.policy.rotation(x.team, ref, { opponent: other.team, opponentPolicy: other.policy, isSeriesHome, policy: x.policy }), scores: new Map() };
  });
  const results = [];
  const dhByStretch = {}; // the home team picks the DH rule for games 1-2/6-7 and for games 3-5
  for (let n = 1; n <= games; n++) {
    const seriesHomeHosts = ![3, 4, 5].includes(n);
    const homeIdx = seriesHomeHosts === aIsSeriesHome ? 0 : 1;
    const [home, away] = [ctx[homeIdx], ctx[1 - homeIdx]];
    const entry = (t) => ({
      team: t.team, policy: t.policy, starter: t.rotation[(n - 1) % 4], mods: fatigueMods(t.scores, t.team),
    });
    const stretch = [3, 4, 5].includes(n) ? 'middle' : 'ends';
    if (dhByStretch[stretch] === undefined) {
      dhByStretch[stretch] = !!home.policy.wantsDh(home.team, { rng, opponent: away.team, gameNumber: n, ref });
    }
    const useDh = dhByStretch[stretch];
    const r = simulateGame({ home: entry(home), away: entry(away), useDh, rng, ref, trace, key: `${key}g${n}` });
    updateFatigue(away.scores, away.team, r.sides[0], n);
    updateFatigue(home.scores, home.team, r.sides[1], n);
    const aHome = homeIdx === 0;
    results.push({
      aHome, useDh, innings: r.innings,
      aRuns: aHome ? r.homeScore : r.awayScore,
      bRuns: aHome ? r.awayScore : r.homeScore,
    });
  }
  return results;
}

module.exports = { makeRng, simulateGame, simulateSeries, RULES, makeSide, runHalfInning };
