<script setup>
import { ref, onMounted, computed, onUnmounted, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import { socket } from '@/services/socket';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';
import { getLastName } from '@/utils/playerUtils';

const authStore = useAuthStore();
const router = useRouter();
const selectedCard = ref(null);

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
const globalDraftActive = ref(false);
const leagueRosterIds = ref(new Set());

// Ensure apiUrl is an empty string if VITE_API_URL is not defined
const apiUrl = import.meta.env.VITE_API_URL || '';
const takenPlayersMap = ref(new Map()); // card_id -> { logo_url, name }

const isSubmitting = ref(false);

// --- COMPUTED ---
const isDraftActive = computed(() => draftState.value.is_active);

const isMyTurn = computed(() => {
    if (!authStore.user || !authStore.user.team) return false;
    return authStore.user.team.team_id === draftState.value.active_team_id;
});

const hasRandomRemovals = computed(() => {
    return draftState.value.randomRemovals && draftState.value.randomRemovals.length > 0;
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
        // NOTE: We now show taken players, but visually distinguish them
        return true;
    }).sort((a, b) => {
        // Sort available players first, then taken players at bottom
        const aTaken = draftState.value.takenPlayerIds.includes(a.card_id);
        const bTaken = draftState.value.takenPlayerIds.includes(b.card_id);

        //if (aTaken && !bTaken) return 1;
        //if (!aTaken && bTaken) return -1;

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

// Draft Table Generation
const displayRows = computed(() => {
    // If no active draft data is available (e.g. historical only, no order),
    // fallback to just showing history.
    if (!draftState.value.draft_order || draftState.value.draft_order.length === 0) {
        return draftState.value.history
            .filter(item => (item.action || '').toUpperCase() !== 'REMOVED_RANDOM')
            .map(h => {
                let name = h.player_name;
                if (h.position) name += ` (${h.position})`;
                if (h.action === 'ADDED' && (h.round === 'Add/Drop 1' || h.round === 'Add/Drop 2')) name = `ADD: ${name}`;
                if (h.action === 'DROPPED') name = `DROP: ${name}`;

                return {
                    id: `hist-${h.id}`,
                    round: h.round,
                    pick_number: h.pick_number,
                    team_name: h.team_name,
                    player_name: name,
                    action: h.action,
                    // Show logo if available and action is not DROPPED
                    team_logo: (h.action === 'DROPPED') ? null : h.logo_url
                };
            });
    }

    const rows = [];
    const order = draftState.value.draft_order;
    const teamCount = order.length;

    // Generate 20 slots for 4 rounds (Round 1, 2, Add/Drop 1, Add/Drop 2)
    // Assuming 5 teams, that's 20 picks.
    const totalPicks = teamCount * 4;

    for (let i = 1; i <= totalPicks; i++) {
        const teamIndex = (i - 1) % teamCount;
        const teamId = order[teamIndex];

        const teamObj = (draftState.value.teams && draftState.value.teams[teamId]);
        let teamName = teamObj ? teamObj.name : `Team ${teamId}`;
        let teamLogo = teamObj ? teamObj.logo_url : null;

        // Determine Round Name
        let roundNum = "";
        let isAddDrop = false;
        if (i <= teamCount) {
            roundNum = "1";
        } else if (i <= teamCount * 2) {
            roundNum = "2";
        } else if (i <= teamCount * 3) {
            roundNum = "Add/Drop 1";
            isAddDrop = true;
        } else {
            roundNum = "Add/Drop 2";
            isAddDrop = true;
        }

        const historyItems = draftState.value.history.filter(h => h.pick_number === i && h.round !== 'Removal');

        if (historyItems.length > 0) {
            // Render existing history items
            // Sort: DROPPED first, then ADDED. (DROPPED < ADDED alphabetically false, so reverse or custom)
            // Or explicit: DROPPED=0, ADDED=1
            historyItems.sort((a, b) => {
                const actionOrder = { 'DROPPED': 0, 'ADDED': 1, 'ROSTER_CONFIRMED': 2 };
                const aVal = actionOrder[a.action] !== undefined ? actionOrder[a.action] : 99;
                const bVal = actionOrder[b.action] !== undefined ? actionOrder[b.action] : 99;
                if (aVal !== bVal) return aVal - bVal;
                return a.id - b.id;
            }).forEach(h => {
                 // Display Round normalization
                 let displayRound = h.round;
                 if (h.round === 'Round 1') displayRound = '1';
                 if (h.round === 'Round 2') displayRound = '2';
                 // Keep "Add/Drop 1" and "Add/Drop 2" as is

                 let name = h.player_name;
                 // Append position if available
                 if (h.position) {
                     name += ` (${h.position})`;
                 }

                 if (isAddDrop) {
                    if (h.action === 'ADDED') name = `ADD: ${name}`;
                    else if (h.action === 'DROPPED') name = `DROP: ${name}`;
                 }

                 rows.push({
                     id: `hist-${h.id}`,
                     round: displayRound,
                     pick_number: i,
                     team_name: h.city || h.team_name,
                     player_name: name,
                     action: h.action,
                     // Only show logo if not a DROP
                     team_logo: (h.action === 'DROPPED') ? null : teamLogo
                 });
            });
        } else {
            // Render placeholder
            rows.push({
                id: `pick-${i}`,
                round: roundNum,
                pick_number: i,
                team_name: teamName, // Use the scheduled team name
                team_logo: teamLogo,
                player_name: '',
                action: 'PENDING'
            });
        }
    }

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

    // Sort players within each team by points descending
    for (const team in groups) {
        groups[team].sort((a, b) => (b.points || 0) - (a.points || 0));
    }

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
            const map = new Map();

            leagueData.forEach(team => {
                team.roster.forEach(p => {
                    ids.add(p.card_id);
                    map.set(p.card_id, {
                        logo_url: team.logo_url,
                        name: team.name
                    });
                });
            });
            leagueRosterIds.value = ids;
            takenPlayersMap.value = map;
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
            globalDraftActive.value = data.globalDraftActive;

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
        }
    } catch (error) {
        console.error("Error starting draft:", error);
    }
}

async function makePick(player) {
    if (leagueRosterIds.value.has(player.card_id)) return; // Double check
    if (isSubmitting.value) return; // Prevent double submission
    if (!confirm(`Draft ${player.name}?`)) return;

    isSubmitting.value = true;
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
    } finally {
        isSubmitting.value = false;
    }
}

async function fetchAvailablePlayers() {
    availablePlayers.value = authStore.allPlayers;
}

function goToRosterBuilder() {
    router.push('/roster-builder');
}

async function submitRoster() {
    if (isSubmitting.value) return;
    if (!confirm("Are you sure you want to finalize your roster? Make sure your roster is valid (20 players, 5000pts cap, 4 SPs).")) return;

    isSubmitting.value = true;
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
    } finally {
        isSubmitting.value = false;
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
    <!-- Modal for viewing player cards -->
    <div v-if="selectedCard" class="modal-overlay" @click="selectedCard = null">
        <div @click.stop><PlayerCard :player="selectedCard" /></div>
    </div>

    <div class="draft-container">

        <!-- HEADER / SEASON SELECT -->
        <div class="history-header">
            <h2>Offseason Draft</h2>
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
                            <span class="view-icon" @click.stop="selectedCard = player" title="View Card">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </span>
                            <template v-if="leagueRosterIds.has(player.card_id)">
                                <img v-if="takenPlayersMap.get(player.card_id)?.logo_url"
                                     :src="takenPlayersMap.get(player.card_id).logo_url"
                                     class="rostered-team-icon"
                                     :title="takenPlayersMap.get(player.card_id).name" />
                            </template>
                        </div>
                        <div class="action-cell">
                            <button v-if="!leagueRosterIds.has(player.card_id)" @click="makePick(player)" class="draft-btn" :disabled="isSubmitting">Draft</button>
                            <button v-else disabled class="draft-btn disabled">Taken</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ADD/DROP INTERFACE (Rounds 3 & 4) -->
            <div v-else-if="draftState.current_round === 4 || draftState.current_round === 5" class="add-drop-interface">
                <h3>Add/Drop</h3>
                <p>You can add and drop as many players as you like.</p>
                <div class="add-drop-buttons">
                    <button @click="goToRosterBuilder" class="builder-btn">Edit Roster</button>
                    <button @click="submitRoster" class="submit-roster-btn" :disabled="isSubmitting">
                        {{ isSubmitting ? 'Submitting...' : 'Submit Roster' }}
                    </button>
                </div>
            </div>
        </div>

        <!-- WAITING MESSAGE FOR ACTIVE DRAFT -->
        <div v-else-if="isDraftActive && !isMyTurn" class="waiting-message">
            <p>Waiting for current pick...</p>
        </div>

        <!-- START BUTTON (If Season Over) -->
        <div v-else-if="!globalDraftActive && isSeasonOver" class="start-section">
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
                        <td class="pick-cell">
                            <div class="pick-content">
                                <span>{{ item.pick_number || '-' }}</span>
                                <img v-if="item.team_logo" :src="item.team_logo" class="table-team-logo" />
                            </div>
                        </td>
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
.draft-container { max-width: 1000px; margin: 0 auto; padding: 1rem; }
.history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
.history-controls { display: flex; align-items: center; gap: 0.5rem; }
.season-select-inline { padding: 0.25rem; font-size: 0.9rem; }

.start-section { margin-bottom: 2rem; text-align: center; }
.start-btn { padding: 1rem 2rem; font-size: 1.2rem; background: #28a745; color: white; border: none; cursor: pointer; border-radius: 4px; }

.active-controls { margin-bottom: 2rem; padding: 1rem; background: #f0f8ff; border: 1px solid #b8daff; border-radius: 8px; max-width: 400px; align-items: center; }
.waiting-message { margin-bottom: 2rem; padding: 1rem; background: #fff3cd; border: 1px solid #ffeeba; border-radius: 8px; text-align: center; }

.pick-interface h3 { margin-top: 0; }
/* Restrict width to keep button closer to name on wide screens */
.pick-interface { max-width: 400px; margin: 0 auto; }
.add-drop-interface h3 { margin-top: 0; }
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

.view-icon { cursor: pointer; color: #6c757d; display: flex; align-items: center; }
.view-icon:hover { color: #007bff; }

.rostered { background-color: #f0f0f0; color: #aaa; opacity: 0.7; }
.rostered-team-icon { width: 25px; height: 25px; object-fit: contain; }

.action-cell {
    flex-shrink: 0;
    margin-left: auto; /* Push to right, but constrained by flex gap */
}

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
.draft-table { max-width: 700px; border-collapse: collapse; table-layout: fixed; }
.draft-table th, .draft-table td { border: 1px solid #ddd; padding: 0.25rem 0.5rem; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft-table th { background-color: #f2f2f2; }
.draft-table th:nth-child(1) { width: 15%; }
.draft-table th:nth-child(2) { width: 10%; }
.draft-table th:nth-child(3) { width: 45%; }
.draft-table th:nth-child(4) { width: 30%; }

/* REMOVALS STYLES */
.removals-section { margin-top: 2rem; }
.teams-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; }
.team-block { max-width: 280px; background: #f9f9f9; border-radius: 8px; padding: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.team-header { display: flex; align-items: center; gap: 1rem; padding-bottom: 1rem; margin-bottom: 0rem; }
.team-info h2 { margin: 0; font-size: 1.4rem; }
.roster-table-container { overflow-x: auto; }
.roster-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.roster-table th { text-align: left; padding: 0.5rem; background: #e9ecef; color: #495057; font-weight: 600; }
.roster-table td { padding: 0.25rem 0.5rem; border-bottom: 1px solid #dee2e6; }
.player-row { transition: background-color 0.2s; }
.player-row:hover { background-color: #e2e6ea; }
.name-cell { font-weight: normal; }

.pick-cell { }
.pick-content { display: flex; align-items: center; gap: 8px; }
.table-team-logo { width: 24px; height: 24px; object-fit: contain; }

.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000; }

</style>
