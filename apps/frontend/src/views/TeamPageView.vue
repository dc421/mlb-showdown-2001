<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';
import { formatNameShort } from '@/utils/playerUtils';

const route = useRoute();
const teamId = ref(route.params.teamId);
const teamData = ref(null);
const loading = ref(true);
const selectedPlayer = ref(null);
const apiUrl = import.meta.env.VITE_API_URL || '';

// Helper to determine position category
const getBatterPosition = (player) => {
    // If pitcher, ignore here
    if (player.ip > 0 || player.control !== null) return null;
    return player.assignment || player.position;
};

// Organize roster for matrix display
const organizeRosterForMatrix = (rosterPlayers) => {
    // Create map for batters: { C: player, 1B: player, ... }
    const batterMap = {
        'C': [], '1B': [], '2B': [], '3B': [], 'SS': [],
        'LF': [], 'CF': [], 'RF': [], 'DH': [], 'B': []
    };

    // Create map for pitchers: { SP: [], RP: [] }
    const pitcherMap = { 'SP': [], 'RP': [] };

    rosterPlayers.forEach(p => {
        // Check if pitcher - Correctly handle null control from backend
        const isPitcher = (p.ip && Number(p.ip) > 0) || (p.control !== undefined && p.control !== null) || p.position === 'SP' || p.position === 'RP';

        if (isPitcher) {
            const pos = (Number(p.ip) > 3 || p.position === 'SP') ? 'SP' : 'RP';
            pitcherMap[pos].push(p);
        } else {
            // Batter
            let pos = p.assignment || p.position;
            if (pos === 'BENCH') pos = 'B';
            if (!batterMap[pos]) batterMap['B'].push(p); // Fallback to bench
            else batterMap[pos].push(p);
        }
    });

    // We only take the top player for starting spots in matrix (if multiples exist for 1 position)
    const batterRow = {};
    ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].forEach(pos => {
        batterRow[pos] = batterMap[pos].length > 0 ? batterMap[pos][0] : null;
    });
    batterRow['Bench'] = batterMap['B']; // Array of bench players

    // For pitchers, we want SP1, SP2, SP3, SP4, RP1, RP2, Bullpen
    const sps = pitcherMap['SP'].sort((a,b) => (b.points || 0) - (a.points || 0));
    const rps = pitcherMap['RP'].sort((a,b) => (b.points || 0) - (a.points || 0));

    const pitchersRow = {
        'SP1': sps[0] || null,
        'SP2': sps[1] || null,
        'SP3': sps[2] || null,
        'SP4': sps[3] || null,
        'RP1': rps[0] || null,
        'RP2': rps[1] || null,
        'Bullpen': rps.slice(2)
    };

    return { batterRow, pitchersRow };
};

const processedHistory = computed(() => {
    if (!teamData.value?.rosters) return [];

    return teamData.value.rosters.map(r => {
        const { batterRow, pitchersRow } = organizeRosterForMatrix(r.players);
        return {
            season: r.season,
            batters: batterRow,
            pitchers: pitchersRow
        };
    });
});

const mostCommonPlayers = computed(() => {
    if (!processedHistory.value.length) return { batters: {}, pitchers: {} };

    const batterCounts = {};
    const pitcherCounts = {};

    // Initialize counters
    ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'Bench'].forEach(pos => batterCounts[pos] = {});
    ['SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2', 'Bullpen'].forEach(pos => pitcherCounts[pos] = {});

    processedHistory.value.forEach(row => {
        // Batters
        ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].forEach(pos => {
            const p = row.batters[pos];
            if (p) {
                const key = p.displayName || p.name;
                batterCounts[pos][key] = (batterCounts[pos][key] || 0) + 1;
            }
        });
        // Bench (Array)
        if (row.batters['Bench']) {
             row.batters['Bench'].forEach(p => {
                 const key = p.displayName || p.name;
                 batterCounts['Bench'][key] = (batterCounts['Bench'][key] || 0) + 1;
             });
        }

        // Pitchers
        ['SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2'].forEach(pos => {
            const p = row.pitchers[pos];
            if (p) {
                const key = p.displayName || p.name;
                pitcherCounts[pos][key] = (pitcherCounts[pos][key] || 0) + 1;
            }
        });
        // Bullpen (Array)
         if (row.pitchers['Bullpen']) {
             row.pitchers['Bullpen'].forEach(p => {
                 const key = p.displayName || p.name;
                 pitcherCounts['Bullpen'][key] = (pitcherCounts['Bullpen'][key] || 0) + 1;
             });
        }
    });

    const getMostCommon = (counts) => {
        const result = {};
        for (const pos in counts) {
            let max = 0;
            let player = null;
            for (const name in counts[pos]) {
                if (counts[pos][name] > max) {
                    max = counts[pos][name];
                    player = name;
                }
            }
            if (player) {
                result[pos] = { name: player, count: max };
            }
        }
        return result;
    };

    // NEW LOGIC FOR MOST COMMON ROW:
    // "list the player who has appeared on the roster most frequently (in any position) who has appeared once (at that position)"

    // 1. Calculate Total Appearances on Roster for Every Player
    const playerTotalApps = {}; // Name -> Count
    processedHistory.value.forEach(row => {
        const seenInThisSeason = new Set();
        // Check Batters
        Object.values(row.batters).forEach(p => {
             if (p) { // p might be array for Bench
                 const list = Array.isArray(p) ? p : [p];
                 list.forEach(pl => {
                     const name = pl.displayName || pl.name;
                     if (!seenInThisSeason.has(name)) {
                         playerTotalApps[name] = (playerTotalApps[name] || 0) + 1;
                         seenInThisSeason.add(name);
                     }
                 });
             }
        });
        // Check Pitchers
        Object.values(row.pitchers).forEach(p => {
             if (p) {
                 const list = Array.isArray(p) ? p : [p];
                 list.forEach(pl => {
                     const name = pl.displayName || pl.name;
                     if (!seenInThisSeason.has(name)) {
                         playerTotalApps[name] = (playerTotalApps[name] || 0) + 1;
                         seenInThisSeason.add(name);
                     }
                 });
             }
        });
    });

    const getMostCommonByTotal = (countsForPos) => {
        const result = {};
        for (const pos in countsForPos) {
            // countsForPos[pos] is { "Player Name": countAtPos }
            // We want the player with MAX playerTotalApps, provided countAtPos >= 1
            let maxTotal = 0;
            let winner = null;

            // Iterate all players who have appeared at this position
            for (const name in countsForPos[pos]) {
                const totalApps = playerTotalApps[name] || 0;
                if (totalApps > maxTotal) {
                    maxTotal = totalApps;
                    winner = name;
                } else if (totalApps === maxTotal) {
                    // Tie-breaker? Maybe maxAtPos? Or just first found.
                    // Let's use countAtPos as tiebreaker
                    const currentWinnerCount = winner ? (countsForPos[pos][winner] || 0) : 0;
                    const challengerCount = countsForPos[pos][name];
                    if (challengerCount > currentWinnerCount) {
                         winner = name;
                    }
                }
            }

            if (winner) {
                // Return format: Name (TotalApps)
                result[pos] = { name: formatNameShort(winner), count: maxTotal };
            }
        }
        return result;
    };

    return {
        batters: getMostCommonByTotal(batterCounts),
        pitchers: getMostCommonByTotal(pitcherCounts)
    };
});

// Fetch team data on mount or when teamId changes
async function fetchTeamData() {
  loading.value = true;
  try {
    const response = await apiClient(`/api/teams/${teamId.value}/history`);
    if (response.ok) {
      teamData.value = await response.json();
    } else {
      console.error('Failed to fetch team data');
    }
  } catch (error) {
    console.error('Error fetching team data:', error);
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.teamId, (newId) => {
  teamId.value = newId;
  fetchTeamData();
});

onMounted(() => {
  fetchTeamData();
});

function openPlayerCard(player) {
    if (player) selectedPlayer.value = player;
}

function closePlayerCard() {
    selectedPlayer.value = null;
}

// Display Name Helper
const teamDisplayName = computed(() => {
  if (!teamData.value?.team) return '';
  const team = teamData.value.team;
  const format = team.display_format || '{city} {name}';
  return format.replace('{city}', team.city).replace('{name}', team.name);
});
</script>

<template>
  <div class="team-page-container" v-if="teamData">
    <!-- HEADER -->
    <header class="team-header" :style="{ backgroundColor: teamData.team.primary_color, color: teamData.team.secondary_color }">
      <img :src="teamData.team.logo_url" :alt="teamData.team.name" class="team-logo" />
      <div class="team-info">
        <h1>{{ teamDisplayName }}</h1>
        <p v-if="teamData.team.owner_first_name">Owner: {{ teamData.team.owner_first_name }} {{ teamData.team.owner_last_name }}</p>

        <!-- NEW: Identity History -->
        <div v-if="teamData.identityHistory && teamData.identityHistory.length > 0" class="identity-history">
             <span class="identity-label">Franchise History:</span>
             <ul class="identity-list">
                 <li v-for="(identity, idx) in teamData.identityHistory" :key="idx">
                     {{ identity.name }} ({{ identity.start === identity.end ? identity.start : `${identity.start}-${identity.end}` }})
                 </li>
             </ul>
        </div>
      </div>
      <div class="accolades">
          <div v-if="teamData.accolades.spaceships.length > 0" class="accolade-row">
            <!-- Desktop: Show all -->
            <div v-for="(accolade, index) in teamData.accolades.spaceships" :key="accolade.season_name + index" class="accolade-item desktop-only">
              <img :src="`${apiUrl}/images/golden_spaceship.png`" :title="accolade.season_name" class="accolade-icon" alt="Golden Spaceship" />
            </div>
            <!-- Mobile: Show count -->
            <div class="accolade-item mobile-only">
              <img :src="`${apiUrl}/images/golden_spaceship.png`" class="accolade-icon" alt="Golden Spaceship" />
              <span class="accolade-count">: {{ teamData.accolades.spaceships.length }}</span>
            </div>
          </div>

          <div v-if="teamData.accolades.spoons.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamData.accolades.spoons" :key="accolade.season_name + index" class="accolade-item desktop-only">
               <img :src="`${apiUrl}/images/wooden_spoon.png`" :title="accolade.season_name" class="accolade-icon" alt="Wooden Spoon" />
             </div>
             <div class="accolade-item mobile-only">
               <img :src="`${apiUrl}/images/wooden_spoon.png`" class="accolade-icon" alt="Wooden Spoon" />
               <span class="accolade-count">: {{ teamData.accolades.spoons.length }}</span>
             </div>
          </div>

          <div v-if="teamData.accolades.submarines && teamData.accolades.submarines.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamData.accolades.submarines" :key="accolade.season_name + index" class="accolade-item desktop-only">
               <img :src="`${apiUrl}/images/silver_submarine.png`" :title="accolade.season_name" class="accolade-icon" alt="Silver Submarine" />
             </div>
             <div class="accolade-item mobile-only">
               <img :src="`${apiUrl}/images/silver_submarine.png`" class="accolade-icon" alt="Silver Submarine" />
               <span class="accolade-count">: {{ teamData.accolades.submarines.length }}</span>
             </div>
          </div>
      </div>
    </header>

    <main class="team-main">
        <!-- SEASON HISTORY TABLE (STATS) -->
        <section class="section history-section">
            <h2>Season History</h2>
            <div class="table-scroll">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Season</th>
                            <th>Record</th>
                            <th>Win %</th>
                            <th>Result</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="season in teamData.history" :key="season.season">
                            <td class="season-name">
                                <RouterLink :to="`/teams/${teamId}/seasons/${season.season}`" class="season-link">
                                    {{ season.season }}
                                </RouterLink>
                            </td>
                            <td>{{ season.wins }}-{{ season.losses }}</td>
                            <td>{{ season.winPct }}</td>
                            <td class="result-cell" :class="{'champion': season.result === 'Champion', 'spoon': season.result === 'Wooden Spoon'}">{{ season.result }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- ROSTER MATRIX: BATTERS -->
        <section class="section rosters-section">
            <h2>Position Player History</h2>
            <div class="table-scroll">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th class="sticky-col">Season</th>
                            <th>C</th>
                            <th>1B</th>
                            <th>2B</th>
                            <th>3B</th>
                            <th>SS</th>
                            <th>LF</th>
                            <th>CF</th>
                            <th>RF</th>
                            <th>DH</th>
                            <th>Bench</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in processedHistory" :key="row.season">
                            <td class="season-cell sticky-col">
                                <RouterLink :to="`/teams/${teamId}/seasons/${row.season}`" class="season-link">
                                    {{ row.season }}
                                </RouterLink>
                            </td>
                            <td v-for="pos in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']" :key="pos" @click="openPlayerCard(row.batters[pos])" class="player-cell" :class="{'filled': row.batters[pos]}">
                                <span :title="row.batters[pos] ? `${row.batters[pos].displayName} (${row.batters[pos].points} pts)` : ''">
                                    {{ row.batters[pos] ? formatNameShort(row.batters[pos].displayName) : '-' }}
                                </span>
                            </td>
                            <td class="bench-cell">
                                <div class="bench-list">
                                    <span v-for="p in row.batters['Bench']" :key="p.card_id" @click="openPlayerCard(p)" class="bench-player" :title="`${p.displayName} (${p.points} pts)`">
                                        {{ formatNameShort(p.displayName) }}
                                    </span>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                    <tfoot v-if="mostCommonPlayers.batters && Object.keys(mostCommonPlayers.batters).length > 0">
                        <tr class="summary-row">
                            <td class="sticky-col total-label">Most Common</td>
                            <td v-for="pos in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']" :key="pos" class="summary-cell">
                                <template v-if="mostCommonPlayers.batters[pos]">
                                    <div class="common-name">{{ mostCommonPlayers.batters[pos].name }}</div>
                                    <div class="common-count">({{ mostCommonPlayers.batters[pos].count }})</div>
                                </template>
                                <span v-else>-</span>
                            </td>
                            <td class="summary-cell">
                                <template v-if="mostCommonPlayers.batters['Bench']">
                                    <div class="common-name">{{ mostCommonPlayers.batters['Bench'].name }}</div>
                                    <div class="common-count">({{ mostCommonPlayers.batters['Bench'].count }})</div>
                                </template>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>

        <!-- ROSTER MATRIX: PITCHERS -->
        <section class="section rosters-section">
            <h2>Pitching History</h2>
            <div class="table-scroll">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th class="sticky-col">Season</th>
                            <th>SP1</th>
                            <th>SP2</th>
                            <th>SP3</th>
                            <th>SP4</th>
                            <th>RP1</th>
                            <th>RP2</th>
                            <th>Bullpen</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in processedHistory" :key="row.season">
                            <td class="season-cell sticky-col">
                                <RouterLink :to="`/teams/${teamId}/seasons/${row.season}`" class="season-link">
                                    {{ row.season }}
                                </RouterLink>
                            </td>
                            <td v-for="pos in ['SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2']" :key="pos" @click="openPlayerCard(row.pitchers[pos])" class="player-cell" :class="{'filled': row.pitchers[pos]}">
                                <span :title="row.pitchers[pos] ? `${row.pitchers[pos].displayName} (${row.pitchers[pos].points} pts)` : ''">
                                    {{ row.pitchers[pos] ? formatNameShort(row.pitchers[pos].displayName) : '-' }}
                                </span>
                            </td>
                            <td class="bench-cell">
                                <div class="bench-list">
                                    <span v-for="p in row.pitchers['Bullpen']" :key="p.card_id" @click="openPlayerCard(p)" class="bench-player" :title="`${p.displayName} (${p.points} pts)`">
                                        {{ formatNameShort(p.displayName) }}
                                    </span>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                    <tfoot v-if="mostCommonPlayers.pitchers && Object.keys(mostCommonPlayers.pitchers).length > 0">
                        <tr class="summary-row">
                            <td class="sticky-col total-label">Most Common</td>
                            <td v-for="pos in ['SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2']" :key="pos" class="summary-cell">
                                <template v-if="mostCommonPlayers.pitchers[pos]">
                                    <div class="common-name">{{ mostCommonPlayers.pitchers[pos].name }}</div>
                                    <div class="common-count">({{ mostCommonPlayers.pitchers[pos].count }})</div>
                                </template>
                                <span v-else>-</span>
                            </td>
                            <td class="summary-cell">
                                <template v-if="mostCommonPlayers.pitchers['Bullpen']">
                                    <div class="common-name">{{ mostCommonPlayers.pitchers['Bullpen'].name }}</div>
                                    <div class="common-count">({{ mostCommonPlayers.pitchers['Bullpen'].count }})</div>
                                </template>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>
    </main>

    <!-- Player Card Modal -->
    <div v-if="selectedPlayer" class="modal-overlay" @click.self="closePlayerCard">
        <div class="modal-content">
            <button class="close-btn" @click="closePlayerCard">×</button>
            <PlayerCard :player="selectedPlayer" />
        </div>
    </div>
  </div>
  <div v-else-if="loading" class="loading">Loading team history...</div>
  <div v-else class="error">Team not found.</div>
</template>

<style scoped>
.team-page-container {
  max-width: 1200px;
  margin: 0 auto;
  padding-bottom: 4rem;
}
.team-header {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 2rem;
  border-radius: 8px;
  margin: 2rem 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  flex-wrap: wrap;
}
.team-logo {
  height: 100px;
  width: auto;
  max-width: 150px;
  border-radius: 8px;
  background-color: white;
  padding: 0.5rem;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}
.team-info h1 { margin: 0; font-size: 2.5rem; }
.team-info p { margin: 0; font-size: 1.2rem; opacity: 0.9; }

.accolades {
    margin-left: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-end;
}
.accolade-row { display: flex; gap: 0.25rem; }
.accolade-icon { height: 35px; width: auto; }
.accolade-count { font-size: 1.5rem; font-weight: bold; margin-left: 0.5rem; align-self: center; color: white;}

.team-main {
    padding: 0 1rem;
}

.section {
    margin-bottom: 3rem;
    background: #fff;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.section h2 {
    margin-top: 0;
    border-bottom: 2px solid #eee;
    padding-bottom: 0.5rem;
    margin-bottom: 1.5rem;
}

/* Scroll Wrapper for Tables */
.table-scroll {
    overflow-x: auto;
    position: relative;
}

/* Generic Table Styles */
table {
    width: 100%;
    border-collapse: collapse;
    min-width: 600px; /* Force scroll on small screens */
}
th {
    text-align: left;
    padding: 0.75rem;
    background: #f1f3f5;
    font-weight: bold;
    white-space: nowrap;
}
td {
    padding: 0.75rem;
    border-bottom: 1px solid #eee;
}

/* Sticky First Column for Season */
.sticky-col {
    position: sticky;
    left: 0;
    background-color: #f8f9fa; /* slightly darker to distinguish */
    z-index: 2;
    border-right: 2px solid #dee2e6;
    font-weight: bold;
}
thead th.sticky-col {
    background-color: #e9ecef;
    z-index: 3;
}

.season-link {
    color: #007bff;
    text-decoration: none;
}
.season-link:hover { text-decoration: underline; }

.result-cell { font-weight: 500; }
.champion { color: #d4af37; font-weight: bold; }
.spoon { color: #8b4513; }

/* Matrix Table Specifics */
.matrix-table td {
    font-size: 0.9rem;
    vertical-align: top;
}
.player-cell {
    cursor: default;
    color: #999;
}
.player-cell.filled {
    color: #000;
    cursor: pointer;
    font-weight: 500;
}
.player-cell.filled:hover {
    background-color: #e2e6ea;
    color: #0056b3;
}

.bench-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    max-width: 300px;
}
.bench-player {
    background: #f1f3f5;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
}
.bench-player:hover {
    background: #e2e6ea;
}

/* Modal */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2000;
}
.modal-content {
    background: transparent;
    padding: 0;
    border-radius: 12px;
    position: relative;
    max-width: 90%;
    max-height: 90vh;
}
.close-btn {
    position: absolute;
    top: -40px;
    right: 0;
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
}

/* Responsive Toggles */
.mobile-only { display: none !important; }

@media (max-width: 768px) {
    .team-header {
        flex-direction: column;
        text-align: center;
        gap: 1rem;
    }
    .accolades {
        align-items: center;
        margin-left: 0;
        margin-top: 1rem;
    }
    .desktop-only { display: none !important; }
    .mobile-only { display: flex !important; }

    .bench-list {
        max-width: 200px; /* Constrain bench width on mobile scroll */
    }
}

/* Footer Summary Styles */
.summary-row td {
    background-color: #f8f9fa;
    border-top: 2px solid #dee2e6;
    font-size: 0.85rem;
    vertical-align: top;
}
.summary-row .total-label {
    font-weight: bold;
    text-align: right;
    padding-right: 1rem;
    background-color: #e9ecef; /* Match sticky header style somewhat */
}
.common-name {
    font-weight: 600;
    margin-bottom: 2px;
}
.common-count {
    color: #666;
    font-size: 0.8rem;
}
</style>
