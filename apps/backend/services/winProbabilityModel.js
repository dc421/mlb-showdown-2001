// Win Probability model — pure math, no DB access.
//
// The model is calibrated to *this league's* run environment (MLB Showdown 2001 scores higher than
// real MLB), so it uses empirical base/out run-scoring distributions taken from completed games rather
// than a generic published WP table. From those distributions it precomputes a win-probability grid by
// Monte-Carlo simulating the rest of a game from every (half-inning, outs, base state, score margin)
// cell. At runtime a game's WP curve is a series of O(1) lookups into that grid.
//
// Shared by scripts/build-wp-table.js (which builds + serializes the grid) and
// services/winProbability.js (which loads the grid and turns a game's states into a curve + WPA plays).

const OUTS = 3; // 0,1,2
const BASE = 8; // bitmask: 1=first, 2=second, 4=third

const outsClamp = (o) => (o > 2 ? 2 : o < 0 ? 0 : o);

function baseCode(bases) {
  if (!bases) return 0;
  return (bases.first ? 1 : 0) | (bases.second ? 2 : 0) | (bases.third ? 4 : 0);
}

// Build a name -> card_id map from every card that appears on base or at the plate, so a steal (whose
// lastStealResult only names the runner) can be attributed to a card_id.
function collectNameCardMap(rawStates) {
  const map = new Map();
  const addCard = (c) => {
    if (!c || c.card_id == null) return;
    for (const nm of [c.display_name, c.displayName, c.name]) if (nm && !map.has(nm)) map.set(nm, c.card_id);
  };
  for (const rs of rawStates) {
    const s = rs && rs.state_data ? rs.state_data : rs;
    if (!s) continue;
    if (s.bases) { addCard(s.bases.first); addCard(s.bases.second); addCard(s.bases.third); }
    if (s.currentAtBat) addCard(s.currentAtBat.batter);
    if (s.lastCompletedAtBat) addCard(s.lastCompletedAtBat.batter);
  }
  return map;
}

// Identify the runner on a baserunning transition (steal / caught stealing) by diffing the bases: the
// card that left a base (caught, or advanced to a different base) is the runner. Returns its card.
function findBaserunner(prevBases, curBases) {
  if (!prevBases) return null;
  const curAt = {};
  for (const k of ['first', 'second', 'third']) {
    const c = curBases && curBases[k];
    if (c && c.card_id != null) curAt[c.card_id] = k;
  }
  for (const k of ['first', 'second', 'third']) {
    const c = prevBases[k];
    if (c && c.card_id != null && curAt[c.card_id] !== k) return c; // removed (CS) or moved (SB)
  }
  return null;
}

// Reduce a game's ordered raw turn-states into ordered *distinct* situations. Consecutive turns share
// the same base/out/score until a play resolves, so we collapse on that key, keeping the FIRST state.
//
// Each situation carries the play that *produced* it (caused the transition into it). At the first
// state of a new base/out/score the resolving swing lives in `currentAtBat` (its swingRollResult is
// set and the score/outs/bases update on the same turn). `lastCompletedAtBat` lags a turn behind, so
// we read `currentAtBat`. When there's no swing result the transition is baserunning (a steal / caught
// stealing / the opening state); we attribute those to the runner via lastStealResult when possible.
//
// Finally the inning-ending "3 outs" state and the following new-inning leadoff are the same moment,
// so they're merged into one situation: the leadoff's state (which has the correct post-inning win
// probability) carrying the third-out play's attribution and turn.
function extractSituations(rawStates) {
  const nameToCard = collectNameCardMap(rawStates);
  const raw = [];
  let prevKey = null;
  let prevBases = null;
  let prevOuts = 0;
  for (const rs of rawStates) {
    const s = rs && rs.state_data ? rs.state_data : rs;
    if (!s || s.inning == null || s.isTopInning == null) continue;
    const inning = s.inning;
    const isTop = !!s.isTopInning;
    const outs = s.outs == null ? 0 : s.outs;
    const home = s.homeScore == null ? 0 : s.homeScore;
    const away = s.awayScore == null ? 0 : s.awayScore;
    const base = baseCode(s.bases);
    const key = `${inning}|${isTop}|${outs}|${home}|${away}|${base}`;
    if (key === prevKey) continue;
    prevKey = key;
    const turn = rs && rs.turn_number != null ? rs.turn_number : null;
    const ca = s.currentAtBat || null;
    const outcome = (ca && ca.swingRollResult && ca.swingRollResult.outcome) || null;
    let play;
    let paSig;
    if (outcome) {
      const b = ca.batter;
      const p = ca.pitcher;
      const batterId = b && b.card_id != null ? b.card_id : null;
      play = {
        batter: (b && (b.display_name || b.name)) || null,
        batterId,
        batterImage: (b && b.image_url) || null,
        pitcher: (p && (p.display_name || p.name)) || null,
        pitcherId: (p && p.card_id) != null ? p.card_id : null,
        outcome,
      };
      // A single PA can cross several micro-states (a hit that also advances a runner); tag them so
      // the caller can merge them into one play.
      paSig = `${batterId}|${outcome}|${inning}|${isTop}`;
    } else {
      // Baserunning (steal / caught stealing) or the opening state: identify the runner from the base
      // diff, falling back to lastStealResult's name. A caught stealing shows up as an extra out.
      const runner = findBaserunner(prevBases, s.bases);
      const lsr = s.lastStealResult;
      const runnerName = (runner && (runner.display_name || runner.name)) || (lsr && lsr.runner) || null;
      const runnerId = (runner && runner.card_id != null) ? runner.card_id
        : (runnerName && nameToCard.has(runnerName)) ? nameToCard.get(runnerName) : null;
      const caught = outs > prevOuts;
      play = runnerName
        ? { baserunning: true, batter: runnerName, batterId: runnerId, batterImage: (runner && runner.image_url) || null, pitcher: null, pitcherId: null, outcome: caught ? 'CS' : 'SB' }
        : { baserunning: true };
      paSig = null;
    }
    raw.push({ inning, isTop, outs, home, away, base, turn, play, paSig });
    prevBases = s.bases || null;
    prevOuts = outs;
  }

  // Merge each inning-ending 3-out state with the following new-inning leadoff (same score, bases
  // empty, half-inning flipped): keep the leadoff's state (correct post-inning WP) + the out's play.
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    const nxt = raw[i + 1];
    if (
      cur.outs >= 3 && nxt && nxt.outs === 0 && nxt.base === 0 &&
      nxt.home === cur.home && nxt.away === cur.away &&
      (nxt.inning !== cur.inning || nxt.isTop !== cur.isTop)
    ) {
      out.push({
        inning: nxt.inning, isTop: nxt.isTop, outs: 0, base: 0, home: nxt.home, away: nxt.away,
        turn: cur.turn, play: cur.play, paSig: cur.paSig,
      });
      i++; // consume the leadoff
    } else {
      out.push(cur);
    }
  }
  return out;
}

// Build dist[outs][base] = array of "runs the batting team scored from this situation to the end of the
// half-inning". Game-ending half-innings are excluded by default because a walk-off truncates scoring
// (the inning stops the instant the winning run scores), which would bias the distributions low.
function buildDistributions(gamesSituations, { excludeGameEndingHalf = true } = {}) {
  const dist = Array.from({ length: OUTS }, () => Array.from({ length: BASE }, () => []));
  for (const sits of gamesSituations) {
    let i = 0;
    while (i < sits.length) {
      const { inning, isTop } = sits[i];
      let j = i;
      while (j < sits.length && sits[j].inning === inning && sits[j].isTop === isTop) j++;
      const half = sits.slice(i, j);
      const bk = isTop ? 'away' : 'home';
      const isGameEnd = j >= sits.length;
      const endScore = isGameEnd ? half[half.length - 1][bk] : sits[j][bk];
      if (!(isGameEnd && excludeGameEndingHalf)) {
        for (const st of half) {
          const runsToEnd = endScore - st[bk];
          if (runsToEnd >= 0) dist[outsClamp(st.outs)][st.base].push(runsToEnd);
        }
      }
      i = j;
    }
  }
  return dist;
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Simulate the remainder of a game once from a situation; returns 1 (home win), 0 (away win), or 0.5
// (tie hit the inning cap). Only the score *margin* matters, so callers pass home/away = the margin.
function simOnce(dist, sit, maxInning) {
  let { inning, isTop, outs, base, home, away } = sit;
  const fresh = dist[0][0];
  const sample = (o, b) => {
    if (o > 2) return 0; // 3-out snapshot: half already over
    const cell = dist[o] && dist[o][b];
    return pick(cell && cell.length ? cell : fresh);
  };
  while (true) {
    if (inning > maxInning) return home > away ? 1 : away > home ? 0 : 0.5;
    if (isTop) {
      away += sample(outsClamp(outs), base);
      isTop = false; outs = 0; base = 0;
      if (inning >= 9 && home > away) return 1; // home leads after top of 9th+, no bottom needed
    } else {
      const r = sample(outsClamp(outs), base);
      if (inning >= 9) {
        if (home + r > away) return 1; // walk-off
        home += r;
        if (home !== away) return home > away ? 1 : 0; // decided after a completed extra frame
      } else {
        home += r;
      }
      inning += 1; isTop = true; outs = 0; base = 0;
    }
  }
}

function winProbSim(dist, sit, sims, maxInning) {
  let w = 0;
  for (let k = 0; k < sims; k++) w += simOnce(dist, { ...sit }, maxInning);
  return w / sims;
}

// Precompute grid[halfIndex][outs][base][diffIdx] = P(home wins). halfIndex = (inning-1)*2 + (isTop?0:1).
// diffIdx = (home-away) + diffCap. Innings beyond maxInning reuse the maxInning "last licks" rows.
function buildGrid(dist, { maxInning = 13, diffCap = 15, sims = 5000 } = {}) {
  const halves = maxInning * 2;
  const grid = [];
  for (let hi = 0; hi < halves; hi++) {
    const inning = Math.floor(hi / 2) + 1;
    const isTop = hi % 2 === 0;
    const byOuts = [];
    for (let o = 0; o < OUTS; o++) {
      const byBase = [];
      for (let b = 0; b < BASE; b++) {
        const row = new Array(2 * diffCap + 1);
        for (let d = -diffCap; d <= diffCap; d++) {
          const sit = { inning, isTop, outs: o, base: b, home: Math.max(d, 0), away: Math.max(-d, 0) };
          row[d + diffCap] = Math.round(winProbSim(dist, sit, sims, maxInning) * 1e4) / 1e4;
        }
        byBase.push(row);
      }
      byOuts.push(byBase);
    }
    grid.push(byOuts);
  }
  return grid;
}

// O(1) grid lookup for a situation.
function lookupWP(table, sit) {
  const { grid, maxInning, diffCap } = table;
  if (sit.outs >= 3) {
    // Inning over: evaluate the leadoff of the next half-inning (same score, bases empty).
    return lookupWP(table, {
      inning: sit.isTop ? sit.inning : sit.inning + 1,
      isTop: !sit.isTop, outs: 0, base: 0, home: sit.home, away: sit.away,
    });
  }
  const inning = Math.min(sit.inning, maxInning);
  const hi = (inning - 1) * 2 + (sit.isTop ? 0 : 1);
  const o = outsClamp(sit.outs);
  const b = sit.base & 7;
  const diff = Math.max(-diffCap, Math.min(diffCap, sit.home - sit.away));
  const row = grid[hi] && grid[hi][o] && grid[hi][o][b];
  if (!row) return sit.home > sit.away ? 1 : sit.home < sit.away ? 0 : 0.5;
  return row[diff + diffCap];
}

module.exports = {
  OUTS, BASE, outsClamp, baseCode,
  extractSituations, buildDistributions, buildGrid, lookupWP, winProbSim,
};
