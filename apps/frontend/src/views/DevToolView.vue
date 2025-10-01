<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useGameStore } from '@/stores/game';

const gameStore = useGameStore();
const route = useRoute();
const gameId = route.params.id;
const awayBOP = ref(1); // Batting order is 1-indexed for the UI
const homeBOP = ref(1);

// Form state
const inning = ref(1);
const isTopInning = ref(true);
const outs = ref(0);
const homeScore = ref(0);
const awayScore = ref(0);
const runnerOnFirst = ref(null);
const runnerOnSecond = ref(null);
const runnerOnThird = ref(null);

const homeRoster = computed(() => gameStore.rosters.home || []);
const awayRoster = computed(() => gameStore.rosters.away || []);
const allGamePlayers = computed(() => [...homeRoster.value, ...awayRoster.value]);

function handleSubmit() {
    const partialState = {
        inning: Number(inning.value),
        isTopInning: isTopInning.value,
        outs: Number(outs.value),
        homeScore: Number(homeScore.value),
        awayScore: Number(awayScore.value),
        bases: {
            first: allGamePlayers.value.find(p => p.card_id === runnerOnFirst.value) || null,
            second: allGamePlayers.value.find(p => p.card_id === runnerOnSecond.value) || null,
            third: allGamePlayers.value.find(p => p.card_id === runnerOnThird.value) || null,
        },
        // Add these nested objects
        awayTeam: {
            battingOrderPosition: Number(awayBOP.value) - 1 // Convert from 1-indexed to 0-indexed
        },
        homeTeam: {
            battingOrderPosition: Number(homeBOP.value) - 1 // Convert from 1-indexed to 0-indexed
        }
    };
    gameStore.setGameState(gameId, partialState);
}

onMounted(() => {
    // Fetch roster data to populate runner dropdowns
    gameStore.fetchGame(gameId); 
});
</script>

<template>
    <div class="dev-container">
        <h1>Game State Debugger</h1>
        <p>Set a specific game situation to test logic. The game will update in real-time.</p>

        <div class="form-grid">
            <div class="form-group">
                <label>Inning</label>
                <input type="number" v-model="inning" min="1" />
            </div>
            <div class="form-group">
                <label>Outs</label>
                <input type="number" v-model="outs" min="0" max="2" />
            </div>
             <div class="form-group">
                <label>Top/Bottom</label>
                <select v-model="isTopInning">
                    <option :value="true">Top</option>
                    <option :value="false">Bottom</option>
                </select>
            </div>
            <div class="form-group">
                <label>Away Score</label>
                <input type="number" v-model="awayScore" min="0" />
            </div>
            <div class="form-group">
                <label>Home Score</label>
                <input type="number" v-model="homeScore" min="0" />
            </div>
        </div>

        <h3>Batting Order</h3>
        <div class="form-grid">
            <div class="form-group">
                <label>Away Team Batter #</label>
                <input type="number" v-model="awayBOP" min="1" max="9" />
            </div>
            <div class="form-group">
                <label>Home Team Batter #</label>
                <input type="number" v-model="homeBOP" min="1" max="9" />
            </div>
        </div>

        <h3>Baserunners</h3>
        <div class="form-grid">
            <div class="form-group">
                <label>Runner on 1st</label>
                <select v-model="runnerOnFirst">
                    <option :value="null">Empty</option>
                    <option v-for="player in allGamePlayers" :key="player.card_id" :value="player.card_id">
                        {{ player.displayName }}
                    </option>
                </select>
            </div>
             <div class="form-group">
                <label>Runner on 2nd</label>
                <select v-model="runnerOnSecond">
                    <option :value="null">Empty</option>
                    <option v-for="player in allGamePlayers" :key="player.card_id" :value="player.card_id">
                        {{ player.displayName }}
                    </option>
                </select>
            </div>
             <div class="form-group">
                <label>Runner on 3rd</label>
                <select v-model="runnerOnThird">
                    <option :value="null">Empty</option>
                    <option v-for="player in allGamePlayers" :key="player.card_id" :value="player.card_id">
                        {{ player.displayName }}
                    </option>
                </select>
            </div>
        </div>
        
        <button @click="handleSubmit">Set Game State</button>
    </div>
</template>

<style scoped>
    .dev-container {
        max-width: 800px;
        margin: 2rem auto;
        padding: 2rem;
        font-family: sans-serif;
        background: #fff8e1;
        border: 2px solid #ffecb3;
        border-radius: 8px;
    }
    .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    .form-group {
        display: flex;
        flex-direction: column;
    }
    label {
        font-weight: bold;
        margin-bottom: 0.5rem;
    }
    input, select {
        padding: 0.5rem;
        border-radius: 4px;
        border: 1px solid #ccc;
    }
    button {
        width: 100%;
        padding: 1rem;
        font-size: 1.2rem;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    }
</style>
