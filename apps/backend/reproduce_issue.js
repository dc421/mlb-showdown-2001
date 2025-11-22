
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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

        const gameRes = await client.query("INSERT INTO games (status, home_team_user_id) VALUES ('in_progress', $1) RETURNING game_id", [userId]);
        const gameId = gameRes.rows[0].game_id;
        console.log(`Created game ${gameId}`);

        // Create dummy participant and team
        const playersRes = await client.query("SELECT card_id, name, speed FROM cards_player LIMIT 10");
        const players = playersRes.rows;
        const batter = players[0];
        const runner1 = players[1];
        const runner2 = players[2];

        await client.query(
            "INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation) VALUES ($1, $2, $3, 'home', 'AL')",
            [gameId, userId, rosterId]
        );
        await client.query(
             "INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation) VALUES ($1, $2, $3, 'away', 'AL')",
             [gameId, userId + 1, rosterId] // Dummy away user
         );

        // Setup initial game state with runners on 2nd and 3rd, 1 out.
        const initialState = {
            inning: 1,
            isTopInning: true,
            outs: 1, // One out already recorded (simulating the fly out happened)
            awayScore: 0,
            homeScore: 0,
            bases: {
                first: null,
                second: runner1,
                third: runner2
            },
            currentAtBat: {
                batter: batter,
                basesBeforePlay: { first: null, second: runner1, third: runner2 },
                awayScoreBeforePlay: 0,
                homeScoreBeforePlay: 0,
                 swingRollResult: { outcome: 'FB', batter: batter }
            },
            currentPlay: {
                type: 'TAG_UP',
                payload: {
                    decisions: [], // To be filled
                    initialEvent: `${batter.name} flies out.`
                }
            },
            homeTeam: { userId: userId }, // Dummy
            awayTeam: { userId: userId + 1 } // Dummy
        };

        await client.query("INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, 1, $2)", [gameId, initialState]);

        // Simulate Submit Decisions logic from server.js
        // We are simulating: Runner on 2nd advances to 3rd. Runner on 3rd holds (or scores, but let's say holds for now to test tag up logic).
        // Wait, the example was: "Roger Cedeno flies out. Matt Lawton advances to 3rd. Edgar Renteria is SAFE at 2nd!"
        // This implies Lawton was on 2nd -> 3rd. Renteria was on 1st -> 2nd?
        // Or Lawton on 2nd, Renteria on 1st.
        // Fly out. Lawton tags 2nd->3rd. Renteria tags 1st->2nd.
        // Let's simulate Lawton on 2nd, Renteria on 1st.

        initialState.bases = { first: runner2, second: runner1, third: null };
        initialState.currentAtBat.basesBeforePlay = { first: runner2, second: runner1, third: null };

        const decisions = {
            [1]: true, // Runner on 1st (Renteria) goes
            [2]: true  // Runner on 2nd (Lawton) goes
        };

        // Logic from submit-decisions:
        const sentRunners = Object.keys(decisions).filter(key => decisions[key]);
        // sentRunners.length is 2.

        // If sentRunners > 1, it goes to resolve-throw eventually.
        // So let's simulate resolve-throw.

        const throwTo = 2; // Throw to 2nd to get Renteria

        // Logic from resolve-throw endpoint
        const newState = JSON.parse(JSON.stringify(initialState));
        const choices = decisions;
        const initialEvent = initialState.currentPlay.payload.initialEvent;

        // ... skipping DB reads for getActivePlayers ...

        const allEvents = [];
        const baseMap = { 1: 'first', 2: 'second', 3: 'third', 4: 'home' };
        const originalOuts = newState.outs; // 1

        // 1. Batter is out (already in initialEvent)

        // 2. Runners sent
        // Lawton (from 2) -> 3. Uncontested.
        // Renteria (from 1) -> 2. Contested.

        // Lawton advances
        const runnerLawton = runner1; // on 2nd
        const targetBaseLawton = 2 + 1; // 3
        allEvents.push(`${runnerLawton.name} advances to 3rd.`); // using literal for simplicity

        // Renteria contested at 2nd
        const runnerRenteria = runner2; // on 1st
        const isSafe = true; // Assume safe
        allEvents.push(`${runnerRenteria.name} is SAFE at 2nd!`);

        let combinedLogMessage = initialEvent ? `${initialEvent} ${allEvents.join(' ')}` : allEvents.join(' ');

        console.log(`Original Outs: ${originalOuts}`);
        console.log(`New State Outs: ${newState.outs}`);

        if (newState.outs > originalOuts) {
            combinedLogMessage += ` <strong>Outs: ${newState.outs}</strong>`;
        }

        console.log("Log Message:", combinedLogMessage);

        if (!combinedLogMessage.includes(`Outs: ${originalOuts}`) && newState.outs === originalOuts) {
             console.log("ISSUE REPRODUCED: Outs count missing when outs didn't increase.");
        }

        // Cleanup
        await client.query("DELETE FROM game_participants WHERE game_id = $1", [gameId]);
        await client.query("DELETE FROM game_states WHERE game_id = $1", [gameId]);
        await client.query("DELETE FROM games WHERE game_id = $1", [gameId]);

    } catch (e) {
        console.error(e);
    } finally {
        await client.release();
        await pool.end();
    }
}

runTest();
