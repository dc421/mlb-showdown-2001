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

// --- DYNAMIC COLUMNS LOGIC ---

// Calculate max number of RPs and Bench players across all seasons
const maxCols = computed(() => {
    let maxRp = 2; // Minimum 2 RPs shown
    let maxBench = 1; // Minimum 1 Bench col

    if (!teamData.value?.rosters) return { rp: maxRp, bench: maxBench };

    teamData.value.rosters.forEach(r => {
        const { rpCount, benchCount } = getCountsForSeason(r.players);
        if (rpCount > maxRp) maxRp = rpCount;
        if (benchCount > maxBench) maxBench = benchCount;
    });

    return { rp: maxRp, bench: maxBench };
});

const getCountsForSeason = (rosterPlayers) => {
    let rpCount = 0;
    let benchCount = 0;
    rosterPlayers.forEach(p => {
        // Consistent pitcher check with organizeRosterForMatrix
        const isPitcher = (p.ip && Number(p.ip) > 0) || (p.control !== undefined && p.control !== null) || p.position === 'SP' || p.position === 'RP';
        const pos = p.assignment || p.position;

        if (isPitcher) {
            // Count as RP if position is RP OR if stats imply RP (ip <= 3) and not explicitly assigned SP
            if (p.position === 'RP' || (Number(p.ip) <= 3 && p.position !== 'SP')) {
                 rpCount++;
            }
        } else {
            if (pos === 'BENCH' || pos === 'B') {
                benchCount++;
            } else if (!['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].includes(pos)) {
                 benchCount++; // Fallback for weirder positions
            }
        }
    });
    return { rpCount, benchCount };
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

    // Flatten Bench: Bench 1, Bench 2, ...
    const benches = batterMap['B'].sort((a,b) => (b.points || 0) - (a.points || 0));
    for (let i = 0; i < maxCols.value.bench; i++) {
        batterRow[`Bench${i+1}`] = benches[i] || null;
    }

    // For pitchers, we want SP1, SP2, SP3, SP4
    const sps = pitcherMap['SP'].sort((a,b) => (b.points || 0) - (a.points || 0));
    batterRow['SP1'] = sps[0] || null;

    const pitchersRow = {
        'SP1': sps[0] || null,
        'SP2': sps[1] || null,
        'SP3': sps[2] || null,
        'SP4': sps[3] || null
    };

    // Flatten RPs: RP1, RP2, ... RP_Max
    const rps = pitcherMap['RP'].sort((a,b) => (b.points || 0) - (a.points || 0));
    for (let i = 0; i < maxCols.value.rp; i++) {
        pitchersRow[`RP${i+1}`] = rps[i] || null;
    }

    return { batterRow, pitchersRow };
};

const processedHistory = computed(() => {
    if (!teamData.value?.rosters) return [];

    return teamData.value.rosters.map(r => {
        const { batterRow, pitchersRow } = organizeRosterForMatrix(r.players);

        // Find season result for highlighting
        const historyItem = teamData.value.history.find(h => h.season === r.season);
        const result = historyItem ? historyItem.result : '';

        return {
            season: r.season,
            batters: batterRow,
            pitchers: pitchersRow,
            result
        };
    });
});

const mostCommonPlayers = computed(() => {
    if (!processedHistory.value.length) return { batters: {}, pitchers: {} };

    const batterCounts = {};
    const pitcherCounts = {};

    // Dynamic keys
    const batterKeys = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
    for (let i = 1; i <= maxCols.value.bench; i++) batterKeys.push(`Bench${i}`);

    const pitcherKeys = ['SP1', 'SP2', 'SP3', 'SP4'];
    for (let i = 1; i <= maxCols.value.rp; i++) pitcherKeys.push(`RP${i}`);

    // Initialize counters
    batterKeys.forEach(pos => batterCounts[pos] = {});
    pitcherKeys.forEach(pos => pitcherCounts[pos] = {});

    processedHistory.value.forEach(row => {
        batterKeys.forEach(pos => {
            const p = row.batters[pos];
            if (p) {
                const key = p.displayName || p.name;
                batterCounts[pos][key] = (batterCounts[pos][key] || 0) + 1;
            }
        });

        pitcherKeys.forEach(pos => {
            const p = row.pitchers[pos];
            if (p) {
                const key = p.displayName || p.name;
                pitcherCounts[pos][key] = (pitcherCounts[pos][key] || 0) + 1;
            }
        });
    });

    // Modified Logic: Greedy Unique Selection across ALL slots in priority order
    // We process slots in order (Starters first, then Bench/Relief)
    const getMostCommonUnique = (countsForPos, keys) => {
        const result = {};
        const globalUsedPlayers = new Set(); // Track usage across the entire table (batters or pitchers separate or combined? "List the player... who has appeared once")
        // The request says: "make sure we don't list the same player twice? So the same player wouldn't be named for SP1 and SP2"
        // This implies uniqueness within the table (Pitchers Table vs Batters Table).
        // Since a player is usually EITHER a pitcher OR a batter, we can scope to the table.

        keys.forEach(pos => {
            let max = 0;
            let winner = null;

            // Find best candidate for this slot who hasn't been used yet
            for (const name in countsForPos[pos]) {
                if (globalUsedPlayers.has(name)) continue; // Skip if already assigned to a higher priority slot

                const count = countsForPos[pos][name];
                if (count > max) {
                    max = count;
                    winner = name;
                } else if (count === max) {
                    // Tie-breaker logic?
                    // Maybe prioritize total apps? For now, first found (arbitrary but stable key order)
                }
            }

            if (winner) {
                result[pos] = { name: formatNameShort(winner, true), count: max };
                globalUsedPlayers.add(winner);
            }
        });
        return result;
    };

    return {
        batters: getMostCommonUnique(batterCounts, batterKeys),
        pitchers: getMostCommonUnique(pitcherCounts, pitcherKeys)
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
            <div v-for="(accolade, index) in teamData.accolades.spaceships" :key="accolade.season_name + index" class="accolade-item desktop-only">
              <img :src="`${apiUrl}/images/golden_spaceship.png`" :title="accolade.season_name" class="accolade-icon" alt="Golden Spaceship" />
            </div>
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
        <!-- SEASON HISTORY TABLE -->
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
                        <!-- ADDED HIGHLIGHT CLASSES -->
                        <tr v-for="season in teamData.history" :key="season.season"
                            :class="{'gold-bg': season.result && season.result.includes('Champion'), 'brown-bg': season.result && season.result.includes('Wooden Spoon') && !season.result.includes('Participant')}">
                            <td class="season-name">
                                <RouterLink :to="`/teams/${teamId}/seasons/${season.season}`" class="season-link">
                                    {{ season.season }}
                                </RouterLink>
                            </td>
                            <td>{{ season.wins }}-{{ season.losses }}</td>
                            <td>{{ season.winPct }}</td>
                            <td class="result-cell" :class="{'champion-text': season.result === 'Champion', 'spoon-text': season.result === 'Wooden Spoon'}">{{ season.result }}</td>
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
                            <!-- Dynamic Bench Headers -->
                            <th v-for="i in maxCols.bench" :key="`bench-head-${i}`">B{{i > 1 ? i : ''}}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in processedHistory" :key="row.season" :class="{'gold-bg': row.result && row.result.includes('Champion'), 'brown-bg': row.result && row.result.includes('Wooden Spoon') && !row.result.includes('Participant')}">
                            <td class="season-cell sticky-col">
                                <RouterLink :to="`/teams/${teamId}/seasons/${row.season}`" class="season-link">
                                    {{ row.season }}
                                </RouterLink>
                            </td>
                            <td v-for="pos in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']" :key="pos" @click="openPlayerCard(row.batters[pos])" class="player-cell" :class="{'filled': row.batters[pos]}">
                                <span :title="row.batters[pos] ? `${row.batters[pos].displayName} (${row.batters[pos].points} pts)` : ''">
                                    {{ row.batters[pos] ? formatNameShort(row.batters[pos].displayName, true) : '-' }}
                                </span>
                            </td>
                            <!-- Dynamic Bench Cells -->
                            <td v-for="i in maxCols.bench" :key="`bench-${i}`"
                                @click="openPlayerCard(row.batters[`Bench${i}`])"
                                class="player-cell" :class="{'filled': row.batters[`Bench${i}`]}">
                                <span :title="row.batters[`Bench${i}`] ? `${row.batters[`Bench${i}`].displayName} (${row.batters[`Bench${i}`].points} pts)` : ''">
                                    {{ row.batters[`Bench${i}`] ? formatNameShort(row.batters[`Bench${i}`].displayName, true) : '-' }}
                                </span>
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
                            <td v-for="i in maxCols.bench" :key="`bench-sum-${i}`" class="summary-cell">
                                <template v-if="mostCommonPlayers.batters[`Bench${i}`]">
                                    <div class="common-name">{{ mostCommonPlayers.batters[`Bench${i}`].name }}</div>
                                    <div class="common-count">({{ mostCommonPlayers.batters[`Bench${i}`].count }})</div>
                                </template>
                                <span v-else>-</span>
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
                            <!-- Dynamic RP Headers -->
                            <th v-for="i in maxCols.rp" :key="`rp-head-${i}`">RP{{i}}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in processedHistory" :key="row.season" :class="{'gold-bg': row.result && row.result.includes('Champion'), 'brown-bg': row.result && row.result.includes('Wooden Spoon') && !row.result.includes('Participant')}">
                            <td class="season-cell sticky-col">
                                <RouterLink :to="`/teams/${teamId}/seasons/${row.season}`" class="season-link">
                                    {{ row.season }}
                                </RouterLink>
                            </td>
                            <td v-for="pos in ['SP1', 'SP2', 'SP3', 'SP4']" :key="pos" @click="openPlayerCard(row.pitchers[pos])" class="player-cell" :class="{'filled': row.pitchers[pos]}">
                                <span :title="row.pitchers[pos] ? `${row.pitchers[pos].displayName} (${row.pitchers[pos].points} pts)` : ''">
                                    {{ row.pitchers[pos] ? formatNameShort(row.pitchers[pos].displayName, true) : '-' }}
                                </span>
                            </td>
                             <!-- Dynamic RP Cells -->
                            <td v-for="i in maxCols.rp" :key="`rp-${i}`"
                                @click="openPlayerCard(row.pitchers[`RP${i}`])"
                                class="player-cell" :class="{'filled': row.pitchers[`RP${i}`]}">
                                <span :title="row.pitchers[`RP${i}`] ? `${row.pitchers[`RP${i}`].displayName} (${row.pitchers[`RP${i}`].points} pts)` : ''">
                                    {{ row.pitchers[`RP${i}`] ? formatNameShort(row.pitchers[`RP${i}`].displayName, true) : '-' }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                    <tfoot v-if="mostCommonPlayers.pitchers && Object.keys(mostCommonPlayers.pitchers).length > 0">
                        <tr class="summary-row">
                            <td class="sticky-col total-label">Most Common</td>
                            <td v-for="pos in ['SP1', 'SP2', 'SP3', 'SP4']" :key="pos" class="summary-cell">
                                <template v-if="mostCommonPlayers.pitchers[pos]">
                                    <div class="common-name">{{ mostCommonPlayers.pitchers[pos].name }}</div>
                                    <div class="common-count">({{ mostCommonPlayers.pitchers[pos].count }})</div>
                                </template>
                                <span v-else>-</span>
                            </td>
                            <td v-for="i in maxCols.rp" :key="`rp-sum-${i}`" class="summary-cell">
                                <template v-if="mostCommonPlayers.pitchers[`RP${i}`]">
                                    <div class="common-name">{{ mostCommonPlayers.pitchers[`RP${i}`].name }}</div>
                                    <div class="common-count">({{ mostCommonPlayers.pitchers[`RP${i}`].count }})</div>
                                </template>
                                <span v-else>-</span>
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
  max-width: 1600px;
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
.champion-text { color: #d4af37; font-weight: bold; } /* Changed class name to avoid conflict with bg */
.spoon-text { color: #8b4513; }

/* HIGHLIGHTS */
.gold-bg {
    background-color: rgba(255, 215, 0, 0.15) !important;
}
.brown-bg {
    background-color: rgba(139, 69, 19, 0.1) !important;
}

/* Matrix Table Specifics */
.matrix-table td {
    font-size: 0.7rem;
    vertical-align: top;
    padding: .2rem;
    min-width: 50px; /* Ensure columns are wide enough */
    white-space: nowrap; /* Prevent wrapping */
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

/* Removed old .bench-list styles since we are flattening */

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
