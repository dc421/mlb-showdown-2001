// apps/backend/routes/classic.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');

// GET INELIGIBLE PLAYERS (>= 5 Historical Appearances)
router.get('/eligibility', authenticateToken, async (req, res) => {
    try {
        // We only care about player card_ids that have appeared 5 or more times.
        // We join with cards_player to get names for debugging/display if needed,
        // but the ID is the critical part for filtering.
        const query = `
            SELECT card_id, COUNT(*) as appearances
            FROM historical_rosters
            WHERE card_id IS NOT NULL
            GROUP BY card_id
            HAVING COUNT(*) >= 5
        `;
        const result = await pool.query(query);
        const ineligibleIds = result.rows.map(r => r.card_id);

        res.json({ ineligibleIds });
    } catch (error) {
        console.error('Error fetching classic eligibility:', error);
        res.status(500).json({ message: 'Server error fetching eligibility.' });
    }
});

// GET CLASSIC STATE (Bracket, Seeding, Rosters)
router.get('/state', authenticateToken, async (req, res) => {
    try {
        // 1. Seeding: Fetch Wooden Spoon losers
        const spoonQuery = `
            SELECT losing_team_id, date
            FROM series_results
            WHERE round = 'Wooden Spoon'
            ORDER BY date DESC
        `;
        const spoonResult = await pool.query(spoonQuery);

        // Use a Set to get unique most recent losers
        const seeds = [];
        const seenTeams = new Set();

        for (const row of spoonResult.rows) {
            if (!seenTeams.has(row.losing_team_id) && row.losing_team_id) {
                seenTeams.add(row.losing_team_id);
                // Fetch team details
                const teamRes = await pool.query('SELECT name, city, user_id FROM teams WHERE team_id = $1', [row.losing_team_id]);
                if (teamRes.rows.length > 0) {
                    const t = teamRes.rows[0];
                    seeds.push({
                        team_id: row.losing_team_id,
                        user_id: t.user_id,
                        name: `${t.city} ${t.name}`,
                        lastSpoonDate: row.date
                    });
                }
            }
            if (seeds.length >= 5) break; // We only need top 5 seeds
        }

        // 2. Bracket Data: Fetch Classic series results
        const bracketQuery = `
            SELECT * FROM series_results
            WHERE style = 'Classic' OR notes LIKE '%Classic%'
        `;
        // Note: The prompt says "Classic series option". We need to ensure when a game is created as "Classic",
        // the series is marked as such. The current schema has 'series_type'.
        // Let's assume series_type = 'classic'.

        const classicSeriesQuery = `
            SELECT s.*,
                   ht.city as home_city, ht.name as home_name,
                   at.city as away_city, at.name as away_name
            FROM series s
            JOIN teams ht ON s.series_home_user_id = ht.user_id
            LEFT JOIN teams at ON s.series_away_user_id = at.user_id
            WHERE s.series_type = 'classic'
        `;
        const bracketResult = await pool.query(classicSeriesQuery);
        const seriesData = bracketResult.rows.map(s => ({
            id: s.id,
            home: `${s.home_city} ${s.home_name}`,
            away: s.away_name ? `${s.away_city} ${s.away_name}` : 'TBD',
            score: `${s.home_wins}-${s.away_wins}`,
            status: s.status,
            home_user_id: s.series_home_user_id,
            away_user_id: s.series_away_user_id
        }));

        // 3. Roster Reveal Status
        const rosterCountQuery = `
            SELECT COUNT(*) as count
            FROM rosters r
            JOIN roster_cards rc ON r.roster_id = rc.roster_id
            WHERE r.roster_type = 'classic'
        `;
        // Wait, a simple count of rosters isn't enough, we need to know if 5 VALID rosters exist.
        // A valid roster has 20 cards.
        const validRostersQuery = `
            SELECT r.user_id
            FROM rosters r
            JOIN roster_cards rc ON r.roster_id = rc.roster_id
            WHERE r.roster_type = 'classic'
            GROUP BY r.roster_id
            HAVING COUNT(rc.card_id) = 20
        `;
        const validRostersRes = await pool.query(validRostersQuery);
        const readyCount = validRostersRes.rowCount;
        const revealed = readyCount >= 5;

        let rosters = [];
        if (revealed) {
            // Fetch the rosters
            const rostersQuery = `
                SELECT
                    u.user_id,
                    t.city, t.name as team_name,
                    cp.name as player_name, cp.display_name, cp.points,
                    rc.assignment
                FROM rosters r
                JOIN users u ON r.user_id = u.user_id
                JOIN teams t ON u.team_id = t.team_id
                JOIN roster_cards rc ON r.roster_id = rc.roster_id
                JOIN cards_player cp ON rc.card_id = cp.card_id
                WHERE r.roster_type = 'classic'
            `;
            const rostersRes = await pool.query(rostersQuery);

            // Group by user
            const rosterMap = {};
            rostersRes.rows.forEach(row => {
                if (!rosterMap[row.user_id]) {
                    rosterMap[row.user_id] = {
                        team: `${row.city} ${row.team_name}`,
                        players: []
                    };
                }
                rosterMap[row.user_id].players.push(row);
            });
            rosters = Object.values(rosterMap);
        }

        res.json({
            seeding: seeds, // Array of { team_id, name } ordered 5th seed to 1st seed (based on spoon recency)
            series: seriesData,
            revealed,
            rosters,
            readyCount
        });

    } catch (error) {
        console.error('Error fetching classic state:', error);
        res.status(500).json({ message: 'Server error fetching classic state.' });
    }
});

module.exports = router;
