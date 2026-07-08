/* eslint-disable no-console */
//
// Dev helper: simulate a linked series being played game-by-game so you can watch the "games played"
// auto-population (series_results status scheduled -> in_progress -> completed + standings) WITHOUT
// actually playing full games through the engine.
//
// It reproduces the write-back that the server does in handleSeriesProgression (server.js ~955-1017):
// increment the live series' win tally, decide if the series is over with the same rule, then call the
// REAL resolveSeriesResultUpdate util and UPDATE series_results exactly as the server would. Keep this
// in sync with that function if the write-back changes.
//
// Everything runs in one transaction and ROLLS BACK unless you pass --commit, so it's safe to poke at.
//
// Usage (run from apps/backend):
//   node simulate-series.js                       # list scheduled/in-progress league series you can drive
//   node simulate-series.js <series_result_id>    # step it out to a 4-3 win (dry run, rolls back)
//   node simulate-series.js <id> --wins 4-2       # final tally: winning-slot 4, losing-slot 2
//   node simulate-series.js <id> --pattern HHAAHHH # explicit per-game winners (H=winning slot, A=losing slot)
//   node simulate-series.js <id> --commit         # actually persist the result
//
require('dotenv').config();
const { pool } = require('./db');
const { resolveSeriesResultUpdate, seriesTypeForRound } = require('./utils/seriesUtils');
const { buildSeasonModel } = require('./utils/standingsUtils');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined;
};
const seriesResultId = args.find(a => /^\d+$/.test(a));
const commit = !!flag('commit');
const winsArg = flag('wins');           // e.g. "4-3"
const patternArg = flag('pattern');     // e.g. "HHAAHHH"

// Build a realistic, deterministic game sequence that ends on a winning-slot ("H") win.
function sequenceForWins(w, l) {
  const seq = [];
  let h = 0; let a = 0;
  while (h < w || a < l) {
    if (h < w && (a >= l || h <= a)) { seq.push('H'); h += 1; } else { seq.push('A'); a += 1; }
  }
  return seq;
}

function printStandings(rows, teams) {
  const model = buildSeasonModel(rows, teams);
  const table = Object.values(model.teamStats || model)
    .map(t => ({ team: t.name, W: t.wins, L: t.losses, rem: t.remaining }))
    .sort((x, y) => y.W - x.W || x.L - y.L);
  console.table(table);
}

async function listCandidates(client) {
  const { rows } = await client.query(`
    SELECT id, season_name, round, style, status, winning_team_name, winning_score, losing_team_name, losing_score
    FROM series_results
    WHERE status IN ('scheduled', 'in_progress') AND (style IS NULL OR style <> 'Classic')
    ORDER BY season_name DESC, id DESC`);
  console.log('Scheduled / in-progress league series you can simulate:');
  console.table(rows);
  console.log('\nRun: node simulate-series.js <id> [--wins 4-3] [--pattern HHAAHHH] [--commit]');
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!seriesResultId) {
      await listCandidates(client);
      await client.query('ROLLBACK');
      return;
    }

    const srRes = await client.query(
      `SELECT id, season_name, round, style, status,
              winning_team_id, winning_team_name, losing_team_id, losing_team_name
       FROM series_results WHERE id = $1 FOR UPDATE`, [seriesResultId]);
    if (srRes.rows.length === 0) throw new Error(`series_results ${seriesResultId} not found`);
    const sr = srRes.rows[0];
    const seriesType = seriesTypeForRound(sr.round, sr.style);
    console.log(`\nSimulating series_result ${sr.id}  [${sr.season_name} / ${sr.round} / ${seriesType}]`);
    console.log(`  winning-slot (H) = ${sr.winning_team_name} (team ${sr.winning_team_id})`);
    console.log(`  losing-slot  (A) = ${sr.losing_team_name} (team ${sr.losing_team_id})\n`);

    // Map the two scheduled teams -> their user ids (same team_id<->user_id link the server uses).
    const teamUsers = await client.query(
      'SELECT team_id, user_id FROM teams WHERE team_id = ANY($1)',
      [[sr.winning_team_id, sr.losing_team_id]]);
    const userForTeam = (tid) => (teamUsers.rows.find(r => r.team_id === tid) || {}).user_id;
    const homeUserId = userForTeam(sr.winning_team_id); // winning slot plays "home"
    const awayUserId = userForTeam(sr.losing_team_id);

    // Ensure a linked live series row exists (fresh tally); create if missing.
    let liveRes = await client.query(
      'SELECT id, home_wins, away_wins FROM series WHERE series_result_id = $1 ORDER BY id DESC LIMIT 1',
      [sr.id]);
    let seriesId;
    if (liveRes.rows.length === 0) {
      const ins = await client.query(
        `INSERT INTO series (series_type, series_home_user_id, series_away_user_id, series_result_id, home_wins, away_wins, status)
         VALUES ($1, $2, $3, $4, 0, 0, 'in_progress') RETURNING id`,
        [seriesType, homeUserId, awayUserId, sr.id]);
      seriesId = ins.rows[0].id;
      console.log(`Created linked live series ${seriesId} (home user ${homeUserId} vs away user ${awayUserId}).`);
    } else {
      seriesId = liveRes.rows[0].id;
      await client.query('UPDATE series SET home_wins = 0, away_wins = 0, status = $2 WHERE id = $1', [seriesId, 'in_progress']);
      console.log(`Reusing linked live series ${seriesId} (tally reset to 0-0).`);
    }

    // Decide the game sequence.
    let sequence;
    if (patternArg && typeof patternArg === 'string') {
      sequence = patternArg.toUpperCase().split('').filter(c => c === 'H' || c === 'A');
    } else if (winsArg && typeof winsArg === 'string') {
      const [w, l] = winsArg.split('-').map(Number);
      sequence = sequenceForWins(w, l);
    } else {
      sequence = sequenceForWins(4, 3);
    }

    let homeWins = 0; let awayWins = 0;
    for (let i = 0; i < sequence.length; i += 1) {
      const gameNum = i + 1; // game_in_series is 1-based
      if (sequence[i] === 'H') homeWins += 1; else awayWins += 1;
      await client.query('UPDATE series SET home_wins = $1, away_wins = $2 WHERE id = $3', [homeWins, awayWins, seriesId]);

      // Same over-condition as handleSeriesProgression.
      let isOver = false;
      if (['playoff', 'golden_spaceship', 'wooden_spoon', 'classic'].includes(seriesType) && (homeWins >= 4 || awayWins >= 4)) isOver = true;
      if (seriesType === 'regular_season' && gameNum >= 7) isOver = true;

      const update = resolveSeriesResultUpdate(
        { winning_team_id: sr.winning_team_id, winning_team_name: sr.winning_team_name, losing_team_id: sr.losing_team_id, losing_team_name: sr.losing_team_name },
        { homeTeamId: sr.winning_team_id, awayTeamId: sr.losing_team_id, homeGames: homeWins, awayGames: awayWins, isOver });

      await client.query(
        `UPDATE series_results SET status=$1, result_source=$2,
           winning_team_id=$3, winning_team_name=$4, winning_score=$5,
           losing_team_id=$6, losing_team_name=$7, losing_score=$8 WHERE id=$9`,
        [update.status, update.result_source, update.winning_team_id, update.winning_team_name, update.winning_score,
         update.losing_team_id, update.losing_team_name, update.losing_score, sr.id]);
      if (isOver) await client.query("UPDATE series SET status='completed' WHERE id=$1", [seriesId]);

      const played = (update.winning_score || 0) + (update.losing_score || 0);
      console.log(`Game ${gameNum} (${sequence[i]} win) -> status=${update.status.padEnd(11)} ` +
        `${update.winning_team_name} ${update.winning_score}-${update.losing_score} ${update.losing_team_name}  (games played: ${played})`);
    }

    // Standings snapshot for the season after the simulation.
    const [seasonRows, teams] = await Promise.all([
      client.query(
        `SELECT id, round, status, winning_team_id, winning_team_name, winning_score, losing_team_id, losing_team_name, losing_score
         FROM series_results WHERE season_name = $1 AND (style IS NULL OR style <> 'Classic')`, [sr.season_name]),
      client.query('SELECT team_id, name, city, logo_url FROM teams'),
    ]);
    console.log(`\nStandings for ${sr.season_name} after simulation:`);
    printStandings(seasonRows.rows, teams.rows);

    if (commit) {
      await client.query('COMMIT');
      console.log('\n✅ COMMITTED — changes persisted.');
    } else {
      await client.query('ROLLBACK');
      console.log('\n↩️  Dry run — rolled back (pass --commit to persist).');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
