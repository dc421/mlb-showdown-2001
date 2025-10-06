require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');

const dbConfig = {
  // jatuh: I updated this to use DATABASE_URL to be consistent with other scripts.
  connectionString: process.env.DATABASE_URL,
};

const pool = new Pool(dbConfig);

// These are the columns in prices.csv that are NOT point sets
const NON_POINT_SET_COLUMNS = ['Team', 'Player', 'Tm', 'Pos', 'ASG'];

async function importAllPoints() {
  console.log('Starting full points import process...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('Database transaction started.');

    // 1. Clear the player_point_values table
    console.log('Clearing existing data from player_point_values table...');
    await client.query('TRUNCATE TABLE player_point_values RESTART IDENTITY');
    console.log('Table cleared.');

    const records = [];
    const csvPath = path.join(__dirname, 'prices.csv');
    const pointSetNames = new Set();

    // 2. Read the CSV and identify all unique point sets from the headers
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('headers', (headers) => {
          headers.forEach(header => {
            if (!NON_POINT_SET_COLUMNS.includes(header)) {
              pointSetNames.add(header);
            }
          });
        })
        .on('data', (row) => records.push(row))
        .on('end', resolve)
        .on('error', reject);
    });
    console.log(`Found ${records.length} records in prices.csv.`);
    console.log(`Identified ${pointSetNames.size} unique point sets.`);

    // 3. Ensure all point sets exist in the database and get their IDs
    const pointSetMap = new Map();
    console.log('Syncing point sets with the database...');
    for (const name of pointSetNames) {
      // Use INSERT ... ON CONFLICT to avoid a separate SELECT check
      const res = await client.query(
        `INSERT INTO point_sets (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING point_set_id`,
        [name]
      );
      pointSetMap.set(name, res.rows[0].point_set_id);
    }
    console.log('Point sets synced.');

    // 4. Iterate through players and insert their point values
    let notFoundCount = 0;
    console.log('Importing player point values...');
    for (const row of records) {
      const playerName = row['Player'];
      if (!playerName) {
        console.warn('Skipping row with missing player name:', row);
        continue;
      }

      // Find player card_id based on display_name
      const playerRes = await client.query("SELECT card_id FROM cards_player WHERE display_name = $1", [playerName]);

      if (playerRes.rows.length === 0) {
        console.warn(`Player not found in database: "${playerName}". Skipping.`);
        notFoundCount++;
        continue;
      }
      const cardId = playerRes.rows[0].card_id;

      // Insert a point value for each point set column
      for (const pointSetName of pointSetNames) {
        const points = row[pointSetName];
        if (points !== undefined && points !== null && points !== '') {
          const pointSetId = pointSetMap.get(pointSetName);
          const pointValue = parseInt(points, 10);

          if (!isNaN(pointValue)) {
            await client.query(
              `INSERT INTO player_point_values (card_id, point_set_id, points)
               VALUES ($1, $2, $3)`,
              [cardId, pointSetId, pointValue]
            );
          }
        }
      }
    }

    if (notFoundCount > 0) {
      console.warn(`Warning: ${notFoundCount} players from the CSV were not found in the database.`);
    }

    await client.query('COMMIT');
    console.log('✅ Full points import complete! Transaction committed.');

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Full points import failed. Transaction rolled back.', e);
  } finally {
    client.release();
    await pool.end();
    console.log('Process finished.');
  }
}

importAllPoints();