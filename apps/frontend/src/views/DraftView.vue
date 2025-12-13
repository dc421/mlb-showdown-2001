<script setup>
import { ref, onMounted, computed, onUnmounted } from 'vue';
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
    takenPlayerIds: []
});
const availablePlayers = ref([]);
const loading = ref(true);
const searchQuery = ref('');
const filterPosition = ref('ALL');

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

// --- ACTIONS ---
async function fetchDraftState() {
    loading.value = true;
    try {
        const response = await fetch(`${authStore.API_URL}/api/draft/state`, {
            headers: { 'Authorization': `Bearer ${authStore.token}` }
        });
        if (response.ok) {
            draftState.value = await response.json();
        }
    } catch (error) {
        console.error("Error fetching draft state:", error);
    } finally {
        loading.value = false;
    }
}

async function startDraft() {
    if (!confirm("Are you sure you want to start the Offseason Draft? This will remove 5 players from every team.")) return;
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
    // We can reuse the `cards/player` endpoint but filter out taken ones?
    // Actually, `cards/player` returns ALL players. We need to filter client side or fetch from a new endpoint.
    // Let's assume we fetch all and authStore.allPlayers is populated.
    // But we need the "Upcoming Season" points.
    // Let's rely on authStore having fetched the right set.
    if (authStore.allPlayers.length === 0) {
        // Need to find upcoming season ID.
        // For now, let's just use what's loaded, assuming the backend switch worked.
        // Wait, the backend doesn't force the frontend state.
        // The frontend needs to know to switch.
        // Let's fetch the point sets and find "Upcoming Season" manually here if needed.
    }
    availablePlayers.value = authStore.allPlayers; // Simple for now
}

function goToRosterBuilder() {
    router.push('/roster-builder');
}

onMounted(async () => {
    await authStore.fetchPointSets();
    // Switch to Upcoming Season if available
    const upcoming = authStore.pointSets.find(ps => ps.name === 'Upcoming Season');
    if (upcoming) {
        authStore.selectedPointSetId = upcoming.point_set_id;
        await authStore.fetchAllPlayers(upcoming.point_set_id);
    }

    fetchDraftState();
    fetchAvailablePlayers();

    socket.on('draft-updated', fetchDraftState);
});

onUnmounted(() => {
    socket.off('draft-updated', fetchDraftState);
});

</script>

<template>
    <div class="draft-container">
        <h1>Offseason Draft</h1>

        <div v-if="loading" class="loading">Loading...</div>

        <div v-else-if="!isDraftActive" class="inactive-state">
            <p>The draft is currently inactive.</p>
            <button @click="startDraft" class="start-btn">Start Offseason Draft</button>

            <div class="history-section" v-if="draftState.history && draftState.history.length > 0">
                <h3>Draft History</h3>
                <ul>
                    <li v-for="item in draftState.history" :key="item.id">
                        {{ new Date(item.timestamp).toLocaleString() }}:
                        <strong>{{ item.team_name || item.team_id }}</strong>
                        {{ item.action }}
                        {{ item.player_name }} ({{ item.round }})
                    </li>
                </ul>
            </div>
        </div>

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
.start-btn { padding: 1rem 2rem; font-size: 1.2rem; background: #28a745; color: white; border: none; cursor: pointer; }
.status-bar { display: flex; justify-content: space-between; background: #f0f0f0; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; }
.my-turn { color: #d9534f; font-weight: bold; }
.draft-workspace { display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; }
.player-list { height: 400px; overflow-y: auto; border: 1px solid #ccc; padding: 0.5rem; }
.player-card-row { display: flex; justify-content: space-between; padding: 0.5rem; border-bottom: 1px solid #eee; }
.player-card-row button { background: #007bff; color: white; border: none; padding: 0.25rem 0.5rem; cursor: pointer; }
.side-history { background: #f9f9f9; padding: 1rem; border-radius: 8px; }
.side-history ul { padding-left: 1rem; }
.builder-btn { padding: 1rem; font-size: 1.1rem; background: #17a2b8; color: white; border: none; cursor: pointer; }
</style>
