// apps/backend/routes/league.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');

// Helper to clean "City City" name repetition (e.g. "Boston Boston")
// and match to a current team
const mapToCurrentTeam = (name, currentTeams) => {
    if (!name) return null;

    // 1. Clean the name (Handle "Boston Boston" -> "Boston")
    let cleanName = name;
    const parts = name.split(' ');
    if (parts.length > 1 && parts.length % 2 === 0) {
        const mid = parts.length / 2;
        const firstHalf = parts.slice(0, mid).join(' ');
        const secondHalf = parts.slice(mid).join(' ');
        if (firstHalf === secondHalf) {
            cleanName = firstHalf;
        }
    }

    // 2. Try to find a match in current teams
    // Match strategies:
    // A. Name contains Team Name (e.g. "Boston Red Sox" contains "Red Sox")
    // B. Name contains City (e.g. "Boston Red Sox" contains "Boston")
    // C. City contains Name (e.g. "Boston" contains "Boston")

    // Sort teams by name length desc to match specific first
    const sortedTeams = [...currentTeams].sort((a, b) => b.name.length - a.name.length);

    let matched = sortedTeams.find(t => cleanName.includes(t.name));
    if (!matched) {
        matched = sortedTeams.find(t => cleanName.includes(t.city));
    }

    // If matched, use the Current Team info, but keep the cleaned name for display if needed
    if (matched) {
        return {
            ...matched,
            displayName: cleanName // Pass this along
        };
    }

    return {
        team_id: null, // Orphan
        name: cleanName,
        city: '',
        logo_url: null,
        displayName: cleanName
    };
};

// GET SEASON LIST
router.get('/seasons', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT season_name
            FROM series_results
            WHERE season_name IS NOT NULL
            ORDER BY season_name DESC
        `;
        const result = await pool.query(query);
        const dateQuery = `
            SELECT season_name, MAX(date) as last_date
            FROM series_results
            WHERE season_name IS NOT NULL
            GROUP BY season_name
            ORDER BY last_date DESC
        `;
        const dateResult = await pool.query(dateQuery);
        res.json(dateResult.rows.map(r => r.season_name));
    } catch (error) {
        console.error('Error fetching seasons:', error);
        res.status(500).json({ message: 'Server error fetching seasons.' });
    }
});

// GET SEASON SUMMARY (Standings and Recent Results)
router.get('/season-summary', authenticateToken, async (req, res) => {
    const { season } = req.query;
    try {
        // 0. Fetch Current Teams for Mapping
        const teamsRes = await pool.query('SELECT team_id, name, city, logo_url FROM teams');
        const currentTeams = teamsRes.rows;

        let currentSeason = season;

        if (!currentSeason && season !== 'all-time') {
            const seasonQuery = `
                SELECT season_name
                FROM series_results
                WHERE season_name IS NOT NULL
                ORDER BY date DESC
                LIMIT 1
            `;
            const seasonResult = await pool.query(seasonQuery);

            if (seasonResult.rows.length === 0) {
                return res.json({ standings: [], recentResults: [] });
            }
            currentSeason = seasonResult.rows[0].season_name;
        }

        // 2. Fetch Series Results
        let resultsQuery = `
            SELECT *
            FROM series_results
            WHERE style IS DISTINCT FROM 'Classic'
        `;
        const params = [];

        if (season !== 'all-time') {
            resultsQuery += ` AND season_name = $1`;
            params.push(currentSeason);
        } else {
             resultsQuery += ` AND season_name IS NOT NULL`;
        }

        resultsQuery += ` ORDER BY date DESC`;

        const resultsResult = await pool.query(resultsQuery, params);
        const seriesResults = resultsResult.rows;

        // 3. Calculate Standings
        const teamStats = {};

        seriesResults.forEach(series => {
            if (series.round === 'Golden Spaceship' || series.round === 'Wooden Spoon' || series.round === 'Silver Submarine') {
                return;
            }

            const { winning_team_name, losing_team_name, winning_score, losing_score } = series;

            // Map to Current Teams
            const winner = mapToCurrentTeam(winning_team_name, currentTeams);
            const loser = mapToCurrentTeam(losing_team_name, currentTeams);

            // Helper to init stats
            const initStats = (t) => {
                const key = t.team_id ? `ID-${t.team_id}` : `NAME-${t.name}`;
                if (!teamStats[key]) {
                    // Display Name Logic:
                    // If All-Time: Use Current Team Name (City + Name)
                    // If Season: Use the name from the result (cleaned)
                    let displayName;
                    if (season === 'all-time') {
                         displayName = t.team_id ? (t.city === t.name ? t.name : `${t.city} ${t.name}`) : t.name;
                    } else {
                         displayName = t.displayName || t.name;
                    }

                    teamStats[key] = {
                        team_id: t.team_id,
                        name: displayName,
                        logo_url: t.logo_url,
                        wins: 0,
                        losses: 0,
                        remaining: 0
                    };
                }
                return key;
            };

            const wKey = initStats(winner);
            const lKey = initStats(loser);

            const isCompleted = winning_score !== null && losing_score !== null;

            if (isCompleted) {
                teamStats[wKey].wins += (winning_score || 0);
                teamStats[lKey].losses += (winning_score || 0);

                teamStats[wKey].losses += (losing_score || 0);
                teamStats[lKey].wins += (losing_score || 0);
            } else {
                teamStats[wKey].remaining += 7;
                teamStats[lKey].remaining += 7;
            }
        });

        // --- CLINCH LOGIC ---
        const teams = Object.values(teamStats);

        teams.forEach(t => {
            const pendingCount = seriesResults.filter(s => {
                if (s.winning_score !== null) return false;
                if (s.round === 'Golden Spaceship' || s.round === 'Wooden Spoon' || s.round === 'Silver Submarine') return false;

                const w = mapToCurrentTeam(s.winning_team_name, currentTeams);
                const l = mapToCurrentTeam(s.losing_team_name, currentTeams);
                const wKey = w.team_id ? `ID-${w.team_id}` : `NAME-${w.name}`;
                const lKey = l.team_id ? `ID-${l.team_id}` : `NAME-${l.name}`;

                const tKey = t.team_id ? `ID-${t.team_id}` : `NAME-${t.name}`;

                return wKey === tKey || lKey === tKey;
            }).length;

            t.maxWins = t.wins + (pendingCount * 4);
            t.minWins = t.wins;
        });

        teams.forEach(team => {
            const teamsCanCatch = teams.filter(other => {
                 const otherKey = other.team_id ? `ID-${other.team_id}` : `NAME-${other.name}`;
                 const teamKey = team.team_id ? `ID-${team.team_id}` : `NAME-${team.name}`;
                 return otherKey !== teamKey && other.maxWins >= team.minWins;
            }).length;
            const clinchedSpaceship = teamsCanCatch < 2;

            const teamsCanSurpass = teams.filter(other => {
                 const otherKey = other.team_id ? `ID-${other.team_id}` : `NAME-${other.name}`;
                 const teamKey = team.team_id ? `ID-${team.team_id}` : `NAME-${team.name}`;
                 return otherKey !== teamKey && other.minWins <= team.maxWins;
            }).length;
            const clinchedSpoon = teamsCanSurpass < 2;

            if (clinchedSpaceship) team.clinch = 'x-';
            else if (clinchedSpoon) team.clinch = 'z-';
            else {
                const teamsGuaranteedAbove = teams.filter(other => {
                    const otherKey = other.team_id ? `ID-${other.team_id}` : `NAME-${other.name}`;
                    const teamKey = team.team_id ? `ID-${team.team_id}` : `NAME-${team.name}`;
                    return otherKey !== teamKey && other.minWins > team.maxWins;
                }).length;
                const eliminatedSpaceship = teamsGuaranteedAbove >= 2;

                const teamsGuaranteedBelow = teams.filter(other => {
                    const otherKey = other.team_id ? `ID-${other.team_id}` : `NAME-${other.name}`;
                    const teamKey = team.team_id ? `ID-${team.team_id}` : `NAME-${team.name}`;
                    return otherKey !== teamKey && other.maxWins < team.minWins;
                }).length;
                const safeSpoon = teamsGuaranteedBelow >= 2;

                if (eliminatedSpaceship && safeSpoon) {
                    team.clinch = 'y-';
                } else {
                    team.clinch = '';
                }
            }
        });

        const standings = teams.map(team => {
            const totalGames = team.wins + team.losses;
            const winPct = totalGames > 0 ? (team.wins / totalGames) : 0;
            return {
                ...team,
                winPct: winPct,
                winPctDisplay: winPct.toFixed(3).replace(/^0+/, '')
            };
        });

        standings.sort((a, b) => {
            if (b.winPct !== a.winPct) return b.winPct - a.winPct;
            return b.wins - a.wins;
        });

        res.json({
            standings,
            recentResults: seriesResults.map(r => {
                const hasScore = r.winning_score !== null && r.losing_score !== null;
                const winner = mapToCurrentTeam(r.winning_team_name, currentTeams);
                const loser = mapToCurrentTeam(r.losing_team_name, currentTeams);

                return {
                    id: r.id,
                    date: r.date,
                    round: r.round,
                    style: r.style,
                    winning_team_id: r.winning_team_id,
                    losing_team_id: r.losing_team_id,
                    winner: r.winning_team_name, // Keeping original names for result rows as per "Use team name listed"?
                    // Or should I use cleaned? "Use the team name listed" probably means cleaned if it was "Boston Boston".
                    // But if it was "Boston", keep "Boston".
                    // The "Cleaned" name is in winner.displayName
                    winner_name: winner.displayName,
                    loser_name: loser.displayName,

                    winner_logo: winner.logo_url,
                    loser_logo: loser.logo_url,
                    score: hasScore ? `${r.winning_score}-${r.losing_score}` : null
                };
            })
        });

    } catch (error) {
        console.error('Error fetching season summary:', error);
        res.status(500).json({ message: 'Server error fetching season summary.' });
    }
});

// GET HEAD-TO-HEAD MATRIX
router.get('/matrix', authenticateToken, async (req, res) => {
    const { season } = req.query;
    try {
        const teamsRes = await pool.query('SELECT team_id, name, city, logo_url FROM teams');
        const currentTeams = teamsRes.rows;

        let currentSeason = season;
        if (!currentSeason || currentSeason === 'all-time') {
             if (!season) {
                const seasonQuery = `SELECT season_name FROM series_results WHERE season_name IS NOT NULL ORDER BY date DESC LIMIT 1`;
                const seasonResult = await pool.query(seasonQuery);
                if (seasonResult.rows.length > 0) currentSeason = seasonResult.rows[0].season_name;
             }
        }

        let query = `SELECT * FROM series_results WHERE style IS DISTINCT FROM 'Classic'`;
        const params = [];
        if (currentSeason && currentSeason !== 'all-time') {
            query += ` AND season_name = $1`;
            params.push(currentSeason);
        }

        const result = await pool.query(query, params);

        const matrix = {};

        const getStatsKey = (t) => t.team_id ? `ID-${t.team_id}` : `NAME-${t.name}`;

        result.rows.forEach(row => {
            if (row.round === 'Golden Spaceship' || row.round === 'Wooden Spoon') return;

            const wScore = row.winning_score || 0;
            const lScore = row.losing_score || 0;

            const winner = mapToCurrentTeam(row.winning_team_name, currentTeams);
            const loser = mapToCurrentTeam(row.losing_team_name, currentTeams);

            const wKey = getStatsKey(winner);
            const lKey = getStatsKey(loser);

            // For Matrix, we usually use Current Names for consistency, especially All-Time
            const wName = winner.team_id ? (winner.city === winner.name ? winner.name : `${winner.city} ${winner.name}`) : winner.name;
            const lName = loser.team_id ? (loser.city === loser.name ? loser.name : `${loser.city} ${loser.name}`) : loser.name;

            if (!matrix[wKey]) matrix[wKey] = { id: wKey, name: wName, opponents: {} };
            if (!matrix[lKey]) matrix[lKey] = { id: lKey, name: lName, opponents: {} };

            // Initialize opponent entries
            if (!matrix[wKey].opponents[lKey]) matrix[wKey].opponents[lKey] = { wins: 0, losses: 0 };
            if (!matrix[lKey].opponents[wKey]) matrix[lKey].opponents[wKey] = { wins: 0, losses: 0 };

            matrix[wKey].opponents[lKey].wins += wScore;
            matrix[wKey].opponents[lKey].losses += lScore;

            matrix[lKey].opponents[wKey].wins += lScore;
            matrix[lKey].opponents[wKey].losses += wScore;
        });

        res.json(Object.values(matrix));

    } catch (error) {
        console.error('Error fetching matrix:', error);
        res.status(500).json({ message: 'Server error fetching matrix.' });
    }
});

// SUBMIT/UPDATE RESULT (POST)
router.post('/result', authenticateToken, async (req, res) => {
    const { id, winning_score, losing_score, winner_id } = req.body;

    if (!id || winning_score === undefined || losing_score === undefined || !winner_id) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    try {
        const originalRes = await pool.query('SELECT * FROM series_results WHERE id = $1', [id]);
        if (originalRes.rows.length === 0) return res.status(404).json({ message: 'Result not found.' });

        const original = originalRes.rows[0];

        let newWinningId = winner_id;
        let newLosingId = (original.winning_team_id === winner_id) ? original.losing_team_id : original.winning_team_id;

        let newWinningName, newLosingName;
        if (winner_id === original.winning_team_id) {
            newWinningName = original.winning_team_name;
            newLosingName = original.losing_team_name;
            newLosingId = original.losing_team_id;
        } else {
            // Swap
            newWinningName = original.losing_team_name;
            newLosingName = original.winning_team_name;
            newLosingId = original.winning_team_id;
        }

        const updateQuery = `
            UPDATE series_results
            SET winning_score = $1, losing_score = $2,
                winning_team_id = $3, losing_team_id = $4,
                winning_team_name = $5, losing_team_name = $6
            WHERE id = $7
        `;

        await pool.query(updateQuery, [
            winning_score, losing_score,
            newWinningId, newLosingId,
            newWinningName, newLosingName,
            id
        ]);

        res.json({ message: 'Result updated successfully.' });

    } catch (error) {
        console.error('Error updating result:', error);
        res.status(500).json({ message: 'Server error updating result.' });
    }
});

module.exports = router;
