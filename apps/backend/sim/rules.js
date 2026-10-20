// Pure rule helpers shared by the engine (to enforce legality) and by policies (to reason about
// options). Everything here mirrors the live game in server.js / gameLogic.js — no judgment calls.

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// Can this card occupy this lineup position? Mirrors validateLineup: anyone who isn't a pitcher may
// play 1B (out of position), corner outfielders qualify via LFRF, DH takes any hitter.
function eligible(card, pos) {
  if (card.isPitcher) return pos === 'P';
  if (pos === 'DH' || pos === '1B' || pos === 'PH') return true;
  if (pos === 'LF' || pos === 'RF') return card.fld[pos] !== undefined || card.fld.LFRF !== undefined;
  return card.fld[pos] !== undefined;
}

// Team defense totals. Mirrors getInfieldDefense / getOutfieldDefense / getCatcherArm.
function defenseRatings(lineup) {
  let IF = 0; let OF = 0; let C = 0;
  for (const { card, pos } of lineup) {
    const f = card.fld;
    if (pos === '1B') {
      if (f['1B'] !== undefined) IF += f['1B'];
      else {
        const keys = Object.keys(f);
        IF -= keys.length === 0 || (keys.length === 1 && keys[0] === 'DH') ? 2 : 1;
      }
    } else if (pos === '2B' || pos === 'SS' || pos === '3B') IF += f[pos] || 0;
    else if (pos === 'CF') OF += f.CF || 0;
    else if (pos === 'LF' || pos === 'RF') OF += f[pos] !== undefined ? f[pos] : (f.LFRF || 0);
    else if (pos === 'C') C = f.C || 0;
  }
  return { IF, OF, C };
}

function getStats(side, card) {
  let st = side.pstats.get(card.id);
  if (!st) {
    st = { innings: new Set(), runs: 0, bf: 0, outs: 0, tired: false, mod: 0 };
    side.pstats.set(card.id, st);
  }
  return st;
}

// Mirrors getEffectiveControl: every inning pitched in beyond (IP + series modifier − runs/3) costs
// a point of control. `inning` is projected as pitched in. Replacement pitchers are exempt.
function effectiveControl(side, pitcher, inning) {
  if (pitcher.id < 0) return pitcher.ctrl;
  const st = getStats(side, pitcher);
  const count = st.innings.size + (st.innings.has(inning) ? 0 : 1);
  const threshold = pitcher.ip + st.mod - Math.floor(st.runs / 3);
  return pitcher.ctrl - Math.max(0, count - threshold);
}

// Mirrors validatePitcherSubstitution: a starter can't leave before recording 12 outs unless he is
// tired now (or, when being hit/run for, will be tired in his next inning on the mound).
function canRemovePitcher(g, side, isOffense) {
  const p = side.pitcher;
  if (!p || !side.pitcherIsStarter) return true;
  if (getStats(side, p).outs >= 12) return true;
  if (effectiveControl(side, p, g.inning) < p.ctrl) return true;
  if (isOffense) {
    const nextDefInning = g.top ? g.inning : g.inning + 1;
    if (effectiveControl(side, p, nextDefInning) < p.ctrl) return true;
  }
  return false;
}

// Can a bench hitter take over this lineup spot right now? Covers position eligibility and the
// backup rule (a BENCH-assigned player can't be in the field before the 7th).
function canTakeSpot(g, side, card, spotIdx) {
  if (card.isPitcher) return false;
  if (spotIdx === side.pitcherSpot) return true; // hitting for the pitcher: a reliever takes the spot
  const pos = side.lineup[spotIdx].pos;
  if (!eligible(card, pos)) return false;
  if (pos !== 'DH' && side.team.restricted.has(card.id)) {
    const nextFieldInning = g.top ? g.inning : g.inning + 1; // side is batting
    if (nextFieldInning < 7) return false;
  }
  return true;
}

// P(pitcher wins the advantage): roll + control > on-base, ties to the batter.
const pitcherAdvantageProb = (ob, ctrl) => (20 - clamp(ob - ctrl, 0, 20)) / 20;

// Expected linear-weight runs for one plate appearance of this hitter against this pitcher at the
// given effective control. Policy-side yardstick only (lower is better for the pitcher).
function matchupLW(hitter, pitcher, ctrl) {
  if (hitter.isPitcher) return pitcher.chartLW; // a batting pitcher never gets the advantage
  const pAdv = pitcherAdvantageProb(hitter.ob, ctrl);
  return pAdv * pitcher.chartLW + (1 - pAdv) * hitter.chartLW;
}

module.exports = {
  clamp, eligible, defenseRatings, getStats, effectiveControl, canRemovePitcher, canTakeSpot,
  pitcherAdvantageProb, matchupLW,
};
