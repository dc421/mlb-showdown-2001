// apps/backend/routes/league.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const { matchesFranchise, getMappedIds, parseHistoricalIdentity, getLogoForTeam } = require('../utils/franchiseUtils');
const { mapSeasonToPointSet } = require('../utils/seasonUtils');
const { calculateStandings, findTeamForRecord } = require('../utils/standingsUtils');
const { checkAllTeamsPlayed, snapshotRosters, rolloverPointSets } = require('../services/seasonRolloverService');

function processPlayers(playersToProcess) {
    if (!playersToProcess) return [];
    playersToProcess.forEach(p => {
        if (!p) return;
        p.displayName = p.display_name;
        if (p.control !== null) {
            p.displayPosition = Number(p.ip) > 3 ? 'SP' : 'RP';
        } else {
            const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings).join(',') : 'DH';
            p.displayPosition = positions.replace(/LFRF/g, 'LF/RF');
        }
    });
    return playersToProcess;
};

// GET LEAGUE ROSTERS (Modified to accept season)
router.get('/', authenticateToken, async (req, res) => {
    let { point_set_id, season } = req.query;
    if (!point_set_id) {
        return res.status(400).json({ message: 'A point_set_id is required.' });
    }

    if (season === 'all-time') {
        // Hide rosters for all-time view
        return res.json([]);
    }

    try {
        let teamsMap = {};

        // Fetch Current Teams Metadata (Always needed for structure)
        // Ensure we fetch 'name' (not aliased) to work with findTeamForRecord/matchesFranchise
        const teamsRes = await pool.query('SELECT teams.team_id, teams.city, teams.name, teams.logo_url, teams.display_format, teams.user_id, users.owner_first_name, users.owner_last_name FROM teams JOIN users ON teams.user_id = users.user_id');
        const currentTeams = teamsRes.rows;

        // Initialize teamsMap with Current Teams
        currentTeams.forEach(t => {
            const format = t.display_format || '{city} {name}';
            teamsMap[t.team_id] = {
                team_id: t.team_id,
                city: t.city,
                name: t.name,
                logo_url: t.logo_url,
                owner: `${t.owner_first_name} ${t.owner_last_name}`,
                full_display_name: format.replace('{city}', t.city).replace('{name}', t.name),
                roster: []
            };
        });

        // Check if the requested season is the Active/Draft season
        // If so, we treat it as "Current Rosters" (fetching from roster_cards)
        let isDraftSeason = false;
        if (season) {
             const activeDraftRes = await pool.query('SELECT season_name FROM draft_state WHERE is_active = true LIMIT 1');
             if (activeDraftRes.rows.length > 0 && activeDraftRes.rows[0].season_name === season) {
                 isDraftSeason = true;
             }
             if (season === 'Upcoming Season' || season === 'Live Draft') isDraftSeason = true;
        }

        // --- Check for Active Season (Pre-Rollover) ---
        // If the season is the latest in series_results BUT has no historical rosters, it's "Live"
        if (season && !isDraftSeason) {
            const histCheck = await pool.query('SELECT 1 FROM historical_rosters WHERE season = $1 LIMIT 1', [season]);
            if (histCheck.rows.length === 0) {
                const latestSeasonRes = await pool.query('SELECT season_name FROM series_results ORDER BY date DESC LIMIT 1');
                if (latestSeasonRes.rows.length > 0 && latestSeasonRes.rows[0].season_name === season) {
                    isDraftSeason = true; // Treat as live
                }
            }
        }

        // --- FIX: Force 'Upcoming Season' point set for active draft or pre-rollover season ---
        if (isDraftSeason) {
            const upcomingPsRes = await pool.query("SELECT point_set_id FROM point_sets WHERE name = 'Upcoming Season'");
            if (upcomingPsRes.rows.length > 0) {
                point_set_id = upcomingPsRes.rows[0].point_set_id;
            }
        }
        // -------------------------------------------------------------

        if (season && !isDraftSeason) {
            // HISTORICAL ROSTERS

            // Determine correct Point Set for this season
            const psName = mapSeasonToPointSet(season);
            let targetPointSetId = point_set_id; // Default to query param

            if (psName) {
                const psRes = await pool.query('SELECT point_set_id FROM point_sets WHERE name = $1', [psName]);
                if (psRes.rows.length > 0) {
                    targetPointSetId = psRes.rows[0].point_set_id;
                } else {
                     // Fallback to 'Original Pts'
                     const origRes = await pool.query("SELECT point_set_id FROM point_sets WHERE name = 'Original Pts'");
                     if (origRes.rows.length > 0) targetPointSetId = origRes.rows[0].point_set_id;
                }
            }

            // Fetch all historical rosters for this season
            const rosterQuery = `
                SELECT
                    hr.*,
                    cp.display_name, cp.name as card_name, cp.fielding_ratings, cp.control, cp.ip, cp.image_url,
                    ppv.points
                FROM historical_rosters hr
                LEFT JOIN cards_player cp ON hr.card_id = cp.card_id
                LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $2
                WHERE hr.season = $1
            `;
            const rosterRes = await pool.query(rosterQuery, [season, targetPointSetId]);

            // Map each row to a team using Robust Matching
            rosterRes.rows.forEach(row => {
                 const matchedTeam = findTeamForRecord(row.team_name, null, currentTeams);

                 if (matchedTeam && matchedTeam.team_id && teamsMap[matchedTeam.team_id]) {
                     // Update logo if historical (Explicit check)
                     const historicalLogo = getLogoForTeam(row.team_name, matchedTeam.logo_url);
                     if (historicalLogo && historicalLogo !== teamsMap[matchedTeam.team_id].logo_url) {
                         teamsMap[matchedTeam.team_id].logo_url = historicalLogo;
                     }

                     // Update Name/City based on historical identity
                     const identity = parseHistoricalIdentity(row.team_name);
                     if (identity) {
                         teamsMap[matchedTeam.team_id].city = identity.city;
                         if (identity.name) {
                             teamsMap[matchedTeam.team_id].name = identity.name;
                         }
                     } else if (row.team_name && row.team_name !== matchedTeam.name && row.team_name !== matchedTeam.city) {
                         // Fallback: If no explicit identity parsed but name differs significantly, use it.
                         // This handles partial matches or unmapped aliases.
                         teamsMap[matchedTeam.team_id].full_display_name = row.team_name;
                     }

                     // Recompute full display name if identity was found
                     if (identity) {
                         const t = teamsMap[matchedTeam.team_id];
                         const format = t.display_format || '{city} {name}';
                         const c = t.city || '';
                         const n = t.name || '';
                         teamsMap[matchedTeam.team_id].full_display_name = format.replace('{city}', c).replace('{name}', n);
                     }

                     // Add to the correct team bucket
                     const player = {
                        card_id: row.card_id,
                        name: row.player_name,
                        displayName: row.display_name || row.card_name || row.player_name,
                        position: row.position,
                        points: row.points,
                        assignment: row.position,
                        // Add display properties
                        display_name: row.display_name || row.card_name || row.player_name,
                        control: row.control,
                        ip: row.ip,
                        fielding_ratings: row.fielding_ratings,
                        is_starter: row.position !== 'BENCH' && row.position !== 'PITCHING_STAFF'
                     };

                     teamsMap[matchedTeam.team_id].roster.push(player);
                 }
            });

        } else {
            // CURRENT ROSTERS (Existing Logic)
            const query = `
                SELECT
                    t.team_id,
                    cp.*,
                    rc.assignment, rc.is_starter,
                    ppv.points
                FROM teams t
                JOIN users u ON t.user_id = u.user_id
                JOIN rosters r ON u.user_id = r.user_id AND r.roster_type = 'league'
                JOIN roster_cards rc ON r.roster_id = rc.roster_id
                JOIN cards_player cp ON rc.card_id = cp.card_id
                LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $1
                ORDER BY t.city, t.name, rc.is_starter DESC, cp.display_name
            `;
            const result = await pool.query(query, [point_set_id]);

            result.rows.forEach(row => {
                 if (teamsMap[row.team_id]) {
                     const player = { ...row };
                     delete player.team_id;
                     teamsMap[row.team_id].roster.push(player);
                 }
            });
        }

        // Process players for each team (Common Logic)
        const positionOrder = {
            'SP': 1, 'RP': 2, 'C': 3, '1B': 4, '2B': 5, 'SS': 6, '3B': 7,
            'LF': 8, 'CF': 9, 'RF': 10, 'DH': 11, 'B': 12
        };

        const leagueData = Object.values(teamsMap).map(team => {
            team.roster = processPlayers(team.roster);

            // Apply transformations and sorting
            team.roster.forEach(p => {
                if (p.assignment === 'BENCH') {
                    p.assignment = 'B';
                    if (p.points) p.points = Math.round(p.points / 5);
                }
            });

            team.roster.sort((a, b) => {
                const getSortPos = (p) => {
                    if (p.assignment === 'B') return 'B';
                    if (p.assignment === 'PITCHING_STAFF') {
                        return p.displayPosition; // SP or RP
                    }
                    return p.assignment || p.displayPosition;
                };

                const posA = getSortPos(a);
                const posB = getSortPos(b);

                const rankA = positionOrder[posA] || 99;
                const rankB = positionOrder[posB] || 99;

                if (rankA !== rankB) {
                    return rankA - rankB;
                }

                return (b.points || 0) - (a.points || 0);
            });

            return team;
        });

        res.json(leagueData);
    } catch (error) {
        console.error('Error fetching league data:', error);
        res.status(500).json({ message: 'Server error fetching league data.' });
    }
});

// GET SEASON LIST
router.get('/seasons', authenticateToken, async (req, res) => {
    try {
        const dateQuery = `
            SELECT season_name, MAX(date) as last_date
            FROM series_results
            WHERE season_name IS NOT NULL
            GROUP BY season_name
            ORDER BY last_date DESC
        `;
        const dateResult = await pool.query(dateQuery);
        const seasons = dateResult.rows.map(r => r.season_name);

        // Check for active draft season
        const activeDraftRes = await pool.query('SELECT season_name FROM draft_state WHERE is_active = true LIMIT 1');
        if (activeDraftRes.rows.length > 0) {
            const activeSeason = activeDraftRes.rows[0].season_name;
            if (!seasons.includes(activeSeason)) {
                // Add to the top of the list
                seasons.unshift(activeSeason);
            }
        }

        res.json(seasons);
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
        const standings = calculateStandings(seriesResults, currentTeams, season === 'all-time');

        if (season === 'all-time') {
            res.json({
                standings,
                recentResults: [] // Hide recent results for all-time
            });
        } else {
            res.json({
                standings,
                recentResults: seriesResults.map(r => {
                    const hasScore = r.winning_score !== null && r.losing_score !== null;
                    const winner = findTeamForRecord(r.winning_team_name, r.winning_team_id, currentTeams);
                    const loser = findTeamForRecord(r.losing_team_name, r.losing_team_id, currentTeams);

                    return {
                        id: r.id,
                        date: r.date,
                        round: r.round,
                        style: r.style,
                        winning_team_id: r.winning_team_id,
                        losing_team_id: r.losing_team_id,
                        winner: r.winning_team_name,
                        winner_name: winner.displayName,
                        loser_name: loser.displayName,

                        winner_logo: winner.logo_url,
                        loser_logo: loser.logo_url,
                        score: hasScore ? `${r.winning_score}-${r.losing_score}` : null
                    };
                })
            });
        }

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
            const wScore = row.winning_score || 0;
            const lScore = row.losing_score || 0;

            const winner = findTeamForRecord(row.winning_team_name, row.winning_team_id, currentTeams);
            const loser = findTeamForRecord(row.losing_team_name, row.losing_team_id, currentTeams);

            const wKey = getStatsKey(winner);
            const lKey = getStatsKey(loser);

            // For Matrix, we usually use Current Names for consistency, especially All-Time
            const wName = winner.team_id ? winner.city : winner.name;
            const lName = loser.team_id ? loser.city : loser.name;

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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const originalRes = await client.query('SELECT * FROM series_results WHERE id = $1', [id]);
        if (originalRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Result not found.' });
        }

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

        await client.query(updateQuery, [
            winning_score, losing_score,
            newWinningId, newLosingId,
            newWinningName, newLosingName,
            id
        ]);

        // --- NEW: Check for Season Rollover ---
        const seasonName = original.season_name;
        // Check if this game being finished triggers the "All Teams Played" condition
        const allPlayed = await checkAllTeamsPlayed(client, seasonName);

        if (allPlayed) {
            const histCheck = await client.query('SELECT 1 FROM historical_rosters WHERE season = $1 LIMIT 1', [seasonName]);
            if (histCheck.rows.length === 0) {
                console.log(`Triggering Season Rollover for ${seasonName}...`);
                await snapshotRosters(client, seasonName);

                const psCheck = await client.query('SELECT 1 FROM point_sets WHERE name = $1', [seasonName]);
                if (psCheck.rows.length === 0) {
                    await rolloverPointSets(client, seasonName);
                }
            }
        }
        // ------------------------------------

        await client.query('COMMIT');
        res.json({ message: 'Result updated successfully.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating result:', error);
        res.status(500).json({ message: 'Server error updating result.' });
    } finally {
        client.release();
    }
});

module.exports = router;
