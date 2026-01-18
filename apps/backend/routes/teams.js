const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const { sortSeasons } = require('../utils/seasonUtils');

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

        const historyQuery = `
            SELECT season_name, round, winning_team_id, losing_team_id, winning_team_name, losing_team_name, winning_score, losing_score
            FROM series_results
            WHERE (winning_team_name ILIKE $1 OR losing_team_name ILIKE $1)
            ORDER BY date DESC
        `;

        const historyRes = await client.query(historyQuery, [namePattern]);

        const seasonStats = {}; // season_name -> { wins, losses, rounds: [], teamNameUsed: string }

        historyRes.rows.forEach(r => {
            const season = r.season_name;
            if (!seasonStats[season]) {
                seasonStats[season] = {
                    season_name: season,
                    wins: 0,
                    losses: 0,
                    rounds: new Set(),
                    teamNameUsed: null
                };
            }

            // Check if this row is relevant to the queried team
            const isWinnerName = r.winning_team_name && r.winning_team_name.includes(team.name);
            const isLoserName = r.losing_team_name && r.losing_team_name.includes(team.name);

            if (isWinnerName) {
                seasonStats[season].wins += (r.winning_score || 0);
                seasonStats[season].losses += (r.losing_score || 0);
                seasonStats[season].teamNameUsed = r.winning_team_name;
            } else if (isLoserName) {
                seasonStats[season].wins += (r.losing_score || 0);
                seasonStats[season].losses += (r.winning_score || 0);
                seasonStats[season].teamNameUsed = r.losing_team_name;
            }

            if (r.round) {
                seasonStats[season].rounds.add(r.round);
            }
        });

        // Convert stats to array
        const historyList = Object.values(seasonStats).map(s => {
            const total = s.wins + s.losses;
            const winPct = total > 0 ? (s.wins / total).toFixed(3).replace(/^0+/, '') : '.000';

            // Determine "Result"
            let result = 'Regular Season';
            if (s.rounds.has('Golden Spaceship')) {
                const finals = historyRes.rows.find(r => r.season_name === s.season_name && r.round === 'Golden Spaceship');
                if (finals && finals.winning_team_name.includes(team.name)) {
                    result = 'Champion';
                } else if (finals) {
                    result = 'Runner Up';
                }
            } else if (s.rounds.has('Playoffs') || s.rounds.has('Semi-Finals')) {
                result = 'Playoffs';
            } else if (s.rounds.has('Wooden Spoon')) {
                const spoonGame = historyRes.rows.find(r => r.season_name === s.season_name && r.round === 'Wooden Spoon');
                // Usually winning the spoon match means you avoid the spoon (unless logic implies winner GETS spoon)
                // Let's assume standard logic: Spoon Game Loser = Spoon Winner
                if (spoonGame && spoonGame.losing_team_name.includes(team.name)) {
                     result = 'Wooden Spoon';
                } else {
                     result = 'Wooden Spoon Participant';
                }
            }

            return {
                season: s.season_name,
                wins: s.wins,
                losses: s.losses,
                winPct,
                result,
                teamNameUsed: s.teamNameUsed
            };
        });

        const sortedSeasonNames = sortSeasons(historyList.map(h => h.season));
        historyList.sort((a, b) => sortedSeasonNames.indexOf(a.season) - sortedSeasonNames.indexOf(b.season));


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
            SELECT hr.*, cp.display_name, cp.name as card_name, cp.fielding_ratings, cp.control, cp.ip
            FROM historical_rosters hr
            LEFT JOIN cards_player cp ON hr.card_id = cp.card_id
            WHERE hr.team_name = ANY($1::text[])
        `;

        const rosterRes = await client.query(rosterQuery, [[...namesUsed]]);

        // Group by season
        const rosterHistory = {};

        rosterRes.rows.forEach(r => {
            if (!rosterHistory[r.season]) {
                rosterHistory[r.season] = [];
            }
            const player = {
                card_id: r.card_id,
                name: r.player_name,
                displayName: r.display_name || r.card_name || r.player_name,
                position: r.position,
                points: r.points,
                assignment: r.position
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

        // 4. Accolades (Updated Logic to match server.js AND use Name Matching)
        // Use mapped IDs for extra safety, plus name matching
        const mappedIds = getMappedIds(teamId);

        const spaceshipQuery = `
            SELECT season_name, date FROM series_results
            WHERE (winning_team_id = ANY($1::int[]) OR winning_team_name ILIKE $2)
            AND round = 'Golden Spaceship'
            ORDER BY date DESC
        `;
        const spoonQuery = `
            SELECT season_name, date FROM series_results
            WHERE (losing_team_id = ANY($1::int[]) OR losing_team_name ILIKE $2)
            AND round = 'Wooden Spoon'
            ORDER BY date DESC
        `;
        const submarineQuery = `
            SELECT season_name, date FROM series_results
            WHERE (winning_team_id = ANY($1::int[]) OR winning_team_name ILIKE $2)
            AND round = 'Silver Submarine'
            ORDER BY date DESC
        `;

        const spaceships = await client.query(spaceshipQuery, [mappedIds, namePattern]);
        const spoons = await client.query(spoonQuery, [mappedIds, namePattern]);
        const submarines = await client.query(submarineQuery, [mappedIds, namePattern]);

        res.json({
            team,
            history: historyList,
            rosters: formattedRosters,
            accolades: {
                spaceships: spaceships.rows,
                spoons: spoons.rows,
                submarines: submarines.rows
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
            SELECT hr.*, cp.display_name, cp.name as card_name, cp.fielding_ratings, cp.control, cp.ip
            FROM historical_rosters hr
            LEFT JOIN cards_player cp ON hr.card_id = cp.card_id
            WHERE hr.season = $1 AND (hr.team_name ILIKE $2 OR hr.team_name = $3)
        `;
        // Match against generic name pattern OR exact city+name (in case user query is strict)
        const rosterRes = await client.query(rosterQuery, [seasonName, namePattern, `${team.city} ${team.name}`]);

        let roster = rosterRes.rows.map(r => {
             const player = {
                card_id: r.card_id,
                name: r.player_name,
                displayName: r.display_name || r.card_name || r.player_name,
                position: r.position,
                points: r.points,
                assignment: r.position
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
            WHERE season_name = $1 AND (winning_team_name ILIKE $2 OR losing_team_name ILIKE $2)
            ORDER BY date DESC
        `;
        const resultsRes = await client.query(resultsQuery, [seasonName, namePattern]);

        const results = resultsRes.rows.map(r => {
            const isWinner = r.winning_team_name.includes(team.name);
            return {
                opponent: isWinner ? r.losing_team_name : r.winning_team_name,
                result: isWinner ? 'W' : 'L',
                score: `${r.winning_score}-${r.losing_score}`,
                round: r.round,
                date: r.date
            };
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
