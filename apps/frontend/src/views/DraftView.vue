<script setup>
import { ref, onMounted, computed, onUnmounted, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { socket } from '@/services/socket';

const authStore = useAuthStore();
const router = useRouter();
const draftState = ref({
    is_active: false,
    current_round: 0,
    current_pick_number: 1,
    active_team_id: null,
    history: [],
    randomRemovals: [],
    takenPlayerIds: []
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
const currentRoundName = computed(() => {
    const r = draftState.value.current_round;
    if (r === 2) return "Round 1 (Pick)";
    if (r === 3) return "Round 2 (Pick)";
    if (r === 4) return "Round 3 (Add/Drop)";
    if (r === 5) return "Round 4 (Add/Drop)";
    return "Unknown";
});
const activeTeamName = computed(() => {
    if (draftState.value.activeTeam) {
        return draftState.value.activeTeam.name; // Simplified, ideally construct full name
    }
    return "Unknown";
});
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
            // Simplified position check
        }
        // Exclude taken players
        if (draftState.value.takenPlayerIds.includes(p.card_id)) return false;
        return true;
    }).sort((a, b) => (b.points || 0) - (a.points || 0));
});

// History List (Draft Picks) - excluding removals
const draftPicks = computed(() => {
    if (!draftState.value.history) return [];
    return draftState.value.history.filter(item => {
        const action = (item.action || '').toUpperCase();
        return action !== 'REMOVED_RANDOM';
    });
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
             // For active draft history, we use 'team_name' (which we populated via COALESCE)
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
        const response = await fetch(`${authStore.API_URL}/api/draft/seasons`, {
            headers: { 'Authorization': `Bearer ${authStore.token}` }
        });
        if (response.ok) {
            availableSeasons.value = await response.json();
            // Default to latest if available and not set
            if (availableSeasons.value.length > 0 && !selectedSeason.value) {
                // If there is an active draft (handled by fetchDraftState default), it might be the latest.
                // But generally, the latest season is the first one.
                // We'll let fetchDraftState handle the default "active/latest" if we pass nothing,
                // but for the dropdown we should probably select the one returned by state.
            }
        }
    } catch (error) {
        console.error("Error fetching seasons:", error);
    }
}

async function fetchDraftState() {
    loading.value = true;
    try {
        let url = `${authStore.API_URL}/api/draft/state`;
        if (selectedSeason.value) {
            url += `?season=${encodeURIComponent(selectedSeason.value)}`;
        }

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${authStore.token}` }
        });
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
        const response = await fetch(`${authStore.API_URL}/api/draft/start`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authStore.token}` }
        });
        if (!response.ok) {
            const data = await response.json();
            alert(data.message);
        } else {
            fetchDraftState();
            fetchAvailableSeasons(); // Refresh seasons list as a new one might be created
        }
    } catch (error) {
        console.error("Error starting draft:", error);
    }
}

async function makePick(player) {
    if (!confirm(`Draft ${player.name}?`)) return;
    try {
        const response = await fetch(`${authStore.API_URL}/api/draft/pick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authStore.token}` },
            body: JSON.stringify({ playerId: player.card_id })
        });
        if (!response.ok) {
            const data = await response.json();
            alert(data.message);
        } else {
            // State will update via socket or re-fetch
            fetchDraftState();
        }
    } catch (error) {
        console.error("Pick error:", error);
    }
}

async function fetchAvailablePlayers() {
    if (authStore.allPlayers.length === 0) {
        // Need to find upcoming season ID.
    }
    availablePlayers.value = authStore.allPlayers; // Simple for now
}

function goToRosterBuilder() {
    router.push('/roster-builder');
}

// Watch for season selection change
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
        <div v-if="loading" class="loading">Loading...</div>

        <!-- INACTIVE STATE (Season Over check) -->
        <div v-else-if="!isDraftActive" class="inactive-state">
            <p v-if="isSeasonOver">The season is over. You can now perform random removals to start the draft.</p>
            
            <button v-if="isSeasonOver" @click="startDraft" class="start-btn">Perform Random Removals</button>

            <div class="history-section">
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

                <!-- DRAFT TABLE -->
                <div v-if="draftPicks.length > 0" class="draft-table-container">
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
                            <tr v-for="item in draftPicks" :key="item.id">
                                <td>{{ item.round }}</td>
                                <td>{{ item.pick_number || '-' }}</td>
                                <td>{{ item.player_name }}</td>
                                <td>{{ item.team_name || item.team_id }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-else>No draft picks found for this season.</p>

                <!-- RANDOM REMOVALS SECTION -->
                <div class="removals-section" v-if="Object.keys(randomRemovalsByTeam).length > 0">
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
        </div>

        <!-- ACTIVE DRAFT STATE -->
        <div v-else class="active-draft">
            <div class="status-bar">
                <div class="round-info">
                    <h2>{{ currentRoundName }}</h2>
                    <p>Pick #{{ draftState.current_pick_number }}</p>
                </div>
                <div class="active-team" :class="{ 'my-turn': isMyTurn }">
                    <h3>Current Pick: {{ activeTeamName }}</h3>
                    <p v-if="isMyTurn">IT'S YOUR TURN!</p>
                </div>
            </div>

            <div class="draft-workspace">
                <!-- PICKING INTERFACE (Rounds 1 & 2) -->
                <div v-if="(draftState.current_round === 2 || draftState.current_round === 3) && isMyTurn" class="pick-interface">
                    <h3>Make Your Pick</h3>
                    <input v-model="searchQuery" placeholder="Search Players..." class="search-input" />
                    <div class="player-list">
                        <div v-for="player in filteredPlayers" :key="player.card_id" class="player-card-row">
                            <span>{{ player.displayName }} ({{ player.points }} pts)</span>
                            <button @click="makePick(player)">Draft</button>
                        </div>
                    </div>
                </div>

                <!-- ADD/DROP INTERFACE (Rounds 3 & 4) -->
                <div v-else-if="(draftState.current_round === 4 || draftState.current_round === 5) && isMyTurn" class="add-drop-interface">
                    <h3>Finalize Your Roster</h3>
                    <p>You can add and drop as many players as you like.</p>
                    <p>Your roster must be valid (20 players, 5000 pts) to finish your turn.</p>
                    <button @click="goToRosterBuilder" class="builder-btn">Go to Roster Builder</button>
                </div>

                <div v-else class="waiting-message">
                    Waiting for {{ activeTeamName }} to make their move...
                </div>

                <!-- RECENT HISTORY -->
                <div class="side-history">
                    <h3>Recent Activity</h3>
                    <ul>
                        <li v-for="item in draftState.history.slice(0, 10)" :key="item.id">
                            <strong>{{ item.team_name }}</strong> {{ item.action }} {{ item.player_name }}
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.draft-container { max-width: 1000px; margin: 0 auto; padding: 2rem; }
.header-section { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
.season-select { padding: 0.5rem; font-size: 1rem; }
.start-btn { padding: 1rem 2rem; font-size: 1.2rem; background: #28a745; color: white; border: none; cursor: pointer; border-radius: 4px; }
.status-bar { display: flex; justify-content: space-between; background: #f0f0f0; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; }
.my-turn { color: #d9534f; font-weight: bold; }
.draft-workspace { display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; }
.player-list { height: 400px; overflow-y: auto; border: 1px solid #ccc; padding: 0.5rem; }
.player-card-row { display: flex; justify-content: space-between; padding: 0.5rem; border-bottom: 1px solid #eee; }
.player-card-row button { background: #007bff; color: white; border: none; padding: 0.25rem 0.5rem; cursor: pointer; }
.side-history { background: #f9f9f9; padding: 1rem; border-radius: 8px; }
.side-history ul { padding-left: 1rem; list-style: none; }
.builder-btn { padding: 1rem; font-size: 1.1rem; background: #17a2b8; color: white; border: none; cursor: pointer; }
.history-list { list-style: none; padding: 0; }
.history-list li { padding: 0.5rem 0; border-bottom: 1px solid #eee; }
.history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.history-controls { display: flex; align-items: center; gap: 0.5rem; }
.season-select-inline { padding: 0.25rem; font-size: 0.9rem; }
.timestamp { color: #888; font-size: 0.8rem; margin-right: 0.5rem; }
.team-name { font-weight: bold; margin-right: 0.5rem; }
.action { font-weight: bold; margin-right: 0.5rem; }
.action.added { color: green; }
.action.dropped { color: red; }
.action.removed_random { color: orange; }

/* TABLE STYLES */
.draft-table-container { margin-bottom: 2rem; }
.draft-table { width: 100%; border-collapse: collapse; }
.draft-table th, .draft-table td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
.draft-table th { background-color: #f2f2f2; }

/* REMOVALS STYLES */
.removals-section { margin-top: 2rem; }

/* Styles adapted from LeagueView.vue */
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

.team-info h2 {
    margin: 0;
    font-size: 1.4rem;
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
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid #dee2e6;
}

.player-row {
    transition: background-color 0.2s;
}

.player-row:hover {
    background-color: #e2e6ea;
}

.name-cell {
    font-weight: normal;
}
</style>
