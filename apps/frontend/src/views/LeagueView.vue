<script setup>
import { ref, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import PlayerCard from '@/components/PlayerCard.vue';

const authStore = useAuthStore();
const leagueData = ref([]);
const loading = ref(true);
const selectedPlayer = ref(null);

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
    const response = await fetch(`${authStore.API_URL}/api/league?point_set_id=${pointSetId}`, {
       headers: { 'Authorization': `Bearer ${authStore.token}` }
    });
    if (response.ok) {
        leagueData.value = await response.json();
    } else {
        console.error("Failed to fetch league data");
    }
  } catch (error) {
      console.error("Error fetching league data:", error);
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

onMounted(() => {
    fetchLeagueData();
});
</script>

<template>
  <div class="league-container">
    <div v-if="loading" class="loading">Loading league data...</div>

    <div v-else class="teams-list">
        <div v-for="team in leagueData" :key="team.team_id" class="team-block">
            <div class="team-header" :style="{ borderBottom: `4px solid ${authStore.user?.team?.team_id === team.team_id ? '#28a745' : '#ccc'}` }">
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
                            <th>Pos</th>
                            <th>Player</th>
                            <th>Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="player in team.roster" :key="player.card_id" @click="openPlayerCard(player)" class="player-row">
                            <td class="pos-cell">{{ player.displayPosition || player.position }}</td>
                            <td class="name-cell">{{ player.displayName || player.name }}</td>
                            <td class="points-cell">{{ player.points }}</td>
                        </tr>
                    </tbody>
                </table>
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
    padding: 2rem;
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

.teams-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 2rem;
}

.team-block {
    background: #f9f9f9;
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.team-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-bottom: 1rem;
    margin-bottom: 1rem;
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
    font-size: 0.9rem;
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

.roster-table td {
    padding: 0.25rem;
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
    color: #28a745;
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
