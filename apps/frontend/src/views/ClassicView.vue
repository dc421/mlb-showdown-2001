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
        const seed = seeds.find(s => s.user_id === userId);
        if (seed) return seed; // Return the seeding object which contains name, logo etc. (assuming seeding has it)
        // If not found in seeding (unlikely for classic participants), look in rosters/participants
        // For now, rely on seeding array having team info.
        return { name: 'TBD', logo_url: '' };
    };

    // --- PLAY-IN (4 vs 5) ---
    const playInSeries = findSeries(seed4?.user_id, seed5?.user_id);
    const playInWinnerId = getWinner(playInSeries);
    const playInWinner = playInWinnerId ? getTeam(playInWinnerId) : null;

    // --- SEMI 1 (1 vs Winner of Play-In) ---
    // If playInWinner is known, we look for series between Seed 1 and that winner.
    // If not known yet, we can't find the series definitively by ID pair unless created ahead of time.
    // We search for a series involving Seed 1 that ISN'T against Seed 2 or 3.
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
    // The final is the series that isn't any of the others.
    const finalSeries = state.value.series.find(s => s !== playInSeries && s !== semi1Series && s !== semi2Series);

    return {
        seeds: { 1: seed1, 2: seed2, 3: seed3, 4: seed4, 5: seed5 },
        matchups: {
            playIn: {
                label: 'Play-In (4 v 5)',
                series: playInSeries,
                team1: seed4,
                team2: seed5,
                winner: playInWinner
            },
            semi1: {
                label: 'Semifinal (1 v 4/5)',
                series: semi1Series,
                team1: seed1,
                team2: playInWinner || { name: 'Winner Play-In' }, // Dynamic placeholder
                winner: semi1Winner
            },
            semi2: {
                label: 'Semifinal (2 v 3)',
                series: semi2Series,
                team1: seed2,
                team2: seed3,
                winner: semi2Winner
            },
            final: {
                label: 'Championship',
                series: finalSeries,
                team1: semi1Winner || { name: 'Winner Semi 1' },
                team2: semi2Winner || { name: 'Winner Semi 2' }
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
                <div class="bracket-grid">
                    <!-- Play-In -->
                    <div class="matchup">
                        <h3>{{ bracket.matchups.playIn.label }}</h3>
                        <div class="team-entry">
                            <img v-if="bracket.matchups.playIn.team1.logo_url" :src="bracket.matchups.playIn.team1.logo_url" class="team-logo-tiny" />
                            <span class="team-name">{{ bracket.matchups.playIn.team1.name }}</span>
                        </div>
                        <div class="team-entry">
                            <img v-if="bracket.matchups.playIn.team2.logo_url" :src="bracket.matchups.playIn.team2.logo_url" class="team-logo-tiny" />
                            <span class="team-name">{{ bracket.matchups.playIn.team2.name }}</span>
                        </div>
                        <div class="result" v-if="bracket.matchups.playIn.series">
                            Result: {{ bracket.matchups.playIn.series.score }}
                        </div>
                    </div>

                    <!-- Semi 1 -->
                    <div class="matchup">
                        <h3>{{ bracket.matchups.semi1.label }}</h3>
                        <div class="team-entry">
                            <img v-if="bracket.matchups.semi1.team1.logo_url" :src="bracket.matchups.semi1.team1.logo_url" class="team-logo-tiny" />
                            <span class="team-name">{{ bracket.matchups.semi1.team1.name }}</span>
                        </div>
                        <div class="team-entry">
                            <img v-if="bracket.matchups.semi1.team2.logo_url" :src="bracket.matchups.semi1.team2.logo_url" class="team-logo-tiny" />
                            <span class="team-name">{{ bracket.matchups.semi1.team2.name }}</span>
                        </div>
                        <div class="result" v-if="bracket.matchups.semi1.series">
                            Result: {{ bracket.matchups.semi1.series.score }}
                        </div>
                    </div>

                    <!-- Semi 2 -->
                    <div class="matchup">
                        <h3>{{ bracket.matchups.semi2.label }}</h3>
                        <div class="team-entry">
                            <img v-if="bracket.matchups.semi2.team1.logo_url" :src="bracket.matchups.semi2.team1.logo_url" class="team-logo-tiny" />
                            <span class="team-name">{{ bracket.matchups.semi2.team1.name }}</span>
                        </div>
                        <div class="team-entry">
                            <img v-if="bracket.matchups.semi2.team2.logo_url" :src="bracket.matchups.semi2.team2.logo_url" class="team-logo-tiny" />
                            <span class="team-name">{{ bracket.matchups.semi2.team2.name }}</span>
                        </div>
                        <div class="result" v-if="bracket.matchups.semi2.series">
                            Result: {{ bracket.matchups.semi2.series.score }}
                        </div>
                    </div>

                    <!-- Final -->
                    <div class="matchup final">
                        <img :src="`${apiUrl}/images/silver_submarine.png`" class="trophy-bg" alt="Trophy" />
                        <div class="matchup-content">
                            <h3>{{ bracket.matchups.final.label }}</h3>
                            <div class="team-entry">
                                <img v-if="bracket.matchups.final.team1.logo_url" :src="bracket.matchups.final.team1.logo_url" class="team-logo-tiny" />
                                <span class="team-name">{{ bracket.matchups.final.team1.name }}</span>
                            </div>
                            <div class="team-entry">
                                <img v-if="bracket.matchups.final.team2.logo_url" :src="bracket.matchups.final.team2.logo_url" class="team-logo-tiny" />
                                <span class="team-name">{{ bracket.matchups.final.team2.name }}</span>
                            </div>
                            <div class="result" v-if="bracket.matchups.final.series">
                                Result: {{ bracket.matchups.final.series.score }}
                            </div>
                        </div>
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
                                    <tr v-for="p in team.players" :key="p.card_id" @click="openPlayerCard(p)">
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
.subtext {
    font-size: 0.85em;
    color: #666;
    margin-left: 0.5rem;
}
.bracket-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
}
.matchup {
    background: white;
    padding: 1rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    position: relative; /* Context for trophy positioning */
    overflow: hidden; /* Keep trophy inside */
}
.matchup h3 { margin-top: 0; font-size: 1rem; color: #555; }
.matchup .result {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed #ccc;
    color: #28a745;
    font-weight: bold;
}
.final {
    border-color: #ffd700;
    background-color: #fff9db;
    min-height: 120px; /* Ensure enough height for trophy */
    display: flex;
    align-items: center;
    justify-content: center;
}
.final .matchup-content {
    position: relative;
    z-index: 2; /* Text above trophy */
    width: 100%;
}

.trophy-bg {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 60%; /* Adjust size as needed */
    height: auto;
    opacity: 0.2; /* Watermark effect */
    z-index: 1; /* Behind text */
    pointer-events: none;
}

.team-entry {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.25rem 0;
}
.team-logo-tiny {
    width: 24px;
    height: 24px;
    object-fit: contain;
}
.team-name {
    font-weight: bold;
}

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
