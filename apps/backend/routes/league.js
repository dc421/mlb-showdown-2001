// apps/backend/routes/league.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');

// GET SEASON SUMMARY (Standings and Recent Results)
router.get('/season-summary', authenticateToken, async (req, res) => {
    try {
        // 1. Determine Current Season
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

        const currentSeason = seasonResult.rows[0].season_name;

        // 2. Fetch Series Results for Current Season
        const resultsQuery = `
            SELECT *
            FROM series_results
            WHERE season_name = $1
            ORDER BY date DESC
        `;
        const resultsResult = await pool.query(resultsQuery, [currentSeason]);
        const seriesResults = resultsResult.rows;

        // 3. Calculate Standings
        const teamStats = {};

        seriesResults.forEach(series => {
            const { winning_team_id, winning_team_name, losing_team_id, losing_team_name, winning_score, losing_score } = series;

            // Winning Team
            if (winning_team_id) {
                if (!teamStats[winning_team_id]) {
                    teamStats[winning_team_id] = { team_id: winning_team_id, name: winning_team_name, wins: 0, losses: 0 };
                }
                // Check if name is updated (sometimes names change, take latest or fallback)
                if (!teamStats[winning_team_id].name) teamStats[winning_team_id].name = winning_team_name;

                teamStats[winning_team_id].wins += (winning_score || 0);
                teamStats[winning_team_id].losses += (losing_score || 0);
            }

            // Losing Team
            if (losing_team_id) {
                if (!teamStats[losing_team_id]) {
                    teamStats[losing_team_id] = { team_id: losing_team_id, name: losing_team_name, wins: 0, losses: 0 };
                }
                if (!teamStats[losing_team_id].name) teamStats[losing_team_id].name = losing_team_name;

                teamStats[losing_team_id].wins += (losing_score || 0);
                teamStats[losing_team_id].losses += (winning_score || 0);
            }
        });

        const standings = Object.values(teamStats).map(team => {
            const totalGames = team.wins + team.losses;
            const winPct = totalGames > 0 ? (team.wins / totalGames) : 0;
            return {
                ...team,
                winPct: winPct,
                winPctDisplay: winPct.toFixed(3).replace(/^0+/, '') // e.g. .500
            };
        });

        // Sort Standings: Win % Descending, then Wins Descending
        standings.sort((a, b) => {
            if (b.winPct !== a.winPct) return b.winPct - a.winPct;
            return b.wins - a.wins;
        });

        res.json({
            standings,
            recentResults: seriesResults.map(r => {
                const hasScore = r.winning_score !== null && r.losing_score !== null;
                return {
                    id: r.id,
                    date: r.date,
                    winner: r.winning_team_name,
                    loser: r.losing_team_name,
                    score: hasScore ? `${r.winning_score}-${r.losing_score}` : null
                };
            })
        });

    } catch (error) {
        console.error('Error fetching season summary:', error);
        res.status(500).json({ message: 'Server error fetching season summary.' });
    }
});

module.exports = router;
