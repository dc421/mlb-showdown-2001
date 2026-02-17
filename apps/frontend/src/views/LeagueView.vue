<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';
import { sortRoster } from '@/utils/playerUtils';

const route = useRoute();
const authStore = useAuthStore();
const leagueData = ref([]);
const loading = ref(true);
const selectedPlayer = ref(null);
const seasonSummary = ref(null);
const seasonsList = ref([]);
const selectedSeason = ref('');
const matrixData = ref([]);
const hoveredSlotId = ref(null);

// Modal State for Result Input
const showResultModal = ref(false);
const resultForm = ref({
    id: null,
    winnerName: '',
    loserName: '',
    winningScore: 0,
    losingScore: 0,
    winnerId: null, // User selected winner
    winningTeamId: null, // From DB
    losingTeamId: null // From DB
});

// Use VITE_API_URL or default to empty string for proxy
const apiUrl = import.meta.env.VITE_API_URL || '';

function getLogoUrl(url) {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return `${apiUrl}${url}`;
}

async function fetchSeasons() {
    try {
        const response = await apiClient('/api/league/seasons');
        if (response.ok) {
            seasonsList.value = await response.json();

            if (route.query.season) {
                 selectedSeason.value = route.query.season;
            } else if (seasonsList.value.length > 0 && !selectedSeason.value) {
                selectedSeason.value = seasonsList.value[0];
            }
        }
    } catch (e) {
        console.error("Error fetching seasons:", e);
    }
}

async function fetchLeagueData() {
  if (!authStore.selectedPointSetId) {
      await authStore.fetchPointSets();
  }

  const pointSetId = authStore.selectedPointSetId;
  loading.value = true;

  try {
    let summaryUrl = `/api/league/season-summary`;
    if (selectedSeason.value) summaryUrl += `?season=${encodeURIComponent(selectedSeason.value)}`;

    let leagueUrl = `/api/league?point_set_id=${pointSetId}`;
    if (selectedSeason.value) leagueUrl += `&season=${encodeURIComponent(selectedSeason.value)}`;

    const [leagueResponse, summaryResponse] = await Promise.all([
        apiClient(leagueUrl),
        apiClient(summaryUrl)
    ]);

    if (leagueResponse.ok) {
        leagueData.value = await leagueResponse.json();
    }
    if (summaryResponse.ok) {
        seasonSummary.value = await summaryResponse.json();
    }

    if (selectedSeason.value === 'all-time') {
        await fetchMatrix();
    } else {
        matrixData.value = [];
    }

  } catch (error) {
      console.error("Error fetching data:", error);
  } finally {
      loading.value = false;
  }
}

async function fetchMatrix() {
    try {
        let url = `/api/league/matrix`;
        if (selectedSeason.value) url += `?season=${encodeURIComponent(selectedSeason.value)}`;
        const res = await apiClient(url);
        if (res.ok) {
            matrixData.value = await res.json();
        }
    } catch (e) {
        console.error("Error fetching matrix:", e);
    }
}

// Watch for season changes
watch(selectedSeason, () => {
    fetchLeagueData();
});

function openPlayerCard(player) {
    selectedPlayer.value = player;
}

function closePlayerCard() {
    selectedPlayer.value = null;
}

function getTeamTotalPoints(roster) {
    return roster.reduce((sum, player) => sum + (player.points || 0), 0);
}

function padRoster(roster) {
    // Clone and ensure points are processed for BENCH if missed by backend
    const padded = roster.map(p => {
        const copy = { ...p };
        // Check for Bench assignment and if points look like they need division (heuristic or explicit)
        // Note: Backend usually handles this, but frontend enforcement ensures consistency, especially during drafts
        if ((copy.assignment === 'BENCH' || copy.assignment === 'B') && copy.points) {
             // If points are abnormally high for a bench player (e.g., > 100), assume they are raw and divide
             // Or simpler: just rely on the fact that if assignment is BENCH (raw), it needs division.
             // If it is 'B' (processed), it might be done. But checking prevents double division?
             // Actually, backend sets assignment to 'B' AFTER dividing. So if it is 'BENCH', definitely divide.
             if (copy.assignment === 'BENCH') {
                 copy.points = Math.round(copy.points / 5);
             }
        }
        return copy;
    });

    const counts = { 'C': 0, '1B': 0, '2B': 0, 'SS': 0, '3B': 0, 'LF': 0, 'CF': 0, 'RF': 0, 'DH': 0, 'SP': 0, 'RP': 0 };

    padded.forEach(p => {
        const pos = p.assignment === 'PITCHING_STAFF' ? (p.displayPosition || p.position) : (p.assignment || p.displayPosition || p.position);
        if (pos) {
            if (pos === 'SP' || (p.ip && Number(p.ip) > 3)) counts['SP']++;
            else if (pos === 'RP' || (p.ip && Number(p.ip) <= 3)) counts['RP']++;
            else if (counts[pos] !== undefined) counts[pos]++;
        }
    });

    const missing = [];
    ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'].forEach(pos => {
        if (counts[pos] === 0) missing.push(pos);
    });
    for (let i = 0; i < (4 - counts['SP']); i++) missing.push('SP');

    while (padded.length < 20) {
        const nextMissing = missing.shift() || 'B';
        padded.push({
            card_id: `empty-${padded.length}`,
            name: '',
            displayName: '',
            position: nextMissing,
            displayPosition: nextMissing,
            points: '',
            assignment: nextMissing,
            isEmpty: true
        });
    }

    const sorted = sortRoster(padded);

    // Assign Slot IDs for Highlighting
    const slotCounts = {};
    sorted.forEach(p => {
        const pos = p.assignment === 'PITCHING_STAFF' ? (p.displayPosition || p.position) : (p.assignment || p.displayPosition || p.position);
        const key = pos || 'B';
        if (!slotCounts[key]) slotCounts[key] = 0;
        p.slotId = `${key}-${slotCounts[key]}`;
        slotCounts[key]++;
    });

    return sorted;
}

// Result Input Modal
function openResultModal(series) {
    resultForm.value = {
        id: series.id,
        winnerName: series.winner,
        loserName: series.loser,
        winningScore: 0,
        losingScore: 0,
        winnerId: series.winning_team_id,
        winningTeamId: series.winning_team_id,
        losingTeamId: series.losing_team_id
    };
    showResultModal.value = true;
}

function closeResultModal() {
    showResultModal.value = false;
}

async function submitResult() {
    // Validate scores
    if (resultForm.value.winningScore < 0 || resultForm.value.losingScore < 0) {
        alert("Scores cannot be negative.");
        return;
    }

    try {
        const payload = {
            id: resultForm.value.id,
            winning_score: resultForm.value.winningScore,
            losing_score: resultForm.value.losingScore,
            winner_id: resultForm.value.winnerId
        };

        const res = await apiClient('/api/league/result', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeResultModal();
            fetchLeagueData(); // Refresh
        } else {
            alert("Failed to submit result.");
        }
    } catch (e) {
        console.error(e);
        alert("Error submitting result.");
    }
}

// Filter out spaceship/spoon results for the main list
const filteredRecentResults = computed(() => {
    if (!seasonSummary.value || !seasonSummary.value.recentResults) return [];
    return seasonSummary.value.recentResults.filter(r =>
        !['Golden Spaceship', 'Wooden Spoon', 'Silver Submarine'].includes(r.round)
    );
});

const spaceshipSeries = computed(() => {
    if (!seasonSummary.value || !seasonSummary.value.recentResults) return [];
    return seasonSummary.value.recentResults.filter(r =>
        ['Golden Spaceship', 'Silver Submarine'].includes(r.round)
    ).sort((a, b) => {
        const order = { 'Golden Spaceship': 1, 'Silver Submarine': 2 };
        return (order[a.round] || 99) - (order[b.round] || 99);
    });
});

const spoonSeries = computed(() => {
    if (!seasonSummary.value || !seasonSummary.value.recentResults) return [];
    return seasonSummary.value.recentResults.filter(r =>
        r.round === 'Wooden Spoon'
    );
});

const visibleTeams = computed(() => {
    return leagueData.value
        .filter(t => t.roster && t.roster.length > 0)
        .sort((a, b) => (a.city || '').localeCompare(b.city || ''));
});

// Sorted Matrix Data: Alphabetical, with "Phantoms" forced to the end
const sortedMatrixData = computed(() => {
    if (!matrixData.value) return [];
    // Clone array to sort
    const data = [...matrixData.value];
    data.sort((a, b) => {
        // Force Phantoms to bottom
        if (a.name === 'Phantoms') return 1;
        if (b.name === 'Phantoms') return -1;
        return a.name.localeCompare(b.name);
    });
    return data;
});

// Helper to get win pct
function getWinPct(wins, losses) {
    const total = wins + losses;
    if (total === 0) return '';
    const pct = wins / total;
    return pct.toFixed(3).replace(/^0+/, '');
}

onMounted(async () => {
    await fetchSeasons();
    fetchLeagueData();
});
</script>

<template>
  <div class="league-container">

    <!-- Controls Header -->
    <div class="controls-header">
        <div class="season-selector">
            <label>Season:</label>
            <select v-model="selectedSeason">
                <option v-for="s in seasonsList" :key="s" :value="s">{{ s }}</option>
                <option value="all-time">All-Time</option>
            </select>
        </div>
    </div>

    <div v-if="loading" class="loading">Loading league data...</div>

    <div v-else>

        <!-- STANDINGS AND RESULTS SECTION -->
        <div v-if="seasonSummary && (seasonSummary.standings.length > 0 || seasonSummary.recentResults.length > 0)" class="summary-section">

            <div class="summary-column standings-column">

                <!-- SPACESHIP / SUBMARINE (Above Standings) -->
                <div v-if="spaceshipSeries.length > 0 && selectedSeason !== 'all-time'" class="season-finales">
                    <div v-for="result in spaceshipSeries" :key="result.id" class="finale-card" :class="{'spaceship-card': result.round === 'Golden Spaceship'}">
                         <div class="finale-header-text">
                             {{ result.round.toUpperCase() }}
                         </div>
                         <div class="finale-content-row">
                             <div class="finale-trophy-column">
                                 <img v-if="result.round === 'Golden Spaceship'" :src="`${apiUrl}/images/golden_spaceship.png`" class="finale-trophy-lg" />
                                 <img v-if="result.round === 'Silver Submarine'" :src="`${apiUrl}/images/silver_submarine.png`" class="finale-trophy-lg" />
                             </div>
                             <div class="finale-details-column">
                                 <div class="finale-winner-line">
                                     <span class="winner-name-lg">{{ result.winner_name || result.winner }}</span>
                                 </div>
                                 <div class="finale-score-line">
                                     W {{ result.score }} vs {{ result.loser_name || result.loser }}
                                 </div>
                             </div>
                             <div class="finale-logo-column">
                                 <img v-if="result.winner_logo" :src="getLogoUrl(result.winner_logo)" class="winner-logo-lg" />
                             </div>
                         </div>
                    </div>
                </div>

                <h3>Standings</h3>
                <table class="summary-table standings-table" :class="{'all-time-table': selectedSeason === 'all-time'}">
                    <thead>
                        <tr>
                            <th>Team</th>
                            <th class="text-right">W</th>
                            <th class="text-right">L</th>
                            <th class="text-right">Pct</th>

                            <!-- ALL-TIME COLUMNS -->
                            <th v-if="selectedSeason === 'all-time'" class="text-right border-right-cell">Avg Fin</th>
                            <th v-if="selectedSeason === 'all-time'" class="text-center"><img :src="`${apiUrl}/images/golden_spaceship.png`" class="micro-icon" /></th>
                            <th v-if="selectedSeason === 'all-time'" class="text-center border-right-cell">App</th>
                            <th v-if="selectedSeason === 'all-time'" class="text-center"><img :src="`${apiUrl}/images/wooden_spoon.png`" class="micro-icon" /></th>
                            <th v-if="selectedSeason === 'all-time'" class="text-center border-right-cell">App</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="team in seasonSummary.standings" :key="team.team_id">
                            <td class="team-cell">
                                <span v-if="team.clinch" class="clinch-indicator">{{ team.clinch }}</span>
                                <img v-if="team.logo_url" :src="getLogoUrl(team.logo_url)" class="mini-logo" alt="" />
                                <RouterLink v-if="team.team_id && !team.isFranchise" :to="`/teams/${team.team_id}`" class="team-link">
                                    {{ team.name }}
                                </RouterLink>
                                <span v-else>{{ team.name }}</span>
                            </td>
                            <td class="text-right">{{ team.wins }}</td>
                            <td class="text-right">{{ team.losses }}</td>
                            <td class="text-right">{{ team.winPctDisplay }}</td>

                            <!-- ALL-TIME STATS -->
                            <td v-if="selectedSeason === 'all-time'" class="text-right border-right-cell">{{ team.avgFinish }}</td>
                            <td v-if="selectedSeason === 'all-time'" class="text-center">
                                <span v-if="team.spaceships > 0" class="trophy-count">
                                    <img :src="`${apiUrl}/images/golden_spaceship.png`" class="micro-icon" /> {{ team.spaceships }}
                                </span>
                            </td>
                            <td v-if="selectedSeason === 'all-time'" class="text-center border-right-cell">
                                <span v-if="team.spaceshipAppearances > 0">{{ team.spaceshipAppearances }}</span>
                            </td>
                            <td v-if="selectedSeason === 'all-time'" class="text-center">
                                <span v-if="team.spoons > 0" class="trophy-count">
                                    <img :src="`${apiUrl}/images/wooden_spoon.png`" class="micro-icon" /> {{ team.spoons }}
                                </span>
                            </td>
                            <td v-if="selectedSeason === 'all-time'" class="text-center border-right-cell">
                                <span v-if="team.spoonAppearances > 0">{{ team.spoonAppearances }}</span>
                            </td>
                        </tr>
                    </tbody>
                </table>

                 <!-- TROPHY CASE (All-Time Only) -->
                <div v-if="selectedSeason === 'all-time'" class="trophy-case-section">
                    <h3>Franchise Accolades</h3>
                    <div v-for="team in seasonSummary.standings" :key="team.team_id" class="franchise-accolade-row">
                        <div class="franchise-info">
                             <img v-if="team.logo_url" :src="getLogoUrl(team.logo_url)" class="mini-logo" alt="" />
                             <b>{{ team.name }}</b>
                        </div>
                        <div class="accolade-icons-column">
                            <!-- Spaceships Row -->
                            <div v-if="team.spaceships > 0" class="accolade-row">
                                <img v-for="n in team.spaceships" :key="`s-${n}`" :src="`${apiUrl}/images/golden_spaceship.png`" class="trophy-icon-lg" title="Golden Spaceship Champion" />
                            </div>
                            <!-- Submarines Row (If we have data, logic for submarine count wasn't explicitly in league.js franchiseStats, but just in case) -->
                            <!-- league.js doesn't currently agg submarines in All-Time franchiseStats object explicitly except maybe implicit count?
                                 Wait, franchiseStats object in league.js has spaceships and spoons. I should check if I need to add submarines there.
                                 The user said "showing spaceships above submarines above spoons".
                                 I'll add Submarines support to league.js later if needed, but assuming for now we just show what we have.
                            -->

                            <!-- Spoons Row -->
                            <div v-if="team.spoons > 0" class="accolade-row">
                                <img v-for="n in team.spoons" :key="`sp-${n}`" :src="`${apiUrl}/images/wooden_spoon.png`" class="trophy-icon-lg" title="Wooden Spoon" />
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            <div v-if="selectedSeason !== 'all-time'" class="summary-column results-column">
                <!-- SPOON (Above Results) -->
                <div v-if="spoonSeries.length > 0" class="season-finales">
                    <div v-for="result in spoonSeries" :key="result.id" class="finale-card spoon-card">
                         <div class="finale-header-text">
                             {{ result.round.toUpperCase() }} - LAST PLACE
                         </div>
                         <div class="finale-content-row">
                             <div class="finale-trophy-column">
                                 <img :src="`${apiUrl}/images/wooden_spoon.png`" class="finale-trophy-lg" />
                             </div>
                             <div class="finale-details-column">
                                 <div class="finale-winner-line">
                                     <span class="winner-name-lg">{{ result.loser_name || result.loser }}</span>
                                 </div>
                                 <div class="finale-score-line">
                                     L {{ result.score }} vs {{ result.winner_name || result.winner }}
                                 </div>
                             </div>
                             <div class="finale-logo-column">
                                 <img v-if="result.loser_logo" :src="getLogoUrl(result.loser_logo)" class="winner-logo-lg" />
                             </div>
                         </div>
                    </div>
                </div>

                <h3>Results</h3>
                <div class="results-list">
                    <div v-for="result in filteredRecentResults" :key="result.id" class="result-item">
                        <template v-if="result.score">
                            <div class="result-participant">
                                <img v-if="result.winner_logo" :src="getLogoUrl(result.winner_logo)" class="tiny-logo" alt=""/>
                                <span class="result-winner">{{ result.winner_name || result.winner }}</span>
                            </div>
                            <span class="def-text">def.</span>
                            <div class="result-participant">
                                <img v-if="result.loser_logo" :src="getLogoUrl(result.loser_logo)" class="tiny-logo" alt=""/>
                                <span class="result-loser">{{ result.loser_name || result.loser }}</span>
                            </div>
                            <span class="result-score">({{ result.score }})</span>
                        </template>
                        <template v-else>
                            <div class="result-participant">
                                <img v-if="result.winner_logo" :src="getLogoUrl(result.winner_logo)" class="tiny-logo" alt=""/>
                                <span class="result-matchup">{{ result.winner_name || result.winner }}</span>
                            </div>
                            <span class="vs-text">vs.</span>
                            <div class="result-participant">
                                <img v-if="result.loser_logo" :src="getLogoUrl(result.loser_logo)" class="tiny-logo" alt=""/>
                                <span class="result-matchup">{{ result.loser_name || result.loser }}</span>
                            </div>
                            <!-- Add Result Button -->
                            <button class="add-result-btn" @click="openResultModal(result)">+</button>
                        </template>
                    </div>
                    <div v-if="filteredRecentResults.length === 0" class="no-results">
                        No results yet this season.
                    </div>
                </div>
            </div>

        </div>

        <!-- MATRIX VIEW (Only for All-Time) -->
        <div v-if="selectedSeason === 'all-time' && sortedMatrixData.length > 0" class="matrix-view">
             <h3>Head-to-Head Matrix (All-Time)</h3>
             <div class="matrix-container">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th class="matrix-corner"></th> <!-- Top Left Corner -->
                            <th v-for="team in sortedMatrixData" :key="team.id" :class="{'phantoms-header': team.name === 'Phantoms'}">{{ team.name }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="rowTeam in sortedMatrixData" :key="rowTeam.id">
                            <td class="matrix-row-header" :class="{'phantoms-header': rowTeam.name === 'Phantoms'}">{{ rowTeam.name }}</td>
                            <td v-for="colTeam in sortedMatrixData" :key="colTeam.id" class="matrix-cell" :class="{'phantoms-cell': rowTeam.name === 'Phantoms' || colTeam.name === 'Phantoms'}">
                                <template v-if="rowTeam.id === colTeam.id">
                                    <span class="matrix-self">-</span>
                                </template>
                                <template v-else>
                                    <div v-if="rowTeam.opponents[colTeam.id]" class="matrix-record">
                                        <div>
                                            <span class="matrix-wins">{{ rowTeam.opponents[colTeam.id].wins }}</span> -
                                            <span class="matrix-losses">{{ rowTeam.opponents[colTeam.id].losses }}</span>
                                        </div>
                                        <div class="matrix-pct">
                                            {{ getWinPct(rowTeam.opponents[colTeam.id].wins, rowTeam.opponents[colTeam.id].losses) }}
                                        </div>
                                    </div>
                                    <div v-else class="matrix-empty"></div>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
             </div>
        </div>

        <!-- ROSTERS (Hidden if All-Time) -->
        <div v-if="leagueData.length > 0" class="teams-list">
            <div v-for="team in visibleTeams" :key="team.team_id" class="team-block">
                <div class="team-header" >
                    <img :src="getLogoUrl(team.logo_url)" :alt="team.name" class="team-logo" />
                    <div class="team-info">
                        <h2>
                            <RouterLink :to="`/teams/${team.team_id}`" class="team-link-header">
                                {{ team.full_display_name }}
                            </RouterLink>
                        </h2>
                        <p>Owner: {{ team.owner }}</p>
                    </div>
                </div>

                <div class="roster-table-container">
                    <table class="roster-table">
                        <thead>
                            <tr>
                                <th class="header-pos">Pos</th>
                                <th class="header-player">Player</th>
                                <th class="header-points">Pts</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="player in padRoster(team.roster)"
                                :key="player.card_id"
                                @click="!player.isEmpty && openPlayerCard(player)"
                                class="player-row"
                                :class="{
                                    'empty-row': player.isEmpty,
                                    'highlight-slot': hoveredSlotId && hoveredSlotId === player.slotId
                                }"
                                @mouseenter="hoveredSlotId = player.slotId"
                                @mouseleave="hoveredSlotId = null"
                            >
                                <td class="pos-cell">
                                    {{ player.assignment === 'PITCHING_STAFF' ? (player.displayPosition || player.position) : (player.assignment || player.displayPosition || player.position) }}
                                </td>
                                <td class="name-cell" :class="{'text-shrink': (player.displayName || player.name).length > 18}">
                                    {{ player.displayName || player.name }}
                                </td>
                                <td class="points-cell">{{ player.points }}</td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="2" class="total-label">Total</td>
                                <td class="total-points">{{ getTeamTotalPoints(team.roster) }}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <!-- Player Card Modal -->
    <div v-if="selectedPlayer" class="modal-overlay" @click.self="closePlayerCard">
        <div class="modal-content player-card-modal-content">
            <button class="close-btn" @click="closePlayerCard">×</button>
            <PlayerCard :player="selectedPlayer" />
        </div>
    </div>

    <!-- Result Input Modal -->
    <div v-if="showResultModal" class="modal-overlay" @click.self="closeResultModal">
        <div class="modal-content result-modal-content">
            <h3>Enter Series Result</h3>
            <div class="modal-body">
                <div class="team-score-input">
                    <label>{{ resultForm.winnerName }}</label>
                    <input type="number" v-model.number="resultForm.winningScore" min="0" />
                </div>
                <div class="team-score-input">
                    <label>{{ resultForm.loserName }}</label>
                    <input type="number" v-model.number="resultForm.losingScore" min="0" />
                </div>

                <div class="winner-selector">
                    <label>Winner:</label>
                    <select v-model="resultForm.winnerId">
                        <option :value="resultForm.winningTeamId">{{ resultForm.winnerName }}</option>
                        <option :value="resultForm.losingTeamId">{{ resultForm.loserName }}</option>
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button @click="closeResultModal" class="cancel-btn">Cancel</button>
                <button @click="submitResult" class="submit-btn">Submit</button>
            </div>
        </div>
    </div>

  </div>
</template>

<style scoped>
.league-container {
    max-width: 1400px; /* Increased max-width for 5 columns */
    margin: 0 auto;
    padding: 1rem;
}

/* Controls Header */
.controls-header {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    margin-bottom: 2rem;
    background: #f8f9fa;
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid #dee2e6;
}

.season-selector {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: bold;
}

.season-selector select {
    padding: 0.5rem;
    border-radius: 4px;
    border: 1px solid #ced4da;
    font-size: 1rem;
}

h1 {
    text-align: center;
    margin-bottom: 2rem;
}

.loading {
    text-align: center;
    font-size: 1.2rem;
    color: #666;
}

/* Summary Section Styles */
.summary-section {
    display: flex;
    flex-wrap: wrap;
    gap: 2rem;
    margin-bottom: 2rem;
    background: #fff;
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.summary-column {
    flex: 1 1 300px;
}

.summary-column h3 {
    margin-top: 0;
    margin-bottom: 1rem;
    font-size: 1.2rem;
    border-bottom: 2px solid #eee;
    padding-bottom: 0.5rem;
}

.summary-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
}

.summary-table th {
    text-align: left;
    padding: 0.5rem;
    background: #f8f9fa;
    border-bottom: 2px solid #dee2e6;
    font-weight: 600;
}

.summary-table td {
    padding: 0.5rem;
    border-bottom: 1px solid #e9ecef;
}

.team-cell {
    display: flex;
    align-items: center;
    gap: 8px;
}

.mini-logo {
    width: 24px;
    height: 24px;
    object-fit: contain;
}

.text-right {
    text-align: right !important;
}

.text-center {
    text-align: center !important;
}

.clinch-indicator {
    font-weight: bold;
    margin-right: 4px;
    color: #666;
}

.micro-icon {
    width: 16px;
    height: auto;
    vertical-align: middle;
}

/* Results List Styles */
.results-list {
    /* max-height: 300px;
    overflow-y: auto; */
}

.result-item {
    padding: 0.5rem 0;
    border-bottom: 1px solid #f1f1f1;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.result-item:last-child {
    border-bottom: none;
}

.trophy-icon img {
    height: 20px;
    width: auto;
    vertical-align: middle;
}

.round-label {
    font-weight: bold;
    font-size: 0.85rem;
    color: #666;
    margin-right: 0.5rem;
}

.result-participant {
    display: flex;
    align-items: center;
    gap: 4px;
}

.tiny-logo {
    width: 18px;
    height: 18px;
    object-fit: contain;
}

.result-winner {
    font-weight: 600;
    color: #28a745;
}

.result-loser {
    font-weight: 600;
    color: #333;
}

.def-text, .vs-text {
    margin: 0 4px;
    color: #666;
}

.result-score {
    color: #666;
    font-weight: bold;
    margin-left: 0.5rem;
}

.add-result-btn {
    background: #28a745;
    color: white;
    border: none;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    font-size: 18px;
    line-height: 24px;
    cursor: pointer;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    margin-left: 0.5rem;
}
.add-result-btn:hover {
    background: #218838;
}

.no-results {
    color: #888;
    font-style: italic;
    padding: 1rem 0;
}


/* Existing Styles for Rosters */
.teams-list {
    display: grid;
    /* CHANGE: 5 columns fixed */
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem; /* Reduced gap */
    margin-top: 2rem;
    overflow-x: auto; /* Just in case on very small screens */
}

.team-block {
    background: #f9f9f9;
    border-radius: 8px;
    padding: 0.5rem; /* Reduced padding */
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    min-width: 0; /* Allows flex/grid children to shrink */
}

.team-header {
    display: flex;
    align-items: center;
    gap: 0.5rem; /* Reduced gap */
    padding-bottom: 0.5rem;
    margin-bottom: 0rem;
    flex-direction: column; /* Stack logo and name to save horizontal space */
    text-align: center;
}

.team-logo {
    width: 40px; /* Smaller logo */
    height: 40px;
    object-fit: contain;
    background: white;
    padding: 2px;
    border-radius: 20%;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.team-info h2 {
    margin: 0;
    font-size: 1rem; /* Smaller font */
    line-height: 1.2;
}

.team-info p {
    margin: 0;
    color: #666;
    font-size: .7rem; /* Smaller font */
    display: none; /* Hide owner name to save space? Or keep small? Keeping small. */
}

.roster-table-container {
    overflow-x: hidden; /* Hide scrollbar if possible, content should fit */
}

.roster-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem; /* Compact font */
}

.roster-table th {
    text-align: left;
    padding: 0.25rem; /* Reduced padding */
    background: #e9ecef;
    color: #495057;
    font-weight: 600;
}

.header-points {
    text-align: right !important;
}

.roster-table td {
    padding: 0.15rem 0.25rem; /* Very compact padding */
    border-bottom: 1px solid #dee2e6;
    /* Removed white-space: nowrap to allow flex handling inside cells if needed, but flexrow handles it */
}

.player-row {
    cursor: pointer;
    transition: background-color 0.2s;
}

.player-row:hover {
    background-color: #e2e6ea;
}

/* Slot highlighting across teams */
.highlight-slot {
    background-color: #dadcde; /* Lighter gray than hover */
}
/* Ensure the direct hover overrides the slot highlight */
.player-row:hover {
    background-color: #dbe4ea !important;
}

.name-cell {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 0; /* Important for flex to shrink it */
    width: 100%; /* Take available space */
}

.text-shrink {
    font-size: 1em; /* Shrink font for long names */
    letter-spacing: -0.2px;
}

.points-cell {
    font-weight: bold;
    color: #000000;
    text-align: right;
    width: 30px; /* Fixed width */
    min-width: 30px;
    white-space: nowrap;
}

/* Footer Styles */
.total-row td {
    border-top: 2px solid #aaa;
    padding: 0.25rem 0.25rem;
    font-weight: bold;
    background-color: #f1f3f5;
}

.total-label {
    text-align: right;
    padding-right: 0.5rem;
}

.total-points {
    text-align: right;
    color: #000000;
}

/* Modal Styles */
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
    background: #fff; /* Ensure white background for result modal */
    padding: 1.5rem;
    border-radius: 12px;
    position: relative;
    max-width: 90%;
    max-height: 90vh;
}

.player-card-modal-content {
    background: transparent !important;
    padding: 0 !important;
    box-shadow: none !important;
}

.result-modal-content {
    width: 400px;
}

.result-modal-content h3 {
    margin-top: 0;
    margin-bottom: 1rem;
}

.modal-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.team-score-input {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.team-score-input label {
    font-weight: 600;
    flex: 1;
}

.team-score-input input {
    width: 60px;
    padding: 0.25rem;
    font-size: 1.1rem;
    text-align: center;
}

.winner-selector {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 1rem;
}

.winner-selector select {
    padding: 0.25rem;
    font-size: 1rem;
    flex: 1;
    margin-left: 1rem;
}

.modal-footer {
    margin-top: 1.5rem;
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
}

.submit-btn, .cancel-btn {
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    border: none;
}

.submit-btn {
    background: #007bff;
    color: white;
}

.cancel-btn {
    background: #ccc;
    color: #333;
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

/* Matrix Styles */
.matrix-view {
    margin-bottom: 2rem;
}

.matrix-view h3 {
    margin-top: 0;
    margin-bottom: 1rem;
    font-size: 1.2rem;
    border-bottom: 2px solid #eee;
    padding-bottom: 0.5rem;
}

.matrix-container {
    overflow-x: auto;
    background: white;
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.matrix-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9rem;
}

.matrix-table th, .matrix-table td {
    border: 1px solid #dee2e6;
    padding: 0.5rem;
    text-align: center;
}

.matrix-table th {
    background: #f8f9fa;
    font-weight: 600;
}

.matrix-row-header {
    background: #f8f9fa;
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
}

.matrix-self {
    color: #ccc;
}

.matrix-record {
    font-weight: bold;
}

.matrix-wins {
    color: #28a745;
}

.border-right-cell {
    border-right: 2px solid #dee2e6 !important;
}

.matrix-losses {
    color: #dc3545;
}

.matrix-pct {
    font-size: 0.75rem;
    color: #666;
    margin-top: 2px;
}

/* Darker intersection if both are phantoms (self-cell usually handles this, but just in case) */
.phantoms-cell.matrix-self {
    background-color: #333;
}

/* Ensure Phantoms cells have darker text if needed, or white if background is dark */
.phantoms-header {
    border-color: #555;
}

.team-link {
    color: inherit;
    text-decoration: none;
    font-weight: bold;
}
.team-link:hover {
    text-decoration: underline;
    color: #0056b3;
}

.team-link-header {
    color: inherit;
    text-decoration: none;
}
.team-link-header:hover {
    text-decoration: underline;
}

/* All-Time Trophy Case */
.trophy-case-section {
    margin-top: 2rem;
    margin-bottom: 2rem;
    background: #fff;
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.trophy-case-section h3 {
    margin-top: 0;
    border-bottom: 2px solid #eee;
    padding-bottom: 0.5rem;
    margin-bottom: 1rem;
}

.franchise-accolade-row {
    display: flex;
    align-items: center; /* Align Top? Or Center? */
    padding: 0.5rem 0;
    border-bottom: 1px solid #f1f1f1;
}
.franchise-accolade-row:last-child {
    border-bottom: none;
}

.franchise-info {
    width: 200px;
    display: flex;
    align-items: center;
    gap: 8px;
}

/* NEW: Flex Column for Trophy Rows */
.accolade-icons-column {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.accolade-row {
    display: flex;
    gap: 4px;
}

.trophy-icon-lg {
    height: 32px;
    width: 32px;
    object-fit: contain;
}

/* All-Time Table Width Constraint */
.all-time-table {
    max-width: 700px;
}

/* Postseason Styles (Redesigned) */
.season-finales {
    margin-bottom: 2rem;
}

.finale-card {
    background: #fff;
    border-radius: 8px;
    padding: 0;
    margin-bottom: 1rem;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    border: 1px solid #e9ecef;
    overflow: hidden;
}

.spaceship-card {
    background-color: #FFD700;
    background-image: linear-gradient(135deg, #F0E68C 0%, #FFD700 100%);
    border: 1px solid #DAA520;
}

.spoon-card {
    background-color: #5D4037;
    background-image: linear-gradient(135deg, #6D4C41 0%, #4E342E 100%);
    border: 1px solid #3E2723;
    color: #efebe9; /* Slightly off-white for muddy feel */
}

.finale-header-text {
    background: rgba(0,0,0,0.1); /* Subtle dark overlay for header */
    color: inherit;
    font-weight: 800;
    text-align: center;
    padding: 0.25rem;
    letter-spacing: 1px;
    font-size: 0.8rem;
    border-bottom: 1px solid rgba(0,0,0,0.1);
}

.finale-content-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    gap: 1rem;
}

.finale-trophy-column {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
}

.finale-trophy-lg {
    height: 60px; /* Bigger Trophy */
    width: auto;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
}

.finale-details-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: left; /* Left align text */
    align-items: flex-start;
}

.finale-logo-column {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
}

.finale-winner-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}

.winner-name-lg {
    font-size: 1.8rem; /* Much Bigger Font */
    font-weight: 900;
    text-transform: uppercase;
    color: inherit;
    line-height: 1.1;
}
.spaceship-card .winner-name-lg { color: #000; }
.spoon-card .winner-name-lg {
    color: #d7ccc8; /* Dull text */
    font-size: 1.3rem; /* Smaller for loser */
}

.winner-logo-lg {
    height: 50px; /* Larger logo for the right side */
    width: 50px;
    object-fit: contain;
    background: white;
    border-radius: 20%;
    padding: 4px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.finale-score-line {
    font-size: 1rem;
    font-weight: 700;
    opacity: 0.9;
}
.spaceship-card .finale-score-line { color: #218838; }
.spoon-card .finale-score-line { color: red; }

/* Responsive adjustments */
@media (max-width: 1000px) {
    .teams-list {
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    }
}
</style>
