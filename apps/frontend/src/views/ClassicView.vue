<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';
import { sortRoster } from '@/utils/playerUtils';

const apiUrl = import.meta.env.VITE_API_URL || '';

const loading = ref(true);
const classicsList = ref([]);
const selectedClassicId = ref(null);

const state = ref({
    classic: null,
    seeding: [],
    series: [],
    revealed: false,
    rosters: [],
    readyCount: 0
});
const selectedPlayer = ref(null);

// Bracket Computation
const bracket = computed(() => {
    if (!state.value.seeding || state.value.seeding.length < 5) return null;

    const seeds = state.value.seeding;
    const seed5 = seeds[0];
    const seed4 = seeds[1];
    const seed3 = seeds[2];
    const seed2 = seeds[3];
    const seed1 = seeds[4];

    const findSeries = (uid1, uid2) => {
        if (!uid1 || !uid2) return null;
        return state.value.series.find(s =>
            (s.home_user_id === uid1 && s.away_user_id === uid2) ||
            (s.home_user_id === uid2 && s.away_user_id === uid1)
        );
    };

    const getTeam = (userId) => {
        const seedIndex = seeds.findIndex(s => s.user_id === userId);
        if (seedIndex !== -1) {
            return { ...seeds[seedIndex], seed: 5 - seedIndex };
        }
        return { name: 'TBD', city: 'TBD', logo_url: '' };
    };

    const getWinner = (series) => {
        if (!series) return null;
        const homeWins = parseInt(series.score.split('-')[0] || 0);
        const awayWins = parseInt(series.score.split('-')[1] || 0);
        if (homeWins === 4) return series.home_user_id;
        if (awayWins === 4) return series.away_user_id;
        return null;
    };

    const playInSeries = findSeries(seed4?.user_id, seed5?.user_id);
    const playInWinnerId = getWinner(playInSeries);
    const playInWinner = playInWinnerId ? getTeam(playInWinnerId) : null;

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

    const semi2Series = findSeries(seed2?.user_id, seed3?.user_id);
    const semi2WinnerId = getWinner(semi2Series);
    const semi2Winner = semi2WinnerId ? getTeam(semi2WinnerId) : null;

    const finalSeries = state.value.series.find(s =>
        s !== playInSeries && s !== semi1Series && s !== semi2Series && s.status !== 'pending'
    );
    const finalWinnerId = getWinner(finalSeries);
    const finalWinner = finalWinnerId ? getTeam(finalWinnerId) : null;

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

const getWins = (series, teamId) => {
    if (!series || !teamId) return '';
    const homeWins = parseInt(series.score.split('-')[0] || 0);
    const awayWins = parseInt(series.score.split('-')[1] || 0);
    if (series.home_user_id === teamId) return homeWins;
    if (series.away_user_id === teamId) return awayWins;
    return '';
};

const sortedRosters = computed(() => {
    if (!state.value.rosters) return [];
    return [...state.value.rosters].sort((a, b) => (a.team || '').localeCompare(b.team || ''));
});

// Manual Result Entry State
const resultModalOpen = ref(false);
const activeMatchup = ref(null);
const resultForm = ref({
    winnerId: null,
    winningScore: 4,
    losingScore: 0
});

function openResultModal(matchup, roundName) {
    if (state.value.classic && !state.value.classic.is_active) return; // Read-only for past classics
    activeMatchup.value = { ...matchup, roundName };
    resultForm.value = {
        winnerId: matchup.team1.user_id, // Default to Team 1
        winningScore: 4,
        losingScore: 0
    };
    resultModalOpen.value = true;
}

async function submitResult() {
    if (!activeMatchup.value || !resultForm.value.winnerId) return;

    const winnerId = resultForm.value.winnerId;
    const team1Id = activeMatchup.value.team1.user_id;
    const team2Id = activeMatchup.value.team2.user_id;
    const loserId = winnerId === team1Id ? team2Id : team1Id;

    const payload = {
        winnerId,
        loserId,
        winningScore: resultForm.value.winningScore,
        losingScore: resultForm.value.losingScore,
        round: activeMatchup.value.roundName
    };

    try {
        const res = await apiClient('/api/classic/result', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            resultModalOpen.value = false;
            // Reload state
            loadState();
        } else {
            alert("Failed to submit result.");
        }
    } catch (e) {
        console.error(e);
        alert("Error submitting result.");
    }
}

function openPlayerCard(player) {
    selectedPlayer.value = player;
}

function getTeamTotalPoints(roster) {
    return roster.reduce((sum, player) => {
        let pts = player.points || 0;
        // Divide by 5 for bench players (consistent with backend check)
        // Assignment might be 'BENCH' or 'PITCHING_STAFF' (if bullpen)
        // Check if assignment is explicitly bench or if control is null (hitter) on bench
        if (player.assignment === 'BENCH') {
             pts = Math.round(pts / 5);
        }
        return sum + pts;
    }, 0);
}

function padRoster(roster) {
    const padded = [...roster];

    // Identify missing positions
    const counts = {
        'C': 0, '1B': 0, '2B': 0, 'SS': 0, '3B': 0,
        'LF': 0, 'CF': 0, 'RF': 0, 'DH': 0,
        'SP': 0, 'RP': 0
    };

    padded.forEach(p => {
        // Use assignment if available, fallback to displayPosition or raw position
        // Backend now returns p.position and p.ip
        let pos = p.assignment;

        // Display Logic
        p.displayPoints = p.points;
        if (p.assignment === 'BENCH') {
            p.displayPosition = 'B';
            if (p.points) p.displayPoints = Math.round(p.points / 5);
        } else if (p.assignment === 'PITCHING_STAFF') {
            // Use backend derived position if available, else derive
             if (p.position === 'SP' || (p.ip && Number(p.ip) > 3)) p.displayPosition = 'SP';
             else p.displayPosition = 'RP';
        } else {
            p.displayPosition = p.assignment;
        }

        // If assignment is "PITCHING_STAFF" or generic, we try to deduce from raw position/stats
        // But for Classic, users assign "SP", "RP", "C", etc directly usually.
        // However, if assignment is missing or weird, we fallback.
        if (p.assignment === 'PITCHING_STAFF' || !p.assignment) {
             if (p.ip && Number(p.ip) > 3) pos = 'SP';
             else if (p.ip) pos = 'RP';
             else pos = p.position;
        }

        // Normalize position string for counting
        if (pos) {
            // Handle multi-positions like "LF/RF" if they exist, but usually assignment is specific
            if (pos === 'SP' || (p.assignment === 'SP')) counts['SP']++;
            else if (pos === 'RP' || (p.assignment === 'RP')) counts['RP']++;
            else if (counts[pos] !== undefined) counts[pos]++;
            // If the user assigned 'LF' to a 'LF-RF' player, assignment is 'LF', so counts['LF']++
        }
    });

    const missing = [];
    ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'].forEach(pos => {
        if (counts[pos] === 0) missing.push(pos);
    });
    for (let i = 0; i < (4 - counts['SP']); i++) missing.push('SP');

    while (padded.length < 20) {
        const nextMissing = missing.shift() || 'B';
        padded.push({
            card_id: `empty-${padded.length}`,
            player_name: '',
            display_name: '',
            assignment: nextMissing,
            displayPosition: nextMissing === 'BENCH' ? 'B' : nextMissing,
            points: '',
            displayPoints: '',
            isEmpty: true
        });
    }

    return sortRoster(padded);
}

function getTeamDetails(userId) {
    if (!state.value.seeding) return {};
    const seed = state.value.seeding.find(s => s.user_id === userId);
    return seed || {};
}

async function loadClassicsList() {
    try {
        const res = await apiClient('/api/classic/list');
        if (res.ok) {
            classicsList.value = await res.json();
        }
    } catch (e) {
        console.error("Failed to load classics list", e);
    }
}

async function loadState() {
    loading.value = true;
    try {
        let url = '/api/classic/state';
        if (selectedClassicId.value) {
            url += `?classicId=${selectedClassicId.value}`;
        }
        const res = await apiClient(url);
        if (res.ok) {
            state.value = await res.json();

            // Sync selection if not set (initial load)
            if (state.value.classic && selectedClassicId.value !== state.value.classic.id) {
                 selectedClassicId.value = state.value.classic.id;
            }
        }
    } catch (e) {
        console.error("Failed to load classic state", e);
    } finally {
        loading.value = false;
    }
}

watch(selectedClassicId, (newId, oldId) => {
    // If the new ID matches what's already in state (from initial load), don't reload.
    if (state.value.classic && newId === state.value.classic.id) {
        return;
    }
    if (newId && newId !== oldId) {
        loadState();
    }
});

onMounted(async () => {
    await loadClassicsList();
    await loadState();
});
</script>

<template>
    <div class="classic-container">
        <div class="header-section">
            <div class="title-row">
                <h1>Showdown Classic</h1>
                <div class="classic-selector" v-if="classicsList.length > 0">
                    <select v-model="selectedClassicId">
                        <option v-for="c in classicsList" :key="c.id" :value="c.id">
                            {{ c.name }}
                        </option>
                    </select>
                </div>
            </div>
            <div v-if="state.classic" class="classic-description">
                <p>{{ state.classic.description }}</p>
            </div>
        </div>

        <div v-if="loading">Loading...</div>

        <div v-else>
            <!-- ABSOLUTE POSITIONED BRACKET WITH EXPLICIT LINES -->
            <div class="section bracket-section" v-if="bracket">
                <div class="bracket-container">

                    <!-- TROPHY -->
                    <div class="trophy-container" style="top: 170px; left: 600px;">
                         <img :src="`${apiUrl}/images/silver_submarine.png`" class="trophy-img" alt="Classic Champions" />
                    </div>

                    <!--
                        COORDINATE SYSTEM:
                        Play-In: Top Line 210, Bottom Line 270. Midpoint 240. (Left 0-200)
                        Semi 1:  Top Line 160, Bottom Line 240. Midpoint 200. (Left 250-450)
                        Semi 2:  Top Line 360, Bottom Line 440. Midpoint 400. (Left 250-450)
                        Finals:  Top Line 200, Bottom Line 400. Midpoint 300. (Left 500-700)
                        Champ:   Line 300. (Left 750-950)
                    -->

                    <!-- PLAY-IN (4 vs 5) -->
                    <!-- Top Team -->
                    <div class="text-container" style="top: 50px; left: 0px;">
                        <span class="seed">4</span>
                        <img v-if="bracket.seeds[4].logo_url" :src="bracket.seeds[4].logo_url" class="team-logo" />
                        <span class="name">{{ bracket.seeds[4].city }}</span>
                        <span v-if="bracket.matchups.playIn.series" class="score">
                            {{ getWins(bracket.matchups.playIn.series, bracket.matchups.playIn.team1.user_id) }}
                        </span>
                    </div>
                    <div class="bracket-line" style="top: 80px; left: 0px; width: 200px;"></div>


                    <!-- Bottom Team -->
                    <div class="text-container" style="top: 110px; left: 0px;">
                        <span class="seed">5</span>
                        <img v-if="bracket.seeds[5].logo_url" :src="bracket.seeds[5].logo_url" class="team-logo" />
                        <span class="name">{{ bracket.seeds[5].city }}</span>
                        <span v-if="bracket.matchups.playIn.series" class="score">
                            {{ getWins(bracket.matchups.playIn.series, bracket.matchups.playIn.team2.user_id) }}
                        </span>
                    </div>
                    <div class="bracket-line" style="top: 140px; left: 0px; width: 200px;"></div>

                    <!-- Connector (210 to 270) -->
                    <div class="connector-vertical" style="top: 80px; left: 200px; height: 60px;"></div>
                    <!-- Horizontal Arm (at 240) -->
                    <div class="connector-arm" style="top: 110px; left: 200px; width: 50px;"></div>

                    <!-- Plus Button (Left of connector) -->
                    <button class="enter-result-btn" style="top: 110px; left: 175px;"
                        v-if="!bracket.matchups.playIn.series && bracket.matchups.playIn.team1.user_id && bracket.matchups.playIn.team2.user_id && state.classic && state.classic.is_active"
                        @click="openResultModal(bracket.matchups.playIn, 'Play-In')">
                        +
                    </button>


                    <!-- SEMI 1 (1 vs Winner 4/5) -->
                    <!-- Top Team -->
                    <div class="text-container" style="top: 0px; left: 250px;">
                        <span class="seed">1</span>
                        <img v-if="bracket.seeds[1].logo_url" :src="bracket.seeds[1].logo_url" class="team-logo" />
                        <span class="name">{{ bracket.seeds[1].city }}</span>
                        <span v-if="bracket.matchups.semi1.series" class="score">
                            {{ getWins(bracket.matchups.semi1.series, bracket.matchups.semi1.team1.user_id) }}
                        </span>
                    </div>
                    <div class="bracket-line" style="top: 30px; left: 250px; width: 200px;"></div>

                    <!-- Bottom Team (Winner Play-In) -->
                    <div class="text-container" style="top: 80px; left: 250px;">
                         <span class="seed" v-if="!bracket.matchups.semi1.team2.isPlaceholder && bracket.matchups.semi1.team2.seed">{{ bracket.matchups.semi1.team2.seed }}</span>
                        <img v-if="!bracket.matchups.semi1.team2.isPlaceholder && bracket.matchups.semi1.team2.logo_url" :src="bracket.matchups.semi1.team2.logo_url" class="team-logo" />
                        <span class="name" v-if="!bracket.matchups.semi1.team2.isPlaceholder">{{ bracket.matchups.semi1.team2.city }}</span>
                        <span v-if="bracket.matchups.semi1.series" class="score">
                            {{ getWins(bracket.matchups.semi1.series, bracket.matchups.semi1.team2.user_id) }}
                        </span>
                    </div>
                    <!-- This line connects to Play-In output at 240 -->
                    <div class="bracket-line" style="top: 110px; left: 250px; width: 200px;"></div>

                    <!-- Connector (160 to 240) -->
                    <div class="connector-vertical" style="top: 30px; left: 450px; height: 80px;"></div>
                    <!-- Horizontal Arm (at 200) -->
                    <div class="connector-arm" style="top: 70px; left: 450px; width: 50px;"></div>

                    <!-- Plus Button (Left of connector) -->
                    <button class="enter-result-btn" style="top: 70px; left: 425px;"
                        v-if="!bracket.matchups.semi1.series && bracket.matchups.semi1.team1.user_id && bracket.matchups.semi1.team2.user_id && state.classic && state.classic.is_active"
                        @click="openResultModal(bracket.matchups.semi1, 'Semi-Final')">
                        +
                    </button>


                    <!-- SEMI 2 (2 vs 3) -->
                    <!-- Top Team -->
                    <div class="text-container" style="top: 200px; left: 250px;">
                        <span class="seed">2</span>
                        <img v-if="bracket.seeds[2].logo_url" :src="bracket.seeds[2].logo_url" class="team-logo" />
                        <span class="name">{{ bracket.seeds[2].city }}</span>
                        <span v-if="bracket.matchups.semi2.series" class="score">
                            {{ getWins(bracket.matchups.semi2.series, bracket.matchups.semi2.team1.user_id) }}
                        </span>
                    </div>
                    <div class="bracket-line" style="top: 230px; left: 250px; width: 200px;"></div>

                    <!-- Bottom Team -->
                    <div class="text-container" style="top: 280px; left: 250px;">
                        <span class="seed">3</span>
                        <img v-if="bracket.seeds[3].logo_url" :src="bracket.seeds[3].logo_url" class="team-logo" />
                        <span class="name">{{ bracket.seeds[3].city }}</span>
                        <span v-if="bracket.matchups.semi2.series" class="score">
                            {{ getWins(bracket.matchups.semi2.series, bracket.matchups.semi2.team2.user_id) }}
                        </span>
                    </div>
                    <div class="bracket-line" style="top: 310px; left: 250px; width: 200px;"></div>

                    <!-- Connector (360 to 440) -->
                    <div class="connector-vertical" style="top: 230px; left: 450px; height: 80px;"></div>
                    <!-- Horizontal Arm (at 400) -->
                    <div class="connector-arm" style="top: 270px; left: 450px; width: 50px;"></div>

                    <!-- Plus Button (Left of connector) -->
                    <button class="enter-result-btn" style="top: 270px; left: 425px;"
                        v-if="!bracket.matchups.semi2.series && bracket.matchups.semi2.team1.user_id && bracket.matchups.semi2.team2.user_id && state.classic && state.classic.is_active"
                        @click="openResultModal(bracket.matchups.semi2, 'Semi-Final')">
                        +
                    </button>


                    <!-- FINALS -->
                    <!-- Top Team (Winner Semi 1) -->
                    <div class="text-container" style="top: 40px; left: 500px;">
                         <img v-if="!bracket.matchups.final.team1.isPlaceholder && bracket.matchups.final.team1.logo_url" :src="bracket.matchups.final.team1.logo_url" class="team-logo" />
                        <span class="name" v-if="!bracket.matchups.final.team1.isPlaceholder">{{ bracket.matchups.final.team1.city }}</span>
                        <span v-if="bracket.matchups.final.series" class="score">
                            {{ getWins(bracket.matchups.final.series, bracket.matchups.final.team1.user_id) }}
                        </span>
                    </div>
                    <!-- Connects to Semi 1 output at 200 -->
                    <div class="bracket-line" style="top: 70px; left: 500px; width: 200px;"></div>

                    <!-- Bottom Team (Winner Semi 2) -->
                    <div class="text-container" style="top: 240px; left: 500px;">
                         <img v-if="!bracket.matchups.final.team2.isPlaceholder && bracket.matchups.final.team2.logo_url" :src="bracket.matchups.final.team2.logo_url" class="team-logo" />
                        <span class="name" v-if="!bracket.matchups.final.team2.isPlaceholder">{{ bracket.matchups.final.team2.city }}</span>
                        <span v-if="bracket.matchups.final.series" class="score">
                            {{ getWins(bracket.matchups.final.series, bracket.matchups.final.team2.user_id) }}
                        </span>
                    </div>
                    <!-- Connects to Semi 2 output at 400 -->
                    <div class="bracket-line" style="top: 270px; left: 500px; width: 200px;"></div>

                    <!-- Connector (200 to 400) -->
                    <div class="connector-vertical" style="top: 70px; left: 700px; height: 200px;"></div>
                    <!-- Horizontal Arm (at 300) -->
                    <div class="connector-arm" style="top: 170px; left: 700px; width: 50px;"></div>

                    <!-- Plus Button (Left of connector) -->
                     <button class="enter-result-btn" style="top: 170px; left: 675px;"
                        v-if="!bracket.matchups.final.series && bracket.matchups.final.team1.user_id && bracket.matchups.final.team2.user_id && state.classic && state.classic.is_active"
                        @click="openResultModal(bracket.matchups.final, 'Silver Submarine')">
                        +
                    </button>


                    <!-- CHAMPION -->
                    <div class="text-container text-centered" style="top: 140px; left: 725px; width: 200px;">
                        <img v-if="bracket.matchups.final.winner && bracket.matchups.final.winner.logo_url" :src="bracket.matchups.final.winner.logo_url" class="team-logo" />
                        <span class="name" v-if="bracket.matchups.final.winner">{{ bracket.matchups.final.winner.city }}</span>
                        <span class="name" v-else></span>
                    </div>
                    <!-- Connects to Finals output at 300 -->
                    <div class="bracket-line" style="top: 170px; left: 750px; width: 200px;"></div>

                </div>
            </div>

            <!-- ROSTERS -->
            <div class="section rosters-section">
                <h2>Classic Rosters</h2>
                <div v-if="!state.revealed" class="locked-message">
                    <p>Rosters are hidden until you submit your roster.</p>
                    <p>Current Status: <strong>{{ state.readyCount }} / 5</strong> Ready</p>
                </div>

                <div v-else class="teams-list">
                    <div v-for="roster in sortedRosters" :key="roster.user_id" class="team-block">
                        <div class="team-header">
                            <img v-if="getTeamDetails(roster.user_id).logo_url" :src="getTeamDetails(roster.user_id).logo_url" class="team-logo-roster" />
                            <div class="team-info">
                                <h2>{{ roster.team }}</h2>
                            </div>
                        </div>

                        <div class="roster-table-container">
                            <table class="roster-table">
                                <thead>
                                    <tr>
                                        <th class="header-pos">Pos</th>
                                        <th class="header-player">Player</th>
                                        <th class="header-points">Points</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="p in padRoster(roster.players)" :key="p.card_id" @click="!p.isEmpty && openPlayerCard(p)" class="player-row" :class="{ 'empty-row': p.isEmpty }">
                                        <td class="pos-cell">{{ p.displayPosition }}</td>
                                        <td class="name-cell">{{ p.display_name }}</td>
                                        <td class="points-cell">{{ p.displayPoints }}</td>
                                    </tr>
                                </tbody>
                                <tfoot>
                                    <tr class="total-row">
                                        <td colspan="2" class="total-label">Total</td>
                                        <td class="total-points">{{ getTeamTotalPoints(roster.players) }}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Result Entry Modal -->
        <div v-if="resultModalOpen" class="modal-overlay" @click="resultModalOpen = false">
            <div class="modal-content result-modal" @click.stop>
                <button class="close-btn" @click="resultModalOpen = false">×</button>
                <h2>Enter Result: {{ activeMatchup.roundName }}</h2>

                <div class="result-form">
                    <div class="team-option">
                        <label>
                            <input type="radio" v-model="resultForm.winnerId" :value="activeMatchup.team1.user_id">
                            <span class="team-name-radio">{{ activeMatchup.team1.city }}</span>
                        </label>
                    </div>
                    <div class="vs">vs</div>
                    <div class="team-option">
                        <label>
                            <input type="radio" v-model="resultForm.winnerId" :value="activeMatchup.team2.user_id">
                             <span class="team-name-radio">{{ activeMatchup.team2.city }}</span>
                        </label>
                    </div>

                    <div class="score-inputs">
                        <div class="score-group">
                            <label>Wins</label>
                            <input type="number" v-model="resultForm.winningScore" min="1" max="4">
                        </div>
                         <div class="score-group">
                            <label>Losses</label>
                            <input type="number" v-model="resultForm.losingScore" min="0" max="3">
                        </div>
                    </div>

                    <button class="submit-btn" @click="submitResult">Submit</button>
                </div>
            </div>
        </div>

        <!-- Player Card Modal -->
        <div v-if="selectedPlayer" class="modal-overlay" @click="selectedPlayer = null">
            <div class="modal-content player-card-content" @click.stop>
                <button class="close-btn" @click="selectedPlayer = null">×</button>
                <PlayerCard :player="selectedPlayer" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.player-card-content {
    background: transparent !important;
    padding: 0 !important;
    box-shadow: none !important;
}
.player-card-content .close-btn {
    color: white;
    top: -40px;
    right: 0;
}

.header-section {
    display: flex;
    flex-direction: column;
    margin-bottom: 20px;
}
.title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.classic-selector select {
    font-size: 1.2rem;
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid #ccc;
}
.classic-description {
    margin-top: 0px;
    font-style: italic;
    color: #666;
    background: #f9f9f9;
    padding: 10px;
    border-radius: 4px;
}

.enter-result-btn {
    position: absolute;
    transform: translate(-50%, -50%);
    background: #007bff;
    color: white;
    border: none;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    font-size: 14px;
    line-height: 20px;
    text-align: center;
    cursor: pointer;
    z-index: 10;
}
.enter-result-btn:hover {
    background: #0056b3;
}

.score {
    margin-left: auto;
    margin-right: 5px;
    flex-shrink: 0;
    font-size: 1.2rem;
    color: #d61c0f;
}

.result-modal {
    width: 400px;
    padding: 30px;
    text-align: center;
}
.result-form {
    display: flex;
    flex-direction: column;
    gap: 15px;
    margin-top: 20px;
}
.team-option {
    font-size: 1.2em;
    font-weight: bold;
}
.team-name-radio {
    margin-left: 8px;
}
.score-inputs {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-top: 10px;
}
.score-group {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.score-group input {
    width: 50px;
    text-align: center;
    padding: 5px;
    font-size: 1.1em;
}
.submit-btn {
    background: #28a745;
    color: white;
    padding: 10px;
    border: none;
    border-radius: 4px;
    font-size: 1.1em;
    cursor: pointer;
    margin-top: 10px;
}
.submit-btn:hover {
    background: #218838;
}

.classic-container {
    max-width: 100%;
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

.bracket-section {
    overflow-x: auto;
}

/* --- FIXED LAYOUT BRACKET --- */
.bracket-container {
    position: relative;
    width: 1000px;
    height: 320px;
    margin: 0 auto;
    overflow: hidden;
    /* Ensure border-box for precise pixel math */
    box-sizing: border-box;
}
.bracket-container * {
    box-sizing: border-box;
}

/* Text Containers */
.text-container {
    position: absolute;
    width: 200px;
    height: 30px;
    display: flex;
    align-items: flex-end;
    font-size: 1.1em;
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    padding-bottom: 2px; /* Slight padding off the line */
}
.text-centered {
    justify-content: center;
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

.name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* --- BRACKET LINES --- */
.bracket-line {
    position: absolute;
    height: 2px;
    background: #000;
}

/* Vertical Connectors */
.connector-vertical {
    position: absolute;
    width: 2px;
    background: #000;
}

/* Horizontal Arms (Output from connector) */
.connector-arm {
    position: absolute;
    height: 2px;
    background: #000;
}

/* --- TROPHY --- */
.trophy-container {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 100px;
    height: 100px;
    z-index: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
}
.trophy-img {
    max-width: 100%;
    max-height: 100%;
}

/* --- SCORE LABELS --- */
.score-label {
    position: absolute;
    right: 5px; /* Sit near the end of the arm */
    top: 50%;
    transform: translateY(-50%);
    background: #fff;
    padding: 2px 4px;
    font-size: 0.8em;
    font-weight: bold;
    z-index: 2;
    border: 1px solid #eee;
}


/* --- ROSTER STYLES (Teams List / Grid) --- */
.rosters-section {
    margin-top: 0px;
}
.locked-message {
    text-align: center;
    font-style: italic;
    color: #666;
    padding: 20px;
    background: #f9f9f9;
    border-radius: 8px;
}

.teams-list {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    margin-top: 2rem;
    overflow-x: auto;
}

.team-block {
    background: #f9f9f9;
    border-radius: 8px;
    padding: 0.5rem;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    min-width: 0;
}

.team-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    margin-bottom: 0rem;
    flex-direction: column;
    text-align: center;
    background: transparent;
    cursor: default;
    justify-content: flex-start;
}

.team-logo-roster {
    width: 40px;
    height: 40px;
    object-fit: contain;
    background: white;
    padding: 2px;
    border-radius: 20%;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.team-info h2 {
    margin: 0;
    font-size: 1rem;
    line-height: 1.2;
}

.roster-table-container {
    overflow-x: hidden;
}

.roster-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
}

.roster-table th {
    text-align: left;
    padding: 0.25rem;
    background: #e9ecef;
    color: #495057;
    font-weight: 600;
}

.header-points {
    text-align: right !important;
}

.roster-table td {
    padding: 0.15rem 0.25rem;
    border-bottom: 1px solid #dee2e6;
}

.player-row {
    cursor: pointer;
    transition: background-color 0.2s;
}

.player-row:hover {
    background-color: #e2e6ea;
}

.name-cell {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 0;
    width: 100%;
}

.points-cell {
    font-weight: bold;
    color: #000000;
    text-align: right;
    width: 30px;
    min-width: 30px;
    white-space: nowrap;
}

/* Footer Styles */
.total-row td {
    border-top: 2px solid #aaa;
    padding: 0.25rem 0.25rem;
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

/* --- MODAL --- */
.modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}
.modal-content {
    background: white;
    padding: 20px;
    border-radius: 8px;
    position: relative;
    max-width: 90%;
    max-height: 90vh;
    overflow-y: auto;
}
.close-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
}
</style>
