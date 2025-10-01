const express = require('express');
const router = express.Router();
const { pool, io } = require('../server');
const authenticateToken = require('../middleware/authenticateToken');
const { applyOutcome } = require('../gameLogic');

// This helper is duplicated from server.js for use in this dev-only route
async function getActivePlayers(gameId, currentState, client) {
    try {
        const participantsResult = await client.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
        const game = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);

        const homeParticipant = participantsResult.rows.find(p => p.user_id === game.rows[0].home_team_user_id);
        const awayParticipant = participantsResult.rows.find(p => p.user_id !== game.rows[0].home_team_user_id);

        const offensiveParticipant = currentState.isTopInning ? awayParticipant : homeParticipant;
        const defensiveParticipant = currentState.isTopInning ? homeParticipant : awayParticipant;

        if (!offensiveParticipant?.lineup || !defensiveParticipant?.lineup) {
          return { batter: null, pitcher: null, offensiveTeam: {}, defensiveTeam: {} };
        }

        const offensiveTeamState = currentState.isTopInning ? currentState.awayTeam : currentState.homeTeam;

        const batterInfo = offensiveParticipant.lineup.battingOrder[offensiveTeamState.battingOrderPosition];
        const pitcherCardId = defensiveParticipant.lineup.startingPitcher;

        const batterQuery = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [batterInfo.card_id]);
        const pitcherQuery = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [pitcherCardId]);

        return {
            batter: batterQuery.rows[0],
            pitcher: pitcherQuery.rows[0],
            offensiveTeam: offensiveParticipant,
            defensiveTeam: defensiveParticipant,
        };
    } catch (error) {
        console.error('--- CRITICAL ERROR inside getActivePlayers (dev route) ---', error);
        throw error;
    }
}

router.post('/games/:gameId/apply-outcome', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { outcome } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);

        if (stateResult.rows.length === 0) {
            return res.status(404).json({ message: 'Game state not found.' });
        }

        const currentState = stateResult.rows[0].state_data;
        const currentTurn = stateResult.rows[0].turn_number;

        const { batter, pitcher, offensiveTeam } = await getActivePlayers(gameId, currentState, client);

        if (!batter || !pitcher) {
            return res.status(400).json({ message: 'Could not determine active batter or pitcher. Is the lineup set?' });
        }

        const { newState, events } = applyOutcome(currentState, outcome, batter, pitcher);
        newState.inningChanged = false; // Prevent complex event generation for this dev tool

        await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);

        if (events && events.length > 0) {
            const combinedLogMessage = `[DEV] ${events.join(' ')}`;
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, req.user.userId, currentTurn + 1, 'dev_event', combinedLogMessage]);
        }

        if (newState.gameOver) {
            await client.query(`UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1`, [gameId]);
        } else {
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);
        }

        await client.query('COMMIT');
        io.to(gameId).emit('game-updated');
        res.status(200).json({ message: 'Outcome applied successfully.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error applying dev outcome:', error);
        res.status(500).json({ message: 'Server error while applying outcome.' });
    } finally {
        client.release();
    }
});

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
        // A smarter merge that handles nested objects
        const newState = { ...currentState };
        for (const key in partialState) {
            if (typeof partialState[key] === 'object' && partialState[key] !== null && !Array.isArray(partialState[key])) {
                newState[key] = { ...newState[key], ...partialState[key] };
            } else {
                newState[key] = partialState[key];
            }
        }
        // Also update the main game table's turn info if provided
        if (partialState.current_turn_user_id) {
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [partialState.current_turn_user_id, gameId]);
        }

        await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
        
        await client.query('COMMIT');
        io.to(gameId).emit('game-updated'); // Notify clients of the change
        res.status(200).json({ message: 'Game state updated successfully.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error setting dev state:', error);
        res.status(500).json({ message: 'Server error while setting state.' });
    } finally {
        client.release();
    }
});

module.exports = router;
