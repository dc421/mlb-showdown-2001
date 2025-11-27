
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const pool = new Pool(dbConfig);

async function runTest() {
    const client = await pool.connect();
    try {
        console.log("Starting reproduction test...");

        // 1. Create a dummy game
        // We'll insert directly for speed, mimicking what creates a game
        const userResult = await client.query("SELECT user_id, team_id FROM users LIMIT 1");
        if (userResult.rows.length === 0) {
            console.log("No users found. Cannot run test.");
            return;
        }
        const userId = userResult.rows[0].user_id;
        const teamId = userResult.rows[0].team_id;

        const rosterResult = await client.query("SELECT roster_id FROM rosters WHERE user_id = $1 LIMIT 1", [userId]);
        let rosterId;
        if(rosterResult.rows.length > 0) {
            rosterId = rosterResult.rows[0].roster_id;
        } else {
            console.log("No roster found. Cannot run test.");
            return;
        }

        // Create game
        const gameRes = await client.query("INSERT INTO games (status, home_team_user_id) VALUES ('lineups', $1) RETURNING game_id", [userId]);
        const gameId = gameRes.rows[0].game_id;
        console.log(`Created game ${gameId}`);

        // Create game_participants entry
        // We need a dummy lineup. Let's get some players.
        const playersRes = await client.query("SELECT card_id, name, control FROM cards_player LIMIT 15");
        const players = playersRes.rows;
        const pitcher = players.find(p => p.control !== null);
        const reliever = players.find(p => p.control !== null && p.card_id !== pitcher.card_id);
        const batters = players.filter(p => p.control === null).slice(0, 9);

        if (!pitcher || !reliever || batters.length < 9) {
             console.log("Not enough players to form a lineup.");
             return;
        }

        const lineup = {
            battingOrder: batters.map((p, i) => ({ card_id: p.card_id, position: 'DH' })), // Simplified positions
            startingPitcher: pitcher.card_id
        };

        await client.query(
            "INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation, lineup) VALUES ($1, $2, $3, 'home', 'AL', $4)",
            [gameId, userId, rosterId, JSON.stringify(lineup)]
        );

        console.log(`Initial Starting Pitcher: ${pitcher.card_id} (${pitcher.name})`);

        // Check DB before sub
        let res = await client.query("SELECT lineup FROM game_participants WHERE game_id = $1 AND user_id = $2", [gameId, userId]);
        let dbSP = res.rows[0].lineup.startingPitcher;
        console.log(`DB value before sub: ${dbSP}`);

        // 2. Perform Substitution Logic (Simulating what happens in /substitute)
        // Code from server.js:
        // if (participant.lineup.startingPitcher === playerOutId) {
        //    participant.lineup.startingPitcher = playerInCard.card_id;
        // }

        // Simulate:
        const participant = res.rows[0];
        const playerOutId = pitcher.card_id;
        const playerInCard = reliever;

        console.log(`Subulating ${playerOutId} with ${playerInCard.card_id} (${playerInCard.name})`);

        if (participant.lineup.startingPitcher === playerOutId) {
            participant.lineup.startingPitcher = playerInCard.card_id;
            console.log("Logic executed: startingPitcher updated.");
        }

        // Write back to DB (Simulating the update)
        await client.query("UPDATE game_participants SET lineup = $1::jsonb WHERE game_id = $2 AND user_id = $3", [JSON.stringify(participant.lineup), gameId, userId]);

        // 3. Verify the issue
        res = await client.query("SELECT lineup FROM game_participants WHERE game_id = $1 AND user_id = $2", [gameId, userId]);
        dbSP = res.rows[0].lineup.startingPitcher;
        console.log(`DB value after sub: ${dbSP}`);

        if (dbSP === reliever.card_id) {
            console.log("ISSUE REPRODUCED: startingPitcher was updated to the reliever.");
        } else {
            console.log("Issue NOT reproduced (or fixed).");
        }

        // Cleanup
        await client.query("DELETE FROM game_participants WHERE game_id = $1", [gameId]);
        await client.query("DELETE FROM games WHERE game_id = $1", [gameId]);

    } catch (e) {
        console.error(e);
    } finally {
        await client.release();
        await pool.end();
    }
}

runTest();
