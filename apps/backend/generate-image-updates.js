// generate-image-updates.js
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

// Set up the database connection pool using your local .env variables
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function generateUpdateScript() {
  console.log('Connecting to local database to read image URLs...');
  const client = await pool.connect();
  
  try {
    // 1. Get all player cards from the local database
    const res = await client.query('SELECT card_id, image_url FROM cards_player');
    const players = res.rows;
    console.log(`Found ${players.length} player cards.`);

    const updateStatements = [];

    // 2. Loop through each player and create an UPDATE statement
    for (const player of players) {
      // Only create statements for players that have an image URL
      if (player.image_url) {
        // Escape any single quotes in the URL to prevent SQL errors
        const escapedUrl = player.image_url.replace(/'/g, "''");
        const statement = `UPDATE public.cards_player SET image_url = '${escapedUrl}' WHERE card_id = ${player.card_id};`;
        updateStatements.push(statement);
      }
    }

    // 3. Write all the generated statements to a .sql file
    const fileContent = updateStatements.join('\n');
    fs.writeFileSync('image_updates.sql', fileContent);

    console.log(`✅ Success! Generated ${updateStatements.length} update statements in 'image_updates.sql'.`);

  } catch (error) {
    console.error('❌ An error occurred:', error);
  } finally {
    // 4. Close the connection to the local database
    await client.release();
    await pool.end();
  }
}

generateUpdateScript();