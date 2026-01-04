<script setup>
import { ref, onMounted, computed } from 'vue';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';

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
    // We need to map the series data to bracket slots.
    // Slots:
    // - PlayIn (4v5)
    // - Semi1 (1 vs Winner of PlayIn)
    // - Semi2 (2 vs 3)
    // - Final

    // We need to identify series based on participants and round/notes logic.
    // Assuming backend returns enough info or we infer it.
    // For this iteration, we might just list the games or try to deduce positions.
    // Given the constraints, let's look for matching User IDs from the seeding.

    if (!state.value.seeding || state.value.seeding.length < 5) return null;

    const seeds = state.value.seeding; // 0=5th seed, 1=4th, 2=3rd, 3=2nd, 4=1st (Wait, sorting is typically 1-5)
    // Seeding array from backend is "ordered 5th seed to 1st seed (based on spoon recency)" - Wait, checking backend comments.
    // "Most recent loser is Seed 5".
    // So seeding[0] is #5, seeding[1] is #4, ... seeding[4] is #1.

    const seed5 = seeds[0];
    const seed4 = seeds[1];
    const seed3 = seeds[2];
    const seed2 = seeds[3];
    const seed1 = seeds[4];

    const findSeries = (uid1, uid2) => {
        return state.value.series.find(s =>
            (s.home_user_id === uid1 && s.away_user_id === uid2) ||
            (s.home_user_id === uid2 && s.away_user_id === uid1)
        );
    };

    const playIn = findSeries(seed4?.user_id, seed5?.user_id);
    // Winner of playIn plays Seed 1.
    // We don't know the winner ID easily without parsing score, but we can look for series involving Seed 1.
    const semi1 = state.value.series.find(s =>
        (s.home_user_id === seed1?.user_id && s.away_user_id !== seed2?.user_id && s.away_user_id !== seed3?.user_id) ||
        (s.away_user_id === seed1?.user_id && s.home_user_id !== seed2?.user_id && s.home_user_id !== seed3?.user_id)
    );
    const semi2 = findSeries(seed2?.user_id, seed3?.user_id);

    // Final involves survivors. Usually hard to pinpoint without exact winner logic,
    // but it's the series that isn't one of the above.
    const final = state.value.series.find(s => s !== playIn && s !== semi1 && s !== semi2);

    return {
        seeds: { 1: seed1, 2: seed2, 3: seed3, 4: seed4, 5: seed5 },
        matchups: {
            playIn: { label: 'Play-In (4 v 5)', series: playIn, p1: seed4, p2: seed5 },
            semi1: { label: 'Semifinal (1 v 4/5)', series: semi1, p1: seed1, p2: null }, // p2 is undetermined purely from seeding
            semi2: { label: 'Semifinal (2 v 3)', series: semi2, p1: seed2, p2: seed3 },
            final: { label: 'Championship', series: final }
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
            <!-- SEEDING -->
            <div class="section seeding-section">
                <h2>Seeding (Wooden Spoon History)</h2>
                <ul>
                    <li v-for="(seed, index) in state.seeding" :key="seed.team_id">
                        <strong>#{{ 5 - index }}</strong>: {{ seed.name }}
                        <span class="subtext">(Last Spoon: {{ new Date(seed.lastSpoonDate).toLocaleDateString() }})</span>
                    </li>
                </ul>
            </div>

            <!-- BRACKET -->
            <div class="section bracket-section" v-if="bracket">
                <h2>Tournament Bracket</h2>
                <div class="bracket-grid">
                    <div class="matchup">
                        <h3>{{ bracket.matchups.playIn.label }}</h3>
                        <div class="team">{{ bracket.seeds[4]?.name || 'Seed 4' }}</div>
                        <div class="team">{{ bracket.seeds[5]?.name || 'Seed 5' }}</div>
                        <div class="result" v-if="bracket.matchups.playIn.series">
                            Result: {{ bracket.matchups.playIn.series.score }}
                            ({{ bracket.matchups.playIn.series.home_user_id === bracket.matchups.playIn.series.winning_team_id ? bracket.matchups.playIn.series.home : bracket.matchups.playIn.series.away }} wins)
                        </div>
                    </div>

                    <div class="matchup">
                        <h3>{{ bracket.matchups.semi1.label }}</h3>
                        <div class="team">{{ bracket.seeds[1]?.name || 'Seed 1' }}</div>
                        <div class="team">Winner of Play-In</div>
                        <div class="result" v-if="bracket.matchups.semi1.series">
                            Result: {{ bracket.matchups.semi1.series.score }}
                        </div>
                    </div>

                    <div class="matchup">
                        <h3>{{ bracket.matchups.semi2.label }}</h3>
                        <div class="team">{{ bracket.seeds[2]?.name || 'Seed 2' }}</div>
                        <div class="team">{{ bracket.seeds[3]?.name || 'Seed 3' }}</div>
                        <div class="result" v-if="bracket.matchups.semi2.series">
                            Result: {{ bracket.matchups.semi2.series.score }}
                        </div>
                    </div>

                    <div class="matchup final">
                        <h3>{{ bracket.matchups.final.label }}</h3>
                        <div class="team">Winner Semi 1</div>
                        <div class="team">Winner Semi 2</div>
                        <div class="result" v-if="bracket.matchups.final.series">
                            Result: {{ bracket.matchups.final.series.score }}
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
}
.matchup h3 { margin-top: 0; font-size: 1rem; color: #555; }
.matchup .team { font-weight: bold; margin: 0.25rem 0; }
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
