<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue'; // Import the PlayerCard component
import { getLastName } from '@/utils/playerUtils';

const authStore = useAuthStore();
const router = useRouter();
const selectedCard = ref(null);

// --- STATE ---
const filterPosition = ref('ALL');
const searchQuery = ref('');
const draggedItem = ref(null);
const rosterType = ref('league');
const ineligibleIds = ref(new Set());

const roster = ref({
  lineup: { C: null, '1B': null, '2B': null, SS: null, '3B': null, LF: null, CF: null, RF: null, DH: null },
  pitchingStaff: [],
  bench: [],
});

const draftState = ref(null);

// --- COMPUTED PROPERTIES ---
const filteredPointSets = computed(() => {
  if (rosterType.value === 'classic') {
      return authStore.pointSets.filter(set => set.name === 'Original Pts');
  }
  const allowedNames = ["Original Pts", "Upcoming Season", "8/4/25 Season"];
  return authStore.pointSets
    .filter(set => allowedNames.includes(set.name))
    .map(set => {
      if (set.name === "8/4/25 Season") {
        return { ...set, name: "Current Season" };
      }
      return set;
    });
});

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
    .map(p => {
        // Classic Mode: Mark ineligible players
        if (rosterType.value === 'classic' && ineligibleIds.value.has(p.card_id)) {
            return { ...p, isUnavailable: true, unavailabilityReason: 'Ineligible' };
        }
        // Mark unavailable players if in draft mode
        if (rosterType.value !== 'classic' && draftState.value && draftState.value.is_active && draftState.value.takenPlayerIds) {
            if (draftState.value.takenPlayerIds.includes(p.card_id)) {
                // User wants taken players to be draggable, so we do NOT mark as unavailable here.
                // We will rely on submit validation.
                return { ...p, isTaken: true };
            }
        }
        return p;
    })
    .filter(p => {
      // 1. Filter by Search Query
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        const nameMatch = (p.name && p.name.toLowerCase().includes(query));
        const displayNameMatch = (p.displayName && p.displayName.toLowerCase().includes(query));
        if (!nameMatch && !displayNameMatch) {
          return false;
        }
      }

      // 2. Filter by Position
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
    .sort((a, b) => {
        // Sort by Points (Desc)
        const pointsDiff = (b.points || 0) - (a.points || 0);
        if (pointsDiff !== 0) return pointsDiff;

        // Then by Last Name (Asc)
        const nameA = getLastName(a.displayName).toLowerCase();
        const nameB = getLastName(b.displayName).toLowerCase();
        const lastNameDiff = nameA.localeCompare(nameB);
        if (lastNameDiff !== 0) return lastNameDiff;

        // Then by First Name (Asc)
        const firstA = a.displayName.split(' ')[0].toLowerCase();
        const firstB = b.displayName.split(' ')[0].toLowerCase();
        const firstNameDiff = firstA.localeCompare(firstB);
        if (firstNameDiff !== 0) return firstNameDiff;

        // Finally by Full Name (Asc)
        return a.displayName.localeCompare(b.displayName);
    });
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

// Helper to check if a player is owned by another team
function isPlayerOwnedByOther(player) {
    if (rosterType.value === 'classic') return false; // Disable ownership check for classic mode
    return player.owned_by_team_id && player.owned_by_team_id !== authStore.user.team.team_id;
}

function isPlayerTaken(player) {
    if (rosterType.value === 'classic') return false;
    // Check if owned by other
    if (isPlayerOwnedByOther(player)) return true;
    // Check if taken in draft
    if (draftState.value && draftState.value.is_active && draftState.value.takenPlayerIds) {
        if (draftState.value.takenPlayerIds.includes(player.card_id)) {
            // If taken, it is effectively owned by someone (could be us, but draft logic handles turns)
            // If it is in takenPlayerIds, we need to see if WE took it?
            // takenPlayerIds includes ALL taken players.
            // But if we took it in a PREVIOUS round, it should be fine?
            // Wait, if we took it, it should be in our Roster probably?
            // If we just picked it, it's in our roster.
            // If we are ADDING it now, and it is in takenPlayerIds, it means someone else took it OR we took it previously.
            // If we took it previously, it is in 'myRoster'.
            // The constraint is: we can't Add/Submit a roster with a player that belongs to someone else.
            // If takenPlayerIds includes it, we must verify if it's ours.
            // But draftState doesn't map ID->Team easily here without parsing history.
            // However, the backend validation handles "is owned by another team".
            // For Draft "Taken" players that might not have ownership data yet (if sync is laggy),
            // we should be careful.
            // But generally, if it's in takenPlayerIds, it's taken.
            return true;
        }
    }
    return false;
}

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



function buildRosterPayload() {
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
  return { cards: cardsToSave };
}

async function saveRoster() {
  // Check for players owned by other teams (Only applies to League rosters)
  if (rosterType.value === 'league') {
      const takenPlayers = allPlayersOnRoster.value.filter(isPlayerTaken);
      if (takenPlayers.length > 0) {
          const names = takenPlayers.map(p => p.displayName).join(', ');
          alert(`Cannot save roster. The following players are already taken or on another team's roster: ${names}`);
          return;
      }
  }

  const rosterData = buildRosterPayload();
  await authStore.saveRoster(rosterData, rosterType.value);
}

async function submitDraftTurn() {
    // Check for taken players before submitting draft turn
    const takenPlayers = allPlayersOnRoster.value.filter(p => {
        // We only care if they are taken by SOMEONE ELSE.
        // isPlayerTaken checks takenPlayerIds.
        // If we picked them in a previous round, they are in takenPlayerIds.
        // But we should be able to keep them on our roster.
        // The issue is distinguishing "Taken by Me" vs "Taken by Others".
        // In this view, we don't easily know who took them if owned_by_team_id isn't set.
        // However, the User Request was specifically about "Taken players in league mode" (Regular League).
        // For Draft Mode, the backend validation handles "owned by another team".
        // If we are in Draft Mode, maybe we should relax the client-side check if we aren't sure,
        // OR rely on isPlayerOwnedByOther if available.
        // Let's stick to isPlayerOwnedByOther for now to avoid blocking legitimate re-submissions of own players.
        return isPlayerOwnedByOther(p);
    });

    if (takenPlayers.length > 0) {
         const names = takenPlayers.map(p => p.displayName).join(', ');
         alert(`Cannot submit turn. The following players are on another team's roster: ${names}`);
         return;
    }

    if (!confirm("Are you sure you want to finalize your roster and end your turn?")) return;
    const rosterData = buildRosterPayload();
    try {
        const response = await apiClient(`/api/draft/submit-turn`, {
            method: 'POST',
            body: JSON.stringify(rosterData)
        });
        if (!response.ok) {
            const data = await response.json();
            alert(data.message);
        } else {
            router.push('/draft');
        }
    } catch (error) {
        console.error("Draft submission error:", error);
    }
}

function clearRoster() {
  roster.value = {
    lineup: { C: null, '1B': null, '2B': null, SS: null, '3B': null, LF: null, CF: null, RF: null, DH: null },
    pitchingStaff: [],
    bench: [],
  };
}

watch(() => authStore.selectedPointSetId, async (newId, oldId) => {
  if (newId && newId !== oldId) {
    // Fetch new player data with updated points
    await authStore.fetchAllPlayers(newId);

    // Create a map of the new player data for easy lookup
    const playerMap = new Map(authStore.allPlayers.map(p => [p.card_id, p]));

    // Create a new roster object to avoid reactivity issues, repopulating it with the updated player objects
    const updatedRoster = {
        lineup: { C: null, '1B': null, '2B': null, SS: null, '3B': null, LF: null, CF: null, RF: null, DH: null },
        pitchingStaff: [],
        bench: []
    };

    // Lineup
    for (const pos in roster.value.lineup) {
        const player = roster.value.lineup[pos];
        if (player) updatedRoster.lineup[pos] = playerMap.get(player.card_id) || null;
    }
    // Pitching Staff
    roster.value.pitchingStaff.forEach(player => {
        if (player) updatedRoster.pitchingStaff.push(playerMap.get(player.card_id));
    });
    // Bench
    roster.value.bench.forEach(player => {
        if (player) updatedRoster.bench.push(playerMap.get(player.card_id));
    });

    // Assign the updated roster back to the ref
    roster.value = updatedRoster;
  }
});

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const typeParam = urlParams.get('type');
  if (typeParam === 'classic') {
      rosterType.value = 'classic';
  }

  await authStore.fetchPointSets();

  // Check Draft State
  try {
      const resp = await apiClient(`/api/draft/state`);
      if (resp.ok) {
          draftState.value = await resp.json();
          // If draft is active, force Upcoming Season
          if (draftState.value.is_active && rosterType.value === 'league') {
              const upcoming = authStore.pointSets.find(ps => ps.name === 'Upcoming Season');
              if (upcoming) {
                  authStore.selectedPointSetId = upcoming.point_set_id;
              }
          }
      }
  } catch (e) { console.error(e); }

  if (rosterType.value === 'classic') {
      const originalPts = authStore.pointSets.find(ps => ps.name === 'Original Pts');
      if (originalPts) {
          authStore.selectedPointSetId = originalPts.point_set_id;
      }
      // Fetch eligibility
      try {
          const resp = await apiClient('/api/classic/eligibility');
          if (resp.ok) {
              const data = await resp.json();
              ineligibleIds.value = new Set(data.ineligibleIds);
          }
      } catch (e) { console.error("Error fetching eligibility:", e); }
  }

  if (authStore.selectedPointSetId) {
    await authStore.fetchAllPlayers(authStore.selectedPointSetId);
  }
  
  await authStore.fetchMyRoster(rosterType.value);

  if (authStore.myRoster && authStore.myRoster.cards) {
    const savedCards = authStore.myRoster.cards;
    const playerMap = new Map(authStore.allPlayers.map(p => [p.card_id, p]));

    const newRoster = {
        lineup: { C: null, '1B': null, '2B': null, SS: null, '3B': null, LF: null, CF: null, RF: null, DH: null },
        pitchingStaff: [],
        bench: []
    };

    savedCards.forEach(savedCard => {
        const fullPlayer = playerMap.get(savedCard.card_id);
        if (fullPlayer) {
            if (savedCard.assignment === 'PITCHING_STAFF') {
                newRoster.pitchingStaff.push(fullPlayer);
            } else if (savedCard.assignment === 'BENCH') {
                newRoster.bench.push(fullPlayer);
            } else if (savedCard.assignment in newRoster.lineup) {
                newRoster.lineup[savedCard.assignment] = fullPlayer;
            }
        }
    });
    roster.value = newRoster;
  } else {
    clearRoster();
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
        <div class="mode-badge" v-if="rosterType">
            Editing: {{ rosterType === 'classic' ? 'Classic' : 'League' }} Roster
        </div>
        <div class="filters">
          <select v-model="authStore.selectedPointSetId" title="Select Point Set">
            <option v-for="set in filteredPointSets" :key="set.point_set_id" :value="set.point_set_id">
              {{ set.name }}
            </option>
          </select>
          <select v-model="filterPosition" title="Filter by Position">
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
        <input v-model="searchQuery" class="search-input" type="text" placeholder="Search players..." />
      </div>
      <div class="player-list drop-zone" @dragover.prevent @drop="removePlayer(draggedItem.player)">
        <div 
          v-for="player in availablePlayers" 
          :key="player.card_id"
          class="player-item"
          :class="{ 'unavailable': player.isUnavailable }"
          :draggable="!player.isUnavailable"
          @dragstart="!player.isUnavailable && onDragStart($event, player, 'available')">
          
          <div class="player-info">
            <span class="player-name" :class="{ 'owned-player-text': isPlayerOwnedByOther(player) }">
                {{ player.displayName }} ({{ player.displayPosition }})
            </span>
            <img v-if="isPlayerOwnedByOther(player)" :src="player.owned_by_team_logo" class="owning-team-logo" :title="player.owned_by_team_name" />
            <span class="view-icon" @click.stop="selectedCard = player" title="View Card">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </span>
          </div>
          
          <div class="player-actions">
            <span v-if="player.isUnavailable" class="owned-label">{{ player.unavailabilityReason || 'Unavailable' }}</span>
            <span v-else>{{ player.points }} pts</span>
            <button v-if="!player.isUnavailable" @click.stop="addPlayer(player)" class="add-btn">+</button>
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
            <button v-if="draftState && draftState.is_active && (draftState.current_round === 4 || draftState.current_round === 5) && authStore.user.team.team_id === draftState.active_team_id"
                    @click="submitDraftTurn"
                    class="draft-submit-btn">
                Finalize Draft Turn
            </button>
            <button v-else @click="saveRoster">Save Roster</button>
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
.panel-header { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.5rem; }
.search-input { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; }
.filters { display: flex; gap: 0.5rem; }
.player-list { flex-grow: 1; overflow-y: auto; border: 1px solid #ddd; background: white; border-radius: 4px; }
.player-item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; cursor: grab; border-bottom: 1px solid #eee; }
.player-info { display: flex; align-items: center; gap: 0.5rem; }
.view-icon { cursor: pointer; color: #6c757d; }
.view-icon:hover { color: #007bff; }
.player-actions { display: flex; align-items: center; gap: 0.5rem; }
.add-btn { background: #28a745; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; font-size: 16px; line-height: 24px; cursor: pointer; }
.roster-header { display: flex; gap: 1rem; align-items: center; background: #e9ecef; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;}
.roster-header input { flex-grow: 1; padding: 0.75rem; font-size: 1.1rem; }
.roster-stats { font-weight: bold; text-align: center; white-space: nowrap; display: flex; gap: 1rem; }
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
.unavailable { opacity: 0.5; cursor: not-allowed; background-color: #eee; }
.owned-label { font-size: 0.8em; color: #dc3545; font-weight: bold; margin-right: 0.5rem; }
.owned-player-text { color: #888; }
.owning-team-logo { height: 20px; width: auto; vertical-align: middle; margin-left: 5px; margin-right: 5px; }

.mode-badge {
    background: #007bff;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.9rem;
    font-weight: bold;
    align-self: flex-start;
}
</style>
