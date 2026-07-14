// Builds box-score tables (batting + pitching, with advantage splits) by folding the
// per-plate-appearance `atBatLog` that the game engine accumulates in `state_data`. The fold is
// pure and framework-free so it can be unit-tested and reused on other pages later.
//
// Batting lines come entirely from `atBatLog` (so trimming the last, not-yet-revealed entry keeps
// the box score spoiler-safe). Pitching IP and R/ER come from the authoritative live `pitcherStats`
// (which already accounts for inherited runners and base-running outs); H/BB/SO and the advantage
// split come from `atBatLog`.
//
// Spoiler-safety extends to pitching: `pitcherStats` is a live aggregate with no per-PA breakdown,
// so when the last PA is hidden (opts.hideLastPA) we subtract that entry's recorded per-pitcher
// contribution (`atBatLog[].pitcherDeltas`) from the aggregate. Otherwise IP/R/BF would jump the
// instant a swing resolved, before the reveal animation played.

import { formatNameShort } from './playerUtils';

const REPLACEMENT_NAMES = { '-1': 'Replacement Hitter', '-2': 'Replacement Pitcher' };

function buildCardMap(lineups, rosters) {
  const map = new Map();
  const add = (card) => {
    if (card && card.card_id != null && !map.has(card.card_id)) map.set(card.card_id, card);
  };
  for (const side of ['home', 'away']) {
    (rosters?.[side] || []).forEach(add);
    const lu = lineups?.[side];
    if (lu) {
      (lu.battingOrder || []).forEach((spot) => add(spot?.player));
      add(lu.startingPitcher);
    }
  }
  return map;
}

function cardFor(cardId, cardMap) {
  if (cardId == null) return null;
  return cardMap.get(cardId) || null;
}

function fullNameFor(cardId, cardMap) {
  if (cardId == null) return 'Unknown';
  if (REPLACEMENT_NAMES[String(cardId)]) return REPLACEMENT_NAMES[String(cardId)];
  const c = cardFor(cardId, cardMap);
  return c ? (c.displayName || c.name || `#${cardId}`) : `#${cardId}`;
}

function shortNameFor(cardId, cardMap) {
  if (REPLACEMENT_NAMES[String(cardId)]) return REPLACEMENT_NAMES[String(cardId)];
  const c = cardFor(cardId, cardMap);
  const name = c ? (c.displayName || c.name) : null;
  return name ? formatNameShort(name) : `#${cardId}`;
}

// ".333" / "—" formatting for batting average.
export function formatAvg(h, ab) {
  if (!ab) return '—';
  return (h / ab).toFixed(3).replace(/^0(?=\.)/, '');
}

// Outs → "5.2" innings-pitched display.
export function formatIp(outs) {
  const o = Math.max(0, outs || 0);
  return `${Math.floor(o / 3)}.${o % 3}`;
}

// Normalize a pitcher key to { ownerId, cardId }. Keys are "ownerId_cardId", but legacy data
// contains malformed composite-of-composite keys like "4_4_614" (a known engine bug where a
// run/out was charged through an already-composite key). The owner is always the first segment
// and the real card id the last, so both "4_614" and "4_4_614" resolve to owner 4 / card 614.
function parsePitcherKey(key) {
  const parts = String(key).split('_');
  if (parts.length < 2) return { ownerId: null, cardId: null };
  return { ownerId: parts[0], cardId: Number(parts[parts.length - 1]) };
}

// Normalized "ownerId_cardId" string for a (possibly malformed) raw key, or null if unparseable.
function normalizePitcherKey(key) {
  const { ownerId, cardId } = parsePitcherKey(key);
  if (ownerId == null || cardId == null || Number.isNaN(cardId)) return null;
  return `${ownerId}_${cardId}`;
}

const emptyBatter = () => ({ ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  sb: 0, cs: 0, adv: { ab: 0, h: 0 }, dis: { ab: 0, h: 0 } });
const emptyPitcher = () => ({ outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0,
  adv: { bf: 0, h: 0 }, dis: { bf: 0, h: 0 } });

/**
 * @param {object} gameState  state_data (needs `atBatLog` and `pitcherStats`)
 * @param {object} lineups    { home, away } each { battingOrder:[{player}], startingPitcher }
 * @param {object} rosters    { home:[card], away:[card] }
 * @param {object} teams      { home:{user_id,...}, away:{user_id,...} }
 * @param {object} [opts]      { hideLastPA } — when the viewer is still hiding the latest outcome,
 *                             drop the most recent plate appearance AND back its per-pitcher
 *                             contribution out of the live pitcherStats aggregate, so the pitching
 *                             IP/R/ER/BF stay spoiler-safe (they don't jump before the swing reveal).
 * @returns {{ away: SideBox, home: SideBox }}
 */
export function buildBoxScore(gameState, lineups, rosters, teams, opts = {}) {
  let log = Array.isArray(gameState?.atBatLog) ? gameState.atBatLog : [];
  let hiddenEntry = null;
  if (opts.hideLastPA && log.length > 0) {
    hiddenEntry = log[log.length - 1];
    log = log.slice(0, -1);
  }
  const pitcherStats = gameState?.pitcherStats || {};
  const cardMap = buildCardMap(lineups, rosters);
  const awayUserId = teams?.away?.user_id;
  const ownerTeam = (ownerId) => (String(ownerId) === String(awayUserId) ? 'away' : 'home');

  // Runs scored, counted per runner card_id across the whole log.
  const runsByRunner = new Map();
  for (const e of log) {
    for (const id of e.scoredRunnerIds || []) {
      runsByRunner.set(id, (runsByRunner.get(id) || 0) + 1);
    }
  }

  // Authoritative IP/R/BF per pitcher, merging any legacy malformed keys into the real pitcher.
  const liveByPitcher = new Map(); // normalized "ownerId_cardId" -> { outs, runs, bf }
  // Fallback index by bare card id. Older games (roughly the earliest ones) store pitcherStats
  // keyed by a plain card_id ("558") instead of "ownerId_cardId" ("4_558"); those keys carry no
  // owner, so they don't normalize and would drop out of liveByPitcher — leaving every pitcher at
  // 0.0 IP / 0 R. Indexed by card id, they still join to the atBatLog-derived row (which does carry
  // the composite key) whenever the composite lookup misses.
  const liveByCardId = new Map(); // cardId(Number) -> { outs, runs, bf }
  for (const rawKey of Object.keys(pitcherStats)) {
    const v = pitcherStats[rawKey] || {};
    const outs = v.outs_recorded || 0, runs = v.runs || 0, bf = v.batters_faced || 0;
    const norm = normalizePitcherKey(rawKey);
    if (norm) {
      const cur = liveByPitcher.get(norm) || { outs: 0, runs: 0, bf: 0 };
      cur.outs += outs; cur.runs += runs; cur.bf += bf;
      liveByPitcher.set(norm, cur);
    }
    const cardId = String(rawKey).includes('_') ? parsePitcherKey(rawKey).cardId : Number(rawKey);
    if (cardId != null && !Number.isNaN(cardId)) {
      const c = liveByCardId.get(cardId) || { outs: 0, runs: 0, bf: 0 };
      c.outs += outs; c.runs += runs; c.bf += bf;
      liveByCardId.set(cardId, c);
    }
  }

  // Spoiler-safety: if the last PA is hidden, back its per-pitcher contribution out of the live
  // aggregate so IP/R/ER/BF match the (trimmed) atBatLog-derived columns until the swing reveals.
  // Deltas are keyed by raw pitcher key (owner_card or an inherited runner's pitcherOfRecordId),
  // so normalize before subtracting. Older entries without pitcherDeltas simply skip this (the last
  // PA of an in-flight game at deploy time), self-healing the moment the outcome is revealed.
  for (const [rawKey, d] of Object.entries(hiddenEntry?.pitcherDeltas || {})) {
    const norm = normalizePitcherKey(rawKey);
    const cur = norm && liveByPitcher.get(norm);
    if (cur) {
      cur.outs = Math.max(0, cur.outs - (d.outs || 0));
      cur.runs = Math.max(0, cur.runs - (d.runs || 0));
      cur.bf = Math.max(0, cur.bf - (d.bf || 0));
    }
    const cardId = norm ? parsePitcherKey(norm).cardId : Number(rawKey);
    const curC = (cardId != null && !Number.isNaN(cardId)) && liveByCardId.get(cardId);
    if (curC) {
      curC.outs = Math.max(0, curC.outs - (d.outs || 0));
      curC.runs = Math.max(0, curC.runs - (d.runs || 0));
      curC.bf = Math.max(0, curC.bf - (d.bf || 0));
    }
  }

  // Accumulators keyed by card_id (batting) / pitcher key (pitching), preserving first-seen order.
  const batting = { away: new Map(), home: new Map() };
  const pitching = { away: new Map(), home: new Map() };

  // atBatLog-derived IP/R/BF per normalized composite key, plus which composite keys each card id
  // appears under. Used ONLY to disambiguate legacy bare-key pitcherStats shared by both teams
  // (see the split below); composite-key games never consult these.
  const logByKey = new Map();      // "ownerId_cardId" -> { outs, runs, bf }
  const keysByCardId = new Map();  // cardId(Number) -> Set("ownerId_cardId")

  for (const e of log) {
    // --- Batting (offense side) ---
    if (e.batterId != null) {
      const side = e.batterTeam === 'home' ? 'home' : 'away';
      const map = batting[side];
      let row = map.get(e.batterId);
      if (!row) { row = emptyBatter(); map.set(e.batterId, row); }
      row.ab += e.ab || 0;
      row.h += e.h || 0;
      row.doubles += e.double || 0;
      row.triples += e.triple || 0;
      row.hr += e.hr || 0;
      row.rbi += e.rbi || 0;
      row.bb += e.bb || 0;
      row.so += e.so || 0;
      if (e.advantage === 'batter') { row.adv.ab += e.ab || 0; row.adv.h += e.h || 0; }
      else if (e.advantage === 'pitcher') { row.dis.ab += e.ab || 0; row.dis.h += e.h || 0; }
    }

    // --- Pitching (defense side) ---
    if (e.pitcherKey) {
      const { ownerId } = parsePitcherKey(e.pitcherKey);
      const side = ownerTeam(ownerId);
      const map = pitching[side];
      let row = map.get(e.pitcherKey);
      if (!row) { row = emptyPitcher(); map.set(e.pitcherKey, row); }
      row.bf += 1;
      row.h += e.h || 0;
      row.bb += e.bb || 0;
      row.so += e.so || 0;
      if (e.advantage === 'pitcher') { row.adv.bf += 1; row.adv.h += e.h || 0; }
      else if (e.advantage === 'batter') { row.dis.bf += 1; row.dis.h += e.h || 0; }

      // Reconstruct this PA's outs/runs for the legacy shared-card split. A batter reaching base
      // (hit or walk) records no out; every other PA is one out, a double play two. Runs are the
      // runners that scored while this pitcher was on the mound.
      const norm = normalizePitcherKey(e.pitcherKey);
      if (norm) {
        const reached = (e.h || 0) > 0 || (e.bb || 0) > 0;
        const outs = reached ? 0 : (e.outcome === 'DP' ? 2 : 1);
        const lg = logByKey.get(norm) || { outs: 0, runs: 0, bf: 0 };
        lg.outs += outs; lg.runs += (e.scoredRunnerIds || []).length; lg.bf += 1;
        logByKey.set(norm, lg);
        const cid = parsePitcherKey(norm).cardId;
        if (cid != null && !Number.isNaN(cid)) {
          let set = keysByCardId.get(cid);
          if (!set) { set = new Set(); keysByCardId.set(cid, set); }
          set.add(norm);
        }
      }
    }
  }

  // Legacy bare-key disambiguation. When pitcherStats is keyed by a bare card_id that BOTH teams
  // used (older games), liveByCardId holds the two pitchers' merged totals — applying it to each
  // would show (and double-count) the same line on both. Split it back apart with the atBatLog,
  // which does carry the composite key per PA, then reconcile the split to the authoritative merged
  // total: any residual (e.g. a base-running out the atBatLog can't see) goes to the busier stint.
  // Only shared cards with no composite pitcherStats entry take this path.
  const splitByKey = new Map(); // "ownerId_cardId" -> { outs, runs, bf }
  for (const [cardId, keys] of keysByCardId) {
    if (keys.size < 2) continue;                             // not shared: liveByCardId is already right
    const merged = liveByCardId.get(cardId);
    if (!merged) continue;
    const keyArr = [...keys];
    if (keyArr.some((k) => liveByPitcher.has(k))) continue;  // authoritative composite stats exist
    const parts = keyArr.map((k) => ({ key: k, ...(logByKey.get(k) || { outs: 0, runs: 0, bf: 0 }) }));
    for (const stat of ['outs', 'runs', 'bf']) {
      const sum = parts.reduce((n, p) => n + p[stat], 0);
      const residual = (merged[stat] || 0) - sum;
      if (residual) {
        const top = parts.reduce((a, b) => (b[stat] >= a[stat] ? b : a));
        top[stat] = Math.max(0, top[stat] + residual);
      }
    }
    for (const p of parts) splitByKey.set(p.key, { outs: p.outs, runs: p.runs, bf: p.bf });
  }

  // Stolen bases / caught stealing: the engine records one stealLog entry per deliberate steal
  // attempt, attributed to the runner's card_id and offensive side. Folded into the batting rows
  // (creating a row if a pinch-runner stole without ever batting).
  for (const s of Array.isArray(gameState?.stealLog) ? gameState.stealLog : []) {
    if (s == null || s.runnerId == null) continue;
    const side = s.side === 'home' ? 'home' : 'away';
    let row = batting[side].get(s.runnerId);
    if (!row) { row = emptyBatter(); batting[side].set(s.runnerId, row); }
    if (s.success) row.sb += 1; else row.cs += 1;
  }

  const buildSide = (side) => {
    const battingRows = [];
    const totals = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 };
    for (const [cardId, b] of batting[side]) {
      const r = runsByRunner.get(cardId) || 0;
      totals.ab += b.ab; totals.r += r; totals.h += b.h; totals.rbi += b.rbi; totals.bb += b.bb; totals.so += b.so;
      battingRows.push({
        cardId,
        name: fullNameFor(cardId, cardMap),
        shortName: shortNameFor(cardId, cardMap),
        ab: b.ab, r, h: b.h, doubles: b.doubles, triples: b.triples, hr: b.hr, rbi: b.rbi,
        bb: b.bb, so: b.so, sb: b.sb, cs: b.cs, avg: formatAvg(b.h, b.ab),
        adv: { ...b.adv }, dis: { ...b.dis },
      });
    }

    // Pitching IP/R/ER/BF come from the authoritative (merged) pitcherStats — accurate for every
    // game, including historical ones tracked all along for fatigue — with H/BB/SO and the
    // advantage split overlaid from atBatLog when present. atBatLog pitchers come first (in
    // appearance order, so the starter leads); pitcherStats-only pitchers (e.g. historical games
    // with no per-PA log) are appended. Overlay keys are already normalized "ownerId_cardId".
    const overlay = pitching[side];
    const pitchingKeys = [...overlay.keys()];
    const seen = new Set(pitchingKeys);
    for (const [normKey, live] of liveByPitcher) {
      if (seen.has(normKey) || ownerTeam(parsePitcherKey(normKey).ownerId) !== side) continue;
      const appeared = live.outs > 0 || live.runs > 0 || live.bf > 0;
      if (appeared) { pitchingKeys.push(normKey); seen.add(normKey); }
    }

    const pitchingRows = pitchingKeys.map((key) => {
      const { cardId } = parsePitcherKey(key);
      const norm = normalizePitcherKey(key) || key;
      const p = overlay.get(key) || emptyPitcher();
      const live = liveByPitcher.get(norm) || splitByKey.get(norm)
        || liveByCardId.get(cardId) || { outs: 0, runs: 0, bf: 0 };
      return {
        cardId,
        pitcherKey: key,
        name: fullNameFor(cardId, cardMap),
        shortName: shortNameFor(cardId, cardMap),
        outs: live.outs,
        ip: formatIp(live.outs),
        bf: live.bf || p.bf || 0,
        h: p.h, r: live.runs, er: live.runs, bb: p.bb, so: p.so,
        adv: { ...p.adv }, dis: { ...p.dis },
      };
    });

    return { batting: battingRows, pitching: pitchingRows, totals };
  };

  return { away: buildSide('away'), home: buildSide('home') };
}
