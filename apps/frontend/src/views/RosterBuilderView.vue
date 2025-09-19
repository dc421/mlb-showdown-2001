<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import PlayerCard from '@/components/PlayerCard.vue'; // Import the PlayerCard component

const authStore = useAuthStore();
const router = useRouter();
const selectedCard = ref(null);

// --- STATE ---
const filterPosition = ref('ALL');
const draggedItem = ref(null);

const roster = ref({
  lineup: { C: null, '1B': null, '2B': null, SS: null, '3B': null, LF: null, CF: null, RF: null, DH: null },
  pitchingStaff: [],
  bench: [],
});

// --- COMPUTED PROPERTIES ---
const allPlayersOnRoster = computed(() => [
    ...Object.values(roster.value.lineup).filter(p => p),
    ...roster.value.pitchingStaff,
    ...roster.value.bench
]);
const playerCount = computed(() => allPlayersOnRoster.value.length);
const totalPoints = computed(() => {
  return allPlayersOnRoster.value.reduce((sum, player) => {
    // A player is on the bench if they are in the benchPlayers array.
    const isBenched = benchPlayers.value.some(p => p.card_id === player.card_id);
    const cost = (isBenched && player.control === null) ? Math.round(player.points / 5) : player.points;
    return sum + cost;
  }, 0);
});
const starterPlayerIds = computed(() => {
    const lineupIds = lineupPlayers.value.map(p => p.card_id);
    const spIds = startingPitchersOnRoster.value.map(p => p.card_id);
    return new Set([...lineupIds, ...spIds]);
});
const availablePlayers = computed(() => {
  return authStore.allPlayers
    .filter(p => !allPlayersOnRoster.value.some(rp => rp.card_id === p.card_id))
    .filter(p => {
        if (filterPosition.value === 'ALL') return true;
        if (filterPosition.value === 'SP') return p.displayPosition === 'SP';
        if (filterPosition.value === 'RP') return p.displayPosition === 'RP';
        if (filterPosition.value === 'P') return p.control !== null;
        if (filterPosition.value === 'DH') return p.displayPosition === 'DH';
        const playerPositions = p.fielding_ratings ? Object.keys(p.fielding_ratings) : [];
        if (filterPosition.value === 'LF/RF') {
    const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings) : [];
    return positions.includes('LF') || positions.includes('RF') || positions.includes('LFRF');
}
return playerPositions.includes(filterPosition.value);
    })
    .sort((a, b) => (b.points || 0) - (a.points || 0));
});

const lineupPlayers = computed(() => Object.values(roster.value.lineup).filter(p => p));
const startingPitchersOnRoster = computed(() => roster.value.pitchingStaff.filter(p => p.displayPosition === 'SP'));
const bullpenOnRoster = computed(() => roster.value.pitchingStaff.filter(p => p.displayPosition === 'RP'));
const benchPlayers = computed(() => roster.value.bench);

// --- HELPER & VALIDATION ---
function isPlayerEligibleForPosition(player, position) {
    if (!player || !position) return false;
    if (player.control !== null) return false; // Pitchers can't play in the lineup
    if (position === '1B' || position === 'DH') return true; // Any position player can play 1B or DH
    const playerPositions = player.fielding_ratings ? Object.keys(player.fielding_ratings) : [];
    if (position === 'LF' || position === 'RF') {
        return playerPositions.includes('LF') || playerPositions.includes('RF') || playerPositions.includes('LFRF');
    }
    return playerPositions.includes(position);
}

const isRosterValid = computed(() => {
  // Rule 1: Must have 20 players
  if (playerCount.value !== 20) return false;
  
  // Rule 2: Must be under 5000 points
  if (totalPoints.value > 5000) return false;

  // Rule 3: Must have exactly 4 Starting Pitchers on the staff
  if (startingPitchersOnRoster.value.length !== 4) return false;
  
  // Rule 4: All 9 lineup spots must be filled
  if (lineupPlayers.value.length !== 9) return false;

  // Rule 5: Every player in the lineup must be eligible for their assigned position
  for (const pos in roster.value.lineup) {
    const player = roster.value.lineup[pos];
    if (!isPlayerEligibleForPosition(player, pos)) {
      return false;
    }
  }

  // Rule 6: Check for duplicate player names
  const names = allPlayersOnRoster.value.map(p => p.name);
  const uniqueNames = new Set(names);
  if (uniqueNames.size !== names.length) return false;

  return true; // If all checks pass, the roster is valid
});

// --- METHODS ---
function onDragStart(event, player, from, originalPosition = null) {
  draggedItem.value = { player, from, originalPosition };
  event.dataTransfer.effectAllowed = 'move';
}

function onDrop(event, to, targetPosition = null) {
  if (!draggedItem.value) return;
  const { player, from } = draggedItem.value;
  const playerFromRoster = from !== 'available';
  if (playerCount.value >= 20 && !playerFromRoster) {
    draggedItem.value = null; return;
  }
  if (playerFromRoster) removePlayer(player);
  if (to === 'lineup') {
    if (player.control !== null) { if(playerFromRoster) addPlayer(player); draggedItem.value = null; return; }
    const existingPlayer = roster.value.lineup[targetPosition];
    if (existingPlayer) { removePlayer(existingPlayer); addPlayer(existingPlayer); }
    roster.value.lineup[targetPosition] = player;
  } else if (to === 'pitchingStaff') {
    if(player.control === null) { if(playerFromRoster) addPlayer(player); draggedItem.value = null; return; }
    roster.value.pitchingStaff.push(player);
  } else if (to === 'bench') {
     if(player.control !== null) { if(playerFromRoster) addPlayer(player); draggedItem.value = null; return; }
    roster.value.bench.push(player);
  } else if (from === 'available') {
      addPlayer(player);
  }
  draggedItem.value = null;
}

function addPlayer(player) {
  if (allPlayersOnRoster.value.some(p => p.name === player.name)) return;
  if (player.control !== null) {
    roster.value.pitchingStaff.push(player);
  } else {
    const p_pos = player.fielding_ratings ? Object.keys(player.fielding_ratings) : [];
    const preferredOrder = ['C', 'SS', '2B', '3B', 'CF', 'LF', 'RF', '1B', 'DH'];
    let placed = false;
    for (const pos of preferredOrder) {
      if (!roster.value.lineup[pos] && isPlayerEligibleForPosition(player, pos)) {
        roster.value.lineup[pos] = player;
        placed = true;
        break;
      }
    }
    if (!placed) {
      roster.value.bench.push(player);
    }
  }
}

function removePlayer(playerToRemove) {
    roster.value.pitchingStaff = roster.value.pitchingStaff.filter(p => p.card_id !== playerToRemove.card_id);
    roster.value.bench = roster.value.bench.filter(p => p.card_id !== playerToRemove.card_id);
    for (const pos in roster.value.lineup) {
        if (roster.value.lineup[pos]?.card_id === playerToRemove.card_id) {
            roster.value.lineup[pos] = null;
        }
    }
}



async function saveRoster() {
  // Build the detailed list of cards with their assignments
  const cardsToSave = [];
  
  // Lineup Players
  for (const pos in roster.value.lineup) {
    if (roster.value.lineup[pos]) {
      cardsToSave.push({
        card_id: roster.value.lineup[pos].card_id,
        is_starter: true,
        assignment: pos
      });
    }
  }
  // Pitching Staff
  roster.value.pitchingStaff.forEach(p => {
    cardsToSave.push({
      card_id: p.card_id,
      is_starter: p.displayPosition === 'SP',
      assignment: 'PITCHING_STAFF'
    });
  });
  // Bench Players
  roster.value.bench.forEach(p => {
    cardsToSave.push({
      card_id: p.card_id,
      is_starter: false,
      assignment: 'BENCH'
    });
  });

  const rosterData = {
    cards: cardsToSave
  };
  await authStore.saveRoster(rosterData);
}

// in src/views/RosterBuilderView.vue
onMounted(async () => {
  if (authStore.allPlayers.length === 0) {
    await authStore.fetchAllPlayers();
  }
  
  if (authStore.myRoster && authStore.myRoster.cards) {
    const savedCards = authStore.myRoster.cards;

    // --- THIS IS THE FIX ---
    // We must process the saved cards to create the displayName and displayPosition properties
    const allPlayersForContext = authStore.allPlayers;
    const nameCounts = {};
    allPlayersForContext.forEach(p => { nameCounts[p.name] = (nameCounts[p.anme] || 0) + 1; });

    savedCards.forEach(p => {
        p.displayName = nameCounts[p.name] > 1 ? `${p.name} (${p.team})` : p.name;
        if (p.control !== null) {
            p.displayPosition = Number(p.ip) > 3 ? 'SP' : 'RP';
        } else {
            const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings).join(',') : 'DH';
            p.displayPosition = positions.replace(/LFRF/g, 'LF/RF');
        }
    });
    // --- End of Fix ---

    const newRoster = {
        lineup: { C: null, '1B': null, '2B': null, SS: null, '3B': null, LF: null, CF: null, RF: null, DH: null },
        pitchingStaff: [],
        bench: []
    };

    savedCards.forEach(card => {
        if (card.assignment === 'PITCHING_STAFF') {
            newRoster.pitchingStaff.push(card);
        } else if (card.assignment === 'BENCH') {
            newRoster.bench.push(card);
        } else if (card.assignment in newRoster.lineup) {
            newRoster.lineup[card.assignment] = card;
        }
    });

    roster.value = newRoster;
  }
});
</script>

<template>
  <!-- Modal for viewing player cards -->
  <div v-if="selectedCard" class="modal-overlay" @click="selectedCard = null">
    <div @click.stop><PlayerCard :player="selectedCard" /></div>
  </div>
  <div class="builder-container">
    <div class="available-players-section panel">
      <div class="panel-header">
        <h2>Available Players</h2>
        <select v-model="filterPosition">
          <option value="ALL">All Positions</option>
          <option value="SP">SP</option>
          <option value="RP">RP</option>
          <option value="C">C</option>
          <option value="1B">1B</option>
          <option value="2B">2B</option>
          <option value="SS">SS</option>
          <option value="3B">3B</option>
          <option value="LF/RF">LF/RF</option>
          <option value="CF">CF</option>
          <option value="DH">DH-Only</option>
        </select>
      </div>
      <div class="player-list drop-zone" @dragover.prevent @drop="removePlayer(draggedItem.player)">
        <div 
          v-for="player in availablePlayers" 
          :key="player.card_id"
          class="player-item"
          draggable="true"
          @dragstart="onDragStart($event, player, 'available')">
          
          <div class="player-info">
            <span class="player-name">{{ player.displayName }} ({{ player.displayPosition }})</span>
            <span class="view-icon" @click.stop="selectedCard = player" title="View Card">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </span>
          </div>
          
          <div class="player-actions">
            <span>{{ player.points }} pts</span>
            <button @click.stop="addPlayer(player)" class="add-btn">+</button>
          </div>
        </div>
      </div>
    </div>
    
    <div class="roster-section">
        <div class="roster-header">
            <div class="roster-stats">
                <span>Players: {{ playerCount }} / 20</span>
                <span :class="{ 'over-limit': totalPoints > 5000 }">Points: {{ totalPoints }} / 5000</span>
            </div>
            <button @click="saveRoster">Save Roster</button>
        </div>
        <div class="roster-grid">
            <div class="lineup-panel">
                <h3>Starting Lineup ({{ lineupPlayers.length }}/9)</h3>
                <div class="lineup-grid-positions">
                    <div v-for="(player, pos) in roster.lineup" :key="pos" class="lineup-position drop-zone" @dragover.prevent @drop="onDrop($event, 'lineup', pos)">
                        <strong>{{ pos }}:</strong>
                        <div v-if="player" class="player-chip" draggable="true" @dragstart="onDragStart($event, player, 'lineup', pos)" @click="removePlayer(player)" :class="{ 'illegal-placement': !isPlayerEligibleForPosition(player, pos) }">
                            {{ player.displayName }} <small>({{player.displayPosition}} | {{player.points}} pts)</small>
                        </div>
                    </div>
                </div>
            </div>
            <div class="staff-panel">
                <h3>Pitching Staff ({{ roster.pitchingStaff.length }})</h3>
                <div class="staff-area">
                  <strong>Starting Pitchers ({{ startingPitchersOnRoster.length }}/4):</strong>
                  <div class="bench-area drop-zone" @dragover.prevent @drop="onDrop($event, 'pitchingStaff')">
                      <div v-for="p in startingPitchersOnRoster" :key="p.card_id" class="player-chip" draggable="true" @dragstart="onDragStart($event, p, 'pitchingStaff')" @click="removePlayer(p)">
                        {{ p.displayName }} <small>({{p.displayPosition}} | {{p.points}} pts)</small>
                      </div>
                  </div>
                  <strong>Bullpen ({{ bullpenOnRoster.length }}):</strong>
                  <div class="bench-area drop-zone" @dragover.prevent @drop="onDrop($event, 'pitchingStaff')">
                      <div v-for="p in bullpenOnRoster" :key="p.card_id" class="player-chip" draggable="true" @dragstart="onDragStart($event, p, 'pitchingStaff')" @click="removePlayer(p)">
                        {{ p.displayName }} <small>({{p.displayPosition}} | {{p.points}} pts)</small>
                      </div>
                  </div>
                </div>
                <h3>Bench ({{ benchPlayers.length }})</h3>
                <div class="bench-area drop-zone" @dragover.prevent @drop="onDrop($event, 'bench')">
                    <div v-for="p in benchPlayers" :key="p.card_id" class="player-chip" draggable="true" @dragstart="onDragStart($event, p, 'bench')" @click="removePlayer(p)">
                      {{ p.displayName }} <small>({{p.displayPosition}} | {{p.points}} pts)</small>
                    </div>
                </div>
            </div>
        </div>
    </div>
  </div>
</template>

<style scoped>
.builder-container { display: grid; grid-template-columns: 400px 1fr; grid-template-rows: auto 1fr; gap: 1rem; padding: 1rem; height: calc(100vh - 50px); box-sizing: border-box; }
.available-players-section { grid-row: 1 / 3; display: flex; flex-direction: column; background: #f4f6f8; padding: 1rem; border-radius: 8px; overflow: hidden; }
.roster-section { grid-row: 1 / 3; display: flex; flex-direction: column; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.player-list { flex-grow: 1; overflow-y: auto; border: 1px solid #ddd; background: white; border-radius: 4px; }
.player-item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; cursor: grab; border-bottom: 1px solid #eee; }
.player-info { display: flex; align-items: center; gap: 0.5rem; }
.view-icon { cursor: pointer; color: #6c757d; }
.view-icon:hover { color: #007bff; }
.player-actions { display: flex; align-items: center; gap: 0.5rem; }
.add-btn { background: #28a745; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; font-size: 16px; line-height: 24px; cursor: pointer; }
.roster-header { display: flex; gap: 1rem; align-items: center; background: #e9ecef; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;}
.roster-header input { flex-grow: 1; padding: 0.75rem; font-size: 1.1rem; }
.roster-stats { font-weight: bold; text-align: center; white-space: nowrap; }
.roster-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 1rem; flex-grow: 1; overflow-y: auto; }
.lineup-panel, .staff-panel { background: #f4f6f8; padding: 1rem; border-radius: 8px; display: flex; flex-direction: column; }
.lineup-grid-positions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; }
.lineup-position { padding: 0.5rem; border: 1px dashed #ccc; border-radius: 4px; min-height: 50px; font-size: 0.9em; }
.staff-area { flex-grow: 1; display: flex; flex-direction: column; gap: 0.5rem; }
.bench-area { border: 1px dashed #ccc; border-radius: 4px; padding: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-content: flex-start; min-height: 50px; }
.player-chip { background-color: #dee2e6; padding: 0.25rem 0.5rem; border-radius: 12px; cursor: pointer; font-size: 0.85em; }
.player-chip:hover { background-color: #ffdddd; }
.player-chip small { color: #495057; }
.over-limit { color: #dc3545; }
.drop-zone:hover { border-color: #007bff; }
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000; }
</style>