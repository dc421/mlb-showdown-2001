const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const pool = new Pool(dbConfig);

async function populateImageUrls() {
    const client = await pool.connect();
    try {
        console.log('Fetching all players...');
        const res = await client.query('SELECT card_id FROM cards_player');
        const players = res.rows;
        console.log(`Found ${players.length} players to update.`);

        for (const player of players) {
            const imageUrl = `/images/${player.card_id}.jpg`;
            await client.query(
                'UPDATE cards_player SET image_url = $1 WHERE card_id = $2',
                [imageUrl, player.card_id]
            );
            console.log(`Updated player ${player.card_id} with URL: ${imageUrl}`);
        }

        console.log('All player image URLs have been updated successfully!');
    } catch (err) {
        console.error('Error populating image URLs:', err);
    } finally {
        await client.release();
        await pool.end();
    }
}

populateImageUrls();