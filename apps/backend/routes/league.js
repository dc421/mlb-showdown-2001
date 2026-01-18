// apps/backend/routes/league.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');

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
        // We might want to sort by date, but season_name is all we have in this specific query.
        // Ideally we'd join with a date, but DISTINCT ON is cleaner.
        // Let's try to get them by most recent game date.
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
        let currentSeason = season;

        if (!currentSeason && season !== 'all-time') {
            // 1. Determine Current Season if not provided
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
        `;
        const params = [];

        if (season !== 'all-time') {
            resultsQuery += ` WHERE season_name = $1`;
            params.push(currentSeason);
        } else {
             resultsQuery += ` WHERE season_name IS NOT NULL`; // Filter out garbage if any
        }

        resultsQuery += ` ORDER BY date DESC`;

        const resultsResult = await pool.query(resultsQuery, params);
        const seriesResults = resultsResult.rows;

        // 3. Calculate Standings
        const teamStats = {};

        seriesResults.forEach(series => {
            // Exclude Special Rounds from Standings
            if (series.round === 'Golden Spaceship' || series.round === 'Wooden Spoon' || series.round === 'Silver Submarine') {
                return;
            }

            const { winning_team_id, winning_team_name, losing_team_id, losing_team_name, winning_score, losing_score } = series;

            // Initialize teams
            if (winning_team_id && !teamStats[winning_team_id]) {
                teamStats[winning_team_id] = { team_id: winning_team_id, name: winning_team_name, wins: 0, losses: 0, remaining: 0 };
            }
            if (losing_team_id && !teamStats[losing_team_id]) {
                teamStats[losing_team_id] = { team_id: losing_team_id, name: losing_team_name, wins: 0, losses: 0, remaining: 0 };
            }

            // Update Names
            if (winning_team_id && winning_team_name) teamStats[winning_team_id].name = winning_team_name;
            if (losing_team_id && losing_team_name) teamStats[losing_team_id].name = losing_team_name;

            const isCompleted = winning_score !== null && losing_score !== null;

            if (isCompleted) {
                if (winning_team_id) teamStats[winning_team_id].wins += (winning_score || 0);
                if (losing_team_id) teamStats[losing_team_id].losses += (winning_score || 0); // Losing team gets 'losses' equal to winner's score? No, usually it's series wins.
                // Wait, are these series scores (e.g. 4-2) or game scores?
                // The column is winning_score (integer) and losing_score (integer).
                // In a series context, this usually means Series Wins (e.g. 4) vs Series Losses (e.g. 2).
                // So yes, add winning_score to wins, and losing_score to losses.

                if (winning_team_id) teamStats[winning_team_id].losses += (losing_score || 0);
                if (losing_team_id) teamStats[losing_team_id].wins += (losing_score || 0);
            } else {
                // Scheduled Game (Series) - assuming it's a best of 7 series that hasn't started or finished?
                // If the score is null, it's a scheduled series.
                // We should count this as a "potential" 7 games (or 4 wins) available?
                // Actually, simpler: A scheduled series is usually 1 matchup.
                // If we are tracking W-L of *games* within series, we need to know how many games are in a series.
                // Assuming standard 7 game series for league play.
                // But wait, `series_results` stores the *result of the series*.
                // e.g. "Boston 4, New York 2".
                // If it's null, the series hasn't happened.
                // Since we are aggregating "Wins" and "Losses" (games won/lost),
                // a pending series represents 7 *potential* games (or 4 potential wins).
                // However, the standing table shows W and L.
                // Let's assume a pending series adds 7 to the "remaining games" count for clinch math?
                // Or maybe just count series?
                // The current code does: wins += winning_score. This implies we are counting INDIVIDUAL GAME wins.

                if (winning_team_id) teamStats[winning_team_id].remaining += 7; // Approx max games
                if (losing_team_id) teamStats[losing_team_id].remaining += 7;
            }
        });

        // --- CLINCH LOGIC ---
        // x- Clinched Spaceship (Top 2)
        // z- Clinched Spoon (Bottom 2)
        // y- Clinched Neither (Middle)

        const teams = Object.values(teamStats);

        // Sort for Rank determination
        // Note: This sort is just for current standing, not max possible
        const sortTeams = (list) => {
             return list.sort((a, b) => {
                const totalA = a.wins + a.losses;
                const totalB = b.wins + b.losses;
                const pctA = totalA > 0 ? a.wins / totalA : 0;
                const pctB = totalB > 0 ? b.wins / totalB : 0;
                if (pctB !== pctA) return pctB - pctA;
                return b.wins - a.wins;
            });
        };

        // We need to determine if a team can mathematically reach the top 2 or fall to bottom 2.
        // Simplification:
        // Max Possible Wins = Current Wins + Remaining Games (assuming winning all remaining 7-game series 4-0? No, 7-0?
        // In MLB Showdown league, you get a win for every game won.
        // So pending series = 7 potential wins.

        // Actually, if a series is played 4-3, the winner gets 4 wins, loser gets 3. Total 7.
        // If 4-0, total 4.
        // This makes "remaining games" variable.
        // Let's assume "Remaining Wins Available" = (Number of Pending Series * 4).
        // Because you can't get more than 4 wins in a series.
        // But the *loser* could also get 3 wins.
        // This makes exact math hard without a fixed schedule size.
        // Let's assume a pending series offers a max of 4 wins to a team.

        teams.forEach(t => {
            // Count pending series for this team
            const pendingCount = seriesResults.filter(s =>
                (s.winning_team_id === t.team_id || s.losing_team_id === t.team_id) &&
                s.winning_score === null &&
                (s.round !== 'Golden Spaceship' && s.round !== 'Wooden Spoon' && s.round !== 'Silver Submarine')
            ).length;

            t.maxWins = t.wins + (pendingCount * 4); // Best case: sweep all pending series
            t.minWins = t.wins; // Worst case: lose all pending series 0-4
        });

        // Check Spaceship (Top 2) Clinch
        // A team X clinches Top 2 if their Minimum Wins > 3rd Place's Maximum Wins.
        // Who is "3rd Place"? The team with the 3rd highest Max Wins? No.
        // We need to verify that AT MOST 1 other team can exceed Team X's Min Wins.

        // Check Spoon (Bottom 2) Clinch
        // A team Y clinches Bottom 2 if their Maximum Wins < 3rd-to-Last Place's Minimum Wins.
        // i.e., at most 1 team will finish below them (or equal).

        // Note: This logic assumes all teams play the same number of series, or close to it.

        teams.forEach(team => {
            // Can this team be pushed out of Top 2?
            // Count how many OTHER teams could possibly surpass or tie this team's CURRENT MINIMUM wins.
            // If count < 2, then this team is guaranteed Top 2.
            const teamsCanCatch = teams.filter(other => other.team_id !== team.team_id && other.maxWins >= team.minWins).length;
            const clinchedSpaceship = teamsCanCatch < 2; // Only 0 or 1 team can catch us.

            // Can this team escape Bottom 2?
            // Count how many OTHER teams this team could possibly surpass (or tie).
            // i.e., Other Team's Min Wins <= This Team's Max Wins.
            // If this count < 2, then at most 1 team is below us. -> We are bottom 2.
            // Wait, logic check:
            // If I can catch 5 teams, I am safe.
            // If I can catch only 1 team (or 0), I am stuck in bottom 2.
            const teamsCanSurpass = teams.filter(other => other.team_id !== team.team_id && other.minWins <= team.maxWins).length;
            const clinchedSpoon = teamsCanSurpass < 2;

            if (clinchedSpaceship) team.clinch = 'x-';
            else if (clinchedSpoon) team.clinch = 'z-';
            else {
                // Check if they are eliminated from Spaceship AND safe from Spoon?
                // Eliminated from Spaceship: Impossible to reach Top 2.
                // i.e. My Max Wins < 2nd Place Min Wins?
                // More robust: count teams that are guaranteed to finish above me.
                // teamsGuaranteedAbove = teams.filter(other => other.minWins > team.maxWins).length
                // If teamsGuaranteedAbove >= 2, I cannot make Top 2.

                const teamsGuaranteedAbove = teams.filter(other => other.team_id !== team.team_id && other.minWins > team.maxWins).length;
                const eliminatedSpaceship = teamsGuaranteedAbove >= 2;

                // Safe from Spoon: Guaranteed to finish above at least 2 teams.
                // teamsGuaranteedBelow = teams.filter(other => other.maxWins < team.minWins).length
                // If teamsGuaranteedBelow >= 2, I am safe from Spoon.
                const teamsGuaranteedBelow = teams.filter(other => other.team_id !== team.team_id && other.maxWins < team.minWins).length;
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
                    round: r.round,
                    style: r.style,
                    winning_team_id: r.winning_team_id,
                    losing_team_id: r.losing_team_id,
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

// GET HEAD-TO-HEAD MATRIX
router.get('/matrix', authenticateToken, async (req, res) => {
    const { season } = req.query;
    try {
        let currentSeason = season;
        if (!currentSeason || currentSeason === 'all-time') {
             // For all-time, we just don't filter by season?
             // Or we aggregate everything.
             // If season is explicitly 'all-time', we query all.
             // If season is missing, we default to current (like summary).
             if (!season) {
                const seasonQuery = `SELECT season_name FROM series_results WHERE season_name IS NOT NULL ORDER BY date DESC LIMIT 1`;
                const seasonResult = await pool.query(seasonQuery);
                if (seasonResult.rows.length > 0) currentSeason = seasonResult.rows[0].season_name;
             }
        }

        let query = `SELECT * FROM series_results`;
        const params = [];
        if (currentSeason && currentSeason !== 'all-time') {
            query += ` WHERE season_name = $1`;
            params.push(currentSeason);
        }

        const result = await pool.query(query, params);

        const matrix = {}; // { teamId: { name: '...', opponents: { oppId: { w, l } } } }

        result.rows.forEach(row => {
            if (row.round === 'Golden Spaceship' || row.round === 'Wooden Spoon') return; // Exclude postseason? Usually matrix is reg season.
            // Assuming we include all valid rounds.

            const wId = row.winning_team_id;
            const lId = row.losing_team_id;
            const wName = row.winning_team_name;
            const lName = row.losing_team_name;
            const wScore = row.winning_score || 0;
            const lScore = row.losing_score || 0;

            if (!matrix[wId]) matrix[wId] = { id: wId, name: wName, opponents: {} };
            if (!matrix[lId]) matrix[lId] = { id: lId, name: lName, opponents: {} };

            // Ensure names are up to date
            matrix[wId].name = wName;
            matrix[lId].name = lName;

            // Initialize opponent entries
            if (!matrix[wId].opponents[lId]) matrix[wId].opponents[lId] = { wins: 0, losses: 0 };
            if (!matrix[lId].opponents[wId]) matrix[lId].opponents[wId] = { wins: 0, losses: 0 };

            // Winner perspective
            matrix[wId].opponents[lId].wins += wScore; // Games won
            matrix[wId].opponents[lId].losses += lScore; // Games lost

            // Loser perspective
            matrix[lId].opponents[wId].wins += lScore;
            matrix[lId].opponents[wId].losses += wScore;
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

    // id is series_results.id
    if (!id || winning_score === undefined || losing_score === undefined || !winner_id) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    try {
        // Fetch original to verify and get names/IDs
        const originalRes = await pool.query('SELECT * FROM series_results WHERE id = $1', [id]);
        if (originalRes.rows.length === 0) return res.status(404).json({ message: 'Result not found.' });

        const original = originalRes.rows[0];

        let newWinningId = winner_id;
        let newLosingId = (original.winning_team_id === winner_id) ? original.losing_team_id : original.winning_team_id;

        // Wait, what if the user swapped the winner in the UI?
        // original.winning_team_id might be Team A, original.losing might be Team B.
        // If user says Team B won (winner_id = Team B ID), then newWinningId = Team B, newLosingId = Team A.

        // If original.winning_team_id was ALREADY Team B (if score was null, maybe it was set arbitrarily?)
        // Usually scheduled games have winning_team_id as home? No, logic above uses winning/losing columns.
        // In DB, scheduled games might just have placeholders.
        // Let's rely on the IDs passed.

        // Verify names map correctly
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
