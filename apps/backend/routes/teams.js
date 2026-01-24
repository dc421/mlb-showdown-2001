const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const { sortSeasons, mapSeasonToPointSet } = require('../utils/seasonUtils');
const { matchesFranchise } = require('../utils/franchiseUtils');

// Helper to handle ID mapping
// In prod team IDs, Boston is 3, New York is 5, NY South is 1
// In local team IDs, Boston is 1, New York is 3, NY South is 5
const getMappedIds = (teamId) => {
    const ids = [teamId];
    if (Number(teamId) === 1) ids.push(3);
    else if (Number(teamId) === 3) ids.push(5);
    else if (Number(teamId) === 5) ids.push(1);
    return ids;
};

// GET TEAM HISTORY (Seasons, Records, Rosters)
router.get('/:teamId/history', authenticateToken, async (req, res) => {
    const { teamId } = req.params;
    const client = await pool.connect();

    try {
        // 1. Get Current Team Details including Owner
        const teamRes = await client.query(`
            SELECT t.*, u.owner_first_name, u.owner_last_name
            FROM teams t
            LEFT JOIN users u ON t.user_id = u.user_id
            WHERE t.team_id = $1
        `, [teamId]);

        if (teamRes.rows.length === 0) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        const team = teamRes.rows[0];
        const currentTeamName = `${team.city} ${team.name}`;
        const currentCity = team.city;

        // 2. Fetch Season History from series_results with Name-Based Matching (and ID fallback)
        // This solves the Prod vs Local ID mismatch by relying on the Team Name which is stable.
        const namePattern = `%${team.name}%`; // e.g. "Boston", "New York"
        const mappedIds = getMappedIds(teamId); // Helper for Prod vs Local ID mismatch

        // FETCH ALL TEAMS FOR EXCLUSION LOGIC
        // This prevents fuzzy matches (e.g. "New York") from matching "New York South"
        const allTeamsRes = await client.query('SELECT team_id, city, name FROM teams');
        const allTeams = allTeamsRes.rows;

        // Broad query: Grab everything that might be relevant based on ID or Name, then filter strictly in JS
        // ADDED: "AND style IS DISTINCT FROM 'Classic'" to avoid exhibition games cluttering history (0-0 records)
        const historyQuery = `
            SELECT season_name, round, winning_team_id, losing_team_id, winning_team_name, losing_team_name, winning_score, losing_score
            FROM series_results
            WHERE (winning_team_id = ANY($2::int[]) OR losing_team_id = ANY($2::int[]) OR winning_team_name ILIKE $1 OR losing_team_name ILIKE $1)
            AND style IS DISTINCT FROM 'Classic'
            ORDER BY date DESC
        `;

        const historyRes = await client.query(historyQuery, [namePattern, mappedIds]);

        const seasonStats = {}; // season_name -> { wins, losses, rounds: [], teamNameUsed: string }

        historyRes.rows.forEach(r => {
            const season = r.season_name;

            // Check if Winning Team belongs to this Franchise
            const isWinner = matchesFranchise(r.winning_team_name, r.winning_team_id, team, allTeams, mappedIds);

            // Check if Losing Team belongs to this Franchise
            const isLoser = matchesFranchise(r.losing_team_name, r.losing_team_id, team, allTeams, mappedIds);

            let relevantSide = null; // 'winner' or 'loser'
            let teamNameUsed = null;

            if (isWinner) {
                relevantSide = 'winner';
                teamNameUsed = r.winning_team_name;
            } else if (isLoser) {
                relevantSide = 'loser';
                teamNameUsed = r.losing_team_name;
            }

            if (!relevantSide) return; // Skip this row

            if (!seasonStats[season]) {
                seasonStats[season] = {
                    season_name: season,
                    wins: 0,
                    losses: 0,
                    regularWins: 0,
                    regularLosses: 0,
                    postseasonWins: 0,
                    postseasonLosses: 0,
                    rounds: new Set(),
                    teamNameUsed: null
                };
            }

            const isPostseason = r.round && r.round !== 'Regular Season';

            if (relevantSide === 'winner') {
                seasonStats[season].wins += 1;
                if (isPostseason) {
                    seasonStats[season].postseasonWins += 1;
                } else {
                    seasonStats[season].regularWins += 1;
                }
            } else {
                seasonStats[season].losses += 1;
                if (isPostseason) {
                    seasonStats[season].postseasonLosses += 1;
                } else {
                    seasonStats[season].regularLosses += 1;
                }
            }

            // Track the name used this season (if not set or update if we found one)
            if (teamNameUsed) seasonStats[season].teamNameUsed = teamNameUsed;

            if (r.round) {
                seasonStats[season].rounds.add(r.round);
            }
        });

        // Convert stats to array
        const historyList = Object.values(seasonStats).map(s => {
            const total = s.regularWins + s.regularLosses;
            const winPct = total > 0 ? (s.regularWins / total).toFixed(3).replace(/^0+/, '') : '.000';

            // Determine "Result"
            let result = '-';

            if (s.rounds.has('Golden Spaceship')) {
                const finals = historyRes.rows.find(r => r.season_name === s.season_name && r.round === 'Golden Spaceship');
                // Use robust matching to see if WE won
                if (finals && matchesFranchise(finals.winning_team_name, finals.winning_team_id, team, allTeams, mappedIds)) {
                    result = 'Champion';
                } else if (finals) {
                    result = 'Runner Up';
                }
            } else if (s.rounds.has('Playoffs') || s.rounds.has('Semi-Finals')) {
                result = 'Playoffs';
            } else if (s.rounds.has('Wooden Spoon')) {
                const spoonGame = historyRes.rows.find(r => r.season_name === s.season_name && r.round === 'Wooden Spoon');
                // Usually winning the spoon match means you avoid the spoon
                // If we LOST the spoon match, we are the Spoon Winner.
                if (spoonGame && matchesFranchise(spoonGame.losing_team_name, spoonGame.losing_team_id, team, allTeams, mappedIds)) {
                     result = 'Wooden Spoon';
                } else {
                     result = 'Wooden Spoon Participant';
                }
            }

            // Append Postseason Record if applicable
            if (result !== '-') {
                 result = `${result} (${s.postseasonWins}-${s.postseasonLosses})`;
            }

            return {
                season: s.season_name,
                wins: s.regularWins, // Return Regular Season W-L
                losses: s.regularLosses,
                winPct,
                result,
                teamNameUsed: s.teamNameUsed
            };
        });

        const sortedSeasonNames = sortSeasons(historyList.map(h => h.season));
        historyList.sort((a, b) => sortedSeasonNames.indexOf(a.season) - sortedSeasonNames.indexOf(b.season));

        // CALCULATE IDENTITY HISTORY (Chronological)
        // Group consecutive seasons with the same team name
        const identityHistory = [];
        let currentIdentity = null;
        // historyList is sorted Newest -> Oldest in the API usually, but let's verify sortSeasons output order.
        // sortSeasons returns Newest First (DESC).
        // To build history timeline, iterate Oldest -> Newest (Reverse).

        for (let i = historyList.length - 1; i >= 0; i--) {
            const h = historyList[i];
            const name = h.teamNameUsed || currentTeamName;

            if (!currentIdentity || currentIdentity.name !== name) {
                if (currentIdentity) identityHistory.push(currentIdentity);
                currentIdentity = { name: name, start: h.season, end: h.season };
            } else {
                currentIdentity.end = h.season;
            }
        }
        if (currentIdentity) identityHistory.push(currentIdentity);


        // 3. Fetch Roster History
        // Use the collected names from history + current name
        const namesUsed = new Set();
        namesUsed.add(currentTeamName);
        namesUsed.add(currentCity);
        // Also add just the name part (e.g. "Boston", "New York") to catch cases where only city was used?
        // Or specific full names found in history
        historyList.forEach(h => {
            if (h.teamNameUsed) namesUsed.add(h.teamNameUsed);
        });

        const rosterQuery = `
            SELECT hr.*, cp.display_name, cp.name as card_name, cp.fielding_ratings, cp.control, cp.ip, cp.image_url
            FROM historical_rosters hr
            LEFT JOIN cards_player cp ON hr.card_id = cp.card_id
            WHERE hr.team_name = ANY($1::text[])
        `;

        const rosterRes = await client.query(rosterQuery, [[...namesUsed]]);

        // FETCH POINTS IF MISSING
        // Collect all seasons and point set IDs needed
        const uniqueSeasons = [...new Set(rosterRes.rows.map(r => r.season))];
        const pointSetMap = {}; // season -> pointSetId

        // Fetch all point sets to find IDs
        const psRes = await client.query('SELECT point_set_id, name FROM point_sets');
        const psNameMap = {};
        psRes.rows.forEach(ps => psNameMap[ps.name] = ps.point_set_id);

        uniqueSeasons.forEach(season => {
            const psName = mapSeasonToPointSet(season);
            const psId = psNameMap[psName] || psNameMap['Original Pts'];
            if (psId) pointSetMap[season] = psId;
        });

        // Gather all cards that need points (points is null)
        const cardsNeedingPoints = [];
        rosterRes.rows.forEach(r => {
            if (r.points === null && r.card_id && pointSetMap[r.season]) {
                cardsNeedingPoints.push({ card_id: r.card_id, point_set_id: pointSetMap[r.season] });
            }
        });

        // Batch fetch points
        const pointsLookup = {}; // `${card_id}_${point_set_id}` -> points
        if (cardsNeedingPoints.length > 0) {
            // Since (card_id, point_set_id) is composite, we can't do simple IN.
            // We can fetch ALL values for the relevant point sets and card IDs.
            const uniqueCardIds = [...new Set(cardsNeedingPoints.map(c => c.card_id))];
            const uniquePsIds = [...new Set(cardsNeedingPoints.map(c => c.point_set_id))];

            if (uniqueCardIds.length > 0 && uniquePsIds.length > 0) {
                const ppvQuery = `
                    SELECT card_id, point_set_id, points
                    FROM player_point_values
                    WHERE card_id = ANY($1::int[]) AND point_set_id = ANY($2::int[])
                `;
                const ppvRes = await client.query(ppvQuery, [uniqueCardIds, uniquePsIds]);
                ppvRes.rows.forEach(row => {
                    pointsLookup[`${row.card_id}_${row.point_set_id}`] = row.points;
                });
            }
        }

        // Group by season
        const rosterHistory = {};

        rosterRes.rows.forEach(r => {
            if (!rosterHistory[r.season]) {
                rosterHistory[r.season] = [];
            }

            // Fill missing points
            let pts = r.points;
            if (pts === null && r.card_id) {
                const psId = pointSetMap[r.season];
                if (psId) {
                    const found = pointsLookup[`${r.card_id}_${psId}`];
                    if (found !== undefined) pts = found;
                }
            }

            const player = {
                card_id: r.card_id,
                name: r.player_name,
                displayName: r.display_name || r.card_name || r.player_name,
                position: r.position,
                points: pts,
                assignment: r.position,
                // NEW FIELDS
                control: r.control,
                ip: r.ip,
                fielding_ratings: r.fielding_ratings,
                image_url: r.image_url
            };

            if (r.control !== null) {
                 if (!player.position || player.position.includes('/')) {
                     player.position = r.ip > 3 ? 'SP' : 'RP';
                 }
            }
            rosterHistory[r.season].push(player);
        });

        const formattedRosters = [];
        const seasonsWithRosters = Object.keys(rosterHistory);
        const sortedRosterSeasons = sortSeasons(seasonsWithRosters);

        const positionOrder = {
            'SP': 1, 'RP': 2, 'C': 3, '1B': 4, '2B': 5, 'SS': 6, '3B': 7,
            'LF': 8, 'CF': 9, 'RF': 10, 'DH': 11, 'B': 12, 'BENCH': 12
        };

        sortedRosterSeasons.forEach(season => {
            let players = rosterHistory[season];
            players.sort((a, b) => {
                const getRank = (p) => {
                    const pos = p.position === 'BENCH' ? 'B' : p.position;
                    return positionOrder[pos] || 99;
                }
                const rankA = getRank(a);
                const rankB = getRank(b);
                if (rankA !== rankB) return rankA - rankB;
                return (b.points || 0) - (a.points || 0);
            });

            formattedRosters.push({
                season: season,
                players: players
            });
        });

        // 4. Accolades (Updated Logic with Exclusion)
        // We reuse the broad query but filter results in JS to avoid "New York" grabbing "New York South" trophies
        const spaceshipQuery = `
            SELECT season_name, date, winning_team_id, winning_team_name, round FROM series_results
            WHERE (winning_team_id = ANY($1::int[]) OR winning_team_name ILIKE $2)
            AND round = 'Golden Spaceship'
            ORDER BY date DESC
        `;
        const spoonQuery = `
            SELECT season_name, date, losing_team_id, losing_team_name, round FROM series_results
            WHERE (losing_team_id = ANY($1::int[]) OR losing_team_name ILIKE $2)
            AND round = 'Wooden Spoon'
            ORDER BY date DESC
        `;
        const submarineQuery = `
            SELECT season_name, date, winning_team_id, winning_team_name, round FROM series_results
            WHERE (winning_team_id = ANY($1::int[]) OR winning_team_name ILIKE $2)
            AND round = 'Silver Submarine'
            ORDER BY date DESC
        `;

        const spaceshipsRes = await client.query(spaceshipQuery, [mappedIds, namePattern]);
        const spoonsRes = await client.query(spoonQuery, [mappedIds, namePattern]);
        const submarinesRes = await client.query(submarineQuery, [mappedIds, namePattern]);

        // Filter Function for Accolades
        const filterAccolades = (rows, isWinner) => {
            return rows.filter(r => {
                const idToCheck = isWinner ? r.winning_team_id : r.losing_team_id;
                const nameToCheck = isWinner ? r.winning_team_name : r.losing_team_name;

                // Use the shared franchiseUtils logic
                return matchesFranchise(nameToCheck, idToCheck, team, allTeams, mappedIds);
            });
        };

        res.json({
            team,
            history: historyList,
            identityHistory: identityHistory.reverse(), // Send Newest -> Oldest for display
            rosters: formattedRosters,
            accolades: {
                spaceships: filterAccolades(spaceshipsRes.rows, true),
                spoons: filterAccolades(spoonsRes.rows, false), // Spoon is for loser usually (unless logic changed, but query used losing_team)
                submarines: filterAccolades(submarinesRes.rows, true)
            }
        });

    } catch (error) {
        console.error('Error fetching team page data:', error);
        res.status(500).json({ message: 'Server error fetching team data.' });
    } finally {
        client.release();
    }
});

// GET SPECIFIC SEASON DETAILS
router.get('/:teamId/seasons/:seasonName', authenticateToken, async (req, res) => {
    const { teamId, seasonName } = req.params;
    const client = await pool.connect();

    try {
        const teamRes = await client.query('SELECT * FROM teams WHERE team_id = $1', [teamId]);
        if (teamRes.rows.length === 0) return res.status(404).json({ message: 'Team not found.' });
        const team = teamRes.rows[0];

        const namePattern = `%${team.name}%`;

        // 1. Fetch Roster
        const rosterQuery = `
            SELECT hr.*, cp.display_name, cp.name as card_name, cp.fielding_ratings, cp.control, cp.ip, cp.image_url
            FROM historical_rosters hr
            LEFT JOIN cards_player cp ON hr.card_id = cp.card_id
            WHERE hr.season = $1
        `;
        // We fetch ALL for the season, then filter in JS using matchesFranchise because we need the full power of aliases
        const allRostersRes = await client.query(rosterQuery, [seasonName]);

        // Need all teams for context in matchesFranchise
        const allTeamsRes = await client.query('SELECT team_id, city, name FROM teams');
        const allTeams = allTeamsRes.rows;
        const mappedIds = getMappedIds(teamId);

        // Filter the rows that belong to this franchise
        const rosterRows = allRostersRes.rows.filter(r => {
             // historical_rosters has 'team_name' but not 'team_id'. We pass null for ID.
             return matchesFranchise(r.team_name, null, team, allTeams, mappedIds);
        });

        // Use the filtered rows
        const rosterRes = { rows: rosterRows };

        // FETCH POINTS IF MISSING
        const psName = mapSeasonToPointSet(seasonName);
        let psId = null;
        if (psName) {
            const psRes = await client.query('SELECT point_set_id FROM point_sets WHERE name = $1', [psName]);
            if (psRes.rows.length > 0) psId = psRes.rows[0].point_set_id;
            else {
                 // Fallback to 'Original Pts'
                 const origRes = await client.query("SELECT point_set_id FROM point_sets WHERE name = 'Original Pts'");
                 if (origRes.rows.length > 0) psId = origRes.rows[0].point_set_id;
            }
        }

        const pointsLookup = {};
        const cardIdsNeedingPoints = rosterRes.rows.filter(r => r.points === null && r.card_id).map(r => r.card_id);

        if (psId && cardIdsNeedingPoints.length > 0) {
             const ppvRes = await client.query(
                'SELECT card_id, points FROM player_point_values WHERE point_set_id = $1 AND card_id = ANY($2::int[])',
                [psId, cardIdsNeedingPoints]
             );
             ppvRes.rows.forEach(row => pointsLookup[row.card_id] = row.points);
        }

        let roster = rosterRes.rows.map(r => {
             let pts = r.points;
             if (pts === null && r.card_id && pointsLookup[r.card_id] !== undefined) {
                 pts = pointsLookup[r.card_id];
             }

             const player = {
                card_id: r.card_id,
                name: r.player_name,
                displayName: r.display_name || r.card_name || r.player_name,
                position: r.position,
                points: pts,
                assignment: r.position,
                // NEW FIELDS
                control: r.control,
                ip: r.ip,
                fielding_ratings: r.fielding_ratings,
                image_url: r.image_url
            };
            if (r.control !== null) {
                 if (!player.position || player.position.includes('/')) {
                     player.position = r.ip > 3 ? 'SP' : 'RP';
                 }
            }
            return player;
        });

        // 2. Fetch Series Results
        const resultsQuery = `
            SELECT * FROM series_results
            WHERE season_name = $1
            ORDER BY date DESC
        `;
        // Again, fetch all for season, filter in JS
        const allResultsRes = await client.query(resultsQuery, [seasonName]);

        const results = [];
        allResultsRes.rows.forEach(r => {
            const isWinner = matchesFranchise(r.winning_team_name, r.winning_team_id, team, allTeams, mappedIds);
            const isLoser = matchesFranchise(r.losing_team_name, r.losing_team_id, team, allTeams, mappedIds);

            if (isWinner) {
                results.push({
                    opponent: r.losing_team_name,
                    result: 'W',
                    score: `${r.winning_score}-${r.losing_score}`,
                    round: r.round,
                    date: r.date
                });
            } else if (isLoser) {
                results.push({
                    opponent: r.winning_team_name,
                    result: 'L',
                    score: `${r.winning_score}-${r.losing_score}`, // Winning score first? Or My score first? Usually W-L implies winner first.
                    // But if I lost, maybe I want "L 2-5".
                    // Code before was: `${r.winning_score}-${r.losing_score}`. So always Winner-Loser.
                    round: r.round,
                    date: r.date
                });
            }
        });

        res.json({
            team,
            season: seasonName,
            roster,
            results
        });

    } catch (error) {
        console.error('Error fetching season details:', error);
        res.status(500).json({ message: 'Server error fetching season details.' });
    } finally {
        client.release();
    }
});

module.exports = router;
