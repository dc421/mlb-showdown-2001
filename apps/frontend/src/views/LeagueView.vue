<script setup>
import { ref, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';
import { sortRoster } from '@/utils/playerUtils';

const authStore = useAuthStore();
const leagueData = ref([]);
const loading = ref(true);
const selectedPlayer = ref(null);
const seasonSummary = ref(null);

async function fetchLeagueData() {
  if (!authStore.selectedPointSetId) {
      // Ensure point sets are loaded so we have an ID
      await authStore.fetchPointSets();
  }

  const pointSetId = authStore.selectedPointSetId;
  if (!pointSetId) {
      console.error("Could not determine point set ID.");
      loading.value = false;
      return;
  }

  try {
    // Use apiClient for automatic auth handling
    const [leagueResponse, summaryResponse] = await Promise.all([
        apiClient(`/api/league?point_set_id=${pointSetId}`),
        apiClient(`/api/league/season-summary`)
    ]);

    if (leagueResponse.ok) {
        leagueData.value = await leagueResponse.json();
    } else {
        console.error("Failed to fetch league data");
    }

    if (summaryResponse.ok) {
        seasonSummary.value = await summaryResponse.json();
    } else {
        console.error("Failed to fetch season summary");
    }

  } catch (error) {
      console.error("Error fetching data:", error);
  } finally {
      loading.value = false;
  }
}

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

    // Identify missing positions
    const counts = {
        'C': 0, '1B': 0, '2B': 0, 'SS': 0, '3B': 0,
        'LF': 0, 'CF': 0, 'RF': 0, 'DH': 0,
        'SP': 0, 'RP': 0
    };

    padded.forEach(p => {
        // League rosters often have 'PITCHING_STAFF' as assignment, or explicit positions
        const pos = p.assignment === 'PITCHING_STAFF' ? (p.displayPosition || p.position) : (p.assignment || p.displayPosition || p.position);

        // Normalize position string
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
        const nextMissing = missing.shift() || 'Bench';
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

onMounted(() => {
    fetchLeagueData();
});
</script>

<template>
  <div class="league-container">
    <div v-if="loading" class="loading">Loading league data...</div>

    <div v-else>
        <!-- Season Summary Section -->
        <div v-if="seasonSummary && (seasonSummary.standings.length > 0 || seasonSummary.recentResults.length > 0)" class="summary-section">

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
                            <td>{{ team.name }}</td>
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
                        <template v-if="result.score">
                            <span class="result-winner">{{ result.winner }}</span> def.
                            <span class="result-loser">{{ result.loser }}</span>
                            <span class="result-score">({{ result.score }})</span>
                        </template>
                        <template v-else>
                            <span class="result-matchup">{{ result.winner }} vs. {{ result.loser }}</span>
                        </template>
                    </div>
                    <div v-if="seasonSummary.recentResults.length === 0" class="no-results">
                        No results yet this season.
                    </div>
                </div>
            </div>

        </div>

        <div class="teams-list">
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
  </div>
</template>

<style scoped>
.league-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
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
    background: #fff; /* Optional: adds a background to distinguish it */
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.summary-column {
    flex: 1 1 300px; /* Minimum width 300px, grow equally */
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

/* Results List Styles */
.results-list {
    max-height: 300px; /* Optional: limit height and scroll if very long list */
    overflow-y: auto;
}

.result-item {
    padding: 0.5rem 0;
    border-bottom: 1px solid #f1f1f1;
    font-size: 0.95rem;
}

.result-item:last-child {
    border-bottom: none;
}

.result-winner {
    font-weight: 600;
    color: #28a745; /* Greenish for winner */
}

.result-loser {
    font-weight: 600;
    color: #dc3545; /* Reddish for loser? Or just regular black */
    color: #333;
}

.result-score {
    color: #666;
    font-weight: bold;
    margin-left: 0.5rem;
}

.no-results {
    color: #888;
    font-style: italic;
    padding: 1rem 0;
}


/* Existing Styles */
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
    border-top: 2px solid #aaa; /* Slightly darker border for separation */
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
</style>
