<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useGameStore } from '@/stores/game';
import { cloneDeep } from 'lodash';

const gameStore = useGameStore();
const route = useRoute();
const gameId = route.params.id;

const stateJson = ref('');
const errorMessage = ref('');
const snapshotName = ref('');

// This function is called when the component is first loaded
// and anytime the game state changes from the store
function syncStateToUI() {
    if (gameStore.gameState) {
        // Create a comprehensive object for display
        const comprehensiveState = {
            currentPlay: cloneDeep(gameStore.currentPlay),
            // Raw state from the store
            gameState: cloneDeep(gameStore.gameState),
            lineups: cloneDeep(gameStore.lineups),
            rosters: cloneDeep(gameStore.rosters),
            teams: cloneDeep(gameStore.teams),
            batter: cloneDeep(gameStore.batter),
            pitcher: cloneDeep(gameStore.pitcher),
            // Important computed properties
            displayGameState: cloneDeep(gameStore.displayGameState),
            myTeam: cloneDeep(gameStore.myTeam),
            amIDefensivePlayer: cloneDeep(gameStore.amIDefensivePlayer),
            isBetweenHalfInnings: cloneDeep(gameStore.isBetweenHalfInnings),
            isEffectivelyBetweenHalfInnings: cloneDeep(gameStore.isEffectivelyBetweenHalfInnings),
            displayOuts: cloneDeep(gameStore.displayOuts),
            gameEventsToDisplay: cloneDeep(gameStore.gameEventsToDisplay),
        };

        // Use a replacer to handle potential circular references if any
        const replacer = (key, value) => {
            // Can add logic here to handle specific transformations if needed
            return value;
        };

        stateJson.value = JSON.stringify(comprehensiveState, replacer, 2);
        errorMessage.value = '';
    }
}

// Function to apply changes from the textarea to the game state
function handleSubmit() {
    try {
        const comprehensiveState = JSON.parse(stateJson.value);

        // IMPORTANT: Only send the gameState portion to the backend
        if (comprehensiveState.gameState) {
            gameStore.setGameState(gameId, comprehensiveState.gameState);
             if (comprehensiveState.hasOwnProperty('currentPlay')) {
                gameStore.currentPlay = cloneDeep(comprehensiveState.currentPlay);
            }
            errorMessage.value = '';
        } else {
            errorMessage.value = 'Error: The submitted JSON must have a "gameState" property.';
        }
    } catch (e) {
        errorMessage.value = `Error parsing JSON: ${e.message}`;
        console.error("Failed to parse and set game state:", e);
    }
}

function handleCreateSnapshot() {
    if (!snapshotName.value) {
        alert('Please enter a name for the snapshot.');
        return;
    }
    gameStore.createSnapshot(gameId, snapshotName.value);
    snapshotName.value = '';
}

// Watch for changes in the game state and update the textarea
watch(() => gameStore.gameState, (newState, oldState) => {
    // Only update if the new state is actually different
    if (JSON.stringify(newState) !== JSON.stringify(oldState)) {
        syncStateToUI();
    }
}, { deep: true });

// Fetch initial game data when the component mounts
onMounted(async () => {
    await gameStore.fetchGame(gameId);
    await gameStore.fetchSnapshots(gameId);
    // Once the game data is loaded, sync it to the UI
    syncStateToUI();
});

</script>

<template>
    <div class="dev-container">
        <h1>Game State Debugger</h1>

        <div class="snapshots-container">
            <h2>Game Snapshots</h2>
            <div class="snapshot-form">
                <input type="text" v-model="snapshotName" placeholder="Enter snapshot name" />
                <button @click="handleCreateSnapshot">Save Snapshot</button>
            </div>
            <ul class="snapshot-list">
                <li v-for="snapshot in gameStore.snapshots" :key="snapshot.snapshot_id">
                    <span>{{ snapshot.snapshot_name }} ({{ new Date(snapshot.created_at).toLocaleString() }})</span>
                    <div class="snapshot-actions">
                        <button @click="gameStore.restoreSnapshot(gameId, snapshot.snapshot_id)">Restore</button>
                        <button @click="gameStore.deleteSnapshot(gameId, snapshot.snapshot_id)">Delete</button>
                    </div>
                </li>
            </ul>
        </div>

        <h2>Live Game State</h2>
        <p>Modify the JSON below to set the game state. The game will update in real-time.</p>

        <textarea v-model="stateJson" class="json-editor"></textarea>

        <div v-if="errorMessage" class="error-message">
            {{ errorMessage }}
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
    .json-editor {
        width: 100%;
        height: 600px;
        font-family: 'Courier New', Courier, monospace;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 1rem;
        margin-bottom: 1rem;
    }
    button {
        padding: 0.5rem 1rem;
        font-size: 1rem;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    }
    .error-message {
        color: red;
        margin-bottom: 1rem;
        white-space: pre-wrap;
    }
    .snapshots-container {
        margin-bottom: 2rem;
        padding: 1rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }
    .snapshot-form {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
    }
    .snapshot-form input {
        flex-grow: 1;
        padding: 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }
    .snapshot-list {
        list-style: none;
        padding: 0;
    }
    .snapshot-list li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem;
        border-bottom: 1px solid #eee;
    }
    .snapshot-actions {
        display: flex;
        gap: 0.5rem;
    }
</style>
