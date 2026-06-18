// One-off maintenance script: inspect / fix a duplicated baserunner in a live game.
//
// A bug can leave the same player object in two base slots (e.g. two Ellis Burkses).
// This script reads the latest game_state, shows the bases + recent log, and — only
// when you pass --remove=<base> — appends a NEW game_states turn with that base cleared.
// Nothing is overwritten or deleted, so the change is fully reversible (just delete the
// new turn) and the next page load / GET returns the corrected state.
//
// Usage (run with the PRODUCTION connection string from Render -> Environment):
//   DATABASE_URL='postgres://...'  node fix_game_runner.js 129
//   DATABASE_URL='postgres://...'  node fix_game_runner.js 129 --remove=first
//
// No --remove flag => read-only inspection (safe to run anytime).

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: set DATABASE_URL to the production Postgres connection string.');
  process.exit(1);
}

const gameId = process.argv[2];
if (!gameId) {
  console.error('ERROR: pass a game id, e.g. `node fix_game_runner.js 129`.');
  process.exit(1);
}
const removeBase = (process.argv.find((a) => a.startsWith('--remove=')) || '').split('=')[1] || null;
const VALID_BASES = ['first', 'second', 'third'];
if (removeBase && !VALID_BASES.includes(removeBase)) {
  console.error(`ERROR: --remove must be one of ${VALID_BASES.join(', ')}.`);
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const asState = (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw);
const label = (r) => (r ? `${r.displayName || r.name || '??'} (card_id ${r.card_id})` : '(empty)');

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT turn_number, state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1',
      [gameId]
    );
    if (!rows.length) {
      console.error(`No game_states found for game ${gameId}.`);
      return;
    }

    const currentTurn = rows[0].turn_number;
    const state = asState(rows[0].state_data);
    const bases = state.bases || {};

    console.log(`\n=== Game ${gameId} — latest turn ${currentTurn} ===`);
    console.log(`Inning ${state.inning} ${state.isTopInning ? 'top' : 'bottom'}, outs ${state.outs}, ` +
      `score away ${state.awayScore} / home ${state.homeScore}`);
    console.log('Bases:');
    for (const b of VALID_BASES) console.log(`  ${b.padEnd(6)} -> ${label(bases[b])}`);

    // Detect any card_id occupying more than one base.
    const seen = {};
    for (const b of VALID_BASES) {
      const id = bases[b]?.card_id;
      if (id != null) (seen[id] = seen[id] || []).push(b);
    }
    const dupes = Object.entries(seen).filter(([, slots]) => slots.length > 1);
    if (dupes.length) {
      console.log('\n** DUPLICATE RUNNER(S) DETECTED **');
      for (const [id, slots] of dupes) {
        console.log(`  card_id ${id} (${label(bases[slots[0]])}) is on: ${slots.join(' & ')}`);
      }
    } else {
      console.log('\nNo duplicate runners detected.');
    }

    // Recent game log to help decide which base is the phantom.
    const events = await client.query(
      `SELECT turn_number, log_message FROM game_events
       WHERE game_id = $1 AND log_message IS NOT NULL
       ORDER BY turn_number DESC, timestamp DESC LIMIT 25`,
      [gameId]
    );
    console.log('\nRecent game log (newest first):');
    for (const e of events.rows) console.log(`  [t${e.turn_number}] ${e.log_message}`);

    if (!removeBase) {
      console.log('\n(Read-only inspection. Re-run with --remove=<first|second|third> to clear a base.)\n');
      return;
    }

    // --- Mutation path ---
    const runner = bases[removeBase];
    if (!runner) {
      console.error(`\nABORT: base "${removeBase}" is already empty; nothing to remove.`);
      return;
    }
    const slotsForThisCard = seen[runner.card_id] || [];
    if (slotsForThisCard.length < 2) {
      console.error(`\nABORT: ${label(runner)} on ${removeBase} is NOT duplicated elsewhere. ` +
        `Refusing to remove a legitimate runner. Double-check the base.`);
      return;
    }

    // Build the corrected state: clear the chosen base, and mirror the fix into the
    // frozen pre-play snapshots if they hold the same duplicated player there too.
    const newState = JSON.parse(JSON.stringify(state));
    newState.bases[removeBase] = null;
    for (const key of ['currentAtBat', 'lastCompletedAtBat']) {
      const snap = newState[key]?.basesBeforePlay;
      if (snap && snap[removeBase]?.card_id === runner.card_id) snap[removeBase] = null;
    }

    await client.query('BEGIN');
    await client.query(
      'INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)',
      [gameId, currentTurn + 1, JSON.stringify(newState)]
    );
    await client.query('COMMIT');

    console.log(`\nDONE: removed ${label(runner)} from ${removeBase}.`);
    console.log(`Appended new turn ${currentTurn + 1} (old turn ${currentTurn} preserved for rollback).`);
    console.log('Players should refresh the game page to see the corrected bases.\n');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
