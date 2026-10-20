/* eslint-disable no-console */
// Snapshot completed games into sim/data/history.json for calibrating manager policies against how
// people actually played. Read-only; uses PROD_DATABASE_URL (or the local DB with --local).
//
// Per game: participants (user, side, lineups), the series context, a compact per-turn trace of the
// situation and the decisions on the table, the final box-score PA log, and the substitution /
// steal / baserunning event log.
require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const useLocal = process.argv.includes('--local');
const pool = !useLocal && process.env.PROD_DATABASE_URL
  ? new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool();

const id = (p) => `(${p}->>'card_id')::int`;
const TURN_SQL = `
  SELECT gs.turn_number AS t,
    (s->>'inning')::int AS inn, (s->>'isTopInning')::bool AS top, (s->>'outs')::int AS outs,
    (s->>'homeScore')::int AS hs, (s->>'awayScore')::int AS "as",
    ${id("s->'bases'->'first'")} AS b1, ${id("s->'bases'->'second'")} AS b2, ${id("s->'bases'->'third'")} AS b3,
    ${id("s->'currentAtBat'->'batter'")} AS bat, ${id("s->'currentAtBat'->'pitcher'")} AS pit,
    ${id("s->'currentHomePitcher'")} AS hp, ${id("s->'currentAwayPitcher'")} AS ap,
    (s->'currentAtBat'->>'atBatIndex')::int AS abi,
    s->'currentAtBat'->>'batterAction' AS ba, s->'currentAtBat'->>'pitcherAction' AS pa,
    (s->'currentAtBat'->>'infieldIn')::bool AS ifin,
    s->'currentAtBat'->'pitchRollResult'->>'advantage' AS adv,
    s->'currentAtBat'->'swingRollResult'->>'outcome' AS res,
    s->'currentPlay'->>'type' AS play,
    jsonb_path_query_array(s->'currentPlay'->'payload'->'decisions', '$[*].from') AS dfrom,
    s->'currentPlay'->'payload'->'choices' AS choices,
    s->'currentPlay'->'payload'->>'hitType' AS hit,
    s->'throwRollResult'->>'throwToBase' AS thr, s->'throwRollResult'->>'outcome' AS throut,
    s->'lastStealResult'->>'outcome' AS steal, s->'lastStealResult'->>'throwToBase' AS stealto,
    s->'pendingStealAttempt'->>'throwToBase' AS psteal,
    s->'homeDefensiveRatings' AS hdef, s->'awayDefensiveRatings' AS adef,
    (s->'homeTeam'->>'battingOrderPosition')::int AS hbo, (s->'awayTeam'->>'battingOrderPosition')::int AS abo,
    s->'pitcherStats' AS ps,
    (s->>'gameOver')::bool AS over
  FROM game_states gs, LATERAL (SELECT gs.state_data AS s) x
  WHERE gs.game_id = $1 ORDER BY gs.turn_number`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const games = (await client.query(`
      SELECT g.game_id, g.series_id, g.game_in_series, g.use_dh, g.home_team_user_id, s.series_type
      FROM games g LEFT JOIN series s ON s.id = g.series_id
      WHERE g.status = 'completed' ORDER BY g.game_id`)).rows;
    const out = [];
    for (const g of games) {
      const parts = (await client.query(`
        SELECT gp.user_id, gp.home_or_away, t.city, gp.starting_lineup, gp.lineup, gr.roster_data
        FROM game_participants gp
        LEFT JOIN teams t ON t.user_id = gp.user_id
        LEFT JOIN game_rosters gr ON gr.game_id = gp.game_id AND gr.user_id = gp.user_id
        WHERE gp.game_id = $1`, [g.game_id])).rows.map((p) => ({
        user: p.user_id, side: p.home_or_away, team: p.city,
        startingLineup: p.starting_lineup, finalLineup: p.lineup,
        roster: (p.roster_data || []).map((c) => ({ card_id: c.card_id, assignment: c.assignment })),
      }));
      const turns = (await client.query(TURN_SQL, [g.game_id])).rows;
      const last = (await client.query(`SELECT state_data->'atBatLog' AS log, state_data->'stealLog' AS steals
        FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1`, [g.game_id])).rows[0] || {};
      const events = (await client.query(`
        SELECT turn_number AS t, event_type AS type, user_id AS user,
               regexp_replace(log_message, '<[^>]+>', '', 'g') AS msg
        FROM game_events WHERE game_id = $1 AND event_type IN ('substitution','steal','baserunning','infield-in-gb','walk','game_event')
        ORDER BY turn_number, event_id`, [g.game_id])).rows;
      out.push({ ...g, participants: parts, turns, atBatLog: last.log || [], stealLog: last.steals || [], events });
      process.stdout.write('.');
    }
    const file = path.join(__dirname, 'data', 'history.json');
    fs.writeFileSync(file, JSON.stringify(out));
    console.log(`\nWrote ${out.length} games (${(fs.statSync(file).size / 1e6).toFixed(1)} MB) to ${file}`);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
