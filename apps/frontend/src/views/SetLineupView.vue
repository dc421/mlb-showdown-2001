<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { socket } from '@/services/socket';

const authStore = useAuthStore();
const gameStore = useGameStore();
const route = useRoute();
const router = useRouter();
const gameId = route.params.id;

const startingPitcher = ref(null);
const battingOrder = ref([]);
const hasSubmitted = ref(false); // New state for the waiting screen
const useDh = computed(() => gameStore.game?.use_dh !== false);

const defensivePositions = computed(() => {
  const positions = ['C', 'SS', 'CF', '2B', '3B', 'LF', 'RF', '1B'];
  if (useDh.value) {
    positions.push('DH');
  }
  return positions;
});

const starters = computed(() => authStore.activeRosterCards.filter(p => p.is_starter));
const startingPitchers = computed(() => starters.value.filter(p => p.displayPosition === 'SP'));
const positionPlayers = computed(() => starters.value.filter(p => p.displayPosition !== 'SP' && p.displayPosition !== 'RP'));

const availableBatters = computed(() => {
  return positionPlayers.value.filter(p => !battingOrder.value.some(bo => bo.player.card_id === p.card_id));
});

function isPlayerEligibleForPosition(player, position) {
    if (!player || !position) return false;
    if (player.displayPosition === 'SP' || player.displayPosition === 'RP') return position === 'P';
    if (position === '1B' || (position === 'DH' && useDh.value)) return true;
    const playerPositions = player.fielding_ratings ? Object.keys(player.fielding_ratings) : [];
    if (position === 'LF' || position === 'RF') return playerPositions.includes('LF') || playerPositions.includes('RF') || playerPositions.includes('LFRF');
    return playerPositions.includes(position);
}

const duplicatePositions = computed(() => {
    const positions = battingOrder.value.map(spot => spot.position).filter(pos => pos);
    const positionCounts = positions.reduce((acc, pos) => {
        const key = pos === 'P' ? 'DH' : pos;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    return new Set(Object.keys(positionCounts).filter(pos => positionCounts[pos] > 1));
});

const isLineupValid = computed(() => {
  if (!startingPitcher.value || battingOrder.value.length !== 9) return false;
  if (duplicatePositions.value.size > 0) return false;
  
  for (const spot of battingOrder.value) {
    if (!spot.position || !isPlayerEligibleForPosition(spot.player, spot.position)) return false;
  }
  return true;
});

// in src/views/SetLineupView.vue

// in SetLineupView.vue
function autoPopulateLineup() {
  const savedCards = authStore.activeRosterCards;
  
  // Filter to get only the players who were assigned to a lineup spot in the Roster Builder.
  let lineupPlayers = savedCards.filter(card => 
    card.assignment && card.assignment !== 'BENCH' && card.assignment !== 'PITCHING_STAFF'
  );

  // --- THIS IS THE FIX ---
  // If the "No DH" rule is in effect, find and remove the player assigned to the DH spot.
  if (!useDh.value) {
    lineupPlayers = lineupPlayers.filter(player => player.assignment !== 'DH');
  }
  
  const initialLineup = lineupPlayers.map(player => ({
    player: player,
    position: player.assignment
  }));
  
  const finalBattingOrder = initialLineup.sort((a, b) => b.player.points - a.player.points);

  battingOrder.value = finalBattingOrder;
}

watch(startingPitcher, (newPitcher) => {
    if (!useDh.value && newPitcher) {
        battingOrder.value = battingOrder.value.filter(p => p.player.displayPosition !== 'SP' && p.player.displayPosition !== 'RP');
        if (battingOrder.value.length === 8) {
            battingOrder.value.push({ player: newPitcher, position: 'P' });
        }
    }
});

function addToLineup(player) {
    const lineupSize = useDh.value ? 9 : 8;
    const currentPositionPlayers = battingOrder.value.filter(spot => spot.player.control === null);
    if (currentPositionPlayers.length < lineupSize) {
        battingOrder.value.push({ player: player, position: null });
    } else {
        alert('All position player spots in the lineup are full.');
    }
}

function removeFromLineup(card_id) {
  battingOrder.value = battingOrder.value.filter(p => p.player.card_id !== card_id);
}

function moveUp(index) {
  if (index > 0) {
    [battingOrder.value[index], battingOrder.value[index - 1]] = [battingOrder.value[index - 1], battingOrder.value[index]];
  }
}

function moveDown(index) {
  if (index < battingOrder.value.length - 1) {
    [battingOrder.value[index], battingOrder.value[index + 1]] = [battingOrder.value[index + 1], battingOrder.value[index]];
  }
}

async function handleSubmission() {
    if (!isLineupValid.value) {
        return alert('Lineup is invalid. Please select 1 SP and assign 9 unique and legal positions to your batters.');
    }
    const lineupData = {
        battingOrder: battingOrder.value.map(p => ({ card_id: p.player.card_id, position: p.position })),
        startingPitcher: startingPitcher.value.card_id
    };
    await authStore.submitLineup(gameId, lineupData);
    console.log('Lineup submitted. Now in waiting state.'); // <-- ADD THIS
    hasSubmitted.value = true; // Show the waiting message
}

// in SetLineupView.vue
onMounted(async () => {
  console.log('1. SetLineupView has mounted for game ID:', gameId);
  await gameStore.fetchGame(gameId); // Fetches basic game info like DH rule

  const participantInfo = await authStore.fetchMyParticipantInfo(gameId);
  console.log('2. Fetched participant info:', participantInfo);

  if (participantInfo && participantInfo.roster_id) {
    console.log('3. Roster ID found. Fetching roster details for:', participantInfo.roster_id);
    await authStore.fetchRosterDetails(participantInfo.roster_id);
    console.log('4. Roster details fetch complete. Calling autoPopulateLineup...');
    autoPopulateLineup();
  } else {
    console.error('CRITICAL ERROR: No participant info or roster_id found for this game.');
  }

  socket.on('game-starting', () => {
    // ADD THIS LOG
    console.log("--- FRONTEND: Received 'game-starting' event! Redirecting... ---");
    router.push(`/game/${gameId}`);
  });
});

onUnmounted(() => {
  console.log('SetLineupView is UNMOUNTING.'); // <-- ADD THIS
  socket.off('game-starting');
});
</script>

<template>
  <div class="container">
    <div v-if="!hasSubmitted">
      <h1>Set Your Starting Lineup</h1>
      <h2 class="subtitle" v-if="!useDh">Pitcher will bat</h2>
      <div class="lineup-builder">
        <div class="panel">
          <h2>Your Starters</h2>
          <div class="player-list">
            <h3>Position Players ({{ positionPlayers.length }})</h3>
            <div v-for="p in availableBatters" :key="p.card_id" class="player-item" @click="addToLineup(p)">
              {{ p.displayName }} ({{ p.displayPosition }})
            </div>
            <h3>Starting Pitchers ({{ startingPitchers.length }})</h3>
            <div v-for="p in startingPitchers" :key="p.card_id" class="player-item">
              {{ p.displayName }} (SP)
            </div>
          </div>
        </div>
        <div class="panel">
          <h2>Starting Pitcher</h2>
          <select v-model="startingPitcher" class="pitcher-select">
            <option :value="null" disabled>Select an SP...</option>
            <option v-for="p in startingPitchers" :key="p.card_id" :value="p">
              {{ p.displayName }}
            </option>
          </select>
          <h2>Batting Order ({{ battingOrder.length }} / 9)</h2>
          <div class="lineup-slots">
            <div v-for="(spot, index) in battingOrder" :key="spot.player.card_id" class="lineup-item">
              <span>{{ index + 1 }}. {{ spot.player.displayName }}</span>
              <div>
                <select v-model="spot.position" 
                  :class="{ 
                      'invalid-position': spot.position && !isPlayerEligibleForPosition(spot.player, spot.position),
                      'duplicate-position': duplicatePositions.has(spot.position) 
                  }" 
                  :disabled="spot.player.displayPosition === 'SP' || spot.player.displayPosition === 'RP'">
                  <option :value="null" disabled>Pos...</option>
                  <option v-if="!useDh && (spot.player.displayPosition === 'SP' || spot.player.displayPosition === 'RP')" value="P">P</option>
                  <option v-for="pos in defensivePositions" :key="pos" :value="pos">{{ pos }}</option>
                </select>
                <button @click="moveUp(index)" :disabled="index === 0" class="order-btn">↑</button>
                <button @click="moveDown(index)" :disabled="index === battingOrder.length - 1" class="order-btn">↓</button>
                <button @click="removeFromLineup(spot.player.card_id)" class="remove-btn">X</button>
              </div>
            </div>
          </div>
          <button @click="handleSubmission" :disabled="!isLineupValid" class="submit-btn">Submit Lineup</button>
        </div>
      </div>
    </div>
    <div v-else class="waiting-message panel">
        <h1>Lineup Submitted!</h1>
        <p>Waiting for your opponent to set their lineup...</p>
        <p>(You will be taken to the game automatically when they are ready)</p>
    </div>
  </div>
</template>

<style scoped>
  .container { max-width: 1000px; margin: 2rem auto; font-family: sans-serif; }
  .lineup-builder { display: grid; grid-template-columns: 1fr 1.5fr; gap: 2rem; }
  .panel { padding: 1rem; background-color: #f9f9f9; border-radius: 8px; }
  .player-list { max-height: 60vh; overflow-y: auto; }
  h3 { margin-top: 1rem; margin-bottom: 0.5rem; }
  .player-item { padding: 0.5rem; cursor: pointer; border-bottom: 1px solid #eee; }
  .player-item:hover { background-color: #eef8ff; }
  .pitcher-select { width: 100%; padding: 0.5rem; margin-bottom: 1rem; font-size: 1rem; border-radius: 4px; border: 1px solid #ccc; }
  .lineup-slots { max-height: 50vh; overflow-y: auto; }
  .lineup-item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; border-bottom: 1px solid #eee; }
  .lineup-item select { border-radius: 4px; border: 1px solid #ccc; }
  .lineup-item select.invalid-position, .lineup-item select.duplicate-position { border-color: orange; background-color: #fff3e0; }
  .remove-btn { color: red; margin-left: 0.5rem; background: transparent; border: none; font-size: 1.2rem; cursor: pointer; }
  .order-btn { margin-left: 0.5rem; padding: 2px 6px; }
  .submit-btn { width: 100%; padding: 1rem; font-size: 1.2rem; margin-top: 1rem; cursor: pointer; border-radius: 4px; border: none; color: white; background-color: #28a745; }
  .submit-btn:disabled { background-color: #ccc; cursor: not-allowed; }
  .subtitle { text-align: center; color: #dc3545; font-weight: bold; margin-top: -1rem; margin-bottom: 1rem; }
  .waiting-message { text-align: center; }
</style>