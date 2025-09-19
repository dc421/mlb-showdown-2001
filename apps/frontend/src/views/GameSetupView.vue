<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';
import { socket } from '@/services/socket';

const gameStore = useGameStore();
const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const gameId = route.params.id;

const homeTeamUserId = ref(null);
const useDh = ref(true);
const rollWinnerId = ref(null);
const waitingForRematch = ref(false);

const participants = computed(() => gameStore.setupState?.participants || []);
const diceRolls = computed(() => gameStore.setupState?.rolls || {});
const iHaveRolled = computed(() => authStore.user?.userId in diceRolls.value);
const bothPlayersHaveRolled = computed(() => participants.value.length > 0 && Object.keys(diceRolls.value).length === participants.value.length);
const isHomeTeam = computed(() => authStore.user?.userId === homeTeamUserId.value);
const setupComplete = computed(() => homeTeamUserId.value !== null);



function determineRollWinner() {
  if (!bothPlayersHaveRolled.value) return;
  const [playerA, playerB] = participants.value;
  const rollA = diceRolls.value[playerA.user_id];
  const rollB = diceRolls.value[playerB.user_id];
  if (rollA === rollB) {
    // On a tie, show a message and call the reset function
    waitingForRematch.value = true;
    setTimeout(() => {
        gameStore.resetRolls(gameId); // This will clear rolls for both players
        waitingForRematch.value = false;
    }, 2000); // Wait 2 seconds before resetting
    return;
  }
  
  homeTeamUserId.value = rollA > rollB ? playerA.user_id : playerB.user_id;
  socket.emit('choice-made', { gameId, homeTeamUserId: homeTeamUserId.value });
}

function declareHomeTeam(homePlayer) {
    console.log('1. FRONTEND: declareHomeTeam called. Calling store action...');
    gameStore.declareHomeTeam(gameId, homePlayer.user_id);
}

async function submitSetup() {
  console.log('1. GameSetupView: submitSetup function was called.');
  if (!setupComplete.value) return;
  await gameStore.submitGameSetup(gameId, {
    homeTeamUserId: homeTeamUserId.value,
    useDh: useDh.value
  });
}

onMounted(async () => {
  await gameStore.fetchGameSetup(gameId);

  if (gameStore.setupState?.homeTeamUserId) {
    homeTeamUserId.value = gameStore.setupState.homeTeamUserId;
    if (gameStore.setupState.useDh !== null) {
      useDh.value = gameStore.setupState.useDh;
    }
  }

  // Listen for all real-time updates from the other player
  socket.connect();
  socket.emit('join-game-room', gameId);
  socket.on('roll-updated', () => gameStore.fetchGameSetup(gameId));
  socket.on('choice-updated', (data) => { homeTeamUserId.value = data.homeTeamUserId; });
  socket.on('dh-rule-updated', (data) => { useDh.value = data.useDh; });
  socket.on('setup-complete', () => {
    router.push(`/game/${gameId}/lineup`);
  });
});

onUnmounted(() => {
  socket.off('roll-updated');
  socket.off('setup-complete');
});

watch(diceRolls, () => {
    if (bothPlayersHaveRolled.value) {
        determineRollWinner();
    }
}, { deep: true });
</script>

watch(useDh, (newValue) => {
  // When the home team changes the DH rule, notify the server
  if (isHomeTeam.value) {
    socket.emit('dh-rule-changed', { gameId, useDh: newValue });
  }
});

<template>
  <div class="container">
    <h1>Game Setup</h1>
    <p class="subtitle">The winner of the dice roll will be the home team.</p>
    <div class="panel" v-if="participants.length > 0">
      <div class="participants">
          <div v-for="player in participants" :key="player.user_id" class="participant">
              <span><strong>{{ player.full_display_name }}</strong></span>
              <img :src="player.logo_url" :alt="player.name" class="team-logo-small" />
              <span class="roll" v-if="diceRolls[player.user_id]">{{ diceRolls[player.user_id] }}</span>
          </div>
      </div>
      <hr />

      <div class="setup-section" v-if="!homeTeamUserId && !bothPlayersHaveRolled">
          <h2>1. Determine Home Team</h2>
          <p>Have one player declare or have both players roll.</p>
          <div class="declare-buttons">
              <button @click="declareHomeTeam(participants[0])">{{ participants[0].city }} is Home</button>
              <button @click="declareHomeTeam(participants[1])">{{ participants[1].city }} is Home</button>
          </div>
          <div class="roll-buttons">
            <button v-if="!iHaveRolled" @click="gameStore.submitRoll(gameId)">
                Roll Your Die
            </button>
            <span v-else class="waiting-text">You have rolled. Waiting for opponent...</span>
          </div>
          <div v-if="waitingForRematch" class="result"><strong>Tie! Roll again.</strong></div>
      </div>
      
      <div class="setup-section" v-if="homeTeamUserId">
        <h2>2. Set DH Rule</h2>
        <div class="result">
          <strong>Home Team:</strong> {{ participants.find(p => p.user_id === homeTeamUserId)?.city }}
        </div>
        <div v-if="isHomeTeam" class="dh-section">
          <p>As the home team, you decide the DH rule for this game.</p>
          <div class="dh-toggle">
            <label><input type="radio" :value="true" v-model="useDh"> Use DH</label>
            <label><input type="radio" :value="false" v-model="useDh"> No DH (Pitcher Bats)</label>
          </div>
        </div>
        <div v-else class="dh-section">
          <p>Waiting for the home team to set the DH rule...</p>
        </div>
      </div>
      
      <button v-if="isHomeTeam" @click="submitSetup" :disabled="!setupComplete" class="submit-btn">
  Confirm and Proceed to Lineups
</button>

    </div>
    <div v-else>Loading...</div>
  </div>
</template>

<style scoped>
  .container { max-width: 600px; margin: 2rem auto; font-family: sans-serif; text-align: center; }
  .subtitle { color: #555; margin-bottom: 2rem; }
  .panel { padding: 2rem; background-color: #f9f9f9; border-radius: 8px; }
  .setup-section { margin-bottom: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 1.5rem; }
  .participants { display: flex; justify-content: space-around; align-items: flex-start; margin: 1rem 0; font-size: 1.2rem; }
  .participant { display: flex; flex-direction: column; align-items: center; min-height: 80px; }
  .roll { font-size: 2rem; font-weight: bold; margin-top: 0.5rem; }
  .waiting-text { font-style: italic; color: #888; margin-top: 10px; }
  .result { margin-top: 1rem; font-size: 1.1rem; }
  .dh-section { margin-top: 1rem; }
  .dh-toggle label { margin-right: 1.5rem; }
  .team-logo-small {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    margin-bottom: 0.5rem;
}
  button { padding: 0.5rem 1rem; font-size: 0.9rem; cursor: pointer; border-radius: 4px; border: 1px solid #ccc; }
  .submit-btn { background-color: #28a745; color: white; border-color: #28a745; font-weight: bold; font-size: 1rem; margin-top: 1rem; }
  .submit-btn:disabled { background-color: #ccc; border-color: #ccc; cursor: not-allowed; }
</style>