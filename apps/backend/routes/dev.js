const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { io } = require('../server');
const { getAndProcessGameData } = require('../gameUtils');
const authenticateToken = require('../middleware/authenticateToken');

const isSuperuser = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.sendStatus(403);
  }
};

router.use(authenticateToken);
router.use(isSuperuser);

router.get('/games/:gameId/snapshots', async (req, res) => {
  const { gameId } = req.params;
  try {
    const snapshots = await pool.query(
      'SELECT snapshot_id, snapshot_name, created_at FROM game_snapshots WHERE game_id = $1 ORDER BY created_at DESC',
      [gameId]
    );
    res.json(snapshots.rows);
  } catch (error) {
    console.error(`Error fetching snapshots for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error while fetching snapshots.' });
  }
});

router.post('/games/:gameId/snapshots', async (req, res) => {
    const { gameId } = req.params;
    const { snapshot_name } = req.body;
    if (!snapshot_name) {
        return res.status(400).json({ message: 'Snapshot name is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const gameResult = await client.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ message: 'Game not found.' });
        }
        const game_data = gameResult.rows[0];

        const participantsResult = await client.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
        const participants_data = participantsResult.rows;

        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const latest_state_data = stateResult.rows[0];

        const eventsResult = await client.query('SELECT * FROM game_events WHERE game_id = $1', [gameId]);
        const events_data = eventsResult.rows;

        const rostersResult = await client.query('SELECT * FROM game_rosters WHERE game_id = $1', [gameId]);
        const rosters_data = rostersResult.rows;

        if (latest_state_data && typeof latest_state_data.state_data === 'string') {
            latest_state_data.state_data = JSON.parse(latest_state_data.state_data);
        }
        
        const newSnapshot = await client.query(
            `INSERT INTO game_snapshots (game_id, snapshot_name, game_data, participants_data, latest_state_data, events_data, rosters_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING snapshot_id, snapshot_name, created_at`,
            [
                gameId,
                snapshot_name,
                JSON.stringify(game_data),
                JSON.stringify(participants_data),
                JSON.stringify(latest_state_data || null),
                JSON.stringify(events_data),
                JSON.stringify(rosters_data)
            ]
        );

        await client.query('COMMIT');
        res.status(201).json(newSnapshot.rows[0]);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error creating snapshot for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error while creating snapshot.' });
    } finally {
        client.release();
    }
});

router.post('/games/:gameId/snapshots/:snapshotId/restore', async (req, res) => {
    const { gameId, snapshotId } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const snapshotResult = await client.query('SELECT * FROM game_snapshots WHERE snapshot_id = $1 AND game_id = $2', [snapshotId, gameId]);
        if (snapshotResult.rows.length === 0) {
            return res.status(404).json({ message: 'Snapshot not found.' });
        }
        const snapshot = snapshotResult.rows[0];

        await client.query('DELETE FROM game_events WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_states WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_rosters WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_participants WHERE game_id = $1', [gameId]);

        const gameData = snapshot.game_data;
        await client.query(
            `UPDATE games SET
                status = $1,
                completed_at = $2,
                current_turn_user_id = $3,
                home_team_user_id = $4,
                use_dh = $5,
                setup_rolls = $6
             WHERE game_id = $7`,
            [gameData.status, gameData.completed_at, gameData.current_turn_user_id, gameData.home_team_user_id, gameData.use_dh, gameData.setup_rolls, gameId]
        );

        const participantsData = snapshot.participants_data;
        for (const p of participantsData) {
            await client.query(
                `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation, lineup)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [p.game_id, p.user_id, p.roster_id, p.home_or_away, p.league_designation, JSON.stringify(p.lineup)]
            );
        }

        const rostersData = snapshot.rosters_data;
        for (const r of rostersData) {
            await client.query(
                'INSERT INTO game_rosters (game_id, user_id, roster_data) VALUES ($1, $2, $3)',
                [r.game_id, r.user_id, JSON.stringify(r.roster_data)]
            );
        }

        const state = snapshot.latest_state_data;
        if (state) {
            await client.query(
                'INSERT INTO game_states (game_id, turn_number, state_data, created_at) VALUES ($1, $2, $3, $4)',
                [state.game_id, state.turn_number, JSON.stringify(state.state_data), state.created_at]
            );
        }

        const eventsData = snapshot.events_data;
        for (const e of eventsData) {
            await client.query(
                `INSERT INTO game_events (game_id, turn_number, user_id, event_type, log_message, timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [e.game_id, e.turn_number, e.user_id, e.event_type, e.log_message, e.timestamp]
            );
        }

        await client.query('COMMIT');

        io.to(gameId).emit('game-updated', await getAndProcessGameData(gameId, client));

        res.status(200).json({ message: 'Game state restored successfully.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error restoring snapshot for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error while restoring snapshot.' });
    } finally {
        client.release();
    }
});

router.delete('/games/:gameId/snapshots/:snapshotId', async (req, res) => {
    const { snapshotId, gameId } = req.params;
    try {
        const deleteResult = await pool.query(
            'DELETE FROM game_snapshots WHERE snapshot_id = $1 AND game_id = $2',
            [snapshotId, gameId]
        );

        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ message: 'Snapshot not found.' });
        }

        res.status(200).json({ message: 'Snapshot deleted successfully.' });

    } catch (error) {
        console.error(`Error deleting snapshot ${snapshotId}:`, error);
        res.status(500).json({ message: 'Server error while deleting snapshot.' });
    }
});

router.post('/games/:gameId/set-state', async (req, res) => {
  const { gameId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    const newState = { ...currentState, ...req.body };

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, JSON.stringify(newState)]);
    await client.query('COMMIT');

    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);

    res.status(200).json({ message: 'Game state updated.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error setting game state:', error);
    res.status(500).json({ message: 'Server error while setting state.' });
  } finally {
    client.release();
  }
});


module.exports = router;
