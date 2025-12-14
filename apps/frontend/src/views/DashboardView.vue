<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { RouterLink, useRouter } from 'vue-router';
import { socket } from '@/services/socket';
import GameScorecard from '@/components/GameScorecard.vue';
import PlayerCard from '@/components/PlayerCard.vue';

const authStore = useAuthStore();
const router = useRouter();
const seriesType = ref('exhibition'); // Default to exhibition
const teamAccolades = ref({ spaceships: [], spoons: [] });
const selectedPlayer = ref(null);
// Ensure apiUrl is an empty string if VITE_API_URL is not defined, to allow relative paths (proxied) to work.
const apiUrl = import.meta.env.VITE_API_URL || '';

const myTeamDisplayName = computed(() => {
  if (!authStore.user?.team) return '';
  const team = authStore.user.team;
  const format = team.display_format || '{city} {name}';
  return format.replace('{city}', team.city).replace('{name}', team.name);
});

const processedRoster = computed(() => {
    if (!authStore.activeRosterCards || authStore.activeRosterCards.length === 0) return [];

    // Clone logic from LeagueView to match appearance
    const positionOrder = {
        'SP': 1, 'RP': 2, 'C': 3, '1B': 4, '2B': 5, 'SS': 6, '3B': 7,
        'LF': 8, 'CF': 9, 'RF': 10, 'DH': 11, 'B': 12
    };

    // Deep copy to avoid mutating store state directly if it were mutable
    let roster = JSON.parse(JSON.stringify(authStore.activeRosterCards));

    // Helper to process players (similar to server-side processPlayers)
    roster.forEach(p => {
        // Ensure display properties if missing (though backend usually provides them)
        if (!p.displayName && p.display_name) p.displayName = p.display_name;
        if (!p.displayPosition) {
             if (p.control !== null) {
                p.displayPosition = Number(p.ip) > 3 ? 'SP' : 'RP';
            } else {
                const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings).join(',') : 'DH';
                p.displayPosition = positions.replace(/LFRF/g, 'LF/RF');
            }
        }

        if (p.assignment === 'BENCH') {
            p.assignment = 'B';
            if (p.points) p.points = Math.round(p.points / 5);
        }
    });

    roster.sort((a, b) => {
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

    return roster;
});

const teamTotalPoints = computed(() => {
    return processedRoster.value.reduce((sum, player) => sum + (player.points || 0), 0);
});

async function fetchTeamAccolades() {
    if (authStore.user?.team?.team_id) {
        try {
            const response = await fetch(`${apiUrl}/api/teams/${authStore.user.team.team_id}/accolades`, {
                headers: { 'Authorization': `Bearer ${authStore.token}` }
            });
            if (response.ok) {
                teamAccolades.value = await response.json();
            }
        } catch (error) {
            console.error('Error fetching accolades:', error);
        }
    }
}

const gamesToJoin = computed(() => {
    if (!authStore.user) return [];
    return authStore.openGames.filter(game => game.host_user_id !== authStore.user.userId);
});

const activeGames = computed(() => {
  return authStore.myGames.filter(game => game.status !== 'completed');
});

const completedGames = computed(() => {
  return authStore.myGames.filter(game => game.status === 'completed');
});

function getGameTypeName(seriesType) {
  switch (seriesType) {
    case 'regular_season':
      return 'Regular Season Series';
    case 'playoff':
      return 'Playoff Series';
    case 'exhibition':
    default:
      return 'Exhibition';
  }
}

function handleCreateGame() {
  if (authStore.myRoster) {
    // Pass the selected series type to the store action
    authStore.createGame(authStore.myRoster.roster_id, seriesType.value);
  } else {
    alert('You must create a roster before you can create a game.');
  }
}

function handleJoinGame(gameId) {
    if (authStore.myRoster) {
    authStore.joinGame(gameId, authStore.myRoster.roster_id);
  } else {
    alert('You must create a roster before you can join a game.');
  }
}

function refreshData() {
    authStore.fetchMyGames();
    authStore.fetchOpenGames();
}

function goToRosterBuilder() {
  router.push('/roster-builder');
}

function openPlayerCard(player) {
    selectedPlayer.value = player;
}

function closePlayerCard() {
    selectedPlayer.value = null;
}

onMounted(async () => {
  // Ensure point sets are loaded to get the current season ID
  await authStore.fetchPointSets();

  await authStore.fetchMyRoster();

  // Now fetch full roster details with points for the selected point set
  if (authStore.myRoster && authStore.myRoster.roster_id && authStore.selectedPointSetId) {
      authStore.fetchRosterDetails(authStore.myRoster.roster_id, authStore.selectedPointSetId);
  }

  authStore.fetchMyGames();
  authStore.fetchOpenGames();
  fetchTeamAccolades();
  socket.connect();
  socket.on('games-updated', refreshData);
});

onUnmounted(() => {
  socket.off('games-updated', refreshData);
});
</script>

<template>
  <div class="dashboard-container" v-if="authStore.user?.team">
    <header class="team-header" :style="{ backgroundColor: authStore.user.team.primary_color, color: authStore.user.team.secondary_color }">
      <img :src="authStore.user.team.logo_url" :alt="authStore.user.team.name" class="team-logo" />
      <div class="team-info">
        <h1>{{ myTeamDisplayName }}</h1>
        <p>Owner: {{ authStore.user.owner }}</p>
        <div class="header-buttons">
            <button @click="goToRosterBuilder" class="roster-btn">{{ authStore.myRoster ? 'Edit Roster' : 'Create Roster' }}</button>
            <RouterLink to="/draft" class="roster-btn draft-link">Draft Room</RouterLink>
        </div>
      </div>
      <div class="accolades">
          <div v-if="teamAccolades.spaceships.length > 0" class="accolade-row">
            <div v-for="(accolade, index) in teamAccolades.spaceships" :key="accolade.season_name + index" class="accolade-item">
              <img :src="`${apiUrl}/images/golden_spaceship.png`"
                   :title="accolade.season_name"
                   class="accolade-icon"
                   alt="Golden Spaceship" />
            </div>
          </div>
          <div v-if="teamAccolades.spoons.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamAccolades.spoons" :key="accolade.season_name + index" class="accolade-item">
               <img :src="`${apiUrl}/images/wooden_spoon.png`"
                   :title="accolade.season_name"
                   class="accolade-icon"
                   alt="Wooden Spoon" />
             </div>
          </div>
      </div>
    </header>

    <main class="dashboard-main">
      <!-- COLUMN 1: Roster -->
      <div class="panel roster-panel">
          <h2>My Roster</h2>
          <div v-if="processedRoster.length === 0">No roster loaded.</div>
          <div v-else class="roster-table-container">
            <table class="roster-table">
                <thead>
                    <tr>
                        <th class="header-pos">Pos</th>
                        <th class="header-player">Player</th>
                        <th class="header-points">Points</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="player in processedRoster" :key="player.card_id" @click="openPlayerCard(player)" class="player-row">
                        <td class="pos-cell">{{ player.assignment === 'PITCHING_STAFF' ? (player.displayPosition || player.position) : (player.assignment || player.displayPosition || player.position) }}</td>
                        <td class="name-cell">{{ player.displayName || player.name }}</td>
                        <td class="points-cell">{{ player.points }}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="2" class="total-label">Total</td>
                        <td class="total-points">{{ teamTotalPoints }}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
      </div>

      <!-- COLUMN 2: Active Games + New Game / Open Games -->
      <div class="panel">
        <div class="active-games-section">
            <h2>Active Games</h2>
            <ul v-if="activeGames.length > 0" class="game-list">
                <li v-for="game in activeGames" :key="game.game_id">
                    <RouterLink :to="game.status === 'pending' ? `/game/${game.game_id}/setup` : (game.status === 'lineups' ? `/game/${game.game_id}/lineup` : `/game/${game.game_id}`)">
                        <GameScorecard :game="game" />
                    </RouterLink>
                </li>
            </ul>
            <p v-else>You have no active games.</p>
        </div>

        <div class="new-games-section">
            <h2>New Game</h2>
            <div class="series-options">
                <label><input type="radio" v-model="seriesType" value="exhibition"> Exhibition</label>
                <label><input type="radio" v-model="seriesType" value="regular_season"> Regular Season (7 Games)</label>
                <label><input type="radio" v-model="seriesType" value="playoff"> Playoff (Best of 7)</label>
            </div>
            <button @click="handleCreateGame" :disabled="!authStore.myRoster" class="action-btn">+ Create New Game</button>
            <h3 class="join-header">Open Games to Join</h3>
            <ul v-if="gamesToJoin.length > 0" class="game-list">
              <li v-for="game in gamesToJoin" :key="game.game_id">
                <span>{{ getGameTypeName(game.series_type) }} vs. {{ game.full_display_name }}</span>
                <button @click="handleJoinGame(game.game_id)" :disabled="!authStore.myRoster">Join</button>
              </li>
            </ul>
            <p v-else>No open games to join.</p>
        </div>
      </div>

      <!-- COLUMN 3: Completed Games -->
       <div class="panel">
        <h2>Completed Games</h2>
        <ul v-if="completedGames.length > 0" class="game-list">
          <li v-for="game in completedGames" :key="game.game_id">
            <RouterLink :to="`/game/${game.game_id}`">
              <GameScorecard :game="game" />
            </RouterLink>
          </li>
        </ul>
        <p v-else>You have no completed games.</p>
      </div>
    </main>

    <footer class="dashboard-footer">
      <RouterLink to="/official-rules">Official MLB Showdown 2001 Advanced Rules</RouterLink>
    </footer>

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
.dashboard-container {
  max-width: 1200px;
  margin: 0 auto;
}
.team-header {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 2rem;
  border-radius: 8px;
  margin: 2rem 2rem 1rem 2rem;
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

.accolade-row {
    display: flex;
    gap: 0.25rem;
}

.accolade-item {
    width: 40px;
    display: flex;
    justify-content: center;
}

.accolade-icon {
    width: auto;
    height: 35px;
}

.dashboard-main {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 1.5rem;
  padding: 0 2rem 2rem 2rem;
  align-items: start; /* Align panels to top */
}
.panel {
  background: #f9f9f9;
  padding: 1.5rem;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}
.panel h2 { margin-top: 0; }
.roster-btn {
  margin-top: 1rem;
  padding: .5rem 1rem;
  font-size: 1rem;
  border-radius: 5px;
  color: inherit;
  border: 1px solid currentColor;
  transition: all 0.1s ease-in-out;
  cursor: pointer;
  background-color: rgba(255, 255, 255, 0.2);
  font-weight: bold;
}
.roster-btn:hover {
  background-color: rgba(255, 255, 255, 0.3);
}
.roster-btn:active {
  background-color: rgba(255, 255, 255, 0.4);
  box-shadow: none;
}
.action-btn { float: right; }
.game-list {
  list-style: none;
  padding: 0;
  margin-top: 1rem;
  clear: both;
}
.game-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background-color: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}
.game-list li a {
  display: flex;
  flex-grow: 1;
  justify-content: space-between;
  text-decoration: none;
  color: inherit;
}
.game-list li a:hover { background-color: #f0f0f0; }
.status { text-transform: capitalize; color: #555; }
.turn-indicator { font-weight: bold; color: #28a745; }

.series-options {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #eee;
}

.active-games-section {
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #e0e0e0;
}

.join-header {
  margin-top: 2rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #eee;
  text-align: center;
}

@media (max-width: 768px) {
  .team-header {
    flex-direction: column;
    text-align: center;
  }
  .team-info h1 {
    font-size: 2rem;
  }
}

@media (min-width: 769px) {
  .dashboard-container {
    padding-top: 2rem;
  }
  .team-header {
    margin-top: 0;
  }
}

.dashboard-footer {
  text-align: center;
  padding: 2rem;
  margin-top: 2rem;
  border-top: 1px solid #eee;
}

/* Roster Table Styles (Copied from LeagueView) */
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
