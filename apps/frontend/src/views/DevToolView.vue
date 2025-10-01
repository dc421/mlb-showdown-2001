<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useGameStore } from '@/stores/game';

const gameStore = useGameStore();
const route = useRoute();
const gameId = route.params.id;

// New simplified state for the dev tool
const outcome = ref('SINGLE'); // Default to a common outcome

const gameState = computed(() => gameStore.gameState);

// New handler to call the new backend endpoint
function handleApplyOutcome() {
    if (!outcome.value) {
        alert('Please enter an outcome.');
        return;
    }
    // We will add this function to the game store in the next step
    gameStore.applyDevOutcome(gameId, outcome.value);
}

onMounted(() => {
    // Fetch initial game data so we can see the state
    gameStore.fetchGame(gameId); 
});
</script>

<template>
    <div class="dev-container">
        <h1>Game Logic Debugger</h1>
        <p>Directly apply a game outcome to test the backend logic. The game will update in real-time.</p>

        <div class="form-group">
            <label>Outcome to Apply</label>
            <input type="text" v-model="outcome" placeholder="e.g., SINGLE, HR, SO, GB" />
        </div>

        <button @click="handleApplyOutcome">Apply Outcome</button>

        <div class="state-display" v-if="gameState">
            <h2>Current Game State</h2>
            <pre>{{ JSON.stringify(gameState, null, 2) }}</pre>
        </div>
        <div v-else>
            <p>Loading game state...</p>
        </div>
    </div>
</template>

<style scoped>
    .dev-container {
        max-width: 800px;
        margin: 2rem auto;
        padding: 2rem;
        font-family: sans-serif;
        background: #f0f0f0;
        border: 2px solid #ccc;
        border-radius: 8px;
    }
    .form-group {
        margin-bottom: 1.5rem;
    }
    label {
        font-weight: bold;
        margin-bottom: 0.5rem;
        display: block;
    }
    input {
        width: 100%;
        padding: 0.5rem;
        border-radius: 4px;
        border: 1px solid #ccc;
        box-sizing: border-box;
    }
    button {
        width: 100%;
        padding: 1rem;
        font-size: 1.2rem;
        background-color: #dc3545; /* A more "developery" color */
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        margin-bottom: 1.5rem;
    }
    .state-display {
        background-color: #282c34; /* Dark background for the JSON */
        color: #abb2bf; /* Light grey text */
        padding: 1rem;
        border-radius: 4px;
        overflow-x: auto; /* Allow horizontal scrolling if needed */
    }
    pre {
        white-space: pre-wrap; /* Wrap long lines */
        word-wrap: break-word;
    }
</style>