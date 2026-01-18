const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const { sortSeasons } = require('../utils/seasonUtils');

// GET TEAM HISTORY (Seasons, Records, Rosters)
router.get('/:teamId/history', authenticateToken, async (req, res) => {
    const { teamId } = req.params;
    const client = await pool.connect();

    try {
        // 1. Get Current Team Details
        const teamRes = await client.query('SELECT * FROM teams WHERE team_id = $1', [teamId]);
        if (teamRes.rows.length === 0) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        const team = teamRes.rows[0];
        const currentTeamName = `${team.city} ${team.name}`;
        const currentCity = team.city;

        // 2. Fetch Season History from series_results
        // We want to aggregate W-L records per season.
        // Also track what name the team used in each season.
        const historyQuery = `
            SELECT season_name, round, winning_team_id, losing_team_id, winning_team_name, losing_team_name, winning_score, losing_score
            FROM series_results
            WHERE winning_team_id = $1 OR losing_team_id = $1
            ORDER BY date DESC
        `;
        const historyRes = await client.query(historyQuery, [teamId]);

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

            // Determine if won or lost
            const isWinner = Number(r.winning_team_id) === Number(teamId);
            const isLoser = Number(r.losing_team_id) === Number(teamId);

            if (isWinner) {
                seasonStats[season].wins += (r.winning_score || 0); // Logic from league.js usually counts wins as games won?
                // Wait, series_results stores SERIES outcomes or GAME outcomes?
                // League.js seems to sum winning_score/losing_score which implies series count if score is wins.
                // Or if it's "Regular Season", maybe it's game wins?
                // Let's check league.js again.
                // "teamStats[winning_team_id].wins += (winning_score || 0);"
                // This implies winning_score IS the number of wins in that series/matchup.
                // If round is 'Regular Season', winning_score is how many games they won in that pairing?
                // No, 'Regular Season' entries are often generated with NULL scores initially.
                // But completed games update them?
                // Actually, `series_results` seems to store aggregate results of a "series" (pairing).
                // Let's assume winning_score = wins.

                seasonStats[season].wins += (r.winning_score || 0);
                seasonStats[season].losses += (r.losing_score || 0);
                seasonStats[season].teamNameUsed = r.winning_team_name;
            } else if (isLoser) {
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

            // Determine "Result" (e.g. "Champion", "Runner Up", "Playoffs", "Regular Season")
            let result = 'Regular Season';
            if (s.rounds.has('Golden Spaceship')) {
                // If they have a Golden Spaceship entry, they played in the finals.
                // Did they win it?
                const finals = historyRes.rows.find(r => r.season_name === s.season_name && r.round === 'Golden Spaceship');
                if (finals && Number(finals.winning_team_id) === Number(teamId)) {
                    result = 'Champion';
                } else if (finals) {
                    result = 'Runner Up';
                }
            } else if (s.rounds.has('Playoffs') || s.rounds.has('Semi-Finals')) {
                result = 'Playoffs';
            } else if (s.rounds.has('Wooden Spoon')) {
                // Check if they "Won" the Spoon (meaning they lost the spoon series?)
                // Actually Spoon winner is the loser of the league usually?
                // Let's just say "Wooden Spoon" if they played in it.
                const spoonGame = historyRes.rows.find(r => r.season_name === s.season_name && r.round === 'Wooden Spoon');
                if (spoonGame && Number(spoonGame.winning_team_id) === Number(teamId)) {
                     // Usually winning the spoon match means you avoid the spoon?
                     // Or "Wooden Spoon" round implies playing for last place.
                     result = 'Wooden Spoon Participant';
                } else {
                     result = 'Wooden Spoon'; // Lost the spoon game
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

        // Sort seasons using utility
        // sortSeasons expects simple array of strings.
        const sortedSeasonNames = sortSeasons(historyList.map(h => h.season));
        historyList.sort((a, b) => sortedSeasonNames.indexOf(a.season) - sortedSeasonNames.indexOf(b.season));


        // 3. Fetch Roster History
        // We need to find rosters that match the team names identified in history, OR the current city/name.
        // Collect all potential names
        const namesUsed = new Set();
        namesUsed.add(currentTeamName);
        namesUsed.add(currentCity);
        historyList.forEach(h => {
            if (h.teamNameUsed) namesUsed.add(h.teamNameUsed);
        });

        // Also fetch ANY historical roster where the name matches current City
        // (Since random removals use City name)

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
            // Normalize player object
            const player = {
                card_id: r.card_id,
                name: r.player_name,
                displayName: r.display_name || r.card_name || r.player_name, // Try to use card data if available
                position: r.position,
                points: r.points,
                // Add sorting helpers
                assignment: r.position // historical rosters usually store 'SP', 'C', 'LF/RF' etc directly in position column?
            };

            // If we joined with cards_player, we might have better data
            if (r.control !== null) {
                 // It's a pitcher
                 if (!player.position || player.position.includes('/')) {
                     player.position = r.ip > 3 ? 'SP' : 'RP';
                 }
            }

            rosterHistory[r.season].push(player);
        });

        // Format and sort each roster
        const formattedRosters = [];
        const seasonsWithRosters = Object.keys(rosterHistory);
        const sortedRosterSeasons = sortSeasons(seasonsWithRosters);

        // Position sort order (reused from LeagueView)
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

        // 4. Accolades (Reuse existing logic or endpoint?)
        // Since we are here, let's just fetch them to bundle everything.
        // Or we can let the frontend call the existing accolades endpoint.
        // Let's bundle it for efficiency.
        const spaceshipQuery = `
            SELECT season_name, date FROM series_results
            WHERE winning_team_id = $1 AND round = 'Golden Spaceship'
        `;
        const spoonQuery = `
            SELECT season_name, date FROM series_results
            WHERE losing_team_id = $1 AND round = 'Wooden Spoon'
        `;
        const submarineQuery = `
            SELECT season_name, date FROM series_results
            WHERE winning_team_id = $1 AND round = 'Silver Submarine'
        `;

        const spaceships = await client.query(spaceshipQuery, [teamId]);
        const spoons = await client.query(spoonQuery, [teamId]);
        const submarines = await client.query(submarineQuery, [teamId]);

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

module.exports = router;
