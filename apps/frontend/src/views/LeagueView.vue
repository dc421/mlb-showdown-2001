<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';
import { sortRoster } from '@/utils/playerUtils';

const authStore = useAuthStore();
const leagueData = ref([]);
const loading = ref(true);
const selectedPlayer = ref(null);
const seasonSummary = ref(null);
const seasonsList = ref([]);
const selectedSeason = ref('');
const viewMode = ref('standings'); // 'standings' or 'matrix'
const matrixData = ref([]);

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

async function fetchSeasons() {
    try {
        const response = await apiClient('/api/league/seasons');
        if (response.ok) {
            seasonsList.value = await response.json();
            // Assuming current season is not in this list? Or is it?
            // Usually the list contains all seasons.
            // If we have a list, default selectedSeason to the first one (most recent) if not set.
            if (seasonsList.value.length > 0 && !selectedSeason.value) {
                // Actually, let's keep selectedSeason empty to mean "Current" initially,
                // but if the user picks "All-Time" or a specific one, we set it.
                // Or better: Default to the first one in the list as the "Current" one for display.
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
  // If we are looking at a past season, we might want a different point set,
  // but for now let's stick to the current logic for Rosters.

  // Note: The /api/league endpoint (rosters) is NOT filtered by season currently.
  // It returns CURRENT rosters.
  // The user requested: "view past seasons... (So that includes series results, standings, and team rosters.)"
  // Implementing historical rosters is complex (requires historical_rosters table).
  // The current backend `/api/league` endpoint does NOT support historical rosters yet.
  // Given the scope and constraints, I will focus on Results/Standings/Matrix filtering first.
  // Historical Rosters might be a bigger task or I can try to pass season to it if supported later.

  loading.value = true;

  try {
    let summaryUrl = `/api/league/season-summary`;
    if (selectedSeason.value) summaryUrl += `?season=${encodeURIComponent(selectedSeason.value)}`;

    const [leagueResponse, summaryResponse] = await Promise.all([
        apiClient(`/api/league?point_set_id=${pointSetId}`), // Still fetching current rosters
        apiClient(summaryUrl)
    ]);

    if (leagueResponse.ok) {
        leagueData.value = await leagueResponse.json();
    }
    if (summaryResponse.ok) {
        seasonSummary.value = await summaryResponse.json();
    }

    if (viewMode.value === 'matrix') {
        await fetchMatrix();
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

// Watch for view mode changes
watch(viewMode, () => {
    if (viewMode.value === 'matrix') {
        fetchMatrix();
    }
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
    const padded = [...roster];
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

    return sortRoster(padded);
}

// Result Input Modal
function openResultModal(series) {
    resultForm.value = {
        id: series.id,
        winnerName: series.winner, // Currently mapped as winning_team_name
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

        <div class="view-toggle">
            <button :class="{ active: viewMode === 'standings' }" @click="viewMode = 'standings'">Standings</button>
            <button :class="{ active: viewMode === 'matrix' }" @click="viewMode = 'matrix'">Matrix</button>
        </div>
    </div>

    <div v-if="loading" class="loading">Loading league data...</div>

    <div v-else>

        <!-- MATRIX VIEW -->
        <div v-if="viewMode === 'matrix'" class="matrix-view">
             <div class="matrix-container">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th class="matrix-corner"></th> <!-- Top Left Corner -->
                            <th v-for="team in matrixData" :key="team.id">{{ team.name }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="rowTeam in matrixData" :key="rowTeam.id">
                            <td class="matrix-row-header">{{ rowTeam.name }}</td>
                            <td v-for="colTeam in matrixData" :key="colTeam.id" class="matrix-cell">
                                <template v-if="rowTeam.id === colTeam.id">
                                    <span class="matrix-self">-</span>
                                </template>
                                <template v-else>
                                    <div v-if="rowTeam.opponents[colTeam.id]" class="matrix-record">
                                        <span class="matrix-wins">{{ rowTeam.opponents[colTeam.id].wins }}</span> -
                                        <span class="matrix-losses">{{ rowTeam.opponents[colTeam.id].losses }}</span>
                                    </div>
                                    <div v-else class="matrix-empty"></div>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
             </div>
        </div>

        <!-- STANDINGS VIEW -->
        <div v-else-if="seasonSummary && (seasonSummary.standings.length > 0 || seasonSummary.recentResults.length > 0)" class="summary-section">

            <div class="summary-column standings-column">
                <h3>Standings</h3>
                <table class="summary-table standings-table">
                    <thead>
                        <tr>
                            <th>Team</th>
                            <th class="text-right">W</th>
                            <th class="text-right">L</th>
                            <th class="text-right">Pct</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="team in seasonSummary.standings" :key="team.team_id">
                            <td>
                                <span v-if="team.clinch" class="clinch-indicator">{{ team.clinch }}</span>
                                {{ team.name }}
                            </td>
                            <td class="text-right">{{ team.wins }}</td>
                            <td class="text-right">{{ team.losses }}</td>
                            <td class="text-right">{{ team.winPctDisplay }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="summary-column results-column">
                <h3>Recent Series Results</h3>
                <div class="results-list">
                    <div v-for="result in seasonSummary.recentResults" :key="result.id" class="result-item">

                        <!-- Trophy Icons -->
                        <div v-if="result.round === 'Golden Spaceship'" class="trophy-icon" title="Golden Spaceship">
                            <img :src="`${apiUrl}/images/golden_spaceship.png`" alt="Spaceship" />
                        </div>
                        <div v-if="result.round === 'Wooden Spoon'" class="trophy-icon" title="Wooden Spoon">
                            <img :src="`${apiUrl}/images/wooden_spoon.png`" alt="Spoon" />
                        </div>
                        <div v-if="result.round === 'Silver Submarine'" class="trophy-icon" title="Silver Submarine">
                            <img :src="`${apiUrl}/images/silver_submarine.png`" alt="Submarine" />
                        </div>

                        <span v-if="['Golden Spaceship', 'Wooden Spoon', 'Silver Submarine'].includes(result.round)" class="round-label">{{ result.round }}</span>

                        <template v-if="result.score">
                            <span class="result-winner">{{ result.winner }}</span> def.
                            <span class="result-loser">{{ result.loser }}</span>
                            <span class="result-score">({{ result.score }})</span>
                        </template>
                        <template v-else>
                            <span class="result-matchup">{{ result.winner }} vs. {{ result.loser }}</span>
                            <!-- Add Result Button -->
                            <button class="add-result-btn" @click="openResultModal(result)">+</button>
                        </template>
                    </div>
                    <div v-if="seasonSummary.recentResults.length === 0" class="no-results">
                        No results yet this season.
                    </div>
                </div>
            </div>

        </div>

        <div v-if="viewMode === 'standings'" class="teams-list">
            <div v-for="team in leagueData" :key="team.team_id" class="team-block">
                <div class="team-header" >
                    <img :src="team.logo_url" :alt="team.name" class="team-logo" />
                    <div class="team-info">
                        <h2>{{ team.full_display_name }}</h2>
                        <p>Owner: {{ team.owner }}</p>
                    </div>
                </div>

                <div class="roster-table-container">
                    <table class="roster-table">
                        <thead>
                            <tr>
                                <th class="header-pos">Pos</th>
                                <th class="header-player">Player</th>
                                <th class="header-points">Points</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="player in padRoster(team.roster)" :key="player.card_id" @click="!player.isEmpty && openPlayerCard(player)" class="player-row" :class="{ 'empty-row': player.isEmpty }">
                                <td class="pos-cell">
                                    {{ player.assignment === 'PITCHING_STAFF' ? (player.displayPosition || player.position) : (player.assignment || player.displayPosition || player.position) }}
                                </td>
                                <td class="name-cell">{{ player.displayName || player.name }}</td>
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
        <div class="modal-content">
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
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
}

/* Controls Header */
.controls-header {
    display: flex;
    justify-content: space-between;
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

.view-toggle {
    display: flex;
    gap: 0.5rem;
}

.view-toggle button {
    padding: 0.5rem 1rem;
    border: 1px solid #ced4da;
    background: #fff;
    cursor: pointer;
    border-radius: 4px;
    font-weight: 600;
}

.view-toggle button.active {
    background: #007bff;
    color: white;
    border-color: #007bff;
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

.text-right {
    text-align: right !important;
}

.clinch-indicator {
    font-weight: bold;
    margin-right: 4px;
    color: #666;
}

/* Results List Styles */
.results-list {
    /* REMOVED MAX HEIGHT AND OVERFLOW AS REQUESTED */
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

.result-winner {
    font-weight: 600;
    color: #28a745;
}

.result-loser {
    font-weight: 600;
    color: #333;
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
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 2rem;
}

.team-block {
    background: #f9f9f9;
    border-radius: 8px;
    padding: 1rem;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.team-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-bottom: 1rem;
    margin-bottom: 0rem;
}

.team-logo {
    width: 60px;
    height: 60px;
    object-fit: contain;
    background: white;
    padding: 4px;
    border-radius: 20%;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.team-info h2 {
    margin: 0;
    font-size: 1.4rem;
}

.team-info p {
    margin: 0;
    color: #666;
    font-size: .8rem;
}

.roster-table-container {
    overflow-x: auto;
}

.roster-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}

.roster-table th {
    text-align: left;
    padding: 0.5rem;
    background: #e9ecef;
    color: #495057;
    font-weight: 600;
}

.header-points {
    text-align: right !important;
}

.roster-table td {
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid #dee2e6;
}

.player-row {
    cursor: pointer;
    transition: background-color 0.2s;
}

.player-row:hover {
    background-color: #e2e6ea;
}

.points-cell {
    font-weight: bold;
    color: #000000;
    text-align: right;
}

/* Footer Styles */
.total-row td {
    border-top: 2px solid #aaa;
    padding: 0.5rem 0.25rem;
    font-weight: bold;
    background-color: #f1f3f5;
}

.total-label {
    text-align: right;
    padding-right: 1rem;
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

.matrix-losses {
    color: #dc3545;
}

</style>
