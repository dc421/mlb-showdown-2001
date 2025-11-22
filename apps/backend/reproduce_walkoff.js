const { pool } = require('./server'); // Import pool from server.js
const { applyOutcome } = require('./gameLogic');

async function reproduceWalkoff() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Create a dummy game
        const gameRes = await client.query(`INSERT INTO games (status, home_team_user_id, away_team_user_id) VALUES ('in_progress', 1, 2) RETURNING game_id`);
        const gameId = gameRes.rows[0].game_id;
        console.log(`Created game ${gameId}`);

        // 2. Create a dummy state: Bottom 9th, 2 outs, Tie game (5-5)
        // We need a valid state structure
        const initialState = {
            inning: 9,
            isTopInning: false,
            outs: 2,
            awayScore: 5,
            homeScore: 5,
            bases: { first: null, second: null, third: null },
            pitcherStats: {},
            homeTeam: { userId: 1, battingOrderPosition: 0 },
            awayTeam: { userId: 2, battingOrderPosition: 0 },
            currentAtBat: {
                batter: { name: 'Hero', card_id: 100, displayName: 'Hero' },
                pitcher: { name: 'Villain', card_id: 200, displayName: 'Villain', control: 10 },
                batterAction: null,
                pitcherAction: 'pitch', // Pitcher has already pitched
                pitchRollResult: { roll: 10, advantage: 'batter' }, // Batter has advantage
                outsBeforePlay: 2,
                homeScoreBeforePlay: 5,
                awayScoreBeforePlay: 5,
                basesBeforePlay: { first: null, second: null, third: null }
            },
            homeDefensiveRatings: { infieldDefense: 0, outfieldDefense: 0 },
            awayDefensiveRatings: { infieldDefense: 0, outfieldDefense: 0 },
            gameOver: false,
            winningTeam: null
        };

        await client.query(`INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, 1, $2)`, [gameId, initialState]);
        console.log('Initial state inserted.');

        // 3. Simulate /set-action swing -> HR
        // We will mimic the logic in the route handler
        let currentState = initialState;
        let finalState = JSON.parse(JSON.stringify(currentState));

        finalState.currentAtBat.batterAction = 'swing';

        // Assume roll results in HR
        // Mocking the outcome derivation
        const swingRoll = 20; // HR
        const outcome = 'HR';

        // Apply outcome
        const teamInfo = { home_team_abbr: 'HOME', away_team_abbr: 'AWAY' };
        const getSpeedValue = () => 15;

        const { newState, events } = applyOutcome(finalState, outcome, finalState.currentAtBat.batter, finalState.currentAtBat.pitcher, 0, 0, getSpeedValue, swingRoll, null, teamInfo);

        finalState = newState;
        finalState.currentAtBat.swingRollResult = { roll: swingRoll, outcome: 'HR', batter: finalState.currentAtBat.batter, eventCount: events.length };

        console.log('--- After ApplyOutcome ---');
        console.log('GameOver:', finalState.gameOver);
        console.log('WinningTeam:', finalState.winningTeam);
        console.log('HomeScore:', finalState.homeScore);
        console.log('Events:', events);

        // 4. Simulate DB Update
        if (finalState.gameOver) {
             await client.query(
              `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1`,
              [gameId]
            );
            console.log('Game marked completed.');
        }

        await client.query(`INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, 2, $2)`, [gameId, finalState]);
        console.log('Final state inserted.');

        // 5. Check what is fetched
        const fetchRes = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const fetchedState = fetchRes.rows[0].state_data;

        console.log('--- Fetched State ---');
        console.log('Batter Action:', fetchedState.currentAtBat.batterAction);
        console.log('GameOver:', fetchedState.gameOver);

        await client.query('ROLLBACK'); // Clean up
    } catch (e) {
        console.error(e);
        await client.query('ROLLBACK');
    } finally {
        client.release();
        pool.end(); // Close pool
    }
}

reproduceWalkoff();
