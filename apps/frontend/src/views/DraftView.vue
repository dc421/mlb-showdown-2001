<script setup>
import { ref, onMounted, computed, onUnmounted, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { socket } from '@/services/socket';
import { apiClient } from '@/services/api';

const authStore = useAuthStore();
const router = useRouter();
const draftState = ref({
    is_active: false,
    current_round: 0,
    current_pick_number: 1,
    active_team_id: null,
    history: [],
    randomRemovals: [],
    takenPlayerIds: [],
    draft_order: [],
    teams: {}
});
const availablePlayers = ref([]);
const loading = ref(true);
const searchQuery = ref('');
const filterPosition = ref('ALL');
const availableSeasons = ref([]);
const selectedSeason = ref('');
const isSeasonOver = ref(false);

// --- COMPUTED ---
const isDraftActive = computed(() => draftState.value.is_active);

const isMyTurn = computed(() => {
    if (!authStore.user || !authStore.user.team) return false;
    return authStore.user.team.team_id === draftState.value.active_team_id;
});

const filteredPlayers = computed(() => {
    return availablePlayers.value.filter(p => {
        if (searchQuery.value) {
            const query = searchQuery.value.toLowerCase();
            if (!p.name.toLowerCase().includes(query)) return false;
        }
        if (filterPosition.value !== 'ALL') {
            if (filterPosition.value === 'P' && p.control === null) return false;
        }
        // Exclude taken players
        if (draftState.value.takenPlayerIds.includes(p.card_id)) return false;
        return true;
    }).sort((a, b) => (b.points || 0) - (a.points || 0));
});

// Draft Table Generation
const displayRows = computed(() => {
    // If no active draft data is available (e.g. historical only, no order),
    // fallback to just showing history.
    if (!draftState.value.draft_order || draftState.value.draft_order.length === 0) {
        return draftState.value.history.filter(item => (item.action || '').toUpperCase() !== 'REMOVED_RANDOM');
    }

    const rows = [];
    const order = draftState.value.draft_order;
    const teamCount = order.length;

    // Generate 10 fixed slots for Rounds 1 & 2 (which are DB Rounds 2 & 3)
    // Round 1 (DB 2): Picks 1-5
    // Round 2 (DB 3): Picks 6-10
    const totalFixedPicks = teamCount * 2;

    for (let i = 1; i <= totalFixedPicks; i++) {
        const teamIndex = (i - 1) % teamCount;
        const teamId = order[teamIndex];
        // Fetch Team Name from map or raw ID
        const teamName = (draftState.value.teams && draftState.value.teams[teamId]) || `Team ${teamId}`;

        // DB Round Calculation: Round 1 is Picks 1-5, Round 2 is Picks 6-10
        // DB Round 2 -> UI Round 1
        // DB Round 3 -> UI Round 2
        const roundNum = i <= teamCount ? "Round 1" : "Round 2";

        // Check if this pick has been made
        const historyItem = draftState.value.history.find(h => h.pick_number === i && h.round !== 'Removal');

        rows.push({
            id: `pick-${i}`,
            round: roundNum,
            pick_number: i,
            team_name: teamName,
            player_name: historyItem ? historyItem.player_name : '', // Empty if future
            action: historyItem ? historyItem.action : 'PENDING'
        });
    }

    // Append any subsequent history (Add/Drops, etc) that goes beyond the fixed rounds
    // or if we simply want to show all history that isn't already covered.
    // However, the fixed rows cover pick_number 1-10.
    // Add/Drop items usually share pick numbers or just append?
    // In DB, Add/Drops have `pick_number` corresponding to when they happened.
    // If the draft goes into Add/Drop (Round 4/5), `pick_number` continues incrementing.

    const additionalHistory = draftState.value.history.filter(h => {
        if ((h.action || '').toUpperCase() === 'REMOVED_RANDOM') return false;
        // Include if pick_number > 10 (Add/Drop rounds)
        return (h.pick_number > totalFixedPicks);
    });

    additionalHistory.forEach(h => {
        rows.push({
            id: `hist-${h.id}`,
            round: h.round, // "Add/Drop 1" etc
            pick_number: h.pick_number,
            team_name: h.team_name,
            player_name: h.player_name,
            action: h.action
        });
    });

    return rows;
});


// Random Removals - Grouped by Team
const randomRemovalsByTeam = computed(() => {
    const removals = [];

    // 1. From 'randomRemovals' (Historical table)
    if (draftState.value.randomRemovals) {
        removals.push(...draftState.value.randomRemovals);
    }

    // 2. From 'history' (Active/Recent drafts where action is REMOVED_RANDOM)
    if (draftState.value.history) {
        const historyRemovals = draftState.value.history.filter(item => (item.action || '').toUpperCase() === 'REMOVED_RANDOM');
        historyRemovals.forEach(h => {
             const teamName = h.team_name || "Unknown Team";
             const exists = removals.some(r => r.player_name === h.player_name && r.team_name === teamName);
             if (!exists) {
                 removals.push({
                     player_name: h.player_name,
                     team_name: teamName
                 });
             }
        });
    }

    // Group by Team
    const groups = {};
    removals.forEach(r => {
        const t = r.team_name || "Unknown Team";
        if (!groups[t]) groups[t] = [];
        groups[t].push(r);
    });

    return groups;
});

// --- ACTIONS ---
async function fetchAvailableSeasons() {
    try {
        const response = await apiClient(`/api/draft/seasons`);
        if (response.ok) {
            availableSeasons.value = await response.json();
        }
    } catch (error) {
        console.error("Error fetching seasons:", error);
    }
}

async function fetchDraftState() {
    loading.value = true;
    try {
        let url = `/api/draft/state`;
        if (selectedSeason.value) {
            url += `?season=${encodeURIComponent(selectedSeason.value)}`;
        }

        const response = await apiClient(url);
        if (response.ok) {
            const data = await response.json();
            draftState.value = data;
            isSeasonOver.value = data.isSeasonOver;

            // If we have a state and no season selected in dropdown (e.g. initial load), set it
            if (data.season_name && !selectedSeason.value) {
                selectedSeason.value = data.season_name;
            }
        }
    } catch (error) {
        console.error("Error fetching draft state:", error);
    } finally {
        loading.value = false;
    }
}

async function startDraft() {
    if (!confirm("Are you sure you want to perform random removals? This will remove 5 players from every team.")) return;
    try {
        const response = await apiClient(`/api/draft/start`, {
            method: 'POST'
        });
        if (!response.ok) {
            const data = await response.json();
            alert(data.message);
        } else {
            fetchDraftState();
            fetchAvailableSeasons();
        }
    } catch (error) {
        console.error("Error starting draft:", error);
    }
}

async function makePick(player) {
    if (!confirm(`Draft ${player.name}?`)) return;
    try {
        const response = await apiClient(`/api/draft/pick`, {
            method: 'POST',
            body: JSON.stringify({ playerId: player.card_id })
        });
        if (!response.ok) {
            const data = await response.json();
            alert(data.message);
        } else {
            fetchDraftState();
        }
    } catch (error) {
        console.error("Pick error:", error);
    }
}

async function fetchAvailablePlayers() {
    availablePlayers.value = authStore.allPlayers;
}

function goToRosterBuilder() {
    router.push('/roster-builder');
}

watch(selectedSeason, (newVal, oldVal) => {
    if (newVal !== oldVal) {
        fetchDraftState();
    }
});

onMounted(async () => {
    await authStore.fetchPointSets();
    const upcoming = authStore.pointSets.find(ps => ps.name === 'Upcoming Season');
    if (upcoming) {
        authStore.selectedPointSetId = upcoming.point_set_id;
        await authStore.fetchAllPlayers(upcoming.point_set_id);
    }

    await fetchAvailableSeasons();
    await fetchDraftState();
    fetchAvailablePlayers();

    socket.on('draft-updated', fetchDraftState);
});

onUnmounted(() => {
    socket.off('draft-updated', fetchDraftState);
});

</script>

<template>
    <div class="draft-container">

        <!-- HEADER / SEASON SELECT -->
        <div class="history-header">
            <h2>Draft History</h2>
            <div class="history-controls">
                <select v-if="availableSeasons.length > 0" v-model="selectedSeason" class="season-select-inline">
                    <option v-for="season in availableSeasons" :key="season" :value="season">
                        {{ season }}
                    </option>
                </select>
            </div>
        </div>

        <div v-if="loading" class="loading">Loading...</div>

        <!-- ACTIVE DRAFT CONTROLS -->
        <div v-else-if="isDraftActive && isMyTurn" class="active-controls">
            
            <!-- PICKING INTERFACE (Rounds 1 & 2) -->
            <div v-if="draftState.current_round === 2 || draftState.current_round === 3" class="pick-interface">
                <h3>Make Your Pick (Pick #{{ draftState.current_pick_number }})</h3>
                <input v-model="searchQuery" placeholder="Search Players..." class="search-input" />
                <div class="player-list">
                    <div v-for="player in filteredPlayers" :key="player.card_id" class="player-card-row">
                        <span>{{ player.displayName }} ({{ player.points }} pts)</span>
                        <button @click="makePick(player)">Draft</button>
                    </div>
                </div>
            </div>

            <!-- ADD/DROP INTERFACE (Rounds 3 & 4) -->
            <div v-else-if="draftState.current_round === 4 || draftState.current_round === 5" class="add-drop-interface">
                <h3>Finalize Your Roster</h3>
                <p>You can add and drop as many players as you like.</p>
                <button @click="goToRosterBuilder" class="builder-btn">Go to Roster Builder</button>
            </div>
        </div>

        <!-- WAITING MESSAGE FOR ACTIVE DRAFT -->
        <div v-else-if="isDraftActive && !isMyTurn" class="waiting-message">
            <p>Waiting for current pick...</p>
        </div>

        <!-- START BUTTON (If Season Over) -->
        <div v-if="!isDraftActive && isSeasonOver" class="start-section">
            <p>The season is over. You can now perform random removals to start the draft.</p>
            <button @click="startDraft" class="start-btn">Perform Random Removals</button>
        </div>


        <!-- DRAFT TABLE (Unified) -->
        <div v-if="!loading && displayRows.length > 0" class="draft-table-container">
            <table class="draft-table">
                <thead>
                    <tr>
                        <th>Round Name</th>
                        <th>Pick #</th>
                        <th>Player Name</th>
                        <th>Team Name</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in displayRows" :key="item.id || item.pick_number">
                        <td>{{ item.round }}</td>
                        <td>{{ item.pick_number || '-' }}</td>
                        <td>{{ item.player_name }}</td>
                        <td>{{ item.team_name }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-else-if="!loading && !isSeasonOver && !isDraftActive">No draft data found.</p>

        <!-- RANDOM REMOVALS SECTION -->
        <div class="removals-section" v-if="!loading && Object.keys(randomRemovalsByTeam).length > 0">
            <h2>Random Removals</h2>
            <div class="teams-list">
                <div v-for="(players, teamName) in randomRemovalsByTeam" :key="teamName" class="team-block">
                    <div class="team-header">
                        <div class="team-info">
                            <h2>{{ teamName }}</h2>
                        </div>
                    </div>
                    <div class="roster-table-container">
                        <table class="roster-table">
                            <thead>
                                <tr>
                                    <th class="header-player">Removed Player</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="p in players" :key="p.player_name + p.card_id" class="player-row">
                                    <td class="name-cell">{{ p.player_name }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

    </div>
</template>

<style scoped>
.draft-container { max-width: 1000px; margin: 0 auto; padding: 2rem; }
.history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
.history-controls { display: flex; align-items: center; gap: 0.5rem; }
.season-select-inline { padding: 0.25rem; font-size: 0.9rem; }

.start-section { margin-bottom: 2rem; text-align: center; }
.start-btn { padding: 1rem 2rem; font-size: 1.2rem; background: #28a745; color: white; border: none; cursor: pointer; border-radius: 4px; }

.active-controls { margin-bottom: 2rem; padding: 1rem; background: #f0f8ff; border: 1px solid #b8daff; border-radius: 8px; }
.waiting-message { margin-bottom: 2rem; padding: 1rem; background: #fff3cd; border: 1px solid #ffeeba; border-radius: 8px; text-align: center; }

.pick-interface h3 { margin-top: 0; }
.search-input { width: 100%; padding: 0.5rem; margin-bottom: 1rem; box-sizing: border-box; }
.player-list { height: 300px; overflow-y: auto; border: 1px solid #ccc; background: white; }
.player-card-row { display: flex; justify-content: space-between; padding: 0.5rem; border-bottom: 1px solid #eee; align-items: center; }
.player-card-row button { background: #007bff; color: white; border: none; padding: 0.25rem 0.5rem; cursor: pointer; border-radius: 4px; }

.builder-btn { padding: 1rem; font-size: 1.1rem; background: #17a2b8; color: white; border: none; cursor: pointer; border-radius: 4px; }

/* TABLE STYLES */
.draft-table-container { margin-bottom: 2rem; }
.draft-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.draft-table th, .draft-table td { border: 1px solid #ddd; padding: 0.25rem 0.5rem; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft-table th { background-color: #f2f2f2; }
.draft-table th:nth-child(1) { width: 15%; }
.draft-table th:nth-child(2) { width: 10%; }
.draft-table th:nth-child(3) { width: 45%; }
.draft-table th:nth-child(4) { width: 30%; }

/* REMOVALS STYLES */
.removals-section { margin-top: 2rem; }
.teams-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; }
.team-block { background: #f9f9f9; border-radius: 8px; padding: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.team-header { display: flex; align-items: center; gap: 1rem; padding-bottom: 1rem; margin-bottom: 0rem; }
.team-info h2 { margin: 0; font-size: 1.4rem; }
.roster-table-container { overflow-x: auto; }
.roster-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.roster-table th { text-align: left; padding: 0.5rem; background: #e9ecef; color: #495057; font-weight: 600; }
.roster-table td { padding: 0.25rem 0.5rem; border-bottom: 1px solid #dee2e6; }
.player-row { transition: background-color 0.2s; }
.player-row:hover { background-color: #e2e6ea; }
.name-cell { font-weight: normal; }
</style>
