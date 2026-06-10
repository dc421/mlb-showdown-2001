const { matchesFranchise, getMappedIds, getLogoForTeam } = require('./franchiseUtils');

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
            displayName: cleanName,
            logo_url: getLogoForTeam(cleanName, matched.logo_url)
        };
    }

    return {
        team_id: null,
        name: cleanName,
        city: '',
        logo_url: getLogoForTeam(cleanName, null),
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
                    winPct: total > 0 ? t.wins / total : 0.5
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
                    submarines: 0,
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
            } else if (series.round === 'Silver Submarine') {
                wStats.submarines++;
            } else if (series.round === 'Wooden Spoon') {
                wStats.spoonAppearances++;
                lStats.spoonAppearances++;
                lStats.spoons++;
            }
        });

        const standings = Object.values(franchiseStats).map(t => {
            const totalGames = t.wins + t.losses;
            const winPct = totalGames > 0 ? (t.wins / totalGames) : 0.5;
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

        // Monte Carlo playoff odds for incomplete seasons
        if (!isPostseasonSet) {
            // Build baseline head-to-head from completed regular-season games
            const baseH2H = {};
            seriesResults.forEach(s => {
                if (s.winning_score === null) return;
                if (['Golden Spaceship', 'Wooden Spoon', 'Silver Submarine'].includes(s.round)) return;
                const w = findTeamForRecord(s.winning_team_name, s.winning_team_id, currentTeams);
                const l = findTeamForRecord(s.losing_team_name, s.losing_team_id, currentTeams);
                if (w.name && (w.name.includes('Phantoms') || w.displayName.includes('Phantoms'))) return;
                if (l.name && (l.name.includes('Phantoms') || l.displayName.includes('Phantoms'))) return;
                const wKey = w.team_id ? `ID-${w.team_id}` : `NAME-${w.name}`;
                const lKey = l.team_id ? `ID-${l.team_id}` : `NAME-${l.name}`;
                if (!teamStats[wKey] || !teamStats[lKey]) return;
                if (!baseH2H[wKey]) baseH2H[wKey] = {};
                if (!baseH2H[lKey]) baseH2H[lKey] = {};
                if (!baseH2H[wKey][lKey]) baseH2H[wKey][lKey] = { wins: 0, losses: 0 };
                if (!baseH2H[lKey][wKey]) baseH2H[lKey][wKey] = { wins: 0, losses: 0 };
                baseH2H[wKey][lKey].wins += s.winning_score;
                baseH2H[wKey][lKey].losses += s.losing_score;
                baseH2H[lKey][wKey].wins += s.losing_score;
                baseH2H[lKey][wKey].losses += s.winning_score;
            });

            const unplayedGames = seriesResults
                .filter(s =>
                    s.winning_score === null &&
                    !['Golden Spaceship', 'Wooden Spoon', 'Silver Submarine'].includes(s.round)
                )
                .map(s => {
                    const t1 = findTeamForRecord(s.winning_team_name, s.winning_team_id, currentTeams);
                    const t2 = findTeamForRecord(s.losing_team_name, s.losing_team_id, currentTeams);
                    return {
                        t1Key: t1.team_id ? `ID-${t1.team_id}` : `NAME-${t1.name}`,
                        t2Key: t2.team_id ? `ID-${t2.team_id}` : `NAME-${t2.name}`
                    };
                })
                .filter(g => teamStats[g.t1Key] && teamStats[g.t2Key]);

            // Returns h2h win% for `k` within `group` using simH2H
            const h2hPct = (k, group, simH2H) => {
                let wins = 0, losses = 0;
                for (const opp of group) {
                    if (opp === k) continue;
                    const r = simH2H[k] && simH2H[k][opp] ? simH2H[k][opp] : { wins: 0, losses: 0 };
                    wins += r.wins;
                    losses += r.losses;
                }
                const tot = wins + losses;
                return tot > 0 ? wins / tot : 0.5;
            };

            // Recursively resolve a tied group using h2h within the group.
            // Per league rules: in a 3-way tie, use 3-way h2h; once one team separates,
            // use direct 2-way h2h for the remaining pair.
            const resolveH2H = (group, simH2H) => {
                if (group.length <= 1) return group;
                if (group.length === 2) {
                    const [a, b] = group;
                    return h2hPct(a, group, simH2H) >= h2hPct(b, group, simH2H) ? [a, b] : [b, a];
                }
                // 3+ way: sort by h2h pct within the group
                const sorted = group.slice().sort((a, b) => h2hPct(b, group, simH2H) - h2hPct(a, group, simH2H));
                const result = [];
                let remaining = sorted;
                while (remaining.length > 0) {
                    const topPct = h2hPct(remaining[0], remaining, simH2H);
                    const top = remaining.filter(k => Math.abs(h2hPct(k, remaining, simH2H) - topPct) < 1e-9);
                    const rest = remaining.filter(k => !top.includes(k));
                    if (top.length === remaining.length) {
                        // Fully unresolvable at this level — keep sorted order
                        result.push(...top);
                        break;
                    }
                    if (top.length === 1) {
                        result.push(top[0]);
                    } else {
                        // Multiple teams share the top h2h pct; resolve this sub-group
                        result.push(...resolveH2H(top, simH2H));
                    }
                    remaining = rest;
                }
                return result;
            };

            // Rank all teams by win%, then h2h as tiebreaker
            const rankTeams = (keys, simWins, simLosses, simH2H) => {
                const winPct = k => {
                    const tot = simWins[k] + simLosses[k];
                    return tot > 0 ? simWins[k] / tot : 0.5;
                };
                const sorted = keys.slice().sort((a, b) => winPct(b) - winPct(a));
                const result = [];
                let pool = sorted;
                while (pool.length > 0) {
                    const topPct = winPct(pool[0]);
                    const tiedGroup = pool.filter(k => Math.abs(winPct(k) - topPct) < 1e-9);
                    const rest = pool.filter(k => !tiedGroup.includes(k));
                    result.push(...(tiedGroup.length > 1 ? resolveH2H(tiedGroup, simH2H) : tiedGroup));
                    pool = rest;
                }
                return result;
            };

            const NUM_SIMS = 10000;
            const spaceshipCount = {};
            const spoonCount = {};
            const teamKeys = Object.keys(teamStats);
            teamKeys.forEach(k => { spaceshipCount[k] = 0; spoonCount[k] = 0; });
            const n = teamKeys.length;

            for (let i = 0; i < NUM_SIMS; i++) {
                const simWins = {};
                const simLosses = {};
                const simH2H = {};
                teamKeys.forEach(k => {
                    simWins[k] = teamStats[k].wins;
                    simLosses[k] = teamStats[k].losses;
                    simH2H[k] = {};
                    teamKeys.forEach(opp => {
                        if (opp === k) return;
                        simH2H[k][opp] = baseH2H[k] && baseH2H[k][opp]
                            ? { wins: baseH2H[k][opp].wins, losses: baseH2H[k][opp].losses }
                            : { wins: 0, losses: 0 };
                    });
                });

                for (const game of unplayedGames) {
                    // All 7 games are played; winner determined by majority
                    let w1 = 0;
                    for (let g = 0; g < 7; g++) {
                        if (Math.random() < 0.5) w1++;
                    }
                    const w2 = 7 - w1;
                    simWins[game.t1Key] += w1;
                    simLosses[game.t1Key] += w2;
                    simWins[game.t2Key] += w2;
                    simLosses[game.t2Key] += w1;
                    simH2H[game.t1Key][game.t2Key].wins += w1;
                    simH2H[game.t1Key][game.t2Key].losses += w2;
                    simH2H[game.t2Key][game.t1Key].wins += w2;
                    simH2H[game.t2Key][game.t1Key].losses += w1;
                }

                const ranked = rankTeams(teamKeys, simWins, simLosses, simH2H);

                if (n >= 2) {
                    spaceshipCount[ranked[0]]++;
                    spaceshipCount[ranked[1]]++;
                }
                if (n >= 4) {
                    spoonCount[ranked[n - 1]]++;
                    spoonCount[ranked[n - 2]]++;
                } else if (n >= 2) {
                    spoonCount[ranked[n - 1]]++;
                }
            }

            teamKeys.forEach(k => {
                teamStats[k].spaceshipOdds = spaceshipCount[k] / NUM_SIMS;
                teamStats[k].spoonOdds = spoonCount[k] / NUM_SIMS;
            });
        }

        const standings = teams.map(team => {
            const totalGames = team.wins + team.losses;
            const winPct = totalGames > 0 ? (team.wins / totalGames) : 0.5;
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
