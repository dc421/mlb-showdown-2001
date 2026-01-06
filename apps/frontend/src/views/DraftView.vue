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
const leagueRosterIds = ref(new Set());

// Ensure apiUrl is an empty string if VITE_API_URL is not defined
const apiUrl = import.meta.env.VITE_API_URL || '';

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
            if (filterPosition.value === 'P') {
                if (p.control === null) return false;
            } else {
                // Check if player has rating for this position
                if (!p.fielding_ratings || p.fielding_ratings[filterPosition.value] === undefined) return false;
            }
        }
        // Exclude drafted players
        if (draftState.value.takenPlayerIds.includes(p.card_id)) return false;

        return true;
    }).sort((a, b) => (b.points || 0) - (a.points || 0));
});

// Helper to compute Net Changes for a set of history items
function computeNetChanges(items) {
    const net = [];
    const added = new Set(); // Stores card_id
    const dropped = new Set(); // Stores card_id
    const playerMap = {}; // card_id -> { player_name, team_name, round, pick_number, id }

    // Sort by created_at to process chronological sequence
    const sorted = [...items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    sorted.forEach(item => {
        const id = item.card_id;
        playerMap[id] = item; // Keep reference to latest metadata

        if (item.action === 'ADDED') {
            if (dropped.has(id)) {
                // If previously dropped, adding it back cancels the drop
                dropped.delete(id);
            } else {
                // Otherwise it's a new add
                added.add(id);
            }
        } else if (item.action === 'DROPPED') {
            if (added.has(id)) {
                // If previously added, dropping it cancels the add
                added.delete(id);
            } else {
                // Otherwise it's a new drop
                dropped.add(id);
            }
        }
    });

    // Reconstruct history objects
    added.forEach(id => {
        net.push({ ...playerMap[id], action: 'ADDED' });
    });
    dropped.forEach(id => {
        net.push({ ...playerMap[id], action: 'DROPPED' });
    });

    // Sort again by pick_number (or creation) to keep grouped display tidy
    return net.sort((a, b) => a.id - b.id);
}

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
    const totalFixedPicks = teamCount * 2;

    for (let i = 1; i <= totalFixedPicks; i++) {
        const teamIndex = (i - 1) % teamCount;
        const teamId = order[teamIndex];

        let teamName = (draftState.value.teams && draftState.value.teams[teamId]) || `Team ${teamId}`;

        const roundNum = i <= teamCount ? "1" : "2";
        const historyItem = draftState.value.history.find(h => h.pick_number === i && h.round !== 'Removal');

        // Use city if available (from history join or backend teams map)
        const displayTeam = historyItem ? (historyItem.city || historyItem.team_name) : teamName;

        rows.push({
            id: `pick-${i}`,
            round: roundNum,
            pick_number: i,
            team_name: displayTeam,
            player_name: historyItem ? historyItem.player_name : '',
            action: historyItem ? historyItem.action : 'PENDING'
        });
    }

    // Process Add/Drop Rounds (Round 4+, Pick > 10)
    // We group history items by their 'pick_number' (which represents a specific turn for a specific team)
    const addDropItems = draftState.value.history.filter(h => {
        if ((h.action || '').toUpperCase() === 'REMOVED_RANDOM') return false;
        // The backend uses pick_number > 10 for add/drop rounds logic implicitly via round name check?
        // Actually backend sets round name "Add/Drop 1".
        return (h.pick_number > 10 || h.round.includes('Add/Drop'));
    });

    const itemsByPick = {};
    addDropItems.forEach(item => {
        if (!itemsByPick[item.pick_number]) itemsByPick[item.pick_number] = [];
        itemsByPick[item.pick_number].push(item);
    });

    const sortedPicks = Object.keys(itemsByPick).map(Number).sort((a, b) => a - b);

    sortedPicks.forEach(pickNum => {
        const items = itemsByPick[pickNum];
        // Apply Net Changes logic per turn
        const netItems = computeNetChanges(items);

        netItems.forEach(h => {
            let name = h.player_name;
            if (h.action === 'ADDED') name += ' (Added)';
            if (h.action === 'DROPPED') name += ' (Dropped)';

            rows.push({
                id: `hist-${h.id}`,
                round: h.round,
                pick_number: h.pick_number,
                team_name: h.city || h.team_name,
                player_name: name,
                action: h.action
            });
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
    // Note: The backend update ensures 'history' items now have points/position too.
    if (draftState.value.history) {
        const historyRemovals = draftState.value.history.filter(item => (item.action || '').toUpperCase() === 'REMOVED_RANDOM');
        historyRemovals.forEach(h => {
             // For removals, backend sends full name.
             const rawTeamName = h.team_name || "Unknown Team";
             // Check if already in list (avoid dupes if history overlaps with randomRemovals table)
             const exists = removals.some(r => r.card_id === h.card_id); // Better to check ID
             if (!exists) {
                 removals.push({
                     player_name: h.player_name,
                     team_name: rawTeamName,
                     position: h.position,
                     points: h.points,
                     card_id: h.card_id
                 });
             }
        });
    }

    // Group by Team Name (Full string from DB, which usually includes City)
    // This addresses the user issue "shows nicknames instead of cities" by avoiding any stripping of City.
    const groups = {};
    removals.forEach(r => {
        const t = r.team_name || "Unknown Team";
        if (!groups[t]) groups[t] = [];
        groups[t].push(r);
    });

    return groups;
});

// --- ACTIONS ---
async function fetchLeagueRosters() {
    try {
        if (!authStore.selectedPointSetId) await authStore.fetchPointSets();
        if (!authStore.selectedPointSetId) return;

        const response = await apiClient(`/api/league?point_set_id=${authStore.selectedPointSetId}`);
        if (response.ok) {
            const leagueData = await response.json();
            const ids = new Set();
            leagueData.forEach(team => {
                team.roster.forEach(p => ids.add(p.card_id));
            });
            leagueRosterIds.value = ids;
        }
    } catch (error) {
        console.error("Error fetching league rosters:", error);
    }
}

async function fetchAvailableSeasons() {
    try {
        const response = await apiClient(`/api/draft/seasons`);
        if (response.ok) {
            availableSeasons.value = await response.json();
            // Default to latest if available and not set
            if (availableSeasons.value.length > 0 && !selectedSeason.value) {
                // Determine the most recent season (first in the list)
                selectedSeason.value = availableSeasons.value[0];
            }
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
            await fetchAvailableSeasons();
            selectedSeason.value = 'Live Draft'; // Redirect to Live Draft page
            await fetchDraftState();
        }
    } catch (error) {
        console.error("Error starting draft:", error);
    }
}

async function makePick(player) {
    if (leagueRosterIds.value.has(player.card_id)) return; // Double check
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

async function submitRoster() {
    if (!confirm("Are you sure you want to finalize your roster? Make sure your roster is valid (20 players, 5000pts cap, 4 SPs).")) return;
    try {
        const response = await apiClient(`/api/draft/submit-turn`, {
            method: 'POST',
            body: JSON.stringify({}) // Empty body implies "use saved roster"
        });
        if (!response.ok) {
            const data = await response.json();
            alert(data.message);
        } else {
            fetchDraftState(); // Refresh state
        }
    } catch (error) {
        console.error("Roster submit error:", error);
    }
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
    fetchLeagueRosters(); // Fetch league rosters to gray out taken players

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

                <div class="search-filters">
                    <input v-model="searchQuery" placeholder="Search Players..." class="search-input" />
                    <select v-model="filterPosition" class="position-select">
                        <option value="ALL">All Pos</option>
                        <option value="C">C</option>
                        <option value="1B">1B</option>
                        <option value="2B">2B</option>
                        <option value="SS">SS</option>
                        <option value="3B">3B</option>
                        <option value="LF">LF</option>
                        <option value="CF">CF</option>
                        <option value="RF">RF</option>
                        <option value="DH">DH</option>
                        <option value="P">P</option>
                    </select>
                </div>

                <div class="player-list">
                    <div v-for="player in filteredPlayers" :key="player.card_id" class="player-card-row" :class="{ 'rostered': leagueRosterIds.has(player.card_id) }">
                        <div class="player-info-compact">
                            <span class="p-name">{{ player.displayName }}</span>
                            <span class="p-meta">{{ player.points }} pts</span>
                            <img v-if="leagueRosterIds.has(player.card_id)" :src="`${apiUrl}/images/silver_submarine.png`" class="rostered-icon" title="On League Roster" />
                        </div>
                        <button v-if="!leagueRosterIds.has(player.card_id)" @click="makePick(player)" class="draft-btn">Draft</button>
                        <button v-else disabled class="draft-btn disabled">Taken</button>
                    </div>
                </div>
            </div>

            <!-- ADD/DROP INTERFACE (Rounds 3 & 4) -->
            <div v-else-if="draftState.current_round === 4 || draftState.current_round === 5" class="add-drop-interface">
                <h3>Finalize Your Roster</h3>
                <p>You can add and drop as many players as you like.</p>
                <div class="add-drop-buttons">
                    <button @click="goToRosterBuilder" class="builder-btn">Go to Roster Builder</button>
                    <button @click="submitRoster" class="submit-roster-btn">Submit Roster</button>
                </div>
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
                        <th>Round</th>
                        <th>Pick #</th>
                        <th>Player Name</th>
                        <th>Team</th>
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
                                    <th>Pos</th>
                                    <th>Pts</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="p in players" :key="p.player_name + p.card_id" class="player-row">
                                    <td class="name-cell">{{ p.player_name }}</td>
                                    <td>{{ p.position }}</td>
                                    <td>{{ p.points }}</td>
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
.search-filters { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.search-input { flex-grow: 1; padding: 0.5rem; box-sizing: border-box; }
.position-select { padding: 0.5rem; }

/* COMPACT PLAYER LIST */
.player-list { height: 300px; overflow-y: auto; border: 1px solid #ccc; background: white; }
.player-card-row {
    display: flex;
    justify-content: flex-start; /* Change from space-between */
    gap: 10px; /* Add explicit gap */
    padding: 0.25rem 0.5rem; /* Reduced padding */
    border-bottom: 1px solid #eee;
    align-items: center;
}
.player-info-compact { display: flex; align-items: center; gap: 0.5rem; flex-grow: 1; overflow: hidden; }
.p-name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-meta { font-size: 0.85rem; color: #666; white-space: nowrap; }

.rostered { background-color: #f9f9f9; color: #999; }
.rostered-icon { width: 20px; height: 20px; opacity: 0.5; }

.draft-btn {
    background: #007bff; color: white; border: none; padding: 0.25rem 0.5rem; cursor: pointer; border-radius: 4px; font-size: 0.9rem;
    white-space: nowrap;
}
.draft-btn.disabled { background: #ccc; cursor: not-allowed; }

.add-drop-buttons { display: flex; gap: 1rem; }
.builder-btn { padding: 1rem; font-size: 1.1rem; background: #17a2b8; color: white; border: none; cursor: pointer; border-radius: 4px; }
.submit-roster-btn { padding: 1rem; font-size: 1.1rem; background: #28a745; color: white; border: none; cursor: pointer; border-radius: 4px; }

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
