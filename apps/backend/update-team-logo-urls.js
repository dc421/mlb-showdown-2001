const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const pool = new Pool(dbConfig);
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function updateTeamLogoUrls() {
    const client = await pool.connect();
    try {
        console.log('Updating team logo URLs...');
        const logosDir = path.join(__dirname, 'team_logos');
        const files = fs.readdirSync(logosDir);

        for (const file of files) {
            const teamId = parseInt(path.parse(file).name, 10);
            if (isNaN(teamId)) {
                console.log(`Skipping file with non-numeric name: ${file}`);
                continue;
            }

            const newLogoUrl = `${BACKEND_URL}/team_logos/${file}`;
            await client.query(
                'UPDATE teams SET logo_url = $1 WHERE team_id = $2',
                [newLogoUrl, teamId]
            );
            console.log(`Updated logo_url for team ${teamId} to ${newLogoUrl}`);
        }

        console.log('All team logo URLs have been updated successfully!');
    } catch (err) {
        console.error('Error updating team logo URLs:', err);
    } finally {
        await client.release();
        await pool.end();
    }
}

updateTeamLogoUrls();
