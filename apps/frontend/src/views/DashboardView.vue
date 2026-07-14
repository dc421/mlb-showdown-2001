<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { RouterLink, useRouter } from 'vue-router';
import { socket } from '@/services/socket';
import { apiClient } from '@/services/api';
import GameScorecard from '@/components/GameScorecard.vue';
import PlayerCard from '@/components/PlayerCard.vue';
import PlayerCardModal from '@/components/PlayerCardModal.vue';
import { sortRoster } from '@/utils/playerUtils';

const authStore = useAuthStore();
const router = useRouter();
const seriesType = ref('exhibition'); // Default to exhibition
const teamAccolades = ref({ spaceships: [], spoons: [], submarines: [] });
const selectedPlayer = ref(null);
const activeRosterTab = ref('league'); // 'league' or 'classic'

// Delete Games State
const isDeleteMode = ref(false);
const selectedGamesToDelete = ref([]);

// Ensure apiUrl is an empty string if VITE_API_URL is not defined, to allow relative paths (proxied) to work.
const apiUrl = import.meta.env.VITE_API_URL || '';

const myTeamDisplayName = computed(() => {
  if (!authStore.user?.team) return '';
  const team = authStore.user.team;
  const format = team.display_format || '{city} {name}';
  return format.replace('{city}', team.city).replace('{name}', team.name);
});

const processedRoster = computed(() => {
    if (!authStore.activeRosterCards) return []; // Allow empty array for padding

    // Deep copy to avoid mutating store state directly if it were mutable
    let roster = JSON.parse(JSON.stringify(authStore.activeRosterCards));

    // Helper to process players (similar to server-side processPlayers)
    roster.forEach(p => {
        // Ensure display properties if missing (though backend usually provides them)
        if (!p.displayName && p.display_name) p.displayName = p.display_name;
        if (!p.displayPosition) {
             if (p.control !== null) {
                p.displayPosition = Number(p.ip) > 3 ? 'SP' : 'RP';
            } else {
                const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings).join(',') : 'DH';
                p.displayPosition = positions.replace(/LFRF/g, 'LF/RF');
            }
        }

        if (p.assignment === 'BENCH') {
            p.assignment = 'B';
            if (p.points) p.points = Math.round(p.points / 5);
        }
    });

    // --- NEW: PAD ROSTER WITH MISSING POSITIONS ---
    // Required positions: C, 1B, 2B, SS, 3B, LF, CF, RF, DH, 4x SP, RP
    // We already sorted the real players.
    // Let's identify what's missing.
    const counts = {
        'C': 0, '1B': 0, '2B': 0, 'SS': 0, '3B': 0,
        'LF': 0, 'CF': 0, 'RF': 0, 'DH': 0,
        'SP': 0, 'RP': 0
    };

    roster.forEach(p => {
        // If assignment is valid, count it.
        // If assignment is 'PITCHING_STAFF', check displayPosition or ip
        if (p.assignment === 'PITCHING_STAFF' || p.assignment === 'SP' || p.assignment === 'RP') {
            const isSP = (p.displayPosition === 'SP') || (p.ip && Number(p.ip) > 3) || (p.assignment === 'SP');
            if (isSP) counts['SP']++;
            else counts['RP']++;
        } else if (p.assignment && counts[p.assignment] !== undefined) {
            counts[p.assignment]++;
        } else if (p.displayPosition && counts[p.displayPosition] !== undefined) {
             counts[p.displayPosition]++;
        }
    });

    // Determine missing slots to fill
    const missing = [];
    ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'].forEach(pos => {
        if (counts[pos] === 0) missing.push(pos);
    });

    // We need 4 SPs.
    for (let i = 0; i < (4 - counts['SP']); i++) {
        missing.push('SP');
    }
    // We need at least 1 RP? The validation usually checks roster size.
    // If we have strict 20 slots, let's just prioritize required fielders + SPs.

    while (roster.length < 20) {
        const nextMissing = missing.shift() || 'B';
        roster.push({
            card_id: `empty-${roster.length}`,
            displayName: '',
            displayPosition: nextMissing,
            assignment: nextMissing,
            points: '',
            isEmpty: true
        });
    }

    return sortRoster(roster);
});

const teamTotalPoints = computed(() => {
    // Only sum points from real players
    return processedRoster.value.filter(p => !p.isEmpty).reduce((sum, player) => sum + (player.points || 0), 0);
});

async function fetchTeamAccolades() {
    if (authStore.user?.team?.team_id) {
        try {
            const response = await apiClient(`/api/teams/${authStore.user.team.team_id}/accolades`);
            if (response.ok) {
                teamAccolades.value = await response.json();
            }
        } catch (error) {
            console.error('Error fetching accolades:', error);
        }
    }
}

const gamesToJoin = computed(() => {
    if (!authStore.user) return [];
    return authStore.openGames.filter(game => game.host_user_id !== authStore.user.userId);
});

// Games belonging to a launched league series (linked to a scheduled row) are represented in the
// "My Series" view, so we keep them out of these per-game lists to avoid duplication. Exhibitions,
// Classic games, and legacy series (no series_result_id) still show here.
function isScheduledLinked(game) {
  return !!(game.series && game.series.series_result_id);
}

const activeGames = computed(() => {
  return authStore.myGames.filter(game => game.status !== 'completed' && !isScheduledLinked(game));
});

const completedGames = computed(() => {
  return authStore.myGames.filter(game => game.status === 'completed' && !isScheduledLinked(game));
});

// --- Series (grouped by season / Classic). The backend only returns in-app series (played or live-
// actionable), so offline-only results never appear here. Both League and Classic groups show. ---
const showOlderSeries = ref(false);

// Live groups (current season / active Classic) that still have unplayed/in-progress series.
const liveActiveGroups = computed(() =>
  authStore.myGroups
    .filter(g => g.is_live)
    .map(g => ({ ...g, entries: g.series.filter(s => s.result_status !== 'completed') }))
    .filter(g => g.entries.length > 0)
);

// Completed series grouped; live groups first (highlighted), older ones collapsible.
const completedGroups = computed(() =>
  authStore.myGroups
    .map(g => ({ ...g, entries: g.series.filter(s => s.result_status === 'completed') }))
    .filter(g => g.entries.length > 0)
);
const liveCompletedGroups = computed(() => completedGroups.value.filter(g => g.is_live));
const olderCompletedGroups = computed(() => completedGroups.value.filter(g => !g.is_live));

function opponentLabel(s) {
  const o = s.opponent || {};
  // City only on the dashboard cards (nickname dropped to keep them compact).
  return o.city || o.name || 'TBD';
}

function gameRouteFor(game) {
  if (!game) return null;
  if (game.status === 'pending') return `/game/${game.game_id}/setup`;
  if (game.status === 'lineups') return `/game/${game.game_id}/lineup`;
  return `/game/${game.game_id}`;
}

function rosterForGroup(group) {
  return group?.type === 'classic' ? authStore.myClassicRoster : authStore.myLeagueRoster;
}

async function playSeries(s, group) {
  const roster = rosterForGroup(group);
  if (!roster) { alert(`You must create a ${group?.type === 'classic' ? 'Classic' : 'League'} roster before starting a series.`); return; }
  const gameId = await authStore.launchSeries(s.series_result_id, roster.roster_id);
  if (gameId) router.push(`/game/${gameId}/setup`);
}

async function joinSeries(s, group) {
  const roster = rosterForGroup(group);
  if (!roster) { alert(`You must create a ${group?.type === 'classic' ? 'Classic' : 'League'} roster before joining a series.`); return; }
  const gameId = s.live?.active_game?.game_id;
  if (!gameId) return;
  await authStore.joinGame(gameId, roster.roster_id);
  await authStore.fetchMySeries();
  router.push(gameRouteFor(s.live.active_game));
}

function continueSeries(s) {
  const route = gameRouteFor(s.live?.active_game);
  if (route) router.push(route);
}

// The whole series card is the click target now (no per-action button). Launching a scheduled
// series is gated the same way the old "Play" button was (roster present + no live draft);
// continue/join of an in-progress series is always allowed.
function seriesDisabled(s, g) {
  if (s.live && s.live.series_status !== 'completed') return false;
  const noRoster = g?.type === 'classic' ? !authStore.myClassicRoster : !authStore.myLeagueRoster;
  return authStore.isDraftActive || noRoster;
}
function seriesClickable(s, g) {
  if (s.result_status === 'completed') return !!(s.live && s.live.series_id);
  return !seriesDisabled(s, g);
}
// A scheduled series we can't launch yet (no roster / draft in progress) is shown dimmed.
function seriesMuted(s, g) {
  return s.result_status !== 'completed' && seriesDisabled(s, g);
}
function onSeriesCardClick(s, g) {
  if (s.result_status === 'completed') { goSeries(s); return; }
  if (seriesDisabled(s, g)) return;
  if (s.live && s.live.series_status !== 'completed') {
    if (s.live.i_am_participant) continueSeries(s);
    else joinSeries(s, g);
  } else {
    playSeries(s, g);
  }
}
// Completed-series card → its in-app series page (only when a live series is linked).
function goSeries(s) {
  if (s.live && s.live.series_id) router.push(`/series/${s.live.series_id}`);
}

// Trophy rounds show the trophy image in place of a text round tag.
const TROPHY_IMAGES = {
  'Golden Spaceship': 'golden_spaceship.png',
  'Wooden Spoon': 'wooden_spoon.png',
  'Silver Submarine': 'silver_submarine.png',
};
function trophyImage(round) {
  const file = TROPHY_IMAGES[round];
  return file ? `${apiUrl}/images/${file}` : null;
}
// Round tag gets the trophy's metal/wood color scheme (silver matches ClassicView's finale card).
const TROPHY_TAG_CLASS = {
  'Golden Spaceship': 'trophy-gold',
  'Wooden Spoon': 'trophy-wood',
  'Silver Submarine': 'trophy-silver',
};
function roundTagClass(round) {
  return TROPHY_TAG_CLASS[round] || '';
}
// Playoff/trophy series carry a round tag (and stack onto two lines); regular-season ones don't.
function hasRoundTag(s) {
  return !!(s.round && !['Regular Season', 'Round Robin'].includes(s.round));
}

function ordinalInning(n) {
  const v = n % 100;
  const suffix = (v >= 11 && v <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  return `${n}${suffix}`;
}
// The active-series card's right-hand label: says exactly what you're about to click into —
// the live game and where it stands (e.g. "Game 2 · Top 7th"), or its pre-game step, or that a
// scheduled series is ready to launch.
function seriesStateLabel(s) {
  if (s.result_status === 'completed') return null;
  const ag = s.live && s.live.active_game;
  if (!ag) return 'Ready to play';
  const game = ag.game_in_series ? `Game ${ag.game_in_series}` : 'Game';
  if (ag.status === 'pending') return `${game} · Setup`;
  if (ag.status === 'lineups') return `${game} · Set lineups`;
  if (ag.inning) return `${game} · ${ag.is_top ? 'Top' : 'Bot'} ${ordinalInning(ag.inning)}`;
  return `${game} · In progress`;
}

function getGameTypeName(seriesType) {
  switch (seriesType) {
    case 'regular_season':
      return 'Regular Season Series';
    case 'golden_spaceship':
      return 'Golden Spaceship Series';
    case 'wooden_spoon':
      return 'Wooden Spoon Series';
    case 'playoff':
      return 'Playoff Series';
    case 'classic':
      return 'Classic Series';
    case 'exhibition':
    default:
      return 'Exhibition';
  }
}

function handleCreateGame() {
  if (seriesType.value === 'classic' && activeRosterTab.value !== 'classic') {
      alert("Please switch to the 'Classic' roster tab to create a Classic series game.");
      return;
  }

  const isClassicGame = seriesType.value === 'classic';
  const targetRoster = isClassicGame ? authStore.myClassicRoster : authStore.myLeagueRoster;

  if (targetRoster) {
    // Pass the selected series type to the store action
    authStore.createGame(targetRoster.roster_id, seriesType.value);
  } else {
    alert(`You must create a ${isClassicGame ? 'Classic' : 'League'} roster before you can create a game.`);
  }
}

function handleJoinGame(game) {
    const isClassicGame = game.series_type === 'classic';
    const targetRoster = isClassicGame ? authStore.myClassicRoster : authStore.myLeagueRoster;

    if (!targetRoster) {
        alert(`You must create a ${isClassicGame ? 'Classic' : 'League'} roster before you can join this game.`);
        return;
    }

    authStore.joinGame(game.game_id, targetRoster.roster_id);
}

function toggleDeleteMode() {
    isDeleteMode.value = !isDeleteMode.value;
    selectedGamesToDelete.value = [];
}

async function handleBulkDelete() {
    if (selectedGamesToDelete.value.length === 0) return;
    
    if (confirm(`Are you sure you want to delete ${selectedGamesToDelete.value.length} game(s)?`)) {
        await authStore.bulkHideGames(selectedGamesToDelete.value);
        toggleDeleteMode();
    }
}

function refreshData() {
    authStore.fetchMyGames();
    authStore.fetchOpenGames();
    authStore.fetchMySeries();
}

function goToRosterBuilder() {
  if (activeRosterTab.value === 'classic') {
      router.push('/roster-builder?type=classic');
  } else {
      router.push('/roster-builder');
  }
}

function openPlayerCard(player) {
    selectedPlayer.value = player;
}

function closePlayerCard() {
    selectedPlayer.value = null;
}

async function switchRosterTab(tab) {
    activeRosterTab.value = tab;

    // Update Series Type Logic based on tab
    if (tab === 'classic') {
        seriesType.value = 'classic';
    } else {
        seriesType.value = 'exhibition';
    }

    // Determine appropriate point set BEFORE fetching
    let targetSetId = null;
    if (tab === 'classic') {
        const original = authStore.pointSets.find(ps => ps.name === 'Original Pts');
        if (original) targetSetId = original.point_set_id;
    } else {
        targetSetId = authStore.selectedPointSetId;
    }

    // Reload roster for the new tab, passing targetSetId so it fetches cards immediately
    // We do NOT clear authStore.activeRosterCards here to prevent "empty roster" message flickering
    await authStore.fetchMyRoster(tab, true, targetSetId);
}

onMounted(async () => {
  // Ensure point sets are loaded to get the current season ID
  await authStore.fetchPointSets();

  // Fetch the active roster immediately to display it
  await switchRosterTab(activeRosterTab.value);

  // Fetch the other roster quietly in the background so availability logic works
  // We pass false to setActive so it doesn't overwrite myRoster.value
  const otherTab = activeRosterTab.value === 'league' ? 'classic' : 'league';
  authStore.fetchMyRoster(otherTab, false);

  authStore.fetchMyGames();
  authStore.fetchOpenGames();
  authStore.fetchMySeries();
  fetchTeamAccolades();
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
        <h1>{{ myTeamDisplayName }}</h1>
        <p>Owner: {{ authStore.user.owner }}</p>
        <div class="header-buttons">
            <button @click="goToRosterBuilder" class="roster-btn">{{ authStore.myRoster ? `Edit ${activeRosterTab === 'classic' ? 'Classic ' : ''}Roster` : `Create ${activeRosterTab === 'classic' ? 'Classic ' : ''}Roster` }}</button>
            <!-- REMOVED: Draft Room Link -->
        </div>
      </div>
      <div class="accolades">
          <div v-if="teamAccolades.spaceships.length > 0" class="accolade-row">
            <div v-for="(accolade, index) in teamAccolades.spaceships" :key="accolade.season_name + index" class="accolade-item desktop-only">
              <img :src="`${apiUrl}/images/golden_spaceship.png`"
                   :title="accolade.season_name"
                   class="accolade-icon"
                   alt="Golden Spaceship" />
            </div>
            <div class="accolade-item mobile-only">
              <img :src="`${apiUrl}/images/golden_spaceship.png`"
                   class="accolade-icon"
                   alt="Golden Spaceship" />
              <span class="accolade-count">: {{ teamAccolades.spaceships.length }}</span>
            </div>
          </div>
          <div v-if="teamAccolades.spoons.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamAccolades.spoons" :key="accolade.season_name + index" class="accolade-item desktop-only">
               <img :src="`${apiUrl}/images/wooden_spoon.png`"
                   :title="accolade.season_name"
                   class="accolade-icon"
                   alt="Wooden Spoon" />
             </div>
             <div class="accolade-item mobile-only">
               <img :src="`${apiUrl}/images/wooden_spoon.png`"
                   class="accolade-icon"
                   alt="Wooden Spoon" />
               <span class="accolade-count">: {{ teamAccolades.spoons.length }}</span>
             </div>
          </div>
          <div v-if="teamAccolades.submarines && teamAccolades.submarines.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamAccolades.submarines" :key="accolade.season_name + index" class="accolade-item desktop-only">
               <img :src="`${apiUrl}/images/silver_submarine.png`"
                   :title="accolade.season_name"
                   class="accolade-icon"
                   alt="Silver Submarine" />
             </div>
             <div class="accolade-item mobile-only">
               <img :src="`${apiUrl}/images/silver_submarine.png`"
                   class="accolade-icon"
                   alt="Silver Submarine" />
               <span class="accolade-count">: {{ teamAccolades.submarines.length }}</span>
             </div>
          </div>
      </div>
    </header>

    <main class="dashboard-main">
      <!-- COLUMN 1: Roster -->
      <div class="panel roster-panel">
          <div class="roster-header-tabs">
              <div class="tabs">
                  <button :class="{ active: activeRosterTab === 'league' }" @click="switchRosterTab('league')">League</button>
                  <button :class="{ active: activeRosterTab === 'classic' }" @click="switchRosterTab('classic')">Classic</button>
              </div>
          </div>

          <!-- Empty Check: Only if NO players at all (length 0 before padding, but we pad now).
               So if only placeholders exist, it's empty.
               We check if the first element is empty. -->
          <div v-if="authStore.isFetchingRoster" class="empty-roster-message">
              <p>Loading {{ activeRosterTab === 'classic' ? 'Classic' : 'League' }} roster...</p>
          </div>
          <div v-else-if="processedRoster.length === 0 || processedRoster[0].isEmpty" class="empty-roster-message">
              <p>Your {{ activeRosterTab === 'classic' ? 'Classic' : 'League' }} roster is empty.</p>
              <button @click="goToRosterBuilder" class="create-roster-btn">Create Roster</button>
          </div>
          <div v-else class="roster-table-container">
            <table class="roster-table">
                <thead>
                    <tr>
                        <th class="header-pos">Pos</th>
                        <th class="header-player">Player</th>
                        <th class="header-points">Points</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="player in processedRoster" :key="player.card_id" @click="!player.isEmpty && openPlayerCard(player)" class="player-row" :class="{ 'empty-row': player.isEmpty }">
                        <td class="pos-cell">
                                {{ player.assignment === 'PITCHING_STAFF' ? (player.displayPosition || player.position) : (player.assignment || player.displayPosition || player.position) }}
                        </td>
                        <td class="name-cell">{{ player.displayName || player.name }}</td>
                        <td class="points-cell">{{ player.points }}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="2" class="total-label">Total</td>
                        <td class="total-points">{{ teamTotalPoints }}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
      </div>

      <!-- COLUMN 2: My Series (league schedule) + Active Exhibitions + New game -->
      <div class="panel">
        <!-- Scheduled / in-progress series for the live season (or active Classic), played in-app -->
        <div class="my-series-section">
            <div class="section-header">
                <h2>My Series</h2>
            </div>
            <p v-if="authStore.isFetchingSeries">Loading series...</p>
            <template v-else-if="liveActiveGroups.length > 0">
                <div v-for="g in liveActiveGroups" :key="g.key" class="series-group">
                    <div class="group-label live">{{ g.label }}</div>
                    <ul class="series-list">
                        <li v-for="s in g.entries" :key="s.series_result_id"
                            class="series-item"
                            :class="{ clickable: seriesClickable(s, g), muted: seriesMuted(s, g) }"
                            @click="onSeriesCardClick(s, g)">
                            <div class="series-opp">
                                <img v-if="s.opponent.logo_url" :src="s.opponent.logo_url" :alt="s.opponent.name" class="series-logo" />
                                <span class="series-opp-name">{{ opponentLabel(s) }}</span>
                            </div>
                            <div class="series-action">
                                <span v-if="seriesStateLabel(s)" class="series-state">{{ seriesStateLabel(s) }}</span>
                                <span v-if="seriesClickable(s, g)" class="series-go" aria-hidden="true">›</span>
                            </div>
                        </li>
                    </ul>
                </div>
            </template>
            <p v-else class="empty-note">No series to play right now.</p>
        </div>

        <div class="active-games-section">
            <div class="section-header">
                <h2>{{ activeRosterTab === 'classic' ? 'Active Games' : 'Active Exhibitions' }}</h2>
            </div>

            <p v-if="authStore.isFetchingGames">Loading...</p>
            <ul v-else-if="activeGames.length > 0" class="game-list">
                <li v-for="game in activeGames" :key="game.game_id" class="game-list-item">
                    <div v-if="isDeleteMode" class="checkbox-wrapper">
                        <input type="checkbox" :value="game.game_id" v-model="selectedGamesToDelete" />
                    </div>
                    <RouterLink :to="game.status === 'pending' ? `/game/${game.game_id}/setup` : (game.status === 'lineups' ? `/game/${game.game_id}/lineup` : `/game/${game.game_id}`)">
                        <GameScorecard :game="game" />
                    </RouterLink>
                </li>
            </ul>
            <p v-else>You have no active {{ activeRosterTab === 'classic' ? 'games' : 'exhibitions' }}.</p>

            <div v-if="activeGames.length > 0" class="delete-controls">
                <button v-if="!isDeleteMode" @click="toggleDeleteMode" class="text-btn delete-mode-btn">
                    Select Games to Hide
                </button>
                <div v-else class="delete-actions">
                    <button @click="handleBulkDelete" :disabled="selectedGamesToDelete.length === 0" class="confirm-delete-btn">
                        Hide Selected ({{ selectedGamesToDelete.length }})
                    </button>
                    <button @click="toggleDeleteMode" class="cancel-btn">Cancel</button>
                </div>
            </div>
        </div>

        <div class="new-games-section">
            <h2>{{ activeRosterTab === 'classic' ? 'New Classic Game' : 'New Exhibition' }}</h2>
            <button @click="handleCreateGame" :disabled="(activeRosterTab === 'classic' ? !authStore.myClassicRoster : !authStore.myLeagueRoster) || (activeRosterTab === 'league' && authStore.isDraftActive)" class="action-btn">
                {{ (activeRosterTab === 'league' && authStore.isDraftActive) ? 'Draft in Progress' : (activeRosterTab === 'classic' ? '+ Create Classic Game' : '+ Create Exhibition') }}
            </button>
            <div class="series-options">
                <template v-if="activeRosterTab === 'classic'">
                     <label><input type="radio" v-model="seriesType" value="classic"> Classic (Best of 7)</label>
                </template>
                <p v-else class="exhibition-note">Scheduled league series are played from “My Series” above. Use this for a one-off exhibition that doesn’t affect the standings.</p>
            </div>
            <h3 class="join-header">Open Games to Join</h3>
            <p v-if="authStore.isFetchingOpenGames">Loading open games...</p>
            <ul v-else-if="gamesToJoin.length > 0" class="game-list">
              <li v-for="game in gamesToJoin" :key="game.game_id">
                <span>{{ getGameTypeName(game.series_type) }} vs. {{ game.full_display_name }}</span>
                <button @click="handleJoinGame(game)" :disabled="(game.series_type === 'classic' ? !authStore.myClassicRoster : !authStore.myLeagueRoster) || (game.series_type !== 'classic' && authStore.isDraftActive)">
                    {{ (game.series_type !== 'classic' && authStore.isDraftActive) ? 'Draft Active' : 'Join' }}
                </button>
              </li>
            </ul>
            <p v-else>No open games to join.</p>
        </div>
      </div>

      <!-- COLUMN 3: Completed Series + Completed Exhibitions/Games -->
       <div class="panel">
        <div class="completed-series-section">
            <h2>Completed Series</h2>
            <p v-if="authStore.isFetchingSeries">Loading...</p>
            <template v-else-if="completedGroups.length > 0">
                <div v-for="g in liveCompletedGroups" :key="g.key" class="series-group">
                    <div class="group-label current">{{ g.label }}</div>
                    <ul class="series-list">
                        <li v-for="s in g.entries" :key="s.series_result_id"
                            class="series-item"
                            :class="{ clickable: seriesClickable(s, g), muted: seriesMuted(s, g), stacked: hasRoundTag(s) }"
                            @click="onSeriesCardClick(s, g)">
                            <img v-if="trophyImage(s.round)" :src="trophyImage(s.round)" :alt="s.round" class="trophy-bg" aria-hidden="true" />
                            <div class="series-opp">
                                <img v-if="s.opponent.logo_url" :src="s.opponent.logo_url" :alt="s.opponent.name" class="series-logo" />
                                <span class="series-opp-name">{{ opponentLabel(s) }}</span>
                            </div>
                            <div class="series-action">
                                <span v-if="s.round && !['Regular Season','Round Robin'].includes(s.round)" class="round-tag" :class="roundTagClass(s.round)">{{ s.round }}</span>
                                <span class="series-result" :class="{ win: s.my_score > s.opp_score, loss: s.my_score < s.opp_score }">
                                    {{ s.my_score > s.opp_score ? 'W' : (s.my_score < s.opp_score ? 'L' : 'T') }} {{ s.my_score }}–{{ s.opp_score }}
                                </span>
                                <span v-if="s.result_source === 'offline' && !(s.live && s.live.series_id)" class="source-tag">offline</span>
                            </div>
                        </li>
                    </ul>
                </div>

                <template v-if="olderCompletedGroups.length > 0">
                    <button class="older-toggle" @click="showOlderSeries = !showOlderSeries">
                        {{ showOlderSeries ? '▾ Hide' : '▸ Show' }} older ({{ olderCompletedGroups.length }})
                    </button>
                    <div v-if="showOlderSeries">
                        <div v-for="g in olderCompletedGroups" :key="g.key" class="series-group older">
                            <div class="group-label">{{ g.label }}</div>
                            <ul class="series-list">
                                <li v-for="s in g.entries" :key="s.series_result_id"
                                    class="series-item"
                                    :class="{ clickable: seriesClickable(s, g), muted: seriesMuted(s, g), stacked: hasRoundTag(s) }"
                                    @click="onSeriesCardClick(s, g)">
                                    <img v-if="trophyImage(s.round)" :src="trophyImage(s.round)" :alt="s.round" class="trophy-bg" aria-hidden="true" />
                                    <div class="series-opp">
                                        <img v-if="s.opponent.logo_url" :src="s.opponent.logo_url" :alt="s.opponent.name" class="series-logo" />
                                        <span class="series-opp-name">{{ opponentLabel(s) }}</span>
                                    </div>
                                    <div class="series-action">
                                        <span v-if="s.round && !['Regular Season','Round Robin'].includes(s.round)" class="round-tag" :class="roundTagClass(s.round)">{{ s.round }}</span>
                                        <span class="series-result" :class="{ win: s.my_score > s.opp_score, loss: s.my_score < s.opp_score }">
                                            {{ s.my_score > s.opp_score ? 'W' : (s.my_score < s.opp_score ? 'L' : 'T') }} {{ s.my_score }}–{{ s.opp_score }}
                                        </span>
                                        <span v-if="s.result_source === 'offline' && !(s.live && s.live.series_id)" class="source-tag">offline</span>
                                    </div>
                                </li>
                            </ul>
                        </div>
                    </div>
                </template>
            </template>
            <p v-else class="empty-note">No completed series yet.</p>
        </div>

        <h2>Completed {{ activeRosterTab === 'classic' ? 'Games' : 'Exhibitions' }}</h2>
        <p v-if="authStore.isFetchingGames">Loading completed games...</p>
        <ul v-else-if="completedGames.length > 0" class="game-list">
          <li v-for="game in completedGames" :key="game.game_id">
            <RouterLink :to="`/game/${game.game_id}`">
              <GameScorecard :game="game" />
            </RouterLink>
          </li>
        </ul>
        <p v-else>You have no completed {{ activeRosterTab === 'classic' ? 'games' : 'exhibitions' }}.</p>
      </div>
    </main>

    <footer class="dashboard-footer">
      <RouterLink to="/official-rules">Official MLB Showdown 2001 Advanced Rules</RouterLink>
    </footer>

    <!-- Player Card Modal -->
    <PlayerCardModal :player="selectedPlayer" @close="closePlayerCard" />

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
  margin: 2rem 2rem 1rem 2rem;
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

.accolades {
    margin-left: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-end;
}

.accolade-row {
    display: flex;
    gap: 0.25rem;
}

.accolade-item {
    width: 40px;
    display: flex;
    justify-content: center;
}

.accolade-icon {
    width: auto;
    height: 35px;
}

.dashboard-main {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 1.5rem;
  padding: 0 2rem 2rem 2rem;
  align-items: start; /* Align panels to top */
}
.panel {
  background: #f9f9f9;
  padding: 1.5rem;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}
.panel h2 { margin-top: 0; margin-bottom: 0; }
.roster-header-tabs {
    display: flex;
    justify-content: center; /* Center the tabs */
    align-items: center;
    margin-bottom: 1rem;
    border-bottom: 1px solid #eee;
    padding-bottom: 0; /* Adjusted for tab style */
}
.tabs {
    display: flex;
    gap: 0; /* Tabs touch */
}
.roster-header-tabs {
    background-color: #fff; /* White background for the tab strip */
    border-bottom: 1px solid #ddd;
    margin-bottom: 0; /* Remove margin to connect with panel content */
    border-radius: 8px 8px 0 0; /* Rounded top corners only */
    padding: 10px 10px 0 10px; /* Padding for the tabs */
}
.tabs {
    display: flex;
    gap: 5px; /* Slight gap between tabs */
}
.tabs button {
    background: #f1f1f1; /* Inactive tab background */
    border: 1px solid #ddd;
    padding: 0.75rem 2rem;
    cursor: pointer;
    font-size: 1.1rem;
    font-weight: bold;
    color: #666;
    border-radius: 8px 8px 0 0; /* Tab shape */
    transition: all 0.2s;
    margin-bottom: -1px; /* Overlap the bottom border */
}
.tabs button:hover {
    background-color: #e9ecef;
    color: #333;
}
.tabs button.active {
    background-color: #f9f9f9; /* Match panel background */
    color: #333; /* Darker text for active */
    border-bottom: 1px solid #f9f9f9; /* Hide bottom border to merge */
    border-top: 2px solid #007bff; /* Active indicator on top */
    z-index: 1; /* Ensure it sits on top of the container border */
}
.roster-btn {
  margin-top: 1rem;
  padding: .5rem 1rem;
  font-size: 1rem;
  border-radius: 5px;
  color: inherit;
  border: 1px solid currentColor;
  transition: all 0.1s ease-in-out;
  cursor: pointer;
  background-color: rgba(255, 255, 255, 0.2);
  font-weight: bold;
}
.roster-btn:hover {
  background-color: rgba(255, 255, 255, 0.3);
}
.roster-btn:active {
  background-color: rgba(255, 255, 255, 0.4);
  box-shadow: none;
}
.action-btn { display: block; margin: 1rem auto; }
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

.series-options {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #eee;
}

.exhibition-note {
  font-size: 0.85rem;
  color: #777;
  margin: 0.25rem 0 0 0;
}

/* --- My Series / Completed Series --- */
.my-series-section {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}
.completed-series-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e0e0e0;
}
.season-tag {
  font-size: 0.85rem;
  color: #666;
  background: #eef1f4;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  font-weight: 600;
}
.series-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0 0;
}
.series-item {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 7px;
  margin-bottom: 0.45rem;
}
/* Playoff/trophy cards carry a round tag + result (+ trophy watermark) that fill a second line;
   basic regular-season results stay a single tight row so there's no wasted vertical space. */
.series-item.stacked {
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 0.3rem;
}
.series-item.clickable {
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.series-item.clickable:hover {
  background: #f5f8fc;
  border-color: #c7d6f0;
  box-shadow: 0 1px 4px rgba(13, 110, 253, 0.08);
}
.series-item.muted { opacity: 0.55; }
.series-opp {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}
.series-logo {
  height: 30px;
  width: 30px;
  object-fit: contain;
  background: #fff;
  border-radius: 5px;
  flex-shrink: 0;
}
.series-opp-name {
  font-weight: 600;
  font-size: 1rem;
  line-height: 1.2;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-action {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
}
/* What you're clicking into on an active series card (e.g. "Game 2 · Top 7th"). */
.series-state {
  font-weight: 600;
  font-size: 0.92rem;
  color: #4a5460;
  font-variant-numeric: tabular-nums;
}
/* Subtle "click me" affordance on the active series card, in place of the old action button. */
.series-go {
  color: #b8bfc9;
  font-size: 1.5rem;
  line-height: 1;
  font-weight: 700;
}
.series-item.clickable:hover .series-go { color: #0d6efd; }
.series-item.clickable:hover .series-state { color: #0d6efd; }
/* Trophy round → large faint watermark bleeding off the right edge, behind the result. */
.trophy-bg {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  height: 58px;
  width: auto;
  object-fit: contain;
  opacity: 0.22;
  pointer-events: none;
  z-index: 0;
}
.series-result {
  font-weight: 700;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  color: #666;
}
.series-result.win { color: #28a745; }
.series-result.loss { color: #dc3545; }
.source-tag {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #999;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0.05rem 0.35rem;
}
.empty-note {
  color: #888;
  font-size: 0.9rem;
  margin-top: 0.75rem;
}

/* Grouping by season / Classic, with the live one differentiated */
.series-group { margin-top: 0.75rem; }
.series-group.older { opacity: 0.9; }
.group-label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #8a8a8a;
  padding: 0.1rem 0 0.35rem;
}
.group-label.live {
  color: #0d6efd;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.group-label.live::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #28a745;
  display: inline-block;
}
/* Completed-series label for the current season/Classic: highlighted like "live" but
   WITHOUT the green dot, so a finished group no longer reads as ongoing. */
.group-label.current {
  color: #0d6efd;
}
.round-tag {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6c5ce7;
  border: 1px solid #ddd6fb;
  background: #f3f1fe;
  border-radius: 4px;
  padding: 0.08rem 0.4rem;
  margin-right: auto;
}
.round-tag.trophy-gold { color: #9a7a10; border-color: #ecd79a; background: #fbf4dc; }
.round-tag.trophy-silver { color: #5a6672; border-color: #cdd4dc; background: #eef1f4; }
.round-tag.trophy-wood { color: #8a5a2b; border-color: #ddc6a8; background: #f4e9d8; }
.older-toggle {
  background: none;
  border: none;
  color: #666;
  font-size: 0.85rem;
  cursor: pointer;
  margin-top: 0.75rem;
  padding: 0.25rem 0;
}
.older-toggle:hover { color: #333; }

.active-games-section {
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #e0e0e0;
}

.join-header {
  margin-top: 2rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #eee;
  text-align: center;
}

/* Empty Roster Styles */
.empty-roster-message {
    text-align: center;
    padding: 2rem;
    color: #666;
}

.create-roster-btn {
    background-color: #007bff;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    margin-top: 1rem;
}

.create-roster-btn:hover {
    background-color: #0056b3;
}

.accolade-count {
    font-size: 1.5rem;
    font-weight: bold;
    margin-left: 0.5rem;
    align-self: center;
}

.accolade-item.mobile-only {
    width: auto;
}

@media (max-width: 768px) {
  .team-header {
    flex-direction: column;
    text-align: center;
  }
  .team-info h1 {
    font-size: 2rem;
  }
  .accolades {
      margin-left: 0;
      align-items: center;
      margin-top: 1rem;
  }
  .desktop-only { display: none !important; }
}

@media (min-width: 769px) {
  .mobile-only { display: none !important; }
  .dashboard-container {
    padding-top: 2rem;
  }
  .team-header {
    margin-top: 0;
  }
}

.dashboard-footer {
  text-align: center;
  padding: 2rem;
  margin-top: 2rem;
  border-top: 1px solid #eee;
}

/* Roster Table Styles (Copied from LeagueView) */
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
    padding: 0.4rem;
    border-top: 5px solid #f9f9f9;
    background: #e9ecef;
    color: #495057;
    font-weight: 600;
}

.header-points {
    text-align: right !important;
}

.roster-table td {
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid #dee2e6;
}

.player-row {
    cursor: pointer;
    transition: background-color 0.2s;
}

.player-row:hover {
    background-color: #e2e6ea;
}

.points-cell {
    font-weight: bold;
    color: #000000;
    text-align: right;
}

.total-row td {
    border-top: 2px solid #aaa;
    padding: 0.5rem 0.25rem;
    font-weight: bold;
    background-color: #f1f3f5;
}

.total-label {
    text-align: right;
    padding-right: 1rem;
}

.total-points {
    text-align: right;
    color: #000000;
}

/* Empty Row Styles */
.empty-row {
    pointer-events: none;
    background-color: #fafafa;
}
.empty-row td {
    height: 1rem; /* Ensure minimum height */
}

/* Modal Styles */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2000;
}

.modal-content {
    background: transparent;
    padding: 0;
    border-radius: 12px;
    position: relative;
    max-width: 90%;
    max-height: 90vh;
}

.close-btn {
    position: absolute;
    top: -40px;
    right: 0;
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.game-list-item {
    display: flex;
    align-items: center;
    gap: 10px;
}

.checkbox-wrapper {
    display: flex;
    align-items: center;
    padding-left: 0.5rem;
}

.checkbox-wrapper input {
    width: 18px;
    height: 18px;
    cursor: pointer;
}

.delete-controls {
    margin-top: 1rem;
    display: flex;
    justify-content: flex-end;
    padding-top: 0.5rem;
    border-top: 1px solid #eee;
}

.text-btn {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 0.9rem;
    text-decoration: underline;
}
.text-btn:hover {
    color: #333;
}

.delete-mode-btn {
    color: #dc3545;
}
.delete-mode-btn:hover {
    color: #a71d2a;
}

.delete-actions {
    display: flex;
    gap: 10px;
}

.confirm-delete-btn {
    background-color: #dc3545;
    color: white;
    border: none;
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
}
.confirm-delete-btn:disabled {
    background-color: #e2e6ea;
    color: #aaa;
    cursor: not-allowed;
}
.confirm-delete-btn:not(:disabled):hover {
    background-color: #c82333;
}

.cancel-btn {
    background-color: #f8f9fa;
    border: 1px solid #ddd;
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
}
.cancel-btn:hover {
    background-color: #e2e6ea;
}
</style>
