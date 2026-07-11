const express = require('express');
const router = express.Router();
const { pool, io } = require('../server'); // Import io
const authenticateToken = require('../middleware/authenticateToken');
const { verifyConnection } = require('../services/emailService');
const { applyPhantomLosses, sendPhantomWarnings } = require('../jobs/phantomMonitor');

// Middleware to check if the user is a superuser (optional, for dev routes)
const isSuperuser = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.sendStatus(403); // Forbidden
  }
};

router.use(authenticateToken);
router.use(isSuperuser);

// POST to trigger email connection test
router.post('/test-email', async (req, res) => {
    try {
        console.log("--- Manual Email Connection Test Triggered ---");
        await verifyConnection();
        res.status(200).json({ message: "Email connection test initiated. Check server logs for results." });
    } catch (error) {
        console.error("Error triggering email test:", error);
        res.status(500).json({ message: "Error triggering email test." });
    }
});

// POST to manually exercise the phantom-loss logic.
// Body: { asOf?: ISO date string, dryRun?: bool (default true), mode?: 'apply'|'warn'|'both' (default 'both') }
// dryRun=true computes assignments/at-risk teams WITHOUT inserting rows or sending email.
router.post('/phantom-check', async (req, res) => {
    try {
        const { asOf, mode = 'both', force } = req.body || {};
        const dryRun = req.body && req.body.dryRun === false ? false : true; // default true (safe)
        const when = asOf ? new Date(asOf) : new Date();
        if (isNaN(when.getTime())) {
            return res.status(400).json({ message: 'Invalid asOf date.' });
        }

        const result = {};
        if (mode === 'apply' || mode === 'both') {
            result.apply = await applyPhantomLosses(pool, when, { dryRun });
        }
        if (mode === 'warn' || mode === 'both') {
            // In dry-run previews, force computation so at-risk teams show even when
            // today isn't exactly the warning day.
            result.warn = await sendPhantomWarnings(pool, when, { dryRun, force: force ?? dryRun });
        }

        res.json({ asOf: when.toISOString(), dryRun, ...result });
    } catch (error) {
        console.error('Error in /phantom-check:', error);
        res.status(500).json({ message: 'Error running phantom check.', error: error.message });
    }
});

// GET all snapshots for a game
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

// POST (create) a new snapshot for a game
router.post('/games/:gameId/snapshots', async (req, res) => {
    const { gameId } = req.params;
    const { snapshot_name } = req.body;
    if (!snapshot_name) {
        return res.status(400).json({ message: 'Snapshot name is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get game data
        const gameResult = await client.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ message: 'Game not found.' });
        }
        const game_data = gameResult.rows[0];

        // 2. Get participants data
        const participantsResult = await client.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
        const participants_data = participantsResult.rows;

        // 3. Get latest game state data
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const latest_state_data = stateResult.rows[0];

        // 4. Get all game events data
        const eventsResult = await client.query('SELECT * FROM game_events WHERE game_id = $1', [gameId]);
        const events_data = eventsResult.rows;

        // 5. Get game rosters data
        const rostersResult = await client.query('SELECT * FROM game_rosters WHERE game_id = $1', [gameId]);
        const rosters_data = rostersResult.rows;

        // Ensure nested JSON is parsed, not double-stringified
        if (latest_state_data && typeof latest_state_data.state_data === 'string') {
            latest_state_data.state_data = JSON.parse(latest_state_data.state_data);
        }
        
        // 6. Insert into snapshots table
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

// POST to restore a snapshot
router.post('/games/:gameId/snapshots/:snapshotId/restore', async (req, res) => {
    const { gameId, snapshotId } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Get the snapshot data
        const snapshotResult = await client.query('SELECT * FROM game_snapshots WHERE snapshot_id = $1 AND game_id = $2', [snapshotId, gameId]);
        if (snapshotResult.rows.length === 0) {
            return res.status(404).json({ message: 'Snapshot not found.' });
        }
        const snapshot = snapshotResult.rows[0];

        // 2. Clear existing game data
        await client.query('DELETE FROM game_events WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_states WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_rosters WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_participants WHERE game_id = $1', [gameId]);

        // 3. Restore game table data (update existing record)
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

        // 4. Restore participants
        const participantsData = snapshot.participants_data;
        for (const p of participantsData) {
            await client.query(
                `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation, lineup)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [p.game_id, p.user_id, p.roster_id, p.home_or_away, p.league_designation, JSON.stringify(p.lineup)]
            );
        }

        // 5. Restore rosters
        const rostersData = snapshot.rosters_data;
        for (const r of rostersData) {
            await client.query(
                'INSERT INTO game_rosters (game_id, user_id, roster_data) VALUES ($1, $2, $3)',
                [r.game_id, r.user_id, JSON.stringify(r.roster_data)]
            );
        }

        // 6. Restore game state (only the latest one)
        const state = snapshot.latest_state_data;
        if (state) {
            await client.query(
                'INSERT INTO game_states (game_id, turn_number, state_data, created_at) VALUES ($1, $2, $3, $4)',
                [state.game_id, state.turn_number, JSON.stringify(state.state_data), state.created_at]
            );
        }

        // 7. Restore game events
        const eventsData = snapshot.events_data;
        for (const e of eventsData) {
            await client.query(
                `INSERT INTO game_events (game_id, turn_number, user_id, event_type, log_message, timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [e.game_id, e.turn_number, e.user_id, e.event_type, e.log_message, e.timestamp]
            );
        }

        await client.query('COMMIT');

        // Emit a socket event to notify clients
        io.to(gameId).emit('game-updated', await require('../server').getAndProcessGameData(gameId, client));

        res.status(200).json({ message: 'Game state restored successfully.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error restoring snapshot for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error while restoring snapshot.' });
    } finally {
        client.release();
    }
});

// DELETE a snapshot
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


// POST to set the game state (for debugging)
router.post('/games/:gameId/set-state', async (req, res) => {
  const { gameId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    // Merge the request body into the current state
    const newState = { ...currentState, ...req.body };

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, JSON.stringify(newState)]);
    await client.query('COMMIT');

    // After successfully setting the state, fetch the full processed game data
    const gameData = await require('../server').getAndProcessGameData(gameId, client);
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

// DELETE a series game and re-create it with correct home/away assignments.
// This is useful when a game was created with the wrong home team due to the
// series_home_user_id bug (where the creator was assumed to be the Game 1 home team).
router.post('/games/:gameId/recreate', async (req, res) => {
    const { gameId } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Get info about the game we're deleting
        const gameResult = await client.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
        if (gameResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Game not found.' });
        }
        const game = gameResult.rows[0];

        if (!game.series_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'This game is not part of a series.' });
        }

        const gameInSeries = game.game_in_series;

        // 2. Get the previous game in the series (to re-derive correct home/away)
        const prevGameResult = await client.query(
            'SELECT * FROM games WHERE series_id = $1 AND game_in_series = $2',
            [game.series_id, gameInSeries - 1]
        );
        if (prevGameResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Cannot find the previous game in the series to derive home/away.' });
        }
        const prevGame = prevGameResult.rows[0];

        // 3. Get series info
        const seriesResult = await client.query('SELECT * FROM series WHERE id = $1', [game.series_id]);
        const series = seriesResult.rows[0];

        // 4. Fix series_home_user_id if it doesn't match Game 1's actual home team
        const game1Result = await client.query(
            'SELECT home_team_user_id, use_dh FROM games WHERE series_id = $1 AND game_in_series = 1',
            [game.series_id]
        );
        const game1 = game1Result.rows[0];
        let seriesHomeUserId = series.series_home_user_id;
        let seriesAwayUserId = series.series_away_user_id;

        if (game1.home_team_user_id && seriesHomeUserId !== game1.home_team_user_id) {
            console.log(`[recreate] Fixing series_home_user_id: ${seriesHomeUserId} -> ${game1.home_team_user_id}`);
            await client.query('UPDATE series SET series_home_user_id = $1 WHERE id = $2', [game1.home_team_user_id, game.series_id]);
            seriesHomeUserId = game1.home_team_user_id;
            // Also fix series_away_user_id
            const prevParticipants = await client.query('SELECT user_id FROM game_participants WHERE game_id = $1', [prevGame.game_id]);
            const awayUser = prevParticipants.rows.find(p => p.user_id !== game1.home_team_user_id);
            if (awayUser) {
                await client.query('UPDATE series SET series_away_user_id = $1 WHERE id = $2', [awayUser.user_id, game.series_id]);
                seriesAwayUserId = awayUser.user_id;
            }
        }

        // 5. Determine correct home/away for the new game
        const nextHomeUserId = [3, 4, 5].includes(gameInSeries) ? seriesAwayUserId : seriesHomeUserId;
        const nextAwayUserId = nextHomeUserId === seriesHomeUserId ? seriesAwayUserId : seriesHomeUserId;

        // 6. Get DH and status settings
        let useDh = prevGame.use_dh;
        let nextStatus = 'lineups';
        if (gameInSeries === 3) {
            nextStatus = 'pending';
        } else if (gameInSeries === 6) {
            useDh = game1.use_dh;
        }

        // 7. Get participant info from previous game (for roster_id and league_designation)
        const prevParticipantsResult = await client.query(
            'SELECT user_id, roster_id, league_designation FROM game_participants WHERE game_id = $1',
            [prevGame.game_id]
        );

        const homePlayerInfo = prevParticipantsResult.rows.find(p => p.user_id === nextHomeUserId);
        const awayPlayerInfo = prevParticipantsResult.rows.find(p => p.user_id === nextAwayUserId);

        if (!homePlayerInfo || !awayPlayerInfo) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Could not find participant info for both players.' });
        }

        // 8. Delete the old game (cascading deletes handle states, events, participants, rosters, snapshots)
        await client.query('DELETE FROM game_snapshots WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_events WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_states WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_rosters WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM game_participants WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM games WHERE game_id = $1', [gameId]);

        // 9. Create the new game with correct home/away
        const newGameResult = await client.query(
            `INSERT INTO games (status, series_id, game_in_series, home_team_user_id, use_dh)
             VALUES ($1, $2, $3, $4, $5) RETURNING game_id`,
            [nextStatus, game.series_id, gameInSeries, nextHomeUserId, useDh]
        );
        const newGameId = newGameResult.rows[0].game_id;

        await client.query(
            `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation)
             VALUES ($1, $2, $3, 'home', $4)`,
            [newGameId, nextHomeUserId, homePlayerInfo.roster_id, homePlayerInfo.league_designation]
        );
        await client.query(
            `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation)
             VALUES ($1, $2, $3, 'away', $4)`,
            [newGameId, nextAwayUserId, awayPlayerInfo.roster_id, awayPlayerInfo.league_designation]
        );

        await client.query('COMMIT');

        console.log(`[recreate] Deleted game ${gameId}, created new game ${newGameId} for series ${game.series_id} game #${gameInSeries}`);
        console.log(`[recreate] Home: user ${nextHomeUserId}, Away: user ${nextAwayUserId}`);

        io.emit('games-updated');

        res.status(200).json({
            message: `Game ${gameId} deleted and replaced with game ${newGameId}.`,
            oldGameId: parseInt(gameId),
            newGameId: newGameId,
            homeUserId: nextHomeUserId,
            awayUserId: nextAwayUserId
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error recreating game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error while recreating game.' });
    } finally {
        client.release();
    }
});

// DEV SERIES/GAMES INSPECTOR
// Read-only master overview of every series (with its games) and every orphan game, annotated with
// how each ties (or fails to tie) to a league season / Classic. Powers the /dev/series page so the
// whole series+games state can be eyeballed and spot-checked in the UI.
router.get('/series-overview', async (req, res) => {
    try {
        const seriesRes = await pool.query(`
            SELECT s.id, s.series_type, s.status, s.classic_id, s.series_result_id,
                   s.series_home_user_id, s.series_away_user_id, s.home_wins, s.away_wins, s.created_at,
                   ht.city AS home_city, ht.name AS home_name, ht.team_id AS home_team_id,
                   at.city AS away_city, at.name AS away_name, at.team_id AS away_team_id,
                   sr.season_name, sr.round, sr.style AS sr_style, sr.status AS sr_status,
                   sr.result_source, sr.winning_team_name AS sr_winner, sr.losing_team_name AS sr_loser,
                   sr.winning_score AS sr_wscore, sr.losing_score AS sr_lscore,
                   c.name AS classic_name
            FROM series s
            LEFT JOIN teams ht ON ht.user_id = s.series_home_user_id
            LEFT JOIN teams at ON at.user_id = s.series_away_user_id
            LEFT JOIN series_results sr ON sr.id = s.series_result_id
            LEFT JOIN classics c ON c.id = s.classic_id
            ORDER BY s.id
        `);

        const gamesRes = await pool.query(`
            SELECT g.game_id, g.series_id, g.game_in_series, g.status,
                   g.home_team_user_id, g.completed_at, g.created_at,
                   COALESCE(e.cnt, 0) AS events,
                   (SELECT gs.state_data->>'winningTeam' FROM game_states gs
                     WHERE gs.game_id = g.game_id ORDER BY gs.turn_number DESC LIMIT 1) AS winning_side
            FROM games g
            LEFT JOIN (SELECT game_id, count(*) AS cnt FROM game_events GROUP BY game_id) e
                   ON e.game_id = g.game_id
            ORDER BY g.series_id NULLS LAST, g.game_in_series NULLS LAST, g.game_id
        `);

        // Who actually played each game — the truth even when series_home/away_user_id is unset (as
        // on abandoned/stray series). Lets the UI show a real matchup instead of "TBD".
        const partsRes = await pool.query(`
            SELECT p.game_id, t.city, t.name
            FROM game_participants p
            JOIN teams t ON t.user_id = p.user_id
        `);
        const teamsByGame = {};
        for (const r of partsRes.rows) {
            const label = `${r.city || ''} ${r.name || ''}`.trim();
            if (label) (teamsByGame[r.game_id] ||= new Set()).add(label);
        }

        // Bucket games under their series; series_id = null are orphan (no-series) games.
        const gamesBySeries = {};
        const orphanGames = [];
        for (const g of gamesRes.rows) {
            const game = {
                game_id: g.game_id, game_in_series: g.game_in_series, status: g.status,
                events: Number(g.events), winning_side: g.winning_side,
                completed_at: g.completed_at, created_at: g.created_at,
                teams: [...(teamsByGame[g.game_id] || [])],
            };
            if (g.series_id == null) orphanGames.push(game);
            else (gamesBySeries[g.series_id] ||= []).push(game);
        }

        const teamLabel = (city, name) => (city || name) ? `${city || ''} ${name || ''}`.trim() : null;

        const series = seriesRes.rows.map(s => {
            const games = gamesBySeries[s.id] || [];
            const gamesCompleted = games.filter(g => g.status === 'completed').length;
            const gamesNonFinal = games.length - gamesCompleted;
            const eventsTotal = games.reduce((n, g) => n + g.events, 0);
            const linked = s.series_result_id != null;
            const seriesDone = s.status === 'completed' || s.sr_status === 'completed';

            // How this series ties to the wider record.
            let category;
            if (s.classic_id != null && games.length === 0) category = 'classic_shadow'; // bracket placeholder
            else if (s.series_type === 'classic' && linked) category = 'classic_played';
            else if (linked) category = 'league';           // regular-season / playoff off the schedule
            else if (s.classic_id != null) category = 'classic_other';
            else category = 'stray';                          // tied to no season and no Classic

            // Actual participants across all this series' games (the reliable matchup).
            const participantTeams = [...new Set(games.flatMap(g => g.teams))];

            return {
                ...s,
                home_team: teamLabel(s.home_city, s.home_name),
                away_team: teamLabel(s.away_city, s.away_name),
                participant_teams: participantTeams,
                games,
                games_total: games.length,
                games_completed: gamesCompleted,
                games_nonfinal: gamesNonFinal,
                events_total: eventsTotal,
                category,
                flags: {
                    stray: !linked && s.classic_id == null,
                    played: eventsTotal > 0,
                    empty_shell: games.length > 0 && eventsTotal === 0,
                    phantom_trailing: seriesDone && gamesNonFinal > 0,
                },
            };
        });

        const summary = {
            series_count: series.length,
            orphan_game_count: orphanGames.length,
            by_category: series.reduce((acc, s) => { acc[s.category] = (acc[s.category] || 0) + 1; return acc; }, {}),
            stray_count: series.filter(s => s.flags.stray).length,
            phantom_trailing_count: series.filter(s => s.flags.phantom_trailing).length,
        };

        res.json({ summary, series, orphanGames });
    } catch (error) {
        console.error('Error building series overview:', error);
        res.status(500).json({ message: 'Server error building series overview.' });
    }
});

module.exports = router;
