// Runtime win-probability service: loads the precomputed grid (wpTable.json) and turns a game's
// ordered game_states into a home-win-probability curve plus per-play WPA (Win Probability Added).
//
// The grid is calibrated to the league's run environment; regenerate it with `node build-wp-table.js`.
const path = require('path');
const model = require('./winProbabilityModel');

let TABLE = null;
function getTable() {
  if (!TABLE) {
    // eslint-disable-next-line global-require
    TABLE = require(path.join(__dirname, 'wpTable.json'));
  }
  return TABLE;
}

const halfLabel = (isTop, inning) => `${isTop ? 'Top' : 'Bot'} ${inning}`;

// Strip the play-by-play HTML down to plain text ("... <strong>Outs: 2</strong>" -> "... Outs: 2").
function cleanMessage(html) {
  if (!html) return null;
  const txt = String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return txt || null;
}

// Map turn_number -> the play's game-log message. Play text lives in 'game_event' and 'baserunning'
// events (a hit that drives in a run is logged as 'baserunning'); the 'system' inning-change banners
// and 'substitution' lines are skipped.
const PLAY_EVENT_TYPES = new Set(['game_event', 'baserunning', 'steal']);
function buildTurnMessages(gameEvents) {
  const map = new Map();
  for (const e of gameEvents || []) {
    if (e.event_type && !PLAY_EVENT_TYPES.has(e.event_type)) continue;
    const msg = cleanMessage(e.log_message);
    if (msg && e.turn_number != null) map.set(e.turn_number, msg); // last message at a turn wins
  }
  return map;
}

// The game-log message for a play. The state's dedup turn and the event's turn can differ by a turn
// (a run scoring on a follow-up baserunning turn), so we probe the immediate neighbourhood; plays sit
// ~4+ turns apart, so a ±2 window never reaches the neighbouring play.
function messageAt(turnMsg, turn) {
  if (turn == null) return null;
  for (const d of [0, 1, -1, 2, -2]) {
    const m = turnMsg.get(turn + d);
    if (m) return m;
  }
  return null;
}

// rawStates: rows ordered by turn_number, each with a `state_data` object (or the state_data itself).
// opts.gameEvents: rows from game_events ({ turn_number, event_type, log_message }) for the log text.
// Returns { model, points, plays, summary } or null when the game has no usable states.
function computeGameWinProbability(rawStates, opts = {}) {
  const table = getTable();
  const sits = model.extractSituations(rawStates);
  if (sits.length === 0) return null;
  const turnMsg = buildTurnMessages(opts.gameEvents);

  const homeWP = sits.map((s) => model.lookupWP(table, s));
  // Pin the final point to the actual result so a decided game ends cleanly at 100%/0%.
  const last = sits[sits.length - 1];
  if (last.home !== last.away) homeWP[homeWP.length - 1] = last.home > last.away ? 1 : 0;

  const points = sits.map((s, i) => {
    // WPA of the transition into this point, from the batting team's perspective.
    let wpa = null;
    let battingTeam = null;
    if (i > 0) {
      const dHome = homeWP[i] - homeWP[i - 1];
      const battingIsAway = sits[i - 1].isTop;
      wpa = Math.round((battingIsAway ? -dHome : dHome) * 1000) / 1000;
      battingTeam = battingIsAway ? 'away' : 'home';
    }
    return {
      i,
      inning: s.inning,
      isTop: s.isTop,
      half: halfLabel(s.isTop, s.inning),
      // The base/out/score here are the state AFTER this play; the hover reads the PREVIOUS point for
      // the start-of-at-bat situation (that point's after-state is this at-bat's before-state).
      outs: s.outs,
      base: s.base,
      home: s.home,
      away: s.away,
      homeWP: Math.round(homeWP[i] * 1000) / 1000,
      wpa,
      battingTeam,
      // Full game-log message for the play that produced this situation (null for the opening state).
      log: messageAt(turnMsg, s.turn),
      play: s.play,
    };
  });

  // WPA per play: the play that caused transition (i-1 -> i) was made by the team batting in
  // situation i-1. Credit that team the change in ITS win probability.
  // Group the transitions (i-1 -> i) into plays. Consecutive transitions produced by the same plate
  // appearance (matching paSig) merge into one play, so a hit that also advances a runner counts once
  // with its net WPA. Baserunning transitions (no paSig) each stand alone.
  const segments = [];
  for (let i = 1; i < sits.length; i++) {
    const sig = sits[i].paSig;
    const last = segments[segments.length - 1];
    if (sig && last && last.sig === sig && last.after === i - 1) {
      last.after = i; // extend the current plate appearance
    } else {
      segments.push({ sig, before: i - 1, after: i });
    }
  }

  const plays = segments.map((seg) => {
    const b = sits[seg.before];
    const a = sits[seg.after];
    const dHome = homeWP[seg.after] - homeWP[seg.before];
    const battingIsAway = b.isTop;
    const wpa = battingIsAway ? -dHome : dHome; // batting team's perspective
    const play = a.play || {};
    const outcome = play.outcome || null;
    return {
      i: seg.after,
      inning: b.inning,
      isTop: b.isTop,
      half: halfLabel(b.isTop, b.inning),
      battingTeam: battingIsAway ? 'away' : 'home',
      baserunning: !!play.baserunning,
      batter: play.batter || null,
      batterId: play.batterId != null ? play.batterId : null,
      batterImage: play.batterImage || null,
      pitcher: play.pitcher || null,
      pitcherId: play.pitcherId != null ? play.pitcherId : null,
      outcome,
      // The play's own game-log message (the resolving swing/steal is logged at the first micro-turn).
      log: messageAt(turnMsg, sits[seg.before + 1].turn),
      scoreBefore: `${b.away}-${b.home}`,
      scoreAfter: `${a.away}-${a.home}`,
      runsScored: (a.home - b.home) + (a.away - b.away),
      homeWPBefore: Math.round(homeWP[seg.before] * 1000) / 1000,
      homeWPAfter: Math.round(homeWP[seg.after] * 1000) / 1000,
      wpa: Math.round(wpa * 1000) / 1000,
    };
  });

  const topPlays = plays
    .filter((p) => (p.batter || p.baserunning || p.log) && Math.abs(p.wpa) >= 0.005)
    .slice()
    .sort((a, b) => Math.abs(b.wpa) - Math.abs(a.wpa))
    .slice(0, opts.topN || 8);

  // Per-player WPA: a batter (or a runner on a steal/caught stealing) is credited his play's WPA; the
  // pitcher is charged its negative. Baserunning has a runner but no pitcher, so it lands only on the
  // runner's line — which is what folds those steal swings back into the totals.
  const playerWpa = { batters: {}, pitchers: {} };
  for (const p of plays) {
    if (p.batterId != null) playerWpa.batters[p.batterId] = (playerWpa.batters[p.batterId] || 0) + p.wpa;
    if (p.pitcherId != null) playerWpa.pitchers[p.pitcherId] = (playerWpa.pitchers[p.pitcherId] || 0) - p.wpa;
  }
  for (const grp of [playerWpa.batters, playerWpa.pitchers]) {
    for (const k of Object.keys(grp)) grp[k] = Math.round(grp[k] * 1000) / 1000;
  }

  return {
    model: {
      games: table.games,
      avgTotalRuns: table.avgTotalRuns,
      homeWinPct: table.homeWinPct,
      generatedAt: table.generatedAt,
    },
    points,
    plays: topPlays,
    playerWpa,
    summary: {
      finalHome: last.home,
      finalAway: last.away,
      homeWon: last.home > last.away,
      totalPlays: plays.length,
    },
  };
}

// --- Loading state timelines without blowing the heap -------------------------------------------
//
// A full `state_data` row carries the whole game snapshot: both rosters plus the cumulative
// atBatLog, re-serialized on every turn. That averages ~15 MB of JSON per completed game (399 turns
// x ~40 KB), so pulling a season's timelines in one query decoded well over a gigabyte and OOM'd the
// process inside pg's JSON.parse. The model itself reads only the handful of fields below (see
// extractSituations / collectNameCardMap), so we project those in SQL and let Postgres drop the rest
// before it ever hits the wire.
//
// `bases`, `currentAtBat` and `lastStealResult` are kept whole (they hold the cards used for play
// attribution and are small); `lastCompletedAtBat` is trimmed to the one field collectNameCardMap
// reads. Together this is ~1 MB per game instead of ~15 MB.
const WP_STATE_COLUMN = `jsonb_build_object(
      'inning', state_data->'inning',
      'isTopInning', state_data->'isTopInning',
      'outs', state_data->'outs',
      'homeScore', state_data->'homeScore',
      'awayScore', state_data->'awayScore',
      'bases', state_data->'bases',
      'currentAtBat', state_data->'currentAtBat',
      'lastStealResult', state_data->'lastStealResult',
      'lastCompletedAtBat', jsonb_build_object('batter', state_data->'lastCompletedAtBat'->'batter')
    ) AS state_data`;

// Run `fn(gameId, states)` for each game, loading at most `chunkSize` games' timelines at a time so
// peak memory stays flat no matter how many games the caller passes.
async function forEachGameStates(client, gameIds, fn, { chunkSize = 10 } = {}) {
  for (let i = 0; i < gameIds.length; i += chunkSize) {
    const chunk = gameIds.slice(i, i + chunkSize);
    const res = await client.query(
      `SELECT game_id, turn_number, ${WP_STATE_COLUMN}
       FROM game_states WHERE game_id = ANY($1) ORDER BY game_id, turn_number`, [chunk]);
    const byGame = {};
    for (const r of res.rows) (byGame[r.game_id] = byGame[r.game_id] || []).push(r);
    for (const gid of chunk) await fn(gid, byGame[gid] || []);
  }
}

module.exports = { computeGameWinProbability, getTable, WP_STATE_COLUMN, forEachGameStates };
