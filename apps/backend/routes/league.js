// apps/backend/routes/league.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');

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
    const { point_set_id, season } = req.query;
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
        const teamsRes = await pool.query('SELECT teams.team_id, teams.city, teams.name as team_name, teams.logo_url, teams.display_format, teams.user_id, users.owner_first_name, users.owner_last_name FROM teams JOIN users ON teams.user_id = users.user_id');
        const currentTeams = teamsRes.rows;

        // Initialize teamsMap with Current Teams
        currentTeams.forEach(t => {
            const format = t.display_format || '{city} {name}';
            teamsMap[t.team_id] = {
                team_id: t.team_id,
                city: t.city,
                name: t.team_name,
                logo_url: t.logo_url,
                owner: `${t.owner_first_name} ${t.owner_last_name}`,
                full_display_name: format.replace('{city}', t.city).replace('{name}', t.team_name),
                roster: []
            };
        });

        if (season) {
            // HISTORICAL ROSTERS
            // Fetch team ID mapping for this season from series_results to ensure correct attribution
            const idMapQuery = `
                SELECT winning_team_name as name, winning_team_id as id FROM series_results WHERE season_name = $1
                UNION
                SELECT losing_team_name as name, losing_team_id as id FROM series_results WHERE season_name = $1
            `;
            const idMapRes = await pool.query(idMapQuery, [season]);
            const seasonIdMap = {};
            idMapRes.rows.forEach(row => {
                if (row.name) seasonIdMap[row.name] = row.id;
            });

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
            const rosterRes = await pool.query(rosterQuery, [season, point_set_id]);

            // Map each row to a team
            rosterRes.rows.forEach(row => {
                 let targetTeamId = seasonIdMap[row.team_name];

                 // Fallback to name matching if not found in series_results (e.g. team played no games or name mismatch)
                 if (!targetTeamId) {
                     const matched = mapToCurrentTeam(row.team_name, currentTeams);
                     if (matched) targetTeamId = matched.team_id;
                 }

                 if (targetTeamId && teamsMap[targetTeamId]) {
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

                     teamsMap[targetTeamId].roster.push(player);
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
        if (season === 'all-time') {
            // --- ALL-TIME LOGIC ---
            // Calculate Stats Per Season First for Avg Finish
            const uniqueSeasons = [...new Set(seriesResults.map(r => r.season_name))].filter(Boolean);
            const seasonRankings = {}; // season -> [{ teamId, wins, winPct }]

            uniqueSeasons.forEach(s => {
                const sResults = seriesResults.filter(r => r.season_name === s);
                const sStats = {};
                sResults.forEach(series => {
                    if (series.round === 'Golden Spaceship' || series.round === 'Wooden Spoon' || series.round === 'Silver Submarine') return;

                    // Use IDs directly from series_results for Franchise aggregation
                    const winnerId = series.winning_team_id;
                    const loserId = series.losing_team_id;

                    if (!winnerId || !loserId) return;

                    // Use Mapped IDs (Franchise Logic)
                    const wFranchiseId = getMappedIds(winnerId)[0];
                    const lFranchiseId = getMappedIds(loserId)[0];

                    if (!sStats[wFranchiseId]) sStats[wFranchiseId] = { wins: 0, losses: 0 };
                    if (!sStats[lFranchiseId]) sStats[lFranchiseId] = { wins: 0, losses: 0 };

                    if (series.winning_score !== null) {
                         sStats[wFranchiseId].wins += series.winning_score;
                         sStats[wFranchiseId].losses += series.losing_score;

                         sStats[lFranchiseId].losses += series.winning_score;
                         sStats[lFranchiseId].wins += series.losing_score;
                    }
                });

                // Convert to array and sort
                const sTeams = Object.keys(sStats).map(tid => {
                    const t = sStats[tid];
                    const total = t.wins + t.losses;
                    return {
                        teamId: parseInt(tid),
                        wins: t.wins,
                        losses: t.losses,
                        winPct: total > 0 ? t.wins / total : 0
                    };
                });
                sTeams.sort((a, b) => b.winPct - a.winPct || b.wins - a.wins);
                seasonRankings[s] = sTeams.map((t, index) => ({ ...t, rank: index + 1 }));
            });

            // Aggregate All-Time Stats
            const franchiseStats = {};

            // Helper to get stats object
            const getFranchiseStats = (teamId) => {
                const fid = getMappedIds(teamId)[0];
                if (!franchiseStats[fid]) {
                    // Find a representative team object
                    const repTeam = currentTeams.find(t => getMappedIds(t.team_id).includes(fid)) || { name: 'Unknown', team_id: fid };
                    franchiseStats[fid] = {
                        team_id: repTeam.team_id,
                        name: repTeam.name, // Will be fixed later to show City + Name if needed
                        logo_url: repTeam.logo_url,
                        wins: 0,
                        losses: 0,
                        seasonsPlayed: 0,
                        totalRank: 0,
                        spaceships: 0,
                        spoons: 0,
                        spaceshipAppearances: 0,
                        spoonAppearances: 0
                    };
                }
                return franchiseStats[fid];
            };

            // 1. W-L Record
            seriesResults.forEach(series => {
                if (series.round === 'Golden Spaceship' || series.round === 'Wooden Spoon' || series.round === 'Silver Submarine') return;

                if (!series.winning_team_id || !series.losing_team_id) return;

                const wStats = getFranchiseStats(series.winning_team_id);
                const lStats = getFranchiseStats(series.losing_team_id);

                if (series.winning_score !== null) {
                    wStats.wins += series.winning_score;
                    wStats.losses += series.losing_score;

                    lStats.losses += series.winning_score;
                    lStats.wins += series.losing_score;
                }
            });

            // 2. Average Finish
            Object.values(seasonRankings).forEach(sRankings => {
                sRankings.forEach(r => {
                    const stats = getFranchiseStats(r.teamId);
                    stats.totalRank += r.rank;
                    stats.seasonsPlayed++;
                });
            });

            // 3. Trophies & Appearances
            seriesResults.forEach(series => {
                if (!series.winning_team_id || !series.losing_team_id) return;

                const wStats = getFranchiseStats(series.winning_team_id);
                const lStats = getFranchiseStats(series.losing_team_id);

                if (series.round === 'Golden Spaceship') {
                    wStats.spaceshipAppearances++;
                    lStats.spaceshipAppearances++;
                    // Winner of the series gets the spaceship
                    const winnerId = series.winning_team_id;
                    const wFid = getMappedIds(winnerId)[0];
                    if (wFid === getMappedIds(wStats.team_id)[0]) {
                         wStats.spaceships++;
                    }
                } else if (series.round === 'Wooden Spoon') {
                    wStats.spoonAppearances++;
                    lStats.spoonAppearances++;
                    // Loser of the series gets the spoon
                    const loserId = series.losing_team_id;
                    const lFid = getMappedIds(loserId)[0];
                    if (lFid === getMappedIds(lStats.team_id)[0]) {
                        lStats.spoons++;
                    }
                }
            });

            const standings = Object.values(franchiseStats).map(t => {
                const totalGames = t.wins + t.losses;
                const winPct = totalGames > 0 ? (t.wins / totalGames) : 0;
                const avgFinish = t.seasonsPlayed > 0 ? (t.totalRank / t.seasonsPlayed).toFixed(1) : '-';

                // Fix Name Display for Franchise (Use Current City + Name)
                const teamObj = currentTeams.find(ct => ct.team_id === t.team_id);
                const displayName = teamObj ? (teamObj.city === teamObj.name ? teamObj.name : `${teamObj.city} ${teamObj.name}`) : t.name;

                return {
                    ...t,
                    name: displayName,
                    winPct: winPct,
                    winPctDisplay: winPct.toFixed(3).replace(/^0+/, ''),
                    avgFinish,
                    isFranchise: true
                };
            });

            standings.sort((a, b) => b.winPct - a.winPct);

            res.json({
                standings,
                recentResults: [] // Hide recent results for all-time
            });

        } else {
            // --- REGULAR SEASON LOGIC (Existing) ---
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
                        // If Season: Use the name from the result (cleaned)
                        const displayName = t.displayName || t.name;

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
