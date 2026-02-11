<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';
import { formatNameShort } from '@/utils/playerUtils';

const route = useRoute();
const teamId = ref(route.params.teamId);
const seasonName = ref(route.params.seasonName);
const seasonData = ref(null);
const loading = ref(true);
const selectedPlayer = ref(null);
const apiUrl = import.meta.env.VITE_API_URL || '';

async function fetchSeasonData() {
    loading.value = true;
    try {
        const type = route.query.type;
        let url = `/api/teams/${teamId.value}/seasons/${encodeURIComponent(seasonName.value)}`;
        if (type) url += `?type=${encodeURIComponent(type)}`;

        const response = await apiClient(url);
        if (response.ok) {
            seasonData.value = await response.json();
        } else {
            console.error('Failed to fetch season data');
        }
    } catch (error) {
        console.error('Error fetching season data:', error);
    } finally {
        loading.value = false;
    }
}

watch(() => route.params.seasonName, (newSeason) => {
    seasonName.value = newSeason;
    fetchSeasonData();
});

watch(() => route.query.type, () => {
    fetchSeasonData();
});

onMounted(() => {
    fetchSeasonData();
});

function openPlayerCard(player) {
    selectedPlayer.value = player;
}

function closePlayerCard() {
    selectedPlayer.value = null;
}

const displayRoster = computed(() => {
    if (!seasonData.value?.roster) return [];

    const roster = [...seasonData.value.roster];
    const positionOrder = {
        'SP': 1, 'RP': 2, 'C': 3, '1B': 4, '2B': 5, 'SS': 6, '3B': 7,
        'LF': 8, 'CF': 9, 'RF': 10, 'DH': 11, 'B': 12, 'BENCH': 12
    };

    return roster.sort((a, b) => {
        // Handle assignment or position fallback
        let posA = a.assignment || a.position;
        let posB = b.assignment || b.position;
        if (posA === 'BENCH') posA = 'B';
        if (posB === 'BENCH') posB = 'B';

        // Check if pitcher via stats/assignment
        const isPitcherA = (a.ip > 0 || a.control !== null || posA === 'SP' || posA === 'RP');
        const isPitcherB = (b.ip > 0 || b.control !== null || posB === 'SP' || posB === 'RP');

        if (isPitcherA && !['SP', 'RP'].includes(posA)) {
            posA = Number(a.ip) > 3 ? 'SP' : 'RP';
        }
        if (isPitcherB && !['SP', 'RP'].includes(posB)) {
            posB = Number(b.ip) > 3 ? 'SP' : 'RP';
        }

        const rankA = positionOrder[posA] || 99;
        const rankB = positionOrder[posB] || 99;

        if (rankA !== rankB) return rankA - rankB;
        return (b.points || 0) - (a.points || 0);
    });
});

// RANK AND STATS CALCULATION
const seasonStats = computed(() => {
    if (!seasonData.value?.results) return {
        regularWins: 0, regularLosses: 0,
        postseasonWins: 0, postseasonLosses: 0,
        rank: '3rd Place', accolade: null
    };

    let regularWins = 0;
    let regularLosses = 0;
    let postseasonWins = 0;
    let postseasonLosses = 0;
    let rank = '3rd Place'; // Default
    let accolade = null;

    const results = seasonData.value.results;

    results.forEach(g => {
        const w = Number(g.game_wins) || 0;
        const l = Number(g.game_losses) || 0;

        if (g.round === 'Regular Season' || g.round === 'Round Robin' || !g.round) {
             regularWins += w;
             regularLosses += l;
        } else {
             // Postseason
             postseasonWins += w;
             postseasonLosses += l;
        }
    });

    // Determine Rank
    // 1st: Golden Spaceship Winner
    // 2nd: Golden Spaceship Loser
    // 4th: Wooden Spoon Winner (Winner of the spoon match avoids the spoon? Wait, context from prompt: "1 being Golden Spaceship winner... 5 being Wooden Spoon holder")
    // Prompt said: "1st-5th place finish (1 being Golden Spaceship winner, 5 being Wooden Spoon holder)"
    // "Golden Spaceship appearance is 2nd, wooden spoon appearance is 4th, otherwise 3rd"

    const spaceshipGame = results.find(g => g.round === 'Golden Spaceship');
    const spoonGame = results.find(g => g.round === 'Wooden Spoon');

    if (spaceshipGame) {
        if (spaceshipGame.result === 'W') {
            rank = '1st Place';
            accolade = 'Golden Spaceship Winner';
        } else {
            rank = '2nd Place';
            accolade = 'Runner Up';
        }
    } else if (spoonGame) {
        // In Teams.js backend logic: "If we LOST the spoon match, we are the Spoon Winner (Holder)."
        // Prompt says "Wooden Spoon holder" is 5th.
        if (spoonGame.result === 'L') {
            rank = '5th Place';
            accolade = 'Wooden Spoon Holder';
        } else {
            rank = '4th Place';
            accolade = 'Wooden Spoon Runner Up';
        }
    }

    return { regularWins, regularLosses, postseasonWins, postseasonLosses, rank, accolade };
});


const teamDisplayName = computed(() => {
  if (!seasonData.value?.team) return '';
  const team = seasonData.value.team;
  const format = team.display_format || '{city} {name}';
  return format.replace('{city}', team.city).replace('{name}', team.name);
});
</script>

<template>
    <div class="season-page-container" v-if="seasonData">
        <header class="page-header">
            <RouterLink :to="`/teams/${teamId}`" class="back-link">← Back to Team History</RouterLink>
            <div class="header-content" :style="{ borderLeft: `6px solid ${seasonData.team.primary_color}` }">
                <h1>{{ teamDisplayName }}</h1>
                <div class="season-meta">
                    <h2>{{ seasonData.season }} Season</h2>
                    <div class="season-rank">
                         <!-- Trophy Icons -->
                         <img v-if="seasonStats.accolade === 'Golden Spaceship Winner'" :src="`${apiUrl}/images/golden_spaceship.png`" class="trophy-icon" alt="Golden Spaceship" />
                         <img v-if="seasonStats.accolade === 'Wooden Spoon Holder'" :src="`${apiUrl}/images/wooden_spoon.png`" class="trophy-icon" alt="Wooden Spoon" />

                         <span class="rank-text">{{ seasonStats.rank }}</span>
                         <span class="record-text">
                             ({{ seasonStats.regularWins }}-{{ seasonStats.regularLosses }}<span v-if="seasonStats.postseasonWins > 0 || seasonStats.postseasonLosses > 0">, {{ seasonStats.postseasonWins }}-{{ seasonStats.postseasonLosses }}</span>)
                         </span>
                    </div>
                </div>
            </div>
        </header>

        <main class="season-main">
            <!-- ROSTER -->
            <section class="section roster-section">
                <h3>Roster</h3>
                <div class="roster-list">
                    <!-- Reusing RosterPlayerRow logic manually since the component might expect store data structures -->
                     <table class="roster-table">
                        <thead>
                            <tr>
                                <th>Pos</th>
                                <th>Player</th>
                                <th class="points-header">Points</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="player in displayRoster" :key="player.card_id" @click="openPlayerCard(player)" class="player-row">
                                <td class="pos-cell">
                                    {{ player.assignment === 'BENCH' ? 'B' : (player.assignment || player.position) }}
                                </td>
                                <td class="name-cell">{{ formatNameShort(player.displayName, true) }}</td>
                                <td class="points-cell">{{ player.points }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <!-- RESULTS -->
            <section class="section results-section">
                <h3>Season Results</h3>
                <div class="table-container">
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Opponent</th>
                                <th>Result</th>
                                <th>Score</th>
                                <th>Round</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(game, index) in seasonData.results" :key="index" :class="{'gold-bg': game.round === 'Golden Spaceship', 'brown-bg': game.round === 'Wooden Spoon'}">
                                <td>{{ new Date(game.date).toLocaleDateString() }}</td>
                                <td>{{ game.opponent }}</td>
                                <td :class="{'win': game.result === 'W', 'loss': game.result === 'L'}">{{ game.result }}</td>
                                <td>{{ game.score }}</td>
                                <td>{{ game.round }}</td>
                            </tr>
                            <tr v-if="seasonData.results.length === 0">
                                <td colspan="5" class="empty-msg">No results found for this season.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </main>

        <!-- Player Card Modal -->
        <div v-if="selectedPlayer" class="modal-overlay" @click.self="closePlayerCard">
            <div class="modal-content">
                <button class="close-btn" @click="closePlayerCard">×</button>
                <PlayerCard :player="selectedPlayer" />
            </div>
        </div>
    </div>
    <div v-else-if="loading" class="loading">Loading season data...</div>
    <div v-else class="error">Season not found.</div>
</template>

<style scoped>
.season-page-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1rem;
}
.back-link {
    display: inline-block;
    margin-bottom: 1rem;
    color: #666;
    text-decoration: none;
    font-weight: 500;
}
.back-link:hover { color: #000; }

.header-content {
    padding-left: 1rem;
    margin-bottom: 2rem;
}
.header-content h1 { margin: 0; font-size: 2rem; color: #333; }
.header-content h2 { margin: 0; font-size: 1.5rem; color: #777; font-weight: normal; }

.season-meta {
    display: flex;
    flex-direction: column;
}
.season-rank {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
}
.rank-text {
    font-size: 1.5rem;
    font-weight: bold;
    color: #333;
}
.record-text {
    font-size: 1.2rem;
    color: #666;
}
.trophy-icon {
    height: 40px;
    width: auto;
}

.season-main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
}

.section {
    background: #fff;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.section h3 {
    margin-top: 0;
    border-bottom: 2px solid #eee;
    padding-bottom: 0.5rem;
    margin-bottom: 1rem;
}

/* Roster Table */
.roster-table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
.roster-table th { text-align: left; padding: 0.5rem; background: #f8f9fa; }
.roster-table td { padding: 0.5rem; border-bottom: 1px solid #eee; }
.player-row { cursor: pointer; transition: background 0.2s; }
.player-row:hover { background: #e9ecef; }
.pos-cell { font-weight: bold; width: 50px; }
.points-cell { text-align: right; font-weight: bold; }
.points-header { text-align: right !important; }

/* Results Table */
.table-container { overflow-x: auto; }
.results-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.results-table th { text-align: left; padding: 0.5rem; background: #f8f9fa; }
.results-table td { padding: 0.5rem; border-bottom: 1px solid #eee; }
.win { color: green; font-weight: bold; }
.loss { color: red; font-weight: bold; }
.empty-msg { text-align: center; color: #999; padding: 2rem; }

/* HIGHLIGHTS */
.gold-bg {
    background-color: rgba(255, 215, 0, 0.15) !important;
}
.brown-bg {
    background-color: rgba(139, 69, 19, 0.1) !important;
}

/* Modal */
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

@media (max-width: 768px) {
    .season-main { grid-template-columns: 1fr; }
}
</style>
