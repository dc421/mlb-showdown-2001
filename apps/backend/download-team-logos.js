const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const pool = new Pool(dbConfig);

async function downloadTeamLogos() {
    const client = await pool.connect();
    try {
        console.log('Fetching all teams...');
        const res = await client.query('SELECT team_id, logo_url FROM teams');
        const teams = res.rows;
        console.log(`Found ${teams.length} teams to process.`);

        const logosDir = path.join(__dirname, 'team_logos');
        if (!fs.existsSync(logosDir)) {
            fs.mkdirSync(logosDir);
        }

        for (const team of teams) {
            if (!team.logo_url) {
                console.log(`Skipping team ${team.team_id} due to missing logo_url.`);
                continue;
            }

            try {
                const response = await fetch(team.logo_url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${team.logo_url}: ${response.statusText}`);
                }
                const buffer = await response.buffer();
                const fileExtension = path.extname(new URL(team.logo_url).pathname) || '.png';
                const filename = `${team.team_id}${fileExtension}`;
                const filepath = path.join(logosDir, filename);
                fs.writeFileSync(filepath, buffer);
                console.log(`Successfully downloaded and saved logo for team ${team.team_id} to ${filename}`);
            } catch (error) {
                console.error(`Error processing team ${team.team_id}: ${error.message}`);
            }
        }

        console.log('All team logos have been processed.');
    } catch (err) {
        console.error('Error downloading team logos:', err);
    } finally {
        await client.release();
        await pool.end();
    }
}

downloadTeamLogos();
