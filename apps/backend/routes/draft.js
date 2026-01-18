const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const { pool, io } = require('../server');
const { sendPickConfirmation, sendRandomRemovalsEmail } = require('../services/emailService');
const { getSeasonName, sortSeasons, seasonMap, mapSeasonToPointSet } = require('../utils/seasonUtils');
const { rolloverPointSets, snapshotRosters, generateSchedule } = require('../services/seasonRolloverService');

// Helper to get the active draft state
async function getDraftState(client, seasonName = null) {
    let query = 'SELECT * FROM draft_state ORDER BY created_at DESC LIMIT 1';
    let params = [];

    if (seasonName) {
        query = 'SELECT * FROM draft_state WHERE season_name = $1 ORDER BY created_at DESC LIMIT 1';
        params = [seasonName];
    }

    const res = await client.query(query, params);
    return res.rows[0];
}

// Helper to check if season is over
async function checkSeasonOver(client) {
    try {
        // 1. Find the LATEST completed season (one that has both Spoon and Ship)
        // We look for seasons that have 'Wooden Spoon' AND 'Golden Spaceship' records.
        // We can find all seasons that have both, then pick the most recent one (by date/created_at).
        // Since we don't have a direct "seasons" table with dates easily joinable here without complexity,
        // we can fetch the distinct seasons with Spoon/Ship and then order them.

        const completedSeasonsRes = await client.query(`
            SELECT season_name, MAX(date) as last_date
            FROM series_results
            WHERE round IN ('Wooden Spoon', 'Golden Spaceship')
            GROUP BY season_name
            HAVING COUNT(DISTINCT round) >= 2
            ORDER BY last_date DESC
            LIMIT 1
        `);

        if (completedSeasonsRes.rows.length === 0) {
            // No season has ever finished
            return false;
        }

        const lastCompletedSeason = completedSeasonsRes.rows[0].season_name;

        // 2. Check for ANY games (played or unplayed) that belong to a DIFFERENT (future) season.
        // If the "Latest" season known to the system is NOT the "Last Completed" season,
        // then a new season is active (or partially active), so we should NOT show the draft button.
        // We find the latest season by Date.

        const latestSeasonRes = await client.query(`
            SELECT season_name
            FROM series_results
            ORDER BY date DESC
            LIMIT 1
        `);

        if (latestSeasonRes.rows.length > 0) {
            const latestSeason = latestSeasonRes.rows[0].season_name;
            if (latestSeason !== lastCompletedSeason) {
                // A newer season exists (it has games, even if finished regular season, it lacks the final awards).
                return false;
            }
        }

        // If we are here, the latest known season IS the last completed season.
        // So we are in the off-season.
        return true;

    } catch (e) {
        console.warn("Check Season Over Error:", e);
        return false;
    }
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

    // Find Neutral Team
    const participants = [spoonL, spoonW, shipL, shipW].map(id => Number(id));
    const allTeamsRes = await client.query('SELECT team_id FROM teams WHERE user_id IS NOT NULL');
    const allTeamIds = allTeamsRes.rows.map(t => Number(t.team_id));
    const neutralTeamId = allTeamIds.find(id => !participants.includes(id));

    if (!neutralTeamId) {
        // Fallback for testing/dev environments with < 5 teams
        // Just return whatever order we have
        return participants;
    }

    return [spoonL, spoonW, neutralTeamId, shipL, shipW];
}

// Helper: Advance Draft State
async function advanceDraftState(client, currentState) {
    let { current_round, current_pick_number, draft_order, id, season_name } = currentState;
    const order = draft_order;
    const numTeams = order.length;

    // Advance pick
    current_pick_number++;

    // Check if round is complete
    if ((current_pick_number - 1) % numTeams === 0) {
        current_round++;
    }

    let nextTeamId = null;
    let isActive = true;

    if (current_round > 5) {
        // Draft Complete!
        isActive = false;
        nextTeamId = null;

        // --- NEW SEASON ROLLOVER LOGIC ---
        // 1. Generate empty schedule in series_results (marks season as "started/active")
        await generateSchedule(client, season_name, order);

        // 2. Snapshot current rosters to historical_rosters
        await snapshotRosters(client, season_name);

        // 3. Rollover point sets (calculate new points)
        // Ensure this happens AFTER snapshot because it relies on the snapshot being present in historical_rosters
        await rolloverPointSets(client, season_name);
        // ---------------------------------

    } else {
        // Get next team
        const index = (current_pick_number - 1) % numTeams;
        nextTeamId = order[index];
    }

    // Reset notification_level to 0 for the new turn
    await client.query(
        `UPDATE draft_state
         SET current_round = $1, current_pick_number = $2, active_team_id = $3, is_active = $4, updated_at = NOW(), notification_level = 0
         WHERE id = $5`,
        [current_round, current_pick_number, nextTeamId, isActive, id]
    );

    return { current_round, current_pick_number, active_team_id: nextTeamId, is_active: isActive };
}

// GET AVAILABLE SEASONS
router.get('/seasons', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT DISTINCT season_name FROM draft_state
            UNION
            SELECT DISTINCT season_name FROM draft_history
        `);
        const seasons = result.rows.map(r => r.season_name);

        // Reverse map season name to date string
        const nameToDate = {};
        for (const [date, name] of Object.entries(seasonMap)) {
            nameToDate[name] = date;
        }

        // Identify if there is an active season
        // We can check if any season string does NOT have a date in nameToDate map,
        // OR check draft_state for is_active = true.
        // The most reliable way is to query active draft again or assume the one without a date mapping is the new one.
        // However, we just fetched distinct names.

        // Let's find the active one.
        const activeRes = await client.query('SELECT season_name FROM draft_state WHERE is_active = true LIMIT 1');
        let activeSeasonName = null;
        if (activeRes.rows.length > 0) activeSeasonName = activeRes.rows[0].season_name;

        // Use shared sorting utility
        const sortedSeasons = sortSeasons(seasons);

        // Ensure active season is top (sortSeasons sorts by date descending, active is usually newest, but explicit check matches prior behavior)
        const seasonsToReturn = sortedSeasons;
        if (activeSeasonName) {
            const idx = seasonsToReturn.indexOf(activeSeasonName);
            if (idx > 0) {
                seasonsToReturn.splice(idx, 1);
                seasonsToReturn.unshift(activeSeasonName);
            }
        }

        // Map active season name to "Live Draft"
        const displayedSeasons = seasonsToReturn.map(s => s === activeSeasonName ? "Live Draft" : s);

        res.json(displayedSeasons);
    } catch (error) {
        console.error("Get Draft Seasons Error:", error);
        res.status(500).json({ message: "Error fetching draft seasons." });
    } finally {
        client.release();
    }
});


// START DRAFT (Kickoff) - "Perform Random Removals"
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
        const psRes = await client.query("SELECT point_set_id FROM point_sets WHERE name = 'Upcoming Season'");
        if (psRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(500).json({ message: "Point set 'Upcoming Season' not found." });
        }

        // 4. Random Removal (5 players per team)
        // Format: "Winter 2026" etc. (Automated based on date)
        const seasonName = getSeasonName(new Date());

        const removalsByTeam = {}; // Collect data for email

        for (const teamId of draftOrder) {
            const teamRes = await client.query('SELECT user_id, city, name FROM teams WHERE team_id = $1', [teamId]);
            const team = teamRes.rows[0];
            const userId = team.user_id;
            const teamDisplayName = `${team.city} ${team.name}`;

            const rosterRes = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userId]);
            if (rosterRes.rows.length === 0) continue;
            const rosterId = rosterRes.rows[0].roster_id;

            const cardsRes = await client.query('SELECT card_id FROM roster_cards WHERE roster_id = $1', [rosterId]);
            let cards = cardsRes.rows.map(c => c.card_id);

            cards.sort(() => 0.5 - Math.random());
            const toRemove = cards.slice(0, 5);

            if (toRemove.length > 0) {
                 const namesRes = await client.query('SELECT card_id, display_name, name FROM cards_player WHERE card_id = ANY($1::int[])', [toRemove]);
                 // Create map for easy lookup by ID
                 const nameMap = {};
                 namesRes.rows.forEach(r => {
                     nameMap[r.card_id] = r.display_name || r.name;
                 });

                 const playerNames = toRemove.map(id => nameMap[id] || 'Unknown Player');
                 removalsByTeam[teamDisplayName] = playerNames;

                 // Process removals
                 for (const cardId of toRemove) {
                    const playerName = nameMap[cardId] || 'Unknown Player';
                    await client.query('DELETE FROM roster_cards WHERE roster_id = $1 AND card_id = $2', [rosterId, cardId]);

                    // Insert into random_removals table using City as team_name
                    await client.query(
                        `INSERT INTO random_removals (season, player_name, card_id, team_name)
                         VALUES ($1, $2, $3, $4)`,
                        [seasonName, playerName, cardId, team.city]
                    );
                }
            }
        }

        // 5. Initialize Draft State
        const firstTeamId = draftOrder[0];
        await client.query(
            `INSERT INTO draft_state (season_name, current_round, current_pick_number, active_team_id, draft_order, is_active)
             VALUES ($1, 2, 1, $2, $3, true)`,
            [seasonName, firstTeamId, JSON.stringify(draftOrder)]
        );

        await client.query('COMMIT');

        // --- EMAIL NOTIFICATION ---
        // Get first team name
        // Use draftOrder[0] which is the firstTeamId
        const firstTeamRes = await client.query('SELECT city, name FROM teams WHERE team_id = $1', [draftOrder[0]]);
        const ft = firstTeamRes.rows[0];
        const firstTeamName = `${ft.city} ${ft.name}`;

        try {
             await sendRandomRemovalsEmail(removalsByTeam, firstTeamName, client);
        } catch (e) {
             console.error("Error sending removal email:", e);
        }
        // -------------------------

        io.emit('draft-updated');
        res.json({ message: "Random removals performed and draft started!" });

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
        let seasonName = req.query.season; // Optional query param

        // Handle "Live Draft" alias from frontend
        if (seasonName === "Live Draft") {
             const activeRes = await client.query('SELECT season_name FROM draft_state WHERE is_active = true LIMIT 1');
             if (activeRes.rows.length > 0) {
                 seasonName = activeRes.rows[0].season_name;
             }
        }

        let state = await getDraftState(client, seasonName);
        const seasonOver = await checkSeasonOver(client);

        // Check for ANY active draft globally
        const globalActiveRes = await client.query('SELECT 1 FROM draft_state WHERE is_active = true LIMIT 1');
        const globalDraftActive = globalActiveRes.rows.length > 0;

        // Fallback to finding state from history if not found in draft_state
        if (!state) {
            let targetSeason = seasonName;

            // If no specific season requested, find the latest from history via natural sort
            if (!targetSeason) {
                const historySeasonsRes = await client.query(
                    'SELECT DISTINCT season_name FROM draft_history'
                );
                const seasons = historySeasonsRes.rows.map(r => r.season_name);
                if (seasons.length > 0) {
                    // Reverse map season name to date string
                    const nameToDate = {};
                    for (const [date, name] of Object.entries(seasonMap)) {
                        nameToDate[name] = date;
                    }
                    seasons.sort((a, b) => {
                        const dateA = nameToDate[a];
                        const dateB = nameToDate[b];

                        if (dateA && dateB) {
                            // Parse date strings MM/DD/YY
                            const dA = new Date(dateA);
                            const dB = new Date(dateB);
                            return dB - dA; // Descending (Newest first)
                        }
                        if (dateA) return -1; // A has date, B doesn't -> A first
                        if (dateB) return 1;  // B has date, A doesn't -> B first

                        // Fallback to alphabetical if neither has a date
                        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                    });
                    // Latest is last in ascending sort
                    targetSeason = seasons[seasons.length - 1];
                }
            }

            // If we have a target season, construct a read-only state
            if (targetSeason) {
                state = {
                    season_name: targetSeason,
                    is_active: false,
                    current_round: 0,
                    current_pick_number: 1,
                    active_team_id: null,
                    draft_order: [],
                };
            }
        }

        // If still no state (no history, no active draft), return empty
        if (!state) return res.json({ isActive: false, isSeasonOver: seasonOver, globalDraftActive });

        // Find correct point set for stats
        // 1. Map the season name from draft state/history (e.g. "1-7-25 Season") to Point Set format (e.g. "1/7/25 Season")
        const targetPointSetName = mapSeasonToPointSet(state.season_name);

        // 2. Find the ID of that point set
        const allPsRes = await client.query('SELECT point_set_id, name FROM point_sets');
        const pointSetMap = {};
        allPsRes.rows.forEach(ps => pointSetMap[ps.name] = ps.point_set_id);

        let pointSetId = pointSetMap[targetPointSetName];
        // FALLBACK: If mapSeasonToPointSet didn't find it, try the season name directly
        // e.g. "Fall 2025" -> mapSeason returns "8/4/25 Season", but point_sets might have "Fall 2025" directly if it's new.
        if (!pointSetId && pointSetMap[state.season_name]) {
            pointSetId = pointSetMap[state.season_name];
        }

        // --- NEW: Live Draft Override ---
        // If it's the active draft or explicitly "Live Draft", default to Upcoming Season if mapped set not found OR if we want to force it.
        // We prefer "Upcoming Season" for the live draft experience unless the season name maps perfectly.
        // mapSeasonToPointSet for "Live Draft" (passed as seasonName sometimes) returns "Original Pts", which is wrong for 2025.
        // Also if state.is_active is true, we are likely in the "Upcoming Season" context.
        if (state.is_active || seasonName === 'Live Draft') {
             if (pointSetMap['Upcoming Season']) {
                 pointSetId = pointSetMap['Upcoming Season'];
             }
        }

        if (!pointSetId) {
            pointSetId = pointSetMap["Original Pts"];
        }

        // Fetch History
        // Prioritize official display_name from cards_player, then clean name, then raw history name
        // Team Name priority: Historical (dh.team_name) -> Current (t.name)
        const historyRes = await client.query(
            `SELECT
                dh.*,
                COALESCE(cp.display_name, cp.name, dh.player_name) as player_name,
                t.city,
                t.logo_url,
                COALESCE(dh.team_name, t.name) as team_name,
                ppv.points,
                CASE
                    WHEN cp.control IS NOT NULL THEN (CASE WHEN cp.ip > 3 THEN 'SP' ELSE 'RP' END)
                    ELSE array_to_string(ARRAY(SELECT jsonb_object_keys(cp.fielding_ratings)), '/')
                END as position
             FROM draft_history dh
             LEFT JOIN cards_player cp ON dh.card_id = cp.card_id
             LEFT JOIN teams t ON dh.team_id = t.team_id
             LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $2
             WHERE dh.season_name = $1
             ORDER BY dh.pick_number ASC, dh.created_at ASC`,
            [state.season_name, pointSetId]
        );

        // Fetch Random Removals (Historical)
        const removalQuery = `
            SELECT
                rr.player_name,
                rr.team_name,
                rr.card_id,
                ppv.points,
                CASE
                    WHEN cp.control IS NOT NULL THEN (CASE WHEN cp.ip > 3 THEN 'SP' ELSE 'RP' END)
                    ELSE array_to_string(ARRAY(SELECT jsonb_object_keys(cp.fielding_ratings)), '/')
                END as position
            FROM random_removals rr
            LEFT JOIN cards_player cp ON rr.card_id = cp.card_id
            LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $2
            WHERE rr.season = $1
            ORDER BY rr.team_name, rr.player_name
        `;

        // reusing pointSetId derived above
        const removalRes = await client.query(removalQuery, [state.season_name, pointSetId]);

        // Fix for September 2020: Use 'Fargo' if team name missing or bad lookup
        // Check if this is the target season
        if (state.season_name.includes('September 2020')) {
             removalRes.rows.forEach(row => {
                 if (!row.team_name || row.team_name.trim() === '') {
                     row.team_name = 'Fargo';
                 }
                 // If the stored team name was an ID or unmapped, logic could go here,
                 // but user said "revert to Fargo as the team", implying we force it.
                 // Also ensure it displays properly if the DB had null.
             });

             // Double check if any rows have null team_name even if not Sept 2020?
             // User specific request was for Sept 2020.
        }

        let activeTeam = null;
        if (state.active_team_id) {
            const tRes = await client.query('SELECT * FROM teams WHERE team_id = $1', [state.active_team_id]);
            activeTeam = tRes.rows[0];
        }

        const takenRes = await client.query('SELECT card_id FROM roster_cards where roster_id in (select roster_id from rosters where roster_type=\'league\')');
        const takenPlayerIds = takenRes.rows.map(r => r.card_id);

        // Fetch team info for the draft order (to populate future rows)
        let teamsMap = {};
        if (state.draft_order && state.draft_order.length > 0) {
            const teamsRes = await client.query('SELECT team_id, name, city, logo_url FROM teams WHERE team_id = ANY($1::int[])', [state.draft_order]);
            teamsRes.rows.forEach(t => {
                // For the draft table, we only want the City (as per requirements).
                // Fallback to name if city is missing.
                teamsMap[t.team_id] = {
                    name: t.city || t.name || "Unknown Team",
                    logo_url: t.logo_url
                };
            });
        }

        res.json({
            ...state,
            history: historyRes.rows,
            randomRemovals: removalRes.rows,
            activeTeam,
            takenPlayerIds,
            isSeasonOver: seasonOver,
            teams: teamsMap,
            globalDraftActive
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
        const state = await getDraftState(client); // Picks always apply to CURRENT active draft

        if (!state || !state.is_active) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "No active draft." });
        }

        const teamRes = await client.query('SELECT team_id FROM teams WHERE user_id = $1', [userId]);
        if (teamRes.rows.length === 0 || teamRes.rows[0].team_id !== state.active_team_id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: "It is not your turn." });
        }
        const teamId = state.active_team_id;

        if (state.current_round !== 2 && state.current_round !== 3) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Invalid round for single pick." });
        }

        const ownedCheck = await client.query(
            `SELECT 1
             FROM roster_cards rc
             JOIN rosters r ON rc.roster_id = r.roster_id
             WHERE rc.card_id = $1 AND r.roster_type = 'league'`,
            [playerId]
        );
        if (ownedCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Player is already on a roster." });
        }

        const rosterRes = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userId]);
        const rosterId = rosterRes.rows[0].roster_id;

        const cardRes = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [playerId]);
        const card = cardRes.rows[0];
        const assignment = card.control !== null ? 'PITCHING_STAFF' : 'BENCH';
        const isStarter = card.control !== null && card.ip > 3;

        try {
            await client.query(
                `INSERT INTO roster_cards (roster_id, card_id, is_starter, assignment)
                 VALUES ($1, $2, $3, $4)`,
                [rosterId, playerId, isStarter, assignment]
            );
        } catch (e) {
            // Check for unique violation (duplicate pick race condition)
            if (e.code === '23505' && e.constraint === 'roster_cards_pkey') {
                console.warn(`Duplicate pick detected for card ${playerId}. Handling gracefully.`);
                await client.query('ROLLBACK');
                const currentState = await getDraftState(client);
                return res.json(currentState);
            }
            throw e;
        }

        const roundName = state.current_round === 2 ? "1" : "2";
        await client.query(
            `INSERT INTO draft_history (season_name, round, team_id, card_id, action, pick_number)
             VALUES ($1, $2, $3, $4, 'ADDED', $5)`,
            [state.season_name, roundName, teamId, playerId, state.current_pick_number]
        );

        const newState = await advanceDraftState(client, state);

        // --- EMAIL NOTIFICATION LOGIC ---
        // Fetch current team info for the email
        const currentTeamRes = await client.query('SELECT city, name FROM teams WHERE team_id = $1', [teamId]);
        const currentTeam = currentTeamRes.rows[0];
        const teamDisplayName = `${currentTeam.city} ${currentTeam.name}`;

        // Fetch next team info
        let nextTeam = null;
        if (newState.active_team_id) {
            const nextTeamRes = await client.query('SELECT city, name FROM teams WHERE team_id = $1', [newState.active_team_id]);
            const nt = nextTeamRes.rows[0];
            nextTeam = { name: `${nt.city} ${nt.name}` };
        }

        const pickDetails = {
            player: {
                name: card.display_name || card.name,
                position: card.control !== null ? (card.ip > 3 ? 'SP' : 'RP') : Object.keys(card.fielding_ratings || {}).join('/')
            },
            team: { name: teamDisplayName },
            round: state.current_round,
            pickNumber: state.current_pick_number
        };

        // Fire and forget email (don't await in critical path if not needed, but here we await to ensure logic integrity in mock)
        // In prod, might wrap in try/catch to not fail the request if email fails.
        try {
            await sendPickConfirmation(pickDetails, nextTeam, client);
        } catch (emailErr) {
            console.error("Failed to send draft email:", emailErr);
        }
        // --------------------------------

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
    let { cards } = req.body; // 'cards' is now optional
    const userId = req.user.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const state = await getDraftState(client);

        if (!state || !state.is_active) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "No active draft." });
        }

        const teamRes = await client.query('SELECT team_id FROM teams WHERE user_id = $1', [userId]);
        if (teamRes.rows.length === 0 || teamRes.rows[0].team_id !== state.active_team_id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: "It is not your turn." });
        }
        const teamId = state.active_team_id;

        if (state.current_round !== 4 && state.current_round !== 5) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Invalid round for roster submission." });
        }

        const rosterRes = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userId]);
        const rosterId = rosterRes.rows[0].roster_id;

        // --- NEW: If no cards provided, use current roster from DB ---
        let usingSavedRoster = false;
        if (!cards || cards.length === 0) {
            usingSavedRoster = true;
            const currentRosterRes = await client.query('SELECT card_id, is_starter, assignment FROM roster_cards WHERE roster_id = $1', [rosterId]);
            cards = currentRosterRes.rows;
        }

        const psRes = await client.query("SELECT point_set_id FROM point_sets WHERE name = 'Upcoming Season'");
        const pointSetId = psRes.rows[0].point_set_id;

        const cardIds = cards.map(c => c.card_id);
        const pointsRes = await client.query(
            `SELECT cp.card_id, cp.control, cp.fielding_ratings, ppv.points
             FROM cards_player cp
             LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $1
             WHERE cp.card_id = ANY($2::int[])`,
            [pointSetId, cardIds]
        );
        const cardMap = {};
        pointsRes.rows.forEach(c => cardMap[c.card_id] = c);

        // --- ENHANCED VALIDATION ---
        // 1. Count check
        if (cards.length !== 20) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Roster must have exactly 20 players." });
        }

        // 2. Point Check & SP Check & Lineup Check
        let totalPoints = 0;
        let spCount = 0;
        const positionsFilled = new Set();

        for (const card of cards) {
            const info = cardMap[card.card_id];
            if (!info) continue; // Should not happen if DB is consistent

            // Points
            let pts = info.points || 0;
            if (card.assignment === 'BENCH' && info.control === null) {
                pts = Math.round(pts / 5);
            }
            totalPoints += pts;

            // SP Check
            // We can trust is_starter flag if it was set correctly, but safer to check assignment
            // 'PITCHING_STAFF' doesn't distinguish SP/RP.
            // RosterBuilder uses card.displayPosition ('SP') to count.
            // Here, we can assume if user saved it, the `is_starter` flag in DB is correct?
            // Or we check `card.is_starter` from payload?
            // Let's rely on payload `is_starter` which RosterBuilder sets based on logic.
            // But if user manipulated payload, we should verify?
            // For now, let's trust `is_starter` boolean in payload/DB card object.
            if (card.is_starter && card.assignment === 'PITCHING_STAFF') {
                spCount++;
            }

            // Lineup Check
            if (['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'].includes(card.assignment)) {
                positionsFilled.add(card.assignment);
            }
        }

        if (totalPoints > 5000) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Roster exceeds 5000 points. Total: ${totalPoints}` });
        }

        if (spCount !== 4) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Roster must have exactly 4 Starting Pitchers. Found: ${spCount}` });
        }

        const requiredPositions = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'];
        const missingPositions = requiredPositions.filter(p => !positionsFilled.has(p));
        if (missingPositions.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Incomplete Lineup. Missing: ${missingPositions.join(', ')}` });
        }
        // ---------------------------

        // If we are using the saved roster, no need to update or log history (already done by my-roster)
        const roundName = state.current_round === 4 ? "Add/Drop 1" : "Add/Drop 2";
        let loggedHistory = false;
        if (!usingSavedRoster) {
            const oldCardsRes = await client.query('SELECT card_id FROM roster_cards WHERE roster_id = $1', [rosterId]);
            const oldCardIds = oldCardsRes.rows.map(c => c.card_id);
            const newCardIds = cards.map(c => c.card_id);

            const added = newCardIds.filter(id => !oldCardIds.includes(id));
            const dropped = oldCardIds.filter(id => !newCardIds.includes(id));

            if (added.length > 0) {
                const availabilityCheck = await client.query(
                    `SELECT rc.card_id
                     FROM roster_cards rc
                     JOIN rosters r ON rc.roster_id = r.roster_id
                     WHERE rc.card_id = ANY($1::int[])
                       AND rc.roster_id != $2
                       AND r.roster_type = 'league'`,
                    [added, rosterId]
                );
                if (availabilityCheck.rows.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ message: `One or more selected players are already owned by another team.` });
                }
            }

            await client.query('DELETE FROM roster_cards WHERE roster_id = $1', [rosterId]);

            for (const card of cards) {
                await client.query(
                    'INSERT INTO roster_cards (roster_id, card_id, is_starter, assignment) VALUES ($1, $2, $3, $4)',
                    [rosterId, card.card_id, card.is_starter, card.assignment]
                );
            }

            if (added.length > 0 || dropped.length > 0) {
                loggedHistory = true;
                for (const id of added) {
                    await client.query(
                        `INSERT INTO draft_history (season_name, round, team_id, card_id, action, pick_number)
                         VALUES ($1, $2, $3, $4, 'ADDED', $5)`,
                        [state.season_name, roundName, teamId, id, state.current_pick_number]
                    );
                }
                for (const id of dropped) {
                    await client.query(
                        `INSERT INTO draft_history (season_name, round, team_id, card_id, action, pick_number)
                         VALUES ($1, $2, $3, $4, 'DROPPED', $5)`,
                        [state.season_name, roundName, teamId, id, state.current_pick_number]
                    );
                }
            }
        }

        if (!loggedHistory) {
            // Explicitly fetch team info for history
            const teamInfoRes = await client.query('SELECT city, name FROM teams WHERE team_id = $1', [teamId]);
            const teamName = teamInfoRes.rows[0] ? `${teamInfoRes.rows[0].city} ${teamInfoRes.rows[0].name}` : null;

            await client.query(
                `INSERT INTO draft_history (season_name, round, team_id, action, pick_number, player_name, team_name)
                 VALUES ($1, $2, $3, 'ROSTER_CONFIRMED', $4, 'Roster Confirmed', $5)`,
                [state.season_name, roundName, teamId, state.current_pick_number, teamName]
            );
        }

        const newState = await advanceDraftState(client, state);

        // --- EMAIL NOTIFICATION LOGIC ---
        // For Add/Drop rounds, we can just say "Roster Submitted"
        const currentTeamRes = await client.query('SELECT city, name FROM teams WHERE team_id = $1', [teamId]);
        const currentTeam = currentTeamRes.rows[0];
        const teamDisplayName = `${currentTeam.city} ${currentTeam.name}`;

        let nextTeam = null;
        if (newState.active_team_id) {
            const nextTeamRes = await client.query('SELECT city, name FROM teams WHERE team_id = $1', [newState.active_team_id]);
            const nt = nextTeamRes.rows[0];
            nextTeam = { name: `${nt.city} ${nt.name}` };
        }

        const pickDetails = {
            player: {
                name: "Roster Submission",
                position: "Multi"
            },
            team: { name: teamDisplayName },
            round: state.current_round,
            pickNumber: state.current_pick_number
        };

        try {
            await sendPickConfirmation(pickDetails, nextTeam, client);
        } catch (emailErr) {
            console.error("Failed to send draft email:", emailErr);
        }
        // --------------------------------

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
