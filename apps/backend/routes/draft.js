const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const { pool, io } = require('../server');

// Helper to get the active draft state
async function getDraftState(client) {
    const res = await client.query('SELECT * FROM draft_state ORDER BY created_at DESC LIMIT 1');
    return res.rows[0];
}

// Helper to determine draft order based on previous season
async function calculateDraftOrder(client) {
    // Strategy:
    // 1. Get the most recent completed series for "Wooden Spoon" and "Golden Spaceship"
    // 2. Identify the 4 teams involved.
    // 3. Identify the 5th "Neutral" team.
    // 4. Return array: [SpoonLoser, SpoonWinner, Neutral, ShipLoser, ShipWinner]

    // Fetch Wooden Spoon results
    const spoonRes = await client.query(`
        SELECT winning_team_id, losing_team_id, season_name
        FROM series_results
        WHERE round = 'Wooden Spoon'
        ORDER BY date DESC LIMIT 1
    `);

    // Fetch Golden Spaceship results
    const shipRes = await client.query(`
        SELECT winning_team_id, losing_team_id, season_name
        FROM series_results
        WHERE round = 'Golden Spaceship'
        ORDER BY date DESC LIMIT 1
    `);

    if (spoonRes.rows.length === 0 || shipRes.rows.length === 0) {
        throw new Error("Cannot start draft: Previous season history incomplete.");
    }

    const spoonL = spoonRes.rows[0].losing_team_id;
    const spoonW = spoonRes.rows[0].winning_team_id;
    const shipL = shipRes.rows[0].losing_team_id;
    const shipW = shipRes.rows[0].winning_team_id;

    // Determine Season Name (e.g. "Season 2")
    // We assume the new season is named sequentially or we just use "Upcoming Season" as the key
    // Actually, let's use the point set name "Upcoming Season" as the target identifier.

    // Find Neutral Team
    const participants = [spoonL, spoonW, shipL, shipW];
    const allTeamsRes = await client.query('SELECT team_id FROM teams WHERE user_id IS NOT NULL');
    const neutralTeam = allTeamsRes.rows.find(t => !participants.includes(t.team_id));

    if (!neutralTeam) {
        // Fallback for testing/dev environments with < 5 teams
        // Just return whatever order we have
        return participants;
    }

    return [spoonL, spoonW, neutralTeam.team_id, shipL, shipW];
}

// Helper: Advance Draft State
async function advanceDraftState(client, currentState) {
    let { current_round, current_pick_number, draft_order, id } = currentState;
    const order = draft_order;
    const numTeams = order.length;

    // Advance pick
    current_pick_number++;

    // Check if round is complete
    if (current_pick_number > numTeams) {
        current_pick_number = 1;
        current_round++;
    }

    let nextTeamId = null;
    let isActive = true;

    if (current_round > 5) {
        // Draft Complete!
        isActive = false;
        nextTeamId = null;
        // Trigger Schedule Generation here? Or explicitly calling it.
        await generateSchedule(client, order);
    } else {
        // Get next team
        nextTeamId = order[current_pick_number - 1];
    }

    await client.query(
        `UPDATE draft_state
         SET current_round = $1, current_pick_number = $2, active_team_id = $3, is_active = $4, updated_at = NOW()
         WHERE id = $5`,
        [current_round, current_pick_number, nextTeamId, isActive, id]
    );

    return { current_round, current_pick_number, active_team_id: nextTeamId, is_active: isActive };
}

async function generateSchedule(client, teamIds) {
    // Generate Round Robin Schedule: Each team plays every other team once.
    // teamIds has 5 teams. 5 * 4 / 2 = 10 series total.

    // Series Type: 'regular_season'

    // We need to fetch the user_ids for these teams
    const teamsRes = await client.query('SELECT team_id, user_id FROM teams WHERE team_id = ANY($1::int[])', [teamIds]);
    const teamMap = {};
    teamsRes.rows.forEach(t => teamMap[t.team_id] = t.user_id);

    const matchups = [];
    for (let i = 0; i < teamIds.length; i++) {
        for (let j = i + 1; j < teamIds.length; j++) {
            matchups.push({ home: teamIds[i], away: teamIds[j] });
        }
    }

    // Create Series
    for (const matchup of matchups) {
        const homeUserId = teamMap[matchup.home];
        const awayUserId = teamMap[matchup.away];

        const seriesRes = await client.query(
            `INSERT INTO series (series_type, series_home_user_id, series_away_user_id)
             VALUES ('regular_season', $1, $2) RETURNING id`,
            [homeUserId, awayUserId]
        );
        const seriesId = seriesRes.rows[0].id;

        // Create Game 1
        // Game 1 Home Team is Series Home Team
        // DH Rule: For now default to TRUE or based on home team pref?
        // Let's assume standard 'use_dh' = true for now, or fetch global setting.
        const useDh = true;

        // We need roster_ids.
        const homeRosterRes = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [homeUserId]);
        const awayRosterRes = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [awayUserId]);

        if (homeRosterRes.rows.length === 0 || awayRosterRes.rows.length === 0) continue;

        const homeRosterId = homeRosterRes.rows[0].roster_id;
        const awayRosterId = awayRosterRes.rows[0].roster_id;

        // Get League Designations (AL/NL) from team or user?
        // We'll just default to AL/NL based on an arbitrary split or random.
        // Actually, just keep what they had? Or "AL" for everyone.
        // Let's default to AL for simplicity unless we store it on the team.
        const league = 'AL';

        const gameRes = await client.query(
            `INSERT INTO games (status, series_id, game_in_series, home_team_user_id, use_dh)
             VALUES ('lineups', $1, 1, $2, $3) RETURNING game_id`,
            [seriesId, homeUserId, useDh]
        );
        const gameId = gameRes.rows[0].game_id;

        await client.query(
            `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation)
             VALUES ($1, $2, $3, 'home', $4), ($1, $5, $6, 'away', $4)`,
            [gameId, homeUserId, homeRosterId, league, awayUserId, awayRosterId]
        );
    }
}


// START DRAFT (Kickoff)
router.post('/start', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Check if active draft exists
        const existing = await getDraftState(client);
        if (existing && existing.is_active) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Draft already in progress." });
        }

        // 2. Calculate Order
        let draftOrder;
        try {
            draftOrder = await calculateDraftOrder(client);
        } catch (e) {
            // Fallback for dev: Get all teams
            console.warn("Could not calculate standard order, falling back to random 5 teams.");
            const allTeams = await client.query('SELECT team_id FROM teams WHERE user_id IS NOT NULL LIMIT 5');
            draftOrder = allTeams.rows.map(t => t.team_id);
        }

        // 3. Switch Point Set to "Upcoming Season"
        // Find the ID
        const psRes = await client.query("SELECT point_set_id FROM point_sets WHERE name = 'Upcoming Season'");
        if (psRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(500).json({ message: "Point set 'Upcoming Season' not found." });
        }
        // const upcomingPointSetId = psRes.rows[0].point_set_id;
        // Note: We don't "switch" a global flag in the DB because `auth.js` just looks for it.
        // But we rely on the Frontend to now default to this ID.

        // 4. Random Removal (5 players per team)
        const seasonName = "Season " + new Date().getFullYear(); // Or generate dynamically

        for (const teamId of draftOrder) {
            // Get user_id for the team
            const teamRes = await client.query('SELECT user_id FROM teams WHERE team_id = $1', [teamId]);
            const userId = teamRes.rows[0].user_id;

            // Get Roster
            const rosterRes = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userId]);
            if (rosterRes.rows.length === 0) continue;
            const rosterId = rosterRes.rows[0].roster_id;

            // Get Cards
            const cardsRes = await client.query('SELECT card_id FROM roster_cards WHERE roster_id = $1', [rosterId]);
            let cards = cardsRes.rows.map(c => c.card_id);

            // Shuffle and Pick 5
            cards.sort(() => 0.5 - Math.random());
            const toRemove = cards.slice(0, 5);

            // Remove from DB and Log
            for (const cardId of toRemove) {
                await client.query('DELETE FROM roster_cards WHERE roster_id = $1 AND card_id = $2', [rosterId, cardId]);
                await client.query(
                    `INSERT INTO draft_history (season_name, round, team_id, player_id, action)
                     VALUES ($1, 'Removal', $2, $3, 'REMOVED_RANDOM')`,
                    [seasonName, teamId, cardId]
                );
            }
        }

        // 5. Initialize Draft State (Start at Round 2 (Pick 1) immediately after removal? Or call Removal Round 1?)
        // Plan said: Round 1 & 2 are "Add".
        // Let's call Removal "Round 1" in the DB state just for tracking, but effectively we jump to Round 2 (The first draft round).
        // Actually, let's map DB `current_round` to:
        // 1=Removal (Done), 2=Draft Round 1, 3=Draft Round 2, 4=Add/Drop 1, 5=Add/Drop 2.

        const firstTeamId = draftOrder[0];
        await client.query(
            `INSERT INTO draft_state (season_name, current_round, current_pick_number, active_team_id, draft_order, is_active)
             VALUES ($1, 2, 1, $2, $3, true)`,
            [seasonName, firstTeamId, JSON.stringify(draftOrder)]
        );

        await client.query('COMMIT');

        io.emit('draft-updated'); // Notify clients
        res.json({ message: "Draft started successfully!" });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Start Draft Error:", error);
        res.status(500).json({ message: "Error starting draft." });
    } finally {
        client.release();
    }
});

// GET DRAFT STATE
router.get('/state', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const state = await getDraftState(client);
        if (!state) return res.json({ isActive: false });

        // Fetch History
        const historyRes = await client.query(
            'SELECT dh.*, cp.name as player_name, t.city, t.name as team_name FROM draft_history dh JOIN cards_player cp ON dh.player_id = cp.card_id JOIN teams t ON dh.team_id = t.team_id WHERE dh.season_name = $1 ORDER BY dh.timestamp DESC',
            [state.season_name]
        );

        // Fetch Current Active Team Info
        let activeTeam = null;
        if (state.active_team_id) {
            const tRes = await client.query('SELECT * FROM teams WHERE team_id = $1', [state.active_team_id]);
            activeTeam = tRes.rows[0];
        }

        // Fetch Taken Players (Players on any roster)
        const takenRes = await client.query('SELECT card_id FROM roster_cards');
        const takenPlayerIds = takenRes.rows.map(r => r.card_id);

        res.json({
            ...state,
            history: historyRes.rows,
            activeTeam,
            takenPlayerIds
        });

    } catch (error) {
        console.error("Get Draft State Error:", error);
        res.status(500).json({ message: "Error fetching draft state." });
    } finally {
        client.release();
    }
});

// SUBMIT PICK (Rounds 2 & 3 - The "Add" Rounds)
router.post('/pick', authenticateToken, async (req, res) => {
    const { playerId } = req.body;
    const userId = req.user.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const state = await getDraftState(client);

        if (!state || !state.is_active) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "No active draft." });
        }

        // Validate Turn
        const teamRes = await client.query('SELECT team_id FROM teams WHERE user_id = $1', [userId]);
        if (teamRes.rows.length === 0 || teamRes.rows[0].team_id !== state.active_team_id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: "It is not your turn." });
        }
        const teamId = state.active_team_id;

        // Validate Round (Must be 2 or 3)
        if (state.current_round !== 2 && state.current_round !== 3) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Invalid round for single pick." });
        }

        // Check if player is already owned
        const ownedCheck = await client.query('SELECT 1 FROM roster_cards WHERE card_id = $1', [playerId]);
        if (ownedCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Player is already on a roster." });
        }

        // Add Player to Roster
        const rosterRes = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userId]);
        const rosterId = rosterRes.rows[0].roster_id;

        // Determine Assignment (Bench/PITCHING_STAFF/Lineup is irrelevant for now, just put them on BENCH or PITCHING_STAFF based on position)
        // Actually, just checking card type
        const cardRes = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [playerId]);
        const card = cardRes.rows[0];
        const assignment = card.control !== null ? 'PITCHING_STAFF' : 'BENCH';
        const isStarter = card.control !== null && card.ip > 3;

        await client.query(
            `INSERT INTO roster_cards (roster_id, card_id, is_starter, assignment)
             VALUES ($1, $2, $3, $4)`,
            [rosterId, playerId, isStarter, assignment]
        );

        // Log History
        const roundName = state.current_round === 2 ? "Round 1" : "Round 2";
        await client.query(
            `INSERT INTO draft_history (season_name, round, team_id, player_id, action)
             VALUES ($1, $2, $3, $4, 'ADDED')`,
            [state.season_name, roundName, teamId, playerId]
        );

        // Advance State
        const newState = await advanceDraftState(client, state);

        await client.query('COMMIT');
        io.emit('draft-updated');
        res.json(newState);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Draft Pick Error:", error);
        res.status(500).json({ message: "Error processing pick." });
    } finally {
        client.release();
    }
});

// SUBMIT ROSTER (Rounds 4 & 5 - The "Add/Drop" Rounds)
router.post('/submit-turn', authenticateToken, async (req, res) => {
    const { cards } = req.body; // Expecting full roster cards list like my-roster endpoint
    const userId = req.user.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const state = await getDraftState(client);

        if (!state || !state.is_active) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "No active draft." });
        }

        // Validate Turn
        const teamRes = await client.query('SELECT team_id FROM teams WHERE user_id = $1', [userId]);
        if (teamRes.rows.length === 0 || teamRes.rows[0].team_id !== state.active_team_id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: "It is not your turn." });
        }
        const teamId = state.active_team_id;

        // Validate Round (Must be 4 or 5)
        if (state.current_round !== 4 && state.current_round !== 5) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Invalid round for roster submission." });
        }

        // --- STRICT VALIDATION (20 Players, 5000 Points) ---
        // 1. Fetch "Upcoming Season" Points
        const psRes = await client.query("SELECT point_set_id FROM point_sets WHERE name = 'Upcoming Season'");
        const pointSetId = psRes.rows[0].point_set_id;

        const cardIds = cards.map(c => c.card_id);
        const pointsRes = await client.query(
            `SELECT cp.card_id, cp.control, ppv.points
             FROM cards_player cp
             LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $1
             WHERE cp.card_id = ANY($2::int[])`,
            [pointSetId, cardIds]
        );
        const cardMap = {};
        pointsRes.rows.forEach(c => cardMap[c.card_id] = c);

        if (cards.length !== 20) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Roster must have exactly 20 players." });
        }

        let totalPoints = 0;
        for (const card of cards) {
            const info = cardMap[card.card_id];
            let pts = info.points || 0;
            // Apply Bench logic
            if (card.assignment === 'BENCH' && info.control === null) {
                pts = Math.round(pts / 5);
            }
            totalPoints += pts;
        }

        if (totalPoints > 5000) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Roster exceeds 5000 points. Total: ${totalPoints}` });
        }

        // --- UPDATE ROSTER & CALCULATE DIFF ---
        const rosterRes = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userId]);
        const rosterId = rosterRes.rows[0].roster_id;

        // Get Old Roster
        const oldCardsRes = await client.query('SELECT card_id FROM roster_cards WHERE roster_id = $1', [rosterId]);
        const oldCardIds = oldCardsRes.rows.map(c => c.card_id);
        const newCardIds = cards.map(c => c.card_id);

        const added = newCardIds.filter(id => !oldCardIds.includes(id));
        const dropped = oldCardIds.filter(id => !newCardIds.includes(id));

        // Verify Added Players are Available
        if (added.length > 0) {
            const availabilityCheck = await client.query(
                `SELECT card_id FROM roster_cards WHERE card_id = ANY($1::int[]) AND roster_id != $2`,
                [added, rosterId]
            );
            if (availabilityCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `One or more selected players are already owned by another team.` });
            }
        }

        // Delete Old Roster
        await client.query('DELETE FROM roster_cards WHERE roster_id = $1', [rosterId]);

        // Insert New Roster
        for (const card of cards) {
            await client.query(
                'INSERT INTO roster_cards (roster_id, card_id, is_starter, assignment) VALUES ($1, $2, $3, $4)',
                [rosterId, card.card_id, card.is_starter, card.assignment]
            );
        }

        // Log Changes
        const roundName = state.current_round === 4 ? "Add/Drop 1" : "Add/Drop 2";
        for (const id of added) {
            await client.query(
                `INSERT INTO draft_history (season_name, round, team_id, player_id, action)
                 VALUES ($1, $2, $3, $4, 'ADDED')`,
                [state.season_name, roundName, teamId, id]
            );
        }
        for (const id of dropped) {
            await client.query(
                `INSERT INTO draft_history (season_name, round, team_id, player_id, action)
                 VALUES ($1, $2, $3, $4, 'DROPPED')`,
                [state.season_name, roundName, teamId, id]
            );
        }

        // Advance State
        const newState = await advanceDraftState(client, state);

        await client.query('COMMIT');
        io.emit('draft-updated');
        res.json(newState);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Submit Turn Error:", error);
        res.status(500).json({ message: "Error submitting turn." });
    } finally {
        client.release();
    }
});

module.exports = router;
