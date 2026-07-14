// League leaders: fold a whole season's completed games into league-wide per-player totals, then
// rank each stat category. Games are rebuilt with the same buildBoxScore()/computePitchingDecisions()
// used on every game, series, and team-season page, so a player's leader line always matches what
// their box scores add up to. Input is the lean payload from GET /api/league/leaders-data
// ({ games:[{ homeUserId, awayUserId, state:{atBatLog,pitcherStats} }], cards, teams }).

import { buildBoxScore } from './boxScore';
import { computePitchingDecisions, normalizeKey } from './pitchingDecisions';

// Rate-stat qualifiers, scaled to the season's length (seasonGames ≈ games the ironman played).
// Standard leaderboard behavior: a hitter needs ~2.7 PA per team game, a pitcher ~0.5 IP per game.
const PA_PER_GAME = 2.7;
const OUTS_PER_GAME = 1.5;   // 0.5 IP/game
const MIN_PA_FLOOR = 15;
const MIN_OUTS_FLOOR = 21;   // 7.0 IP

const tb = (b) => b.h + b.doubles + 2 * b.triples + 3 * b.hr; // total bases
const rate = (num, den) => (den > 0 ? num / den : null);
const fmt3 = (x) => (x == null ? '—' : x.toFixed(3).replace(/^0\./, '.'));
const fmt2 = (x) => (x == null ? '—' : x.toFixed(2));

/**
 * Fold every game into league-wide batting + pitching lines, keyed by card_id.
 * @returns {{ batters: Array, pitchers: Array, seasonGames: number }}
 */
export function aggregateLeaguePlayers(payload) {
  const batMap = new Map();
  const pitMap = new Map();

  const emptyBat = (r, teamUserId) => ({ cardId: r.cardId, name: r.name, teamUserId,
    games: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, cs: 0 });
  const emptyPit = (r, teamUserId) => ({ cardId: r.cardId, name: r.name, teamUserId,
    games: 0, w: 0, l: 0, s: 0, outs: 0, h: 0, er: 0, bb: 0, so: 0 });

  const cards = payload?.cards || [];
  for (const game of payload?.games || []) {
    const state = game.state;
    if (!state || !Array.isArray(state.atBatLog) || state.atBatLog.length === 0) continue;
    // buildBoxScore only reads rosters/lineups to name cards, and maps sides by user_id — so the
    // shared pool as both sides works, and the log itself decides who's home/away.
    const rosters = { home: cards, away: cards };
    const teams = { home: { user_id: game.homeUserId }, away: { user_id: game.awayUserId } };
    const box = buildBoxScore(state, {}, rosters, teams);
    const decisions = computePitchingDecisions(state.atBatLog, teams, box);

    for (const side of ['home', 'away']) {
      const teamUserId = side === 'home' ? game.homeUserId : game.awayUserId;

      for (const r of box[side].batting) {
        if (r.cardId < 0) continue; // skip the -1/-2 replacement cards — not real players
        let acc = batMap.get(r.cardId);
        if (!acc) { acc = emptyBat(r, teamUserId); batMap.set(r.cardId, acc); }
        acc.games += 1;
        acc.ab += r.ab || 0; acc.h += r.h || 0; acc.doubles += r.doubles || 0; acc.triples += r.triples || 0;
        acc.hr += r.hr || 0; acc.rbi += r.rbi || 0; acc.bb += r.bb || 0; acc.so += r.so || 0;
        acc.sb += r.sb || 0; acc.cs += r.cs || 0;
      }

      for (const r of box[side].pitching) {
        if (r.cardId < 0) continue; // skip the -1/-2 replacement cards — not real players
        let acc = pitMap.get(r.cardId);
        if (!acc) { acc = emptyPit(r, teamUserId); pitMap.set(r.cardId, acc); }
        acc.games += 1;
        acc.outs += r.outs || 0; acc.h += r.h || 0; acc.er += r.er || 0; acc.bb += r.bb || 0; acc.so += r.so || 0;
        const tags = decisions[normalizeKey(r.pitcherKey)] || [];
        if (tags.includes('W')) acc.w += 1;
        if (tags.includes('L')) acc.l += 1;
        if (tags.includes('S')) acc.s += 1;
      }
    }
  }

  const batters = [...batMap.values()];
  const pitchers = [...pitMap.values()];
  // Season length proxy: the most games any single player appeared in (an everyday regular ≈ team's
  // schedule). Used to scale the rate-stat qualifiers.
  const seasonGames = Math.max(0, ...batters.map((b) => b.games), ...pitchers.map((p) => p.games));
  return { batters, pitchers, seasonGames };
}

// Rank a list into the top N (and optionally bottom N) by a numeric value, dropping nulls. Ties break
// by name for a stable order. `asc` flips which end is "top" (ERA: lowest is best).
function rankTopBottom(rows, valueOf, { n = 3, asc = false, withBottom = false } = {}) {
  const scored = rows
    .map((r) => ({ row: r, v: valueOf(r) }))
    .filter((x) => x.v != null && Number.isFinite(x.v));
  const cmp = (a, b) => (asc ? a.v - b.v : b.v - a.v) || (a.row.name || '').localeCompare(b.row.name || '');
  scored.sort(cmp);
  const top = scored.slice(0, n);
  // Trailers = the worst n (opposite end from top), always displayed value-descending regardless of
  // which end is "best". Guard against overlap when the pool is tiny.
  let bottom = [];
  if (withBottom) {
    bottom = scored.slice(-n).filter((x) => !top.includes(x));
    bottom.sort((a, b) => b.v - a.v || (a.row.name || '').localeCompare(b.row.name || ''));
  }
  return { top, bottom };
}

// Build a display entry for one ranked player in a category.
const entry = (x, display) => ({ cardId: x.row.cardId, teamUserId: x.row.teamUserId,
  name: x.row.name, games: x.row.games, value: x.v, display });

/**
 * Compute the full leaders board: top+bottom 3 for rate stats (BA, OPS, ERA), top 3 for counting
 * stats (HR, RBI, W-L, SV, SO). Rate categories require season-scaled qualification.
 */
export function computeLeaders(agg) {
  const { batters, pitchers, seasonGames } = agg;
  const minPA = Math.max(MIN_PA_FLOOR, Math.round(PA_PER_GAME * seasonGames));
  const minOuts = Math.max(MIN_OUTS_FLOOR, Math.round(OUTS_PER_GAME * seasonGames));

  // Derived rate values per player.
  const withRates = batters.map((b) => ({ ...b, pa: b.ab + b.bb,
    avg: rate(b.h, b.ab), obp: rate(b.h + b.bb, b.ab + b.bb), slg: rate(tb(b), b.ab) }));
  withRates.forEach((b) => { b.ops = (b.obp != null && b.slg != null) ? b.obp + b.slg : null; });
  const qualifiedBat = withRates.filter((b) => b.pa >= minPA);

  const withEra = pitchers.map((p) => ({ ...p, era: rate(p.er * 27, p.outs) }));
  const qualifiedPit = withEra.filter((p) => p.outs >= minOuts);

  // Counting-stat leaders drop zeros — a 0-HR "leader" is noise.
  const countingTop = (rows, key, fmt = String) => {
    const nonZero = rows.filter((r) => (r[key] || 0) > 0);
    const { top } = rankTopBottom(nonZero, (r) => r[key], { n: 3 });
    return top.map((x) => entry(x, fmt(x.v)));
  };

  const rateCat = (rows, valueOf, fmt, asc = false) => {
    const { top, bottom } = rankTopBottom(rows, valueOf, { n: 3, asc, withBottom: true });
    return { top: top.map((x) => entry(x, fmt(x.v))), bottom: bottom.map((x) => entry(x, fmt(x.v))) };
  };

  const wlCat = (rows) => {
    // Rank by win–loss differential (best record on top, worst in the trailers); a pitcher with no
    // decision is ranked at neither end. Encode wins as a tiebreak so 6-1 outranks 5-0 at equal diff.
    const decided = rows.filter((p) => (p.w + p.l) > 0);
    const { top, bottom } = rankTopBottom(decided, (p) => (p.w - p.l) * 1000 + p.w, { n: 3, withBottom: true });
    const mk = (x) => entry(x, `${x.row.w}-${x.row.l}`);
    return { label: 'W–L', top: top.map(mk), bottom: bottom.map(mk) };
  };

  return {
    seasonGames,
    qualifiers: { minPA, minIp: (minOuts / 3).toFixed(1) },
    batting: {
      avg: { label: 'Batting Average', ...rateCat(qualifiedBat, (b) => b.avg, fmt3) },
      ops: { label: 'OPS', ...rateCat(qualifiedBat, (b) => b.ops, fmt3) },
      hr: { label: 'Home Runs', top: countingTop(batters, 'hr') },
      rbi: { label: 'RBI', top: countingTop(batters, 'rbi') },
    },
    pitching: {
      era: { label: 'ERA', ...rateCat(qualifiedPit, (p) => p.era, fmt2, true) },
      wins: wlCat(withEra),
      sv: { label: 'Saves', top: countingTop(withEra, 's') },
      so: { label: 'Strikeouts', top: countingTop(withEra, 'so') },
    },
  };
}
