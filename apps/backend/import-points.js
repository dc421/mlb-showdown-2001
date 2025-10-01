require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');

// Check for command-line argument for the point set name
const pointSetName = process.argv[2];
if (!pointSetName) {
  console.error('Usage: npm run import:points -- <point_set_name>');
  console.error('Example: npm run import:points -- season1');
  process.exit(1);
}

const dbConfig = {
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
};

const pool = new Pool(dbConfig);

async function importPoints() {
  console.log(`Starting points import process for set: "${pointSetName}"...`);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log(`Creating point set: ${pointSetName}`);
    await client.query("INSERT INTO point_sets (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [pointSetName]);
    const { rows: [{ point_set_id }] } = await client.query("SELECT point_set_id FROM point_sets WHERE name = $1", [pointSetName]);

    const records = [];
    const csvPath = path.join(__dirname, 'prices.csv');

    await new Promise((resolve, reject) => {
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row) => records.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    let notFoundCount = 0;
    for (const row of records) {
      const playerName = row['Team Player'];
      const team = row['Tm'];
      const points = row['Upcoming Season'];

      if (!playerName || !team || !points) {
        console.warn('Skipping row with missing data:', row);
        continue;
      }

      const simpleDisplayName = `${playerName} (${team})`;
      const res = await client.query("SELECT card_id FROM cards_player WHERE display_name = $1", [simpleDisplayName]);

      if (res.rows.length === 1) {
        // Happy path: unique player found with simple name
        const card_id = res.rows[0].card_id;
        await client.query(
          `INSERT INTO player_point_values (card_id, point_set_id, points) VALUES ($1, $2, $3)
           ON CONFLICT (card_id, point_set_id) DO UPDATE SET points = $3`,
          [card_id, point_set_id, points]
        );
      } else {
        // If no simple match, check for ambiguous players to provide a better error message
        const potentialMatches = await client.query(
          "SELECT display_name FROM cards_player WHERE name = $1 AND team = $2",
          [playerName, team]
        );

        if (potentialMatches.rows.length > 0) {
          const displayNames = potentialMatches.rows.map(r => `"${r.display_name}"`).join(', ');
          console.warn(`Ambiguous player: "${simpleDisplayName}". Found possible matches: [${displayNames}]. Please specify the exact card in the source file.`);
        } else {
          console.warn(`Player not found: "${simpleDisplayName}"`);
        }
        notFoundCount++;
      }
    }

    if (notFoundCount > 0) {
      console.warn(`Warning: ${notFoundCount} players from the CSV were not found or were ambiguous.`);
    }

    await client.query('COMMIT');
    console.log('✅ Points import complete!');

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Points import failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

importPoints();