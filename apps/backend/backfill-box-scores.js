// Backfill box-score data (the per-plate-appearance `atBatLog`) onto games that finished before
// the live box-score feature shipped. Going-forward games accumulate `atBatLog` in the engine
// (gameLogic.applyOutcome); this script reconstructs it for already-completed games by replaying
// their play-by-play `game_events`.
//
// Best-effort by design: batting lines (AB/H/2B/3B/HR/BB/SO, RBI, and runs scored) are parsed
// from the free-text log. Pitching IP/R/ER/BF still render from the long-tracked `pitcherStats`
// already in each game's state, so this script does NOT try to reconstruct pitcher assignments;
// `pitcherKey` and `advantage` are left null on backfilled entries (so backfilled games show no
// pitching H/BB/SO or advantage splits — flagged below).
//
// Usage (read-only by default — prints a reconstructed box score for review):
//   node backfill-box-scores.js                 # dry-run, ALL completed games (local DB)
//   node backfill-box-scores.js 129             # dry-run, single game
//   node backfill-box-scores.js 129 --prod      # dry-run against PROD_DATABASE_URL (read-only)
//   node backfill-box-scores.js 129 --commit    # write atBatLog into the latest game_state
//
// Nothing is written unless --commit is passed. --commit only updates already-completed games.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const USE_PROD = args.includes('--prod');
const gameIdArg = args.find((a) => /^\d+$/.test(a));

const pool = USE_PROD
  ? new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool(); // pg reads PG* env vars (loaded from .env) for local

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// --- Outcome classification from the leading batter clause ---------------------------------
function classifyOutcome(text) {
  const t = text;
  if (/intentionally walked/i.test(t)) return { kind: 'IBB' };
  if (/\bwalks\b/i.test(t) && !/walk-off/i.test(t)) return { kind: 'BB' };
  if (/HOME RUN/i.test(t)) return { kind: 'HR' };
  if (/walk-off TRIPLE|hits a TRIPLE/i.test(t)) return { kind: '3B' };
  if (/walk-off DOUBLE|hits a DOUBLE/i.test(t)) return { kind: '2B' };
  if (/walk-off SINGLE|hits a SINGLE|for a SINGLE/i.test(t)) return { kind: '1B' };
  if (/strikes out/i.test(t)) return { kind: 'SO' };
  if (/grounds into a double play/i.test(t)) return { kind: 'DP' };
  if (/fielder's choice/i.test(t)) return { kind: 'OUT' };
  if (/sacrifice bunt|lays down a bunt|bunts into/i.test(t)) return { kind: 'BUNT' };
  if (/grounds out|flies out|pops out|\bis out\b|lines out|fouls out/i.test(t)) return { kind: 'OUT' };
  return null;
}

function applyKindToEntry(entry, kind) {
  switch (kind) {
    case '1B': entry.ab = 1; entry.h = 1; break;
    case '2B': entry.ab = 1; entry.h = 1; entry.double = 1; break;
    case '3B': entry.ab = 1; entry.h = 1; entry.triple = 1; break;
    case 'HR': entry.ab = 1; entry.h = 1; entry.hr = 1; break;
    case 'BB': case 'IBB': entry.bb = 1; break;
    case 'SO': entry.ab = 1; entry.so = 1; break;
    case 'BUNT': break; // sacrifice — PA only
    default: entry.ab = 1; // OUT, DP, FC
  }
}

// Count runs in an event the way the linescore does, so RBI totals line up with the score.
function countRuns(text) {
  const scores = (text.match(/scores/gi) || []).length;
  const hr = /HOME RUN/i.test(text) ? 1 : 0;
  const safeHome = /SAFE at home/i.test(text) ? 1 : 0;
  const sentHome = /SENT HOME\.\.\. SAFE/i.test(text) ? 1 : 0;
  return scores + hr + safeHome + sentHome;
}

// Longest-name-first matcher so "Frank Thomas Jr." wins over "Frank Thomas".
function buildNameMap(roster) {
  const entries = (roster || [])
    .filter((c) => c && c.card_id != null && (c.displayName || c.name))
    .map((c) => ({ id: c.card_id, name: (c.displayName || c.name) }))
    .sort((a, b) => b.name.length - a.name.length);
  return entries;
}

function leadingBatter(text, nameEntries) {
  for (const { id, name } of nameEntries) {
    if (text.startsWith(name)) return { id, name };
  }
  return null;
}

// The name of a pitcher entering on a substitution event, or null if this sub isn't a pitching
// change. Matches the two formats server.js emits: "<team> brings in <X> to relieve <Y>." and the
// double-switch "<team> substitutes <X> for <Y>. <X> will now play P."
function pitchingSubName(text) {
  let m = text.match(/brings in (.+?) to relieve /);
  if (m) return m[1].trim();
  if (/will now play P\b/.test(text)) {
    m = text.match(/substitutes (.+?) for /);
    if (m) return m[1].trim();
  }
  return null;
}

// Resolve a name appearing in a sub message to a card_id on the given team's roster.
function cardIdByName(name, nameEntries) {
  if (!name) return null;
  if (/replacement pitcher/i.test(name)) return -2;
  const exact = nameEntries.find((e) => e.name === name);
  if (exact) return exact.id;
  const contained = nameEntries.find((e) => name.startsWith(e.name));
  return contained ? contained.id : null;
}

function scorerIdsInClause(clause, nameEntries) {
  const ids = [];
  for (const { id, name } of nameEntries) {
    if (clause.includes(name)) { ids.push(id); break; }
  }
  return ids;
}

function reconstructAtBatLog(events, awayRoster, homeRoster, opts = {}) {
  const awayNames = buildNameMap(awayRoster);
  const homeNames = buildNameMap(homeRoster);
  const namesBySide = { away: awayNames, home: homeNames };
  const { awayUserId = null, homeUserId = null, startAwayPitcherId = null, startHomePitcherId = null } = opts;
  const userIdBySide = { away: awayUserId, home: homeUserId };
  // Current pitcher card_id per team, updated as relievers enter. Defense side = whoever isn't batting.
  const currentPitcher = { away: startAwayPitcherId, home: startHomePitcherId };
  const log = [];

  let isTop = true; // top of the 1st, away bats
  let inning = 1;

  for (const ev of events) {
    const text = stripHtml(ev.log_message);
    if (!text) continue;

    // Track half-inning from the inning-change markers (same signal the linescore uses).
    if (/inning-change-message/.test(ev.log_message) || /Top of the|Bottom of the/.test(text)) {
      const nowTop = /Top of the|Top\b/.test(text);
      if (nowTop && !isTop) inning += 1;
      isTop = nowTop;
      continue;
    }

    // Track pitching changes so each PA can be attributed to the pitcher of record. The sub
    // event's user_id identifies the team making the change.
    if (ev.event_type === 'substitution') {
      const subName = pitchingSubName(text);
      if (subName) {
        const side = String(ev.user_id) === String(homeUserId) ? 'home' : 'away';
        const id = cardIdByName(subName, namesBySide[side]);
        if (id != null) currentPitcher[side] = id;
      }
      continue;
    }

    const offenseNames = isTop ? awayNames : homeNames;
    const lead = leadingBatter(text, offenseNames);
    if (!lead) continue;
    const kind = classifyOutcome(text);
    if (!kind) continue;

    const defenseSide = isTop ? 'home' : 'away';
    const defUserId = userIdBySide[defenseSide];
    const defPitcherId = currentPitcher[defenseSide];
    const pitcherKey = (defUserId != null && defPitcherId != null) ? `${defUserId}_${defPitcherId}` : null;

    const entry = {
      inning, isTopInning: isTop,
      batterId: lead.id,
      batterTeam: isTop ? 'away' : 'home',
      pitcherKey,
      outcome: kind.kind,
      ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, so: 0,
      rbi: 0, scoredRunnerIds: [], advantage: null,
    };
    applyKindToEntry(entry, kind.kind);

    // RBI: run count on the event, except a GIDP run is not an RBI.
    const runs = countRuns(text);
    entry.rbi = kind.kind === 'DP' ? Math.max(0, runs - 1) : runs;

    // Runs scored (R) per runner — best-effort name extraction per scoring clause.
    const clauses = text.split(/(?<=[.!])\s+/);
    for (const clause of clauses) {
      if (/scores|SAFE at home|SENT HOME/i.test(clause)) {
        entry.scoredRunnerIds.push(...scorerIdsInClause(clause, offenseNames));
      }
    }
    if (kind.kind === 'HR') entry.scoredRunnerIds.push(lead.id); // batter's own run isn't logged

    log.push(entry);
  }

  return log;
}

function summarize(log, label) {
  const byBatter = new Map();
  for (const e of log) {
    const cur = byBatter.get(e.batterId) || { ab: 0, h: 0, hr: 0, bb: 0, so: 0, rbi: 0 };
    cur.ab += e.ab; cur.h += e.h; cur.hr += e.hr; cur.bb += e.bb; cur.so += e.so; cur.rbi += e.rbi;
    byBatter.set(e.batterId, cur);
  }
  console.log(`  ${label}: ${log.length} PAs across ${byBatter.size} batters`);
  let totH = 0, totRbi = 0;
  for (const v of byBatter.values()) { totH += v.h; totRbi += v.rbi; }
  console.log(`    totals → H:${totH} RBI:${totRbi}`);
}

async function processGame(client, gameId) {
  const partRes = await client.query(
    'SELECT user_id, home_or_away FROM game_participants WHERE game_id = $1', [gameId]);
  const home = partRes.rows.find((r) => r.home_or_away === 'home');
  const away = partRes.rows.find((r) => r.home_or_away !== 'home');
  if (!home || !away) { console.log(`Game ${gameId}: missing participants, skipping.`); return; }

  const rosterRes = await client.query(
    'SELECT user_id, roster_data FROM game_rosters WHERE game_id = $1', [gameId]);
  const rosterFor = (uid) => (rosterRes.rows.find((r) => r.user_id === uid)?.roster_data || []);

  const evRes = await client.query(
    'SELECT log_message, event_type, user_id FROM game_events WHERE game_id = $1 ORDER BY "timestamp" ASC, event_id ASC', [gameId]);

  // Starting pitchers from the opening game_state (used as the initial pitcher of record).
  const firstStateRes = await client.query(
    'SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number ASC LIMIT 1', [gameId]);
  const first = firstStateRes.rows[0]?.state_data || {};

  const log = reconstructAtBatLog(evRes.rows, rosterFor(away.user_id), rosterFor(home.user_id), {
    awayUserId: away.user_id,
    homeUserId: home.user_id,
    startAwayPitcherId: first.currentAwayPitcher?.card_id ?? null,
    startHomePitcherId: first.currentHomePitcher?.card_id ?? null,
  });

  console.log(`\nGame ${gameId}:`);
  summarize(log, 'reconstructed');

  if (!COMMIT) return;

  const stateRes = await client.query(
    'SELECT game_state_id, state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
  if (stateRes.rows.length === 0) { console.log('  no game_state, skipping write.'); return; }
  const { game_state_id, state_data } = stateRes.rows[0];
  const updated = { ...state_data, atBatLog: log };
  await client.query('UPDATE game_states SET state_data = $1 WHERE game_state_id = $2', [updated, game_state_id]);
  console.log(`  ✏️  wrote atBatLog (${log.length} PAs) to game_state ${game_state_id}`);
}

module.exports = { reconstructAtBatLog, classifyOutcome, countRuns, buildNameMap };

async function main() {
  const client = await pool.connect();
  try {
    let ids;
    if (gameIdArg) {
      ids = [Number(gameIdArg)];
    } else {
      const res = await client.query("SELECT game_id FROM games WHERE status = 'completed' ORDER BY game_id ASC");
      ids = res.rows.map((r) => r.game_id);
    }
    console.log(`${COMMIT ? 'COMMIT' : 'DRY-RUN'} | ${USE_PROD ? 'PROD' : 'local'} | ${ids.length} game(s)`);
    for (const id of ids) await processGame(client, id);
    console.log('\nDone.');
    if (!COMMIT) console.log('(dry-run — pass --commit to write)');
  } catch (err) {
    console.error('Backfill error:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main();
