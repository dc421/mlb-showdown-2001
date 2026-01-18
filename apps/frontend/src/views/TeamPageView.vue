<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';

const route = useRoute();
const teamId = ref(route.params.teamId);
const teamData = ref(null);
const loading = ref(true);
const selectedPlayer = ref(null);
const apiUrl = import.meta.env.VITE_API_URL || '';

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
    selectedPlayer.value = player;
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

// Format Record Helper
function formatRecord(item) {
    // If we want to show Playoff results, we can.
    // e.g. "Champion"
    return item.result;
}
</script>

<template>
  <div class="team-page-container" v-if="teamData">
    <!-- HEADER -->
    <header class="team-header" :style="{ backgroundColor: teamData.team.primary_color, color: teamData.team.secondary_color }">
      <img :src="teamData.team.logo_url" :alt="teamData.team.name" class="team-logo" />
      <div class="team-info">
        <h1>{{ teamDisplayName }}</h1>
        <p>Owner: {{ teamData.team.owner_first_name }} {{ teamData.team.owner_last_name }}</p>
      </div>
      <div class="accolades">
          <!-- Reusing accolades logic but simplified -->
          <div v-if="teamData.accolades.spaceships.length > 0" class="accolade-row">
            <div v-for="(accolade, index) in teamData.accolades.spaceships" :key="accolade.season_name + index" class="accolade-item">
              <img :src="`${apiUrl}/images/golden_spaceship.png`" :title="accolade.season_name" class="accolade-icon" alt="Golden Spaceship" />
            </div>
          </div>
          <div v-if="teamData.accolades.spoons.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamData.accolades.spoons" :key="accolade.season_name + index" class="accolade-item">
               <img :src="`${apiUrl}/images/wooden_spoon.png`" :title="accolade.season_name" class="accolade-icon" alt="Wooden Spoon" />
             </div>
          </div>
          <div v-if="teamData.accolades.submarines && teamData.accolades.submarines.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamData.accolades.submarines" :key="accolade.season_name + index" class="accolade-item">
               <img :src="`${apiUrl}/images/silver_submarine.png`" :title="accolade.season_name" class="accolade-icon" alt="Silver Submarine" />
             </div>
          </div>
      </div>
    </header>

    <main class="team-main">
        <!-- SEASON HISTORY -->
        <section class="section history-section">
            <h2>Season History</h2>
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
                        <td class="season-name">{{ season.season }}</td>
                        <td>{{ season.wins }}-{{ season.losses }}</td>
                        <td>{{ season.winPct }}</td>
                        <td class="result-cell" :class="{'champion': season.result === 'Champion', 'spoon': season.result === 'Wooden Spoon'}">{{ season.result }}</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <!-- ROSTER HISTORY -->
        <section class="section rosters-section">
            <h2>Roster History</h2>
            <div v-for="roster in teamData.rosters" :key="roster.season" class="roster-block">
                <h3 class="roster-season-header">{{ roster.season }}</h3>
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
                            <tr v-for="player in roster.players" :key="player.card_id" @click="openPlayerCard(player)" class="player-row">
                                <td class="pos-cell">{{ player.position === 'BENCH' ? 'B' : player.position }}</td>
                                <td class="name-cell">{{ player.displayName }}</td>
                                <td class="points-cell">{{ player.points }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
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
  max-width: 1000px;
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

/* History Table */
.history-table {
    width: 100%;
    border-collapse: collapse;
}
.history-table th {
    text-align: left;
    padding: 0.75rem;
    background: #f1f3f5;
    font-weight: bold;
}
.history-table td {
    padding: 0.75rem;
    border-bottom: 1px solid #eee;
}
.season-name { font-weight: bold; color: #333; }
.result-cell { font-weight: 500; }
.champion { color: #d4af37; font-weight: bold; } /* Goldish */
.spoon { color: #8b4513; } /* Brown */

/* Roster Styles */
.roster-block {
    margin-bottom: 2rem;
}
.roster-season-header {
    margin: 1rem 0 0.5rem 0;
    color: #555;
    font-size: 1.2rem;
    border-left: 4px solid #ccc;
    padding-left: 0.5rem;
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
    padding: 0.4rem;
    border-top: 5px solid #f9f9f9;
    background: #e9ecef;
    color: #495057;
    font-weight: 600;
}
.header-points { text-align: right !important; }
.roster-table td {
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid #dee2e6;
}
.player-row {
    cursor: pointer;
    transition: background-color 0.2s;
}
.player-row:hover { background-color: #e2e6ea; }
.points-cell {
    font-weight: bold;
    color: #000;
    text-align: right;
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
}
</style>
