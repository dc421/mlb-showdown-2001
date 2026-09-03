// Build the calibrated win-probability lookup table (services/wpTable.json) from completed games.
//
// The table is a static asset shipped with the backend; regenerate it periodically as more games
// finish so the model stays calibrated to the league's current run environment. It reads only
// game_states (completed games) and writes a JSON grid of home-win probabilities.
//
// Usage:
//   node build-wp-table.js            # build from PROD_DATABASE_URL if set, else local DB
//   node build-wp-table.js --local    # force local DB (DB_* / PG* env)
//   node build-wp-table.js --sims 8000 --max-inning 13   # tune simulation depth/precision
//
// Nothing in the DB is modified. Output: apps/backend/services/wpTable.json
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const model = require('./services/winProbabilityModel');

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const useLocal = argv.includes('--local');
const sims = parseInt(flag('sims', '5000'), 10);
const maxInning = parseInt(flag('max-inning', '13'), 10);
const diffCap = parseInt(flag('diff-cap', '15'), 10);

function makePool() {
  if (!useLocal && process.env.PROD_DATABASE_URL) {
    return { pool: new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } }), label: 'PROD (read-only)' };
  }
  return {
    pool: new Pool({
      user: process.env.DB_USER || process.env.PGUSER,
      host: process.env.DB_HOST || process.env.PGHOST,
      database: process.env.DB_DATABASE || process.env.PGDATABASE,
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
      port: process.env.DB_PORT || process.env.PGPORT,
    }),
    label: 'LOCAL',
  };
}

(async () => {
  const { pool, label } = makePool();
  const t0 = Date.now();
  try {
    console.log(`Building WP table from ${label}  (sims=${sims}, maxInning=${maxInning}, diffCap=${diffCap})`);
    const ids = (await pool.query("SELECT game_id FROM games WHERE status = 'completed' ORDER BY game_id")).rows.map((r) => r.game_id);
    console.log(`Loading ${ids.length} completed games...`);
    const gamesSituations = [];
    let finalHomeWins = 0, totalRuns = 0;
    for (const gid of ids) {
      const rows = (await pool.query('SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number', [gid])).rows;
      const sits = model.extractSituations(rows);
      if (!sits.length) continue;
      gamesSituations.push(sits);
      const last = sits[sits.length - 1];
      totalRuns += last.home + last.away;
      if (last.home > last.away) finalHomeWins++;
    }
    const n = gamesSituations.length;
    console.log(`Extracted situations from ${n} games. avg total runs=${(totalRuns / n).toFixed(2)}, home win%=${((finalHomeWins / n) * 100).toFixed(1)}%`);

    const dist = model.buildDistributions(gamesSituations);
    const freshMean = dist[0][0].reduce((a, b) => a + b, 0) / dist[0][0].length;
    const sampleCounts = dist.map((o) => o.reduce((s, cell) => s + cell.length, 0));
    console.log(`Base/out samples by outs: 0→${sampleCounts[0]}, 1→${sampleCounts[1]}, 2→${sampleCounts[2]}; fresh-inning mean runs=${freshMean.toFixed(3)}`);

    console.log('Simulating win-probability grid...');
    const grid = model.buildGrid(dist, { maxInning, diffCap, sims });

    const table = {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: label,
      games: n,
      sims,
      maxInning,
      diffCap,
      avgTotalRuns: Math.round((totalRuns / n) * 100) / 100,
      homeWinPct: Math.round((finalHomeWins / n) * 1000) / 10,
      freshInningMeanRuns: Math.round(freshMean * 1000) / 1000,
      grid,
    };
    const outPath = path.join(__dirname, 'services', 'wpTable.json');
    fs.writeFileSync(outPath, JSON.stringify(table));
    const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`Wrote ${outPath} (${kb} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Sanity spot-checks
    const chk = (label, sit) => console.log(`  ${label}: home WP = ${(model.lookupWP(table, sit) * 100).toFixed(1)}%`);
    chk('Start (T1, 0-0, 0 out, empty)', { inning: 1, isTop: true, outs: 0, base: 0, home: 0, away: 0 });
    chk('B9, tied, 2 out, bases empty', { inning: 9, isTop: false, outs: 2, base: 0, home: 0, away: 0 });
    chk('B9, down 1, 2 out, bases loaded', { inning: 9, isTop: false, outs: 2, base: 7, home: 3, away: 4 });
    chk('T1, up 5, 0 out, empty', { inning: 1, isTop: true, outs: 0, base: 0, home: 5, away: 0 });
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
