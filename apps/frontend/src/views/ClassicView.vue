<script setup>
import { ref, onMounted, computed } from 'vue';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';

// Ensure apiUrl is an empty string if VITE_API_URL is not defined, to allow relative paths (proxied) to work.
const apiUrl = import.meta.env.VITE_API_URL || '';

const loading = ref(true);
const state = ref({
    seeding: [],
    series: [],
    revealed: false,
    rosters: [],
    readyCount: 0
});
const expandedRosterUserId = ref(null);
const selectedPlayer = ref(null);

// Bracket Computation
const bracket = computed(() => {
    if (!state.value.seeding || state.value.seeding.length < 5) return null;

    const seeds = state.value.seeding; // 0=5th seed, ... 4=1st seed.
    const seed5 = seeds[0];
    const seed4 = seeds[1];
    const seed3 = seeds[2];
    const seed2 = seeds[3];
    const seed1 = seeds[4];

    // Helper to find a series between two user IDs
    const findSeries = (uid1, uid2) => {
        if (!uid1 || !uid2) return null;
        return state.value.series.find(s =>
            (s.home_user_id === uid1 && s.away_user_id === uid2) ||
            (s.home_user_id === uid2 && s.away_user_id === uid1)
        );
    };

    // Helper to determine the winner of a series
    const getWinner = (series) => {
        if (!series || !series.winning_team_id) return null;
        return series.winning_team_id === series.home_team_id ? series.home_user_id : series.away_user_id;
    };

    // Helper to get team details by user ID
    const getTeam = (userId) => {
        const seedIndex = seeds.findIndex(s => s.user_id === userId);
        if (seedIndex !== -1) {
            // seeds array: 0=5th, 1=4th, 2=3rd, 3=2nd, 4=1st
            // So seed number is 5 - index.
            return { ...seeds[seedIndex], seed: 5 - seedIndex };
        }
        return { name: 'TBD', logo_url: '' };
    };

    // --- PLAY-IN (4 vs 5) ---
    const playInSeries = findSeries(seed4?.user_id, seed5?.user_id);
    const playInWinnerId = getWinner(playInSeries);
    const playInWinner = playInWinnerId ? getTeam(playInWinnerId) : null;

    // --- SEMI 1 (1 vs Winner of Play-In) ---
    const semi1Series = state.value.series.find(s =>
        (s.home_user_id === seed1?.user_id && s.away_user_id !== seed2?.user_id && s.away_user_id !== seed3?.user_id) ||
        (s.away_user_id === seed1?.user_id && s.home_user_id !== seed2?.user_id && s.home_user_id !== seed3?.user_id)
    );
    const semi1WinnerId = getWinner(semi1Series);
    const semi1Winner = semi1WinnerId ? getTeam(semi1WinnerId) : null;

    // --- SEMI 2 (2 vs 3) ---
    const semi2Series = findSeries(seed2?.user_id, seed3?.user_id);
    const semi2WinnerId = getWinner(semi2Series);
    const semi2Winner = semi2WinnerId ? getTeam(semi2WinnerId) : null;

    // --- FINAL (Winner Semi 1 vs Winner Semi 2) ---
    const finalSeries = state.value.series.find(s => s !== playInSeries && s !== semi1Series && s !== semi2Series);

    // Explicitly set seeds for TBD checks
    const t4 = { ...seed4, seed: 4 };
    const t5 = { ...seed5, seed: 5 };
    const t1 = { ...seed1, seed: 1 };
    const t2 = { ...seed2, seed: 2 };
    const t3 = { ...seed3, seed: 3 };

    return {
        seeds: { 1: t1, 2: t2, 3: t3, 4: t4, 5: t5 },
        matchups: {
            playIn: {
                team1: t4,
                team2: t5,
                series: playInSeries
            },
            semi1: {
                team1: t1,
                team2: playInWinner || { name: 'Winner 4/5' },
                series: semi1Series
            },
            semi2: {
                team1: t2,
                team2: t3,
                series: semi2Series
            },
            final: {
                team1: semi1Winner || { name: 'Winner Semi 1' },
                team2: semi2Winner || { name: 'Winner Semi 2' },
                series: finalSeries
            }
        }
    };
});

function toggleRoster(userId) {
    if (expandedRosterUserId.value === userId) {
        expandedRosterUserId.value = null;
    } else {
        expandedRosterUserId.value = userId;
    }
}

function openPlayerCard(player) {
    selectedPlayer.value = player;
}

function padRoster(roster) {
    const padded = [...roster];
    while (padded.length < 20) {
        padded.push({
            card_id: `empty-${padded.length}`,
            player_name: '',
            display_name: '',
            assignment: '',
            points: '',
            isEmpty: true
        });
    }
    return padded;
}

onMounted(async () => {
    try {
        const res = await apiClient('/api/classic/state');
        if (res.ok) {
            state.value = await res.json();
        }
    } catch (e) {
        console.error("Failed to load classic state", e);
    } finally {
        loading.value = false;
    }
});
</script>

<template>
    <div class="classic-container">
        <h1>Showdown Classic</h1>

        <div v-if="loading">Loading...</div>

        <div v-else>
            <!-- BRACKET -->
            <div class="section bracket-section" v-if="bracket">
                <h2>Tournament Bracket</h2>

                <div class="bracket-tree">
                    <!-- Column 1: Play-In -->
                    <div class="col col-playin">
                        <div class="matchup-box playin-box">
                            <div class="team-line border-bottom">
                                <span class="seed">5</span>
                                <span class="name">{{ bracket.matchups.playIn.team2.name }}</span>
                            </div>
                            <div class="matchup-score" v-if="bracket.matchups.playIn.series">
                                {{ bracket.matchups.playIn.series.score }}
                            </div>
                             <div class="team-line">
                                <span class="seed">4</span>
                                <span class="name">{{ bracket.matchups.playIn.team1.name }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Column 2: Semis -->
                    <div class="col col-semis">
                        <!-- Semi 1 (Top) -->
                        <div class="matchup-box semi-box semi-top">
                             <div class="team-line border-bottom">
                                <span class="seed">1</span>
                                <span class="name">{{ bracket.matchups.semi1.team1.name }}</span>
                            </div>
                            <div class="matchup-score" v-if="bracket.matchups.semi1.series">
                                {{ bracket.matchups.semi1.series.score }}
                            </div>
                             <div class="team-line">
                                <span class="seed">{{ bracket.matchups.semi1.team2.seed || '' }}</span>
                                <span class="name">{{ bracket.matchups.semi1.team2.name }}</span>
                            </div>
                        </div>

                        <!-- Semi 2 (Bottom) -->
                         <div class="matchup-box semi-box semi-bottom">
                             <div class="team-line border-bottom">
                                <span class="seed">3</span>
                                <span class="name">{{ bracket.matchups.semi2.team2.name }}</span>
                            </div>
                            <div class="matchup-score" v-if="bracket.matchups.semi2.series">
                                {{ bracket.matchups.semi2.series.score }}
                            </div>
                             <div class="team-line">
                                <span class="seed">2</span>
                                <span class="name">{{ bracket.matchups.semi2.team1.name }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Column 3: Final -->
                    <div class="col col-final">
                        <div class="matchup-box final-box">
                             <img :src="`${apiUrl}/images/silver_submarine.png`" class="trophy-img" alt="Trophy" />
                             <!-- Display Final Score/Teams if series exists -->
                             <div v-if="bracket.matchups.final.series" class="final-result">
                                 <strong>{{ bracket.matchups.final.team1.name }} vs {{ bracket.matchups.final.team2.name }}</strong>
                                 <div>{{ bracket.matchups.final.series.score }}</div>
                             </div>
                        </div>
                        <div class="final-label">AREA WINNER</div>
                    </div>
                </div>
            </div>

            <!-- ROSTERS -->
            <div class="section rosters-section">
                <h2>Classic Rosters</h2>
                <div v-if="!state.revealed" class="locked-message">
                    <p>Rosters are hidden until all 5 teams have submitted a valid Classic roster.</p>
                    <p>Current Status: <strong>{{ state.readyCount }} / 5</strong> Ready</p>
                </div>

                <div v-else class="roster-list">
                    <div v-for="team in state.rosters" :key="team.team" class="team-roster-card">
                        <div class="team-roster-header" @click="toggleRoster(team.team)">
                            <h3>{{ team.team }}</h3>
                            <span>{{ expandedRosterUserId === team.team ? '▲' : '▼' }}</span>
                        </div>
                        <div v-if="expandedRosterUserId === team.team" class="team-roster-content">
                            <table>
                                <thead>
                                    <tr><th>Pos</th><th>Player</th><th>Pts</th></tr>
                                </thead>
                                <tbody>
                                    <tr v-for="p in padRoster(team.players)" :key="p.card_id" @click="!p.isEmpty && openPlayerCard(p)" :class="{ 'empty-row': p.isEmpty }">
                                        <td>{{ p.assignment }}</td>
                                        <td>{{ p.display_name }}</td>
                                        <td>{{ p.points }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Player Card Modal -->
        <div v-if="selectedPlayer" class="modal-overlay" @click="selectedPlayer = null">
            <div class="modal-content" @click.stop>
                <button class="close-btn" @click="selectedPlayer = null">×</button>
                <PlayerCard :player="selectedPlayer" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.classic-container {
    max-width: 1000px;
    margin: 0 auto;
    padding: 2rem;
}
.section {
    margin-bottom: 2rem;
    background: #f8f9fa;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
h2 {
    margin-top: 0;
    border-bottom: 2px solid #ddd;
    padding-bottom: 0.5rem;
    margin-bottom: 1rem;
}

/* BRACKET TREE STYLES */
.bracket-tree {
    display: flex;
    justify-content: space-between;
    align-items: stretch; /* Align columns */
    padding: 2rem 0;
    overflow-x: auto;
}

.col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex: 1;
    position: relative;
    min-width: 200px;
}

.col-playin {
    justify-content: flex-start;
    padding-top: 50px; /* Align roughly with bottom of Semi 1 */
    margin-right: 2rem;
}

.col-semis {
    justify-content: space-around; /* Distribute Semi 1 and Semi 2 */
    gap: 4rem;
    margin-right: 2rem;
}

.col-final {
    justify-content: center;
    align-items: center;
}

.matchup-box {
    background: white;
    border: 2px solid #333;
    padding: 0;
    width: 100%;
    max-width: 250px;
    box-shadow: 2px 2px 5px rgba(0,0,0,0.1);
}

.team-line {
    display: flex;
    padding: 8px 12px;
}

.border-bottom {
    border-bottom: 1px solid #333;
}

.seed {
    font-weight: bold;
    margin-right: 8px;
    width: 15px;
}

.name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.matchup-score {
    text-align: center;
    font-size: 0.8em;
    color: #666;
    background: #f1f1f1;
    padding: 2px 0;
}

/* Special alignment for Play-in to look like it feeds 4/5 slot */
.col-playin {
    /* We want this centered vertically relative to the "Winner 4/5" slot of Semi 1 */
    /* This is hard to do perfectly with just flex without fixed heights. */
    /* We'll use absolute positioning logic or just margin/padding approximations. */
    /* Given the image: Play-in box is roughly aligned with the GAP between Semi 1 and Semi 2, but feeding Semi 1 bottom. */
    /* Actually in the image, Play-in is on the left. */
    justify-content: center;
    padding-bottom: 150px; /* Push it up slightly to align with Semi 1 bottom half */
}

/* Semi 1 Top */
.semi-top {
    margin-bottom: auto;
}
/* Semi 2 Bottom */
.semi-bottom {
    margin-top: auto;
}

.final-box {
    width: 200px;
    height: 150px;
    border: 3px solid #333; /* Thicker border */
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: #f0f0f0;
    position: relative;
}

.trophy-img {
    max-width: 80%;
    max-height: 80%;
    object-fit: contain;
}

.final-result {
    position: absolute;
    bottom: 5px;
    font-size: 0.8em;
    text-align: center;
    background: rgba(255,255,255,0.8);
    padding: 2px 5px;
    border-radius: 4px;
}

.final-label {
    margin-top: 1rem;
    font-weight: bold;
    font-size: 1.2rem;
    text-align: center;
}


/* CONNECTING LINES - SIMPLIFIED */
/* It's complex to draw exact connector lines without SVG or heavy CSS absolute positioning. */
/* We will use pseudo elements to suggest flow. */

/* Play-in connects to Semi 1 Bottom */
.playin-box::after {
    content: '';
    position: absolute;
    right: -2rem; /* Reach towards next col */
    top: 50%;
    width: 2rem;
    height: 2px;
    background: #333;
    display: none; /* Hidden for now unless we can target Semi 1 Bottom specifically */
}

/* Rosters Styles */
.locked-message {
    text-align: center;
    padding: 2rem;
    font-size: 1.2rem;
    color: #666;
    font-style: italic;
}
.team-roster-card {
    background: white;
    border: 1px solid #ddd;
    margin-bottom: 0.5rem;
    border-radius: 4px;
}
.team-roster-header {
    padding: 1rem;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #eee;
}
.team-roster-header:hover {
    background: #e2e6ea;
}
.team-roster-header h3 { margin: 0; }
.team-roster-content table {
    width: 100%;
    border-collapse: collapse;
}
.team-roster-content td, .team-roster-content th {
    padding: 0.5rem;
    border-bottom: 1px solid #eee;
    text-align: left;
}
.team-roster-content tr:hover {
    background-color: #f1f1f1;
    cursor: pointer;
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
</style>
