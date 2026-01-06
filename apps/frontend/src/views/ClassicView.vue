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

    const seeds = state.value.seeding; // 0=Seed 5 (Newest), ... 4=Seed 1 (Oldest)
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

    // Helper to get team details by user ID
    const getTeam = (userId) => {
        const seedIndex = seeds.findIndex(s => s.user_id === userId);
        if (seedIndex !== -1) {
            // seeds array: 0=5th, 1=4th, 2=3rd, 3=2nd, 4=1st
            return { ...seeds[seedIndex], seed: 5 - seedIndex };
        }
        return { name: 'TBD', logo_url: '' };
    };

    // Helper to determine the winner of a series
    const getWinner = (series) => {
        if (!series) return null;
        const homeWins = parseInt(series.score.split('-')[0] || 0);
        const awayWins = parseInt(series.score.split('-')[1] || 0);
        if (homeWins === 4) return series.home_user_id;
        if (awayWins === 4) return series.away_user_id;
        return null;
    };


    // --- PLAY-IN (4 vs 5) ---
    const playInSeries = findSeries(seed4?.user_id, seed5?.user_id);
    const playInWinnerId = getWinner(playInSeries);
    const playInWinner = playInWinnerId ? getTeam(playInWinnerId) : null;

    // --- SEMI 1 (1 vs Winner of Play-In) ---
    let semi1OpponentId = playInWinnerId;
    let semi1Series = null;
    if (semi1OpponentId) {
        semi1Series = findSeries(seed1?.user_id, semi1OpponentId);
    } else {
        const s4 = findSeries(seed1?.user_id, seed4?.user_id);
        const s5 = findSeries(seed1?.user_id, seed5?.user_id);
        semi1Series = s4 || s5;
    }

    const semi1WinnerId = getWinner(semi1Series);
    const semi1Winner = semi1WinnerId ? getTeam(semi1WinnerId) : null;

    // --- SEMI 2 (2 vs 3) ---
    const semi2Series = findSeries(seed2?.user_id, seed3?.user_id);
    const semi2WinnerId = getWinner(semi2Series);
    const semi2Winner = semi2WinnerId ? getTeam(semi2WinnerId) : null;

    // --- FINAL (Winner Semi 1 vs Winner Semi 2) ---
    const finalSeries = state.value.series.find(s =>
        s !== playInSeries && s !== semi1Series && s !== semi2Series && s.status !== 'pending'
    );
    const finalWinnerId = getWinner(finalSeries);
    const finalWinner = finalWinnerId ? getTeam(finalWinnerId) : null;

    // Explicitly set seeds for display
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
                series: finalSeries,
                winner: finalWinner
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
            <!-- TREE BRACKET -->
            <div class="section bracket-section" v-if="bracket">
                <!-- Left Column: Matchups -->
                <div class="bracket-tree">

                    <!-- LEFT COLUMN -->
                    <div class="left-column">

                        <!-- Top Group: Seed 1 & 4/5 Matchup -->
                        <div class="bracket-group top-group">
                            <!-- Seed 1 Line -->
                            <div class="matchup-row seed-1-row">
                                <div class="team-box-single">
                                    <span class="seed">1</span>
                                    <span class="name">{{ bracket.seeds[1].name }}</span>
                                </div>
                                <div class="connector-elbow-down"></div>
                            </div>

                            <!-- 4 vs 5 Bracket -->
                            <div class="matchup-row seed-45-row">
                                <div class="mini-bracket-wrapper">
                                    <div class="team-box-pair top-team">
                                        <span class="seed">4</span>
                                        <span class="name">{{ bracket.seeds[4].name }}</span>
                                    </div>
                                    <div class="bracket-connector-45">
                                        <div class="score-label" v-if="bracket.matchups.playIn.series">
                                            {{ bracket.matchups.playIn.series.score }}
                                        </div>
                                    </div>
                                    <div class="team-box-pair bottom-team">
                                        <span class="seed">5</span>
                                        <span class="name">{{ bracket.seeds[5].name }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Semi 1 Score Label (Between 1 and 4/5) -->
                         <div class="semi1-score" v-if="bracket.matchups.semi1.series">
                            {{ bracket.matchups.semi1.series.score }}
                        </div>

                        <!-- Bottom Group: Seed 2 & 3 Matchup -->
                        <div class="bracket-group bottom-group">
                            <div class="mini-bracket-wrapper standard-bracket">
                                <div class="team-box-pair top-team">
                                    <span class="seed">2</span>
                                    <span class="name">{{ bracket.seeds[2].name }}</span>
                                </div>
                                <div class="bracket-connector-23">
                                     <div class="score-label" v-if="bracket.matchups.semi2.series">
                                        {{ bracket.matchups.semi2.series.score }}
                                    </div>
                                </div>
                                <div class="team-box-pair bottom-team">
                                    <span class="seed">3</span>
                                    <span class="name">{{ bracket.seeds[3].name }}</span>
                                </div>
                            </div>
                        </div>

                    </div>

                    <!-- CENTER COLUMN: Trophy & Finals Connectors -->
                    <div class="center-column">
                         <div class="trophy-box">
                             <img :src="`${apiUrl}/images/silver_submarine.png`" class="trophy-img" alt="Showdown Classic Champions" />
                        </div>
                    </div>

                    <!-- RIGHT COLUMN: Winner -->
                    <div class="right-column">
                        <div class="winner-line">
                            <span class="winner-label">Winner</span>
                            <div class="winner-box">
                                <div class="winner-name" v-if="bracket.matchups.final.winner">
                                    {{ bracket.matchups.final.winner.name }}
                                </div>
                                <div class="winner-score" v-if="bracket.matchups.final.series">
                                    {{ bracket.matchups.final.series.score }}
                                </div>
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
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem;
}
.section {
    margin-bottom: 2rem;
    background: #fff;
    padding: 1.5rem;
}
h2 {
    margin-top: 0;
    border-bottom: 2px solid #ddd;
    padding-bottom: 0.5rem;
    margin-bottom: 1rem;
}

/* --- BRACKET STYLES --- */
.bracket-tree {
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
    padding: 20px 0;
    height: 700px;
}

.left-column {
    position: relative;
    height: 100%;
    width: 350px;
}

/* Common Box Styles */
.team-box-single, .team-box-pair {
    width: 250px;
    height: 40px;
    background: #f4f6f9;
    border-bottom: 2px solid #000;
    display: flex;
    align-items: center;
    padding-left: 10px;
    font-family: serif;
    position: relative;
    z-index: 2;
}
.seed {
    font-weight: bold;
    margin-right: 10px;
    width: 20px;
}
.name {
    font-weight: bold;
    font-size: 1.1em;
}

/* POSITIONING */

/* Seed 1 (Top Left) */
.seed-1-row {
    position: absolute;
    top: 50px;
    left: 0;
}
/* Seed 1 Connector: Goes Right then Down */
.connector-elbow-down {
    position: absolute;
    left: 250px;
    top: 40px;
    width: 30px;
    height: 70px;
    border-top: 2px solid #000;
    border-right: 2px solid #000;
}

/* Seed 4 & 5 (Middle Left) */
.seed-45-row {
    position: absolute;
    top: 220px;
    left: 0;
}
.mini-bracket-wrapper {
    position: relative;
}
.team-box-pair.top-team {
    margin-bottom: 40px;
}
.team-box-pair.bottom-team {
    margin-top: 0;
}
/* Bracket Connector for 4/5 */
.bracket-connector-45 {
    position: absolute;
    left: 250px;
    top: 40px;
    height: 40px;
    width: 30px;
    border-right: 2px solid #000;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
}

/* Joiner Line for Semi 1 (Meeting point of 1 and 4/5) */
.seed-45-row::after {
    content: '';
    position: absolute;
    left: 280px;
    top: -100px; /* Meeting point Y=160. 4/5 center is 260. 260-100=160. */
    height: 140px; /* From 160 down to 300? No. */
    /* Seed 1 ends at Y=160 (50+40+70). */
    /* 4/5 Center is Y=260 (220+40). */
    /* We need line from 260 UP to 160. Height 100. */
    top: -60px; /* relative to 220... wait. */
    /* Row is at 220. Box is 40. Center is 40. */
    /* 220+40 = 260. */
    /* Y=160 is 220-60. */
    /* So top: -60px. Height: 100px. */
    border-left: 2px solid #000;
    height: 100px;
}

/* Semi 1 Score Label */
.semi1-score {
    position: absolute;
    left: 290px;
    top: 150px; /* Near the connector meeting point */
    font-size: 0.8em;
    font-weight: bold;
}

/* Seed 2 & 3 (Bottom Left) */
.bottom-group {
    position: absolute;
    top: 500px;
    left: 0;
}
.bracket-connector-23 {
    position: absolute;
    left: 250px;
    top: 40px;
    height: 40px;
    width: 30px;
    border-right: 2px solid #000;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
}
/* 2/3 Output Line */
.bottom-group::after {
    content: '';
    position: absolute;
    left: 280px;
    top: 60px;
    width: 40px;
    height: 2px;
    background: #000;
}

/* CENTER COLUMN */
.center-column {
    flex: 1;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
}
.trophy-box {
    width: 300px;
    height: 300px;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid #eee;
}
.trophy-img {
    max-width: 100%;
}

/* Connectors to Final */
/* Top Half (1 vs 4/5) Result */
.left-column::after {
    content: '';
    position: absolute;
    left: 280px;
    top: 160px;
    width: 100px;
    height: 2px;
    background: #000;
}
/* Bottom Half (2 vs 3) Result */
.left-column::before {
    content: '';
    position: absolute;
    left: 280px;
    top: 560px;
    width: 100px;
    height: 2px;
    background: #000;
}

.right-column {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 250px;
    position: relative;
}
/* Final Bracket Joiner */
.right-column::before {
    content: '';
    position: absolute;
    left: -20px;
    top: 160px;
    bottom: 140px;
    width: 2px;
    background: #000;
}
/* Winner Line */
.winner-line {
    margin-left: 20px;
    text-align: center;
}
.winner-label {
    font-weight: bold;
    font-size: 1.5em;
    font-family: serif;
    display: block;
    margin-bottom: 10px;
    border-bottom: 2px solid #000;
}
.winner-name {
    font-weight: bold;
    font-size: 1.2em;
}
.winner-score {
    font-size: 0.9em;
    color: #666;
}

.score-label {
    position: absolute;
    right: -30px;
    top: 10px;
    font-size: 0.8em;
    font-weight: bold;
}

</style>
