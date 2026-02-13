const { matchesFranchise, getMappedIds } = require('./franchiseUtils');

// Helper to find the matching current team for a historical record
const findTeamForRecord = (name, id, currentTeams) => {
    // 1. Clean the name (Handle "Boston Boston" -> "Boston")
    let cleanName = name || '';
    const parts = cleanName.split(' ');
    if (parts.length > 1 && parts.length % 2 === 0) {
        const mid = parts.length / 2;
        const firstHalf = parts.slice(0, mid).join(' ');
        const secondHalf = parts.slice(mid).join(' ');
        if (firstHalf === secondHalf) {
            cleanName = firstHalf;
        }
    }

    const matched = currentTeams.find(t => {
        // matchesFranchise handles Aliases, ID mapping, and Exclusion logic
        return matchesFranchise(cleanName, id, t, currentTeams, getMappedIds(t.team_id));
    });

    if (matched) {
        return {
            ...matched,
            displayName: cleanName
        };
    }

    return {
        team_id: null,
        name: cleanName,
        city: '',
        logo_url: null,
        displayName: cleanName
    };
};

function calculateStandings(seriesResults, currentTeams, isAllTime = false) {
    if (isAllTime) {
        // --- ALL-TIME LOGIC ---
        // Calculate Stats Per Season First for Avg Finish
        const uniqueSeasons = [...new Set(seriesResults.map(r => r.season_name))].filter(Boolean);
        const seasonRankings = {}; // season -> [{ teamId, wins, winPct }]

        uniqueSeasons.forEach(s => {
            const sResults = seriesResults.filter(r => r.season_name === s);
            const sStats = {};
            sResults.forEach(series => {
                if (series.round === 'Golden Spaceship' || series.round === 'Wooden Spoon' || series.round === 'Silver Submarine') return;

                const winnerTeam = findTeamForRecord(series.winning_team_name, series.winning_team_id, currentTeams);
                const loserTeam = findTeamForRecord(series.losing_team_name, series.losing_team_id, currentTeams);

                // Filter Phantoms
                if (winnerTeam.name && (winnerTeam.name.includes('Phantoms') || winnerTeam.displayName.includes('Phantoms'))) return;
                if (loserTeam.name && (loserTeam.name.includes('Phantoms') || loserTeam.displayName.includes('Phantoms'))) return;

                if (!winnerTeam.team_id || !loserTeam.team_id) return;

                const wFid = winnerTeam.team_id;
                const lFid = loserTeam.team_id;

                if (!sStats[wFid]) sStats[wFid] = { wins: 0, losses: 0 };
                if (!sStats[lFid]) sStats[lFid] = { wins: 0, losses: 0 };

                if (series.winning_score !== null) {
                     sStats[wFid].wins += series.winning_score;
                     sStats[wFid].losses += series.losing_score;

                     sStats[lFid].losses += series.winning_score;
                     sStats[lFid].wins += series.losing_score;
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
            // teamId passed here is already the Canonical/Current Team ID from findTeamForRecord
            if (!franchiseStats[teamId]) {
                const repTeam = currentTeams.find(t => t.team_id === teamId) || { name: 'Unknown', team_id: teamId };
                franchiseStats[teamId] = {
                    team_id: repTeam.team_id,
                    name: repTeam.name,
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
            return franchiseStats[teamId];
        };

        // 1. W-L Record
        seriesResults.forEach(series => {
            const winnerTeam = findTeamForRecord(series.winning_team_name, series.winning_team_id, currentTeams);
            const loserTeam = findTeamForRecord(series.losing_team_name, series.losing_team_id, currentTeams);

            // Filter Phantoms
            if (winnerTeam.name && (winnerTeam.name.includes('Phantoms') || winnerTeam.displayName.includes('Phantoms'))) return;
            if (loserTeam.name && (loserTeam.name.includes('Phantoms') || loserTeam.displayName.includes('Phantoms'))) return;

            if (!winnerTeam.team_id || !loserTeam.team_id) return;

            const wStats = getFranchiseStats(winnerTeam.team_id);
            const lStats = getFranchiseStats(loserTeam.team_id);

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
            const winnerTeam = findTeamForRecord(series.winning_team_name, series.winning_team_id, currentTeams);
            const loserTeam = findTeamForRecord(series.losing_team_name, series.losing_team_id, currentTeams);

            // Filter Phantoms
            if (winnerTeam.name && (winnerTeam.name.includes('Phantoms') || winnerTeam.displayName.includes('Phantoms'))) return;
            if (loserTeam.name && (loserTeam.name.includes('Phantoms') || loserTeam.displayName.includes('Phantoms'))) return;

            if (!winnerTeam.team_id || !loserTeam.team_id) return;

            const wStats = getFranchiseStats(winnerTeam.team_id);
            const lStats = getFranchiseStats(loserTeam.team_id);

            if (series.round === 'Golden Spaceship') {
                wStats.spaceshipAppearances++;
                lStats.spaceshipAppearances++;
                wStats.spaceships++;
            } else if (series.round === 'Wooden Spoon') {
                wStats.spoonAppearances++;
                lStats.spoonAppearances++;
                lStats.spoons++;
            }
        });

        const standings = Object.values(franchiseStats).map(t => {
            const totalGames = t.wins + t.losses;
            const winPct = totalGames > 0 ? (t.wins / totalGames) : 0;
            const avgFinish = t.seasonsPlayed > 0 ? (t.totalRank / t.seasonsPlayed).toFixed(1) : '-';

            // Fix Name Display for Franchise (Use Current City Only)
            const teamObj = currentTeams.find(ct => ct.team_id === t.team_id);
            const displayName = teamObj ? teamObj.city : t.name;

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
        return standings;

    } else {
        // --- REGULAR SEASON LOGIC ---
        const teamStats = {};

        // Identify Postseason Participants for Override Logic
        const spaceshipSeries = seriesResults.find(s => s.round === 'Golden Spaceship');
        const spoonSeries = seriesResults.find(s => s.round === 'Wooden Spoon');

        let spaceshipParticipants = [];
        let spoonParticipants = [];

        if (spaceshipSeries) {
            const w = findTeamForRecord(spaceshipSeries.winning_team_name, spaceshipSeries.winning_team_id, currentTeams);
            const l = findTeamForRecord(spaceshipSeries.losing_team_name, spaceshipSeries.losing_team_id, currentTeams);
            if (w.team_id) spaceshipParticipants.push(w.team_id); // Use ID if available
            else spaceshipParticipants.push(w.name);
            if (l.team_id) spaceshipParticipants.push(l.team_id);
            else spaceshipParticipants.push(l.name);
        }

        if (spoonSeries) {
            const w = findTeamForRecord(spoonSeries.winning_team_name, spoonSeries.winning_team_id, currentTeams);
            const l = findTeamForRecord(spoonSeries.losing_team_name, spoonSeries.losing_team_id, currentTeams);
            if (w.team_id) spoonParticipants.push(w.team_id);
            else spoonParticipants.push(w.name);
            if (l.team_id) spoonParticipants.push(l.team_id);
            else spoonParticipants.push(l.name);
        }

        const isPostseasonSet = spaceshipParticipants.length > 0 || spoonParticipants.length > 0;


        seriesResults.forEach(series => {
            if (series.round === 'Golden Spaceship' || series.round === 'Wooden Spoon' || series.round === 'Silver Submarine') {
                return;
            }

            const { winning_team_name, losing_team_name, winning_score, losing_score } = series;

            // Map to Current Teams
            const winner = findTeamForRecord(winning_team_name, series.winning_team_id, currentTeams);
            const loser = findTeamForRecord(losing_team_name, series.losing_team_id, currentTeams);

            // Filter Phantoms
            if (winner.name && (winner.name.includes('Phantoms') || winner.displayName.includes('Phantoms'))) return;
            if (loser.name && (loser.name.includes('Phantoms') || loser.displayName.includes('Phantoms'))) return;

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
                        remaining: 0,
                        maxWins: 0,
                        minWins: 0,
                        clinch: ''
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

                const w = findTeamForRecord(s.winning_team_name, s.winning_team_id, currentTeams);
                const l = findTeamForRecord(s.losing_team_name, s.losing_team_id, currentTeams);
                // Filter Phantoms here too, although initStats filter avoids creating entries, 
                // we need to be careful about games involving them impacting maxWins calculation?
                // If Phantoms are filtered out of `teams`, they won't iterate here.
                // But we need to make sure we don't count games against Phantoms as "pending" if we want to ignore them?
                // Actually, if we play Phantoms, those are valid games for US. 
                // But if Phantoms are removed from the standings, do we count their games?
                // Usually yes, a win against Phantoms counts.
                // But `teams` array doesn't have Phantoms.
                
                const wKey = w.team_id ? `ID-${w.team_id}` : `NAME-${w.name}`;
                const lKey = l.team_id ? `ID-${l.team_id}` : `NAME-${l.name}`;
                const tKey = t.team_id ? `ID-${t.team_id}` : `NAME-${t.name}`;

                return wKey === tKey || lKey === tKey;
            }).length;

            t.maxWins = t.wins + (pendingCount * 4);
            t.minWins = t.wins;
        });

        teams.forEach(team => {
            if (isPostseasonSet) {
                // OVERRIDE: Check participation
                // Check by ID then Name
                const inSpaceship = spaceshipParticipants.includes(team.team_id) || spaceshipParticipants.includes(team.name);
                const inSpoon = spoonParticipants.includes(team.team_id) || spoonParticipants.includes(team.name);

                if (inSpaceship) team.clinch = 'x-';
                else if (inSpoon) team.clinch = 'z-';
                else team.clinch = 'y-';

            } else {
                // STANDARD MATH LOGIC (Incomplete Season)
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
            // Prioritize clinch status if Postseason is set
            if (isPostseasonSet) {
                const rank = { 'x-': 3, 'y-': 2, 'z-': 1, '': 0 };
                const rankA = rank[a.clinch] || 0;
                const rankB = rank[b.clinch] || 0;
                if (rankA !== rankB) return rankB - rankA;
            }

            if (b.winPct !== a.winPct) return b.winPct - a.winPct;
            return b.wins - a.wins;
        });

        return standings;
    }
}

module.exports = { calculateStandings, findTeamForRecord };
