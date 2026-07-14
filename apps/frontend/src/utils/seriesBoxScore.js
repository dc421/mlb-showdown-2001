// Cumulative series box score: folds every completed game's per-team box score into one combined
// batting + pitching line per player, for each of the two series teams.
//
// Each game's home/away side is mapped to the *series* team by user_id (the physical home team
// alternates game to game, so we can't group by the per-game 'home'/'away' key). Per-game box
// scores come from the same buildBoxScore() used everywhere else, so the aggregate stays consistent
// with what each game shows on its own. Pitcher W/L/S come from the same computePitchingDecisions()
// the live box score uses, tallied across games.

import { buildBoxScore, formatIp } from './boxScore';
import { computePitchingDecisions, normalizeKey } from './pitchingDecisions';

// ".310" / "1.021" — three decimals, leading zero dropped only for sub-1.000 values (OPS can exceed 1).
const fmt3 = (x) => (x == null ? '—' : x.toFixed(3).replace(/^0\./, '.'));
const rate = (num, den) => (den > 0 ? num / den : null);
const fmtEra = (er, outs) => (outs > 0 ? (er * 27 / outs).toFixed(2) : '—');

const addBatting = (acc, r) => {
  acc.ab += r.ab || 0; acc.r += r.r || 0; acc.h += r.h || 0;
  acc.doubles += r.doubles || 0; acc.triples += r.triples || 0; acc.hr += r.hr || 0;
  acc.rbi += r.rbi || 0; acc.bb += r.bb || 0; acc.so += r.so || 0;
  acc.sb += r.sb || 0; acc.cs += r.cs || 0;
};
const emptyBatting = (r) => ({ cardId: r.cardId, name: r.name, shortName: r.shortName,
  games: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, cs: 0 });

const addPitching = (acc, r) => {
  acc.outs += r.outs || 0; acc.bf += r.bf || 0; acc.h += r.h || 0;
  acc.r += r.r || 0; acc.er += r.er || 0; acc.bb += r.bb || 0; acc.so += r.so || 0;
};
const emptyPitching = (r) => ({ cardId: r.cardId, name: r.name, shortName: r.shortName,
  games: 0, gs: 0, w: 0, l: 0, s: 0, outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0 });

// Total bases from a batting line (singles + 2*2B + 3*3B + 4*HR, expressed via H).
const totalBases = (b) => b.h + b.doubles + 2 * b.triples + 3 * b.hr;

function finalizeSide(batMap, pitMap) {
  const batting = [...batMap.values()]
    .map((b) => {
      const obp = rate(b.h + b.bb, b.ab + b.bb);
      const slg = rate(totalBases(b), b.ab);
      const ops = (obp != null && slg != null) ? obp + slg : null;
      return { ...b, avg: fmt3(rate(b.h, b.ab)), obp: fmt3(obp), slg: fmt3(slg), ops: fmt3(ops) };
    })
    .sort((a, b) => b.ab - a.ab || b.h - a.h || (a.shortName || '').localeCompare(b.shortName || ''));

  const pitching = [...pitMap.values()]
    .map((p) => ({ ...p, ip: formatIp(p.outs), era: fmtEra(p.er, p.outs) }))
    // Starters (most outs / GS) first, relievers after.
    .sort((a, b) => b.gs - a.gs || b.outs - a.outs || (a.shortName || '').localeCompare(b.shortName || ''));

  const totals = { ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, cs: 0, tb: 0 };
  for (const b of batting) {
    totals.ab += b.ab; totals.r += b.r; totals.h += b.h; totals.doubles += b.doubles;
    totals.triples += b.triples; totals.hr += b.hr; totals.rbi += b.rbi; totals.bb += b.bb;
    totals.so += b.so; totals.sb += b.sb; totals.cs += b.cs; totals.tb += totalBases(b);
  }
  const tObp = rate(totals.h + totals.bb, totals.ab + totals.bb);
  const tSlg = rate(totals.tb, totals.ab);
  totals.avg = fmt3(rate(totals.h, totals.ab));
  totals.obp = fmt3(tObp);
  totals.slg = fmt3(tSlg);
  totals.ops = fmt3((tObp != null && tSlg != null) ? tObp + tSlg : null);

  const pTotals = { outs: 0, h: 0, er: 0, bb: 0, so: 0, w: 0, l: 0, s: 0 };
  for (const p of pitching) {
    pTotals.outs += p.outs; pTotals.h += p.h; pTotals.er += p.er; pTotals.bb += p.bb;
    pTotals.so += p.so; pTotals.w += p.w; pTotals.l += p.l; pTotals.s += p.s;
  }
  pTotals.ip = formatIp(pTotals.outs);
  pTotals.era = fmtEra(pTotals.er, pTotals.outs);

  return { batting, pitching, totals, pitchingTotals: pTotals };
}

// Build one lean game's per-side box score + pitching decisions, or null if the game has no plays
// yet. `game` is a lean entry from GET /api/series/:id/box-score-data
// ({ homeUserId, awayUserId, state:{atBatLog,pitcherStats}, startingPitchers }); `cards` is the
// shared card pool. As in aggregateLeaguePlayers, buildBoxScore only reads rosters to name cards and
// maps sides by user_id, so the shared pool as both sides works and the log decides home/away.
function boxFromGame(game, cards) {
  const state = game?.state;
  if (!state || !Array.isArray(state.atBatLog) || state.atBatLog.length === 0) return null;
  const rosters = { home: cards, away: cards };
  const teams = { home: { user_id: game.homeUserId }, away: { user_id: game.awayUserId } };
  const box = buildBoxScore(state, {}, rosters, teams);
  const decisions = computePitchingDecisions(state.atBatLog, teams, box);
  return { box, decisions };
}

// Fold one game side (home/away in that game's own frame) into the running batting/pitching maps.
function foldGameSide(box, decisions, gameSide, starterId, batMap, pitMap) {
  for (const r of box[gameSide].batting) {
    let acc = batMap.get(r.cardId);
    if (!acc) { acc = emptyBatting(r); batMap.set(r.cardId, acc); }
    addBatting(acc, r);
    acc.games += 1;
  }
  for (const r of box[gameSide].pitching) {
    let acc = pitMap.get(r.cardId);
    if (!acc) { acc = emptyPitching(r); pitMap.set(r.cardId, acc); }
    addPitching(acc, r);
    acc.games += 1;
    if (starterId != null && r.cardId === starterId) acc.gs += 1;
    const tags = decisions[normalizeKey(r.pitcherKey)] || [];
    if (tags.includes('W')) acc.w += 1;
    if (tags.includes('L')) acc.l += 1;
    if (tags.includes('S')) acc.s += 1;
  }
}

/**
 * Fold a list of lean completed-game entries into a two-team cumulative box score.
 *
 * @param {Array<object>} games     lean entries from GET /api/series/:id/box-score-data
 *                                   ({ homeUserId, awayUserId, state:{atBatLog,pitcherStats}, startingPitchers })
 * @param {Array<object>} cards     shared card pool (for naming), from the same payload
 * @param {string|number} homeUserId  series home team's user_id
 * @param {string|number} awayUserId  series away team's user_id
 * @returns {{ home: SideAgg, away: SideAgg, gamesCounted: number }}
 */
export function aggregateSeriesBoxScore(games, cards, homeUserId, awayUserId) {
  const bat = { home: new Map(), away: new Map() };
  const pit = { home: new Map(), away: new Map() };
  let gamesCounted = 0;

  for (const game of games || []) {
    const built = boxFromGame(game, cards);
    if (!built) continue;
    gamesCounted += 1;

    for (const gameSide of ['home', 'away']) {
      const uid = gameSide === 'home' ? game.homeUserId : game.awayUserId;
      const seriesSide = String(uid) === String(homeUserId) ? 'home'
        : String(uid) === String(awayUserId) ? 'away' : null;
      if (!seriesSide) continue;
      const starterId = game.startingPitchers?.[gameSide] ?? null;
      foldGameSide(built.box, built.decisions, gameSide, starterId, bat[seriesSide], pit[seriesSide]);
    }
  }

  return {
    home: finalizeSide(bat.home, pit.home),
    away: finalizeSide(bat.away, pit.away),
    gamesCounted,
  };
}

/**
 * Fold a list of lean completed-game entries into a single cumulative box score for one team.
 *
 * The team's physical home/away side changes game to game, so each game is matched to the team by
 * user_id and only that side is folded in. Use this for team-season pages, where every game the
 * team played (across many series) rolls up into one batting + pitching line per player.
 *
 * @param {Array<object>} games   lean entries (as in aggregateSeriesBoxScore), merged across series
 * @param {Array<object>} cards   shared card pool (for naming), merged across series
 * @param {string|number} userId  the team's user_id
 * @returns {{ side: SideAgg, gamesCounted: number }}
 */
export function aggregateTeamBoxScore(games, cards, userId) {
  const bat = new Map();
  const pit = new Map();
  let gamesCounted = 0;

  for (const game of games || []) {
    const built = boxFromGame(game, cards);
    if (!built) continue;
    const gameSide = String(game.homeUserId) === String(userId) ? 'home'
      : String(game.awayUserId) === String(userId) ? 'away' : null;
    if (!gameSide) continue;
    gamesCounted += 1;
    const starterId = game.startingPitchers?.[gameSide] ?? null;
    foldGameSide(built.box, built.decisions, gameSide, starterId, bat, pit);
  }

  return { side: finalizeSide(bat, pit), gamesCounted };
}
