<script setup>
import { onMounted, onUnmounted, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { RouterLink, useRouter } from 'vue-router';
import { socket } from '@/services/socket';

const authStore = useAuthStore();
const router = useRouter();

// in DashboardView.vue
const gamesToJoin = computed(() => {
    if (!authStore.user) return [];
    // Filter by user ID instead of email for better reliability
    return authStore.openGames.filter(game => game.host_user_id !== authStore.user.userId);
});

function handleCreateGame() {
  if (authStore.myRoster) {
    authStore.createGame(authStore.myRoster.roster_id);
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

onMounted(() => {
  authStore.fetchMyRoster();
  authStore.fetchMyGames();
  authStore.fetchOpenGames();
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
        <h1>{{ authStore.user.team.city }} {{ authStore.user.team.name }}</h1>
        <p>Owner: {{ authStore.user.owner }}</p>
      </div>
    </header>

    <main class="dashboard-main">
      <div class="panel">
        <h2>Your Roster</h2>
        <div class="roster-controls">
            <p v-if="authStore.myRoster">You have a saved roster ready for action.</p>
            <p v-else>You haven't created your roster yet.</p>
            <button @click="goToRosterBuilder">{{ authStore.myRoster ? 'Edit Your Roster' : 'Create Your Roster' }}</button>
        </div>
      </div>
      <div class="panel">
        <h2>Active Games</h2>
        <button @click="handleCreateGame" :disabled="!authStore.myRoster" class="action-btn">+ Create New Game</button>
        <ul v-if="authStore.myGames.length > 0" class="game-list">
            <li v-for="game in authStore.myGames" :key="game.game_id">
                <RouterLink :to="game.status === 'pending' ? `/game/${game.game_id}/setup` : (game.status === 'lineups' ? `/game/${game.game_id}/lineup` : `/game/${game.game_id}`)">
                    <!-- This now displays the opponent's team name -->
                    <span v-if="game.opponent">vs. {{ game.opponent.city }}</span>
                    <span v-else>Waiting for opponent...</span>
                    
                    <span class="status">{{ game.status }}</span>
                    <span v-if="game.status === 'in_progress' && Number(game.current_turn_user_id) === authStore.user?.userId" class="turn-indicator">
                        Your Turn!
                    </span>
                </RouterLink>
            </li>
        </ul>
        <p v-else>You are not in any active games.</p>
      </div>
       <div class="panel">
        <h2>Open Games to Join</h2>
         <ul v-if="authStore.openGames.length > 0" class="game-list">
         <!-- in DashboardView.vue template -->
<li v-for="game in gamesToJoin" :key="game.game_id">
  <span>Game vs. {{ game.city }}</span>
  <button @click="handleJoinGame(game.game_id)" :disabled="!authStore.myRoster">Join</button>
</li>
        </ul>
        <p v-else>No open games to join.</p>
      </div>
    </main>
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
  margin: 2rem;
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
.dashboard-main {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 1.5rem;
  padding: 0 2rem 2rem 2rem;
}
.panel {
  background: #f9f9f9;
  padding: 1.5rem;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}
.panel h2 { margin-top: 0; }
.roster-controls {
    text-align: center;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
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
</style>

