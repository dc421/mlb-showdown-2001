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
        return { name: 'TBD', city: 'TBD', logo_url: '' };
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
                team2: playInWinner || { isPlaceholder: true },
                series: semi1Series
            },
            semi2: {
                team1: t2,
                team2: t3,
                series: semi2Series
            },
            final: {
                team1: semi1Winner || { isPlaceholder: true },
                team2: semi2Winner || { isPlaceholder: true },
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
            <!-- NEW 4-COLUMN BRACKET -->
            <div class="section bracket-section" v-if="bracket">
                <div class="bracket-container">

                    <!-- COLUMN 1: Play-In (4 vs 5) -->
                    <div class="bracket-column col-playin">
                        <div class="matchup-wrapper centered-matchup">
                            <div class="team-line top-team">
                                <span class="seed">4</span>
                                <img v-if="bracket.seeds[4].logo_url" :src="bracket.seeds[4].logo_url" class="team-logo" />
                                <span class="name">{{ bracket.seeds[4].city }}</span>
                            </div>
                            <div class="team-line bottom-team">
                                <span class="seed">5</span>
                                <img v-if="bracket.seeds[5].logo_url" :src="bracket.seeds[5].logo_url" class="team-logo" />
                                <span class="name">{{ bracket.seeds[5].city }}</span>
                            </div>
                            <!-- Connector -->
                            <div class="bracket-connector">
                                <div class="score-label" v-if="bracket.matchups.playIn.series">
                                    {{ bracket.matchups.playIn.series.score }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- COLUMN 2: Semifinals -->
                    <div class="bracket-column col-semis">
                        <!-- Top Semi: Seed 1 vs Winner 4/5 -->
                        <div class="matchup-wrapper top-semi">
                            <div class="team-line top-team">
                                <span class="seed">1</span>
                                <img v-if="bracket.seeds[1].logo_url" :src="bracket.seeds[1].logo_url" class="team-logo" />
                                <span class="name">{{ bracket.seeds[1].city }}</span>
                            </div>
                            <div class="team-line bottom-team placeholder-line">
                                <span class="seed" v-if="!bracket.matchups.semi1.team2.isPlaceholder && bracket.matchups.semi1.team2.seed">{{ bracket.matchups.semi1.team2.seed }}</span>
                                <img v-if="!bracket.matchups.semi1.team2.isPlaceholder && bracket.matchups.semi1.team2.logo_url" :src="bracket.matchups.semi1.team2.logo_url" class="team-logo" />
                                <span class="name" v-if="!bracket.matchups.semi1.team2.isPlaceholder">{{ bracket.matchups.semi1.team2.city }}</span>
                            </div>
                            <!-- Connector -->
                            <div class="bracket-connector">
                                 <div class="score-label" v-if="bracket.matchups.semi1.series">
                                    {{ bracket.matchups.semi1.series.score }}
                                </div>
                            </div>
                        </div>

                        <!-- Bottom Semi: Seed 2 vs Seed 3 -->
                        <div class="matchup-wrapper bottom-semi">
                            <div class="team-line top-team">
                                <span class="seed">2</span>
                                <img v-if="bracket.seeds[2].logo_url" :src="bracket.seeds[2].logo_url" class="team-logo" />
                                <span class="name">{{ bracket.seeds[2].city }}</span>
                            </div>
                            <div class="team-line bottom-team">
                                <span class="seed">3</span>
                                <img v-if="bracket.seeds[3].logo_url" :src="bracket.seeds[3].logo_url" class="team-logo" />
                                <span class="name">{{ bracket.seeds[3].city }}</span>
                            </div>
                            <!-- Connector -->
                            <div class="bracket-connector">
                                <div class="score-label" v-if="bracket.matchups.semi2.series">
                                    {{ bracket.matchups.semi2.series.score }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- COLUMN 3: Finals -->
                    <div class="bracket-column col-finals">
                        <!-- Trophy Background -->
                         <div class="trophy-container">
                             <img :src="`${apiUrl}/images/silver_submarine.png`" class="trophy-img" alt="Classic Champions" />
                        </div>

                        <div class="matchup-wrapper centered-matchup finals-matchup">
                            <div class="team-line top-team">
                                <img v-if="!bracket.matchups.final.team1.isPlaceholder && bracket.matchups.final.team1.logo_url" :src="bracket.matchups.final.team1.logo_url" class="team-logo" />
                                <span class="name" v-if="!bracket.matchups.final.team1.isPlaceholder">{{ bracket.matchups.final.team1.city }}</span>
                            </div>
                            <div class="team-line bottom-team">
                                <img v-if="!bracket.matchups.final.team2.isPlaceholder && bracket.matchups.final.team2.logo_url" :src="bracket.matchups.final.team2.logo_url" class="team-logo" />
                                <span class="name" v-if="!bracket.matchups.final.team2.isPlaceholder">{{ bracket.matchups.final.team2.city }}</span>
                            </div>
                            <!-- Connector -->
                            <div class="bracket-connector">
                                <div class="score-label" v-if="bracket.matchups.final.series">
                                    {{ bracket.matchups.final.series.score }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- COLUMN 4: Champion -->
                    <div class="bracket-column col-champ">
                        <div class="matchup-wrapper centered-matchup champ-wrapper">
                            <div class="team-line champ-line">
                                <img v-if="bracket.matchups.final.winner && bracket.matchups.final.winner.logo_url" :src="bracket.matchups.final.winner.logo_url" class="team-logo" />
                                <span class="name" v-if="bracket.matchups.final.winner">{{ bracket.matchups.final.winner.city }}</span>
                                <span class="name" v-else></span>
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
    max-width: 1200px;
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

/* --- FLEX BRACKET LAYOUT --- */
.bracket-container {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: stretch;
    min-height: 500px;
    padding: 20px 0;
}

.bracket-column {
    display: flex;
    flex-direction: column;
    position: relative;
    width: 25%;
    justify-content: flex-start; /* Reset flex spacing */
}

/* Alignments */
.col-playin {
    padding-top: 75px;
}
.col-semis .top-semi {
    margin-top: 50px;
}
.col-semis .bottom-semi {
    margin-top: 100px; /* Gap between top and bottom */
}
.col-finals {
    padding-top: 75px;
}
.col-champ {
    justify-content: center;
}


/* --- MATCHUP WRAPPERS & LINES --- */
.matchup-wrapper {
    position: relative;
    width: 220px; /* Increased slightly for logos */
    margin: 0 auto;
}

.team-line {
    border-bottom: 2px solid #000;
    padding-bottom: 2px;
    margin-bottom: 20px;
    height: 30px;
    display: flex;
    align-items: flex-end;
    font-size: 1.1em;
    font-weight: bold;
    position: relative;
    white-space: nowrap;
}
.team-line.bottom-team {
    margin-bottom: 0;
}

.team-logo {
    height: 25px;
    width: auto;
    margin-right: 8px;
    margin-bottom: 2px;
}

.seed {
    margin-right: 8px;
    font-size: 0.9em;
}

/* Placeholder line (for the empty slot where 4/5 winner goes) */
.placeholder-line {
    border-bottom: 2px solid #000; /* Keep the line visible so it connects */
}


/* --- BRACKET CONNECTORS --- */
/* The "Fork" connecting two teams to the next round */
.bracket-connector {
    position: absolute;
    right: -20px; /* Extend to the right */
    top: 30px; /* Start at the bottom of the top team line */
    bottom: 0; /* End at the bottom of the bottom team line */
    width: 20px;
    border-right: 2px solid #000;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
}

.matchup-wrapper .bracket-connector {
    top: 30px; /* Matches height of .team-line */
    height: 50px; /* 20px margin + 30px height of next line */
    bottom: auto;
}
/* Horizontal line extending from the connector to the next column */
.bracket-connector::after {
    content: '';
    position: absolute;
    right: -20px; /* Extend further right */
    top: 50%;
    width: 20px;
    height: 2px;
    background: #000;
}

/* Finals Column Styles */
.col-finals .matchup-wrapper {
    /* Special final wrapper */
}
.col-finals .team-line.top-team {
    margin-bottom: 150px; /* Big gap for trophy */
}
.col-finals .bracket-connector {
    /* Stretch connector */
    height: 180px; /* 150 gap + 30 next line */
    /* top: 30px is default */
}
.col-finals .bracket-connector::after {
    /* Horizontal line position. Midpoint of 210 height (30+150+30) is 105.
       Connector starts at 30. Diff is 75.
       75 / 180 = 41.666%
    */
    top: 41.7%;
}

/* Champ Column Connector (none needed on right) */
.col-champ .bracket-connector {
    display: none;
}
.champ-line {
    margin-bottom: 0;
    justify-content: center;
}


/* --- TROPHY --- */
.trophy-container {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 250px;
    height: 250px;
    z-index: 0; /* Behind text */
    opacity: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
}
/* Center trophy inside the final matchup gap specifically? */
/* The .trophy-container is in col-finals.
   We want it vertically aligned with the gap.
   The gap center is at Y = 75 (padding) + 30 (top line) + 75 (half gap) = 180px from top of column?
   Let's check alignment.
   Col Finals padding-top: 75px.
   Top Line ends at 75 + 30 = 105px.
   Gap is 150px. Center of gap is 105 + 75 = 180px.
   Trophy container is absolute centered in col-finals (height of col is 100%?).
   Actually bracket-column height is 100% of flex container.
   If flex container min-height is 500px, top: 50% is 250px.
   180 vs 250.
   Better to put trophy inside the finals matchup-wrapper.
*/
.trophy-container {
    top: 50%;
    left: 50%;
    /* But relative to what? .col-finals is relative. */
    /* If we move it into .matchup-wrapper, it works better. */
    /* Let's try that next time if needed, but for now CSS in file stays as previous unless I change HTML. */
    /* I kept it in col-finals in HTML. */
    /* Let's adjust top to align with the gap visually. */
    /* Top line is at 75px. Gap center is 180px. */
    top: 180px;
    transform: translate(-50%, -50%);
}

.trophy-img {
    max-width: 100%;
    max-height: 100%;
}
/* Ensure text sits above trophy */
.col-finals .matchup-wrapper {
    z-index: 1;
}

/* --- SCORE LABELS --- */
.score-label {
    position: absolute;
    right: -40px; /* Beyond the horizontal extension */
    top: 50%;
    transform: translateY(-50%);
    background: #fff;
    padding: 2px 4px;
    font-size: 0.8em;
    font-weight: bold;
    z-index: 2;
}

</style>
