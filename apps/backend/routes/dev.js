const express = require('express');
const router = express.Router();
const { pool, io } = require('../server');
const authenticateToken = require('../middleware/authenticateToken');

router.post('/games/:gameId/set-state', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const partialState = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        
        if (stateResult.rows.length === 0) {
            return res.status(404).json({ message: 'Game state not found.' });
        }

        const currentState = stateResult.rows[0].state_data;
        const currentTurn = stateResult.rows[0].turn_number;

        // Merge the partial state from the request into the current state
        const newState = { ...currentState };
        for (const key in partialState) {
            if (typeof partialState[key] === 'object' && partialState[key] !== null && !Array.isArray(partialState[key])) {
                newState[key] = { ...newState[key], ...partialState[key] };
            } else {
                newState[key] = partialState[key];
            }
        }

        if (partialState.current_turn_user_id) {
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [partialState.current_turn_user_id, gameId]);
        }

        await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
        
        await client.query('COMMIT');
        io.to(gameId).emit('game-updated');
        res.status(200).json({ message: 'Game state updated successfully.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error setting dev state:', error);
        res.status(500).json({ message: 'Server error while setting state.' });
    } finally {
        client.release();
    }
});

router.post('/games/:gameId/load-scenario', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { scenario } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        if (stateResult.rows.length === 0) {
            return res.status(404).json({ message: 'Game state not found.' });
        }
        const currentState = stateResult.rows[0].state_data;
        const currentTurn = stateResult.rows[0].turn_number;

        let newState = JSON.parse(JSON.stringify(currentState));

        // 1. Reset to a clean slate
        newState.inning = 1;
        newState.isTopInning = true;
        newState.awayScore = 0;
        newState.homeScore = 0;
        newState.outs = 0;
        newState.bases = { first: null, second: null, third: null };
        newState.lastCompletedAtBat = null;
        newState.awayTeam.battingOrderPosition = 0;
        newState.homeTeam.battingOrderPosition = 0;

        const gameInfo = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
        const homeUserId = gameInfo.rows[0].home_team_user_id;

        const participantsResult = await client.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
        const homeParticipant = participantsResult.rows.find(p => p.user_id === homeUserId);
        const awayParticipant = participantsResult.rows.find(p => p.user_id !== homeUserId);

        const homeRosterResult = await client.query('SELECT roster_data FROM game_rosters WHERE game_id = $1 and user_id = $2', [gameId, homeParticipant.user_id]);
        const awayRosterResult = await client.query('SELECT roster_data FROM game_rosters WHERE game_id = $1 and user_id = $2', [gameId, awayParticipant.user_id]);
        const homeRoster = homeRosterResult.rows[0].roster_data;
        const awayRoster = awayRosterResult.rows[0].roster_data;

        if (scenario === 'bases-loaded-no-outs') {
            const awayLineup = awayParticipant.lineup.battingOrder;

            const runnerOnThird = awayRoster.find(p => p.card_id === awayLineup[0].card_id);
            const runnerOnSecond = awayRoster.find(p => p.card_id === awayLineup[1].card_id);
            const runnerOnFirst = awayRoster.find(p => p.card_id === awayLineup[2].card_id);
            const batter = awayRoster.find(p => p.card_id === awayLineup[3].card_id);
            const pitcher = homeRoster.find(p => p.card_id === homeParticipant.lineup.startingPitcher);

            newState.bases = { first: runnerOnFirst, second: runnerOnSecond, third: runnerOnThird };
            newState.awayTeam.battingOrderPosition = 3;
            newState.currentAtBat = {
                batter: batter,
                pitcher: pitcher,
                pitcherAction: null,
                batterAction: null,
                pitchRollResult: null,
                swingRollResult: null,
                basesBeforePlay: { first: runnerOnFirst, second: runnerOnSecond, third: runnerOnThird },
                outsBeforePlay: 0
            };
        }

        await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
        await client.query('COMMIT');

        io.to(gameId).emit('game-updated');
        res.status(200).json({ message: `Scenario ${scenario} loaded successfully.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error loading scenario:', error);
        res.status(500).json({ message: 'Server error while loading scenario.' });
    } finally {
        client.release();
    }
});


module.exports = router;
