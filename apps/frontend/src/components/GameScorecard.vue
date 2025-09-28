<script setup>
import { computed } from 'vue';
import OutsDisplay from './OutsDisplay.vue';

const props = defineProps({
  game: {
    type: Object,
    required: true,
  },
});

const gameState = computed(() => props.game.gameState);
const awayTeamAbbr = computed(() => props.game.away_team?.abbreviation || 'AWAY');
const homeTeamAbbr = computed(() => props.game.home_team?.abbreviation || 'HOME');

const inningDescription = computed(() => {
  if (!gameState.value) return '';
  const inningHalf = gameState.value.isTopInning ? '▲' : '▼';
  const inningNumber = gameState.value.inning;
  return `${inningNumber}${inningHalf}`;
});

const runnersOnBaseText = computed(() => {
    if (!gameState.value || !gameState.value.bases) return '';
    const bases = gameState.value.bases;
    const runners = [];
    if (bases.first) runners.push('1st');
    if (bases.second) runners.push('2nd');
    if (bases.third) runners.push('3rd');

    if (runners.length === 0) return 'bases empty';
    if (runners.length === 3) return 'bases loaded';

    if (runners.length === 1) {
        return `runner on ${runners[0]}`;
    }

    if (runners.length === 2) {
        return `runners on ${runners[0]} & ${runners[1]}`;
    }
    return ''; // Should not be reached
});
</script>

<template>
  <div class="game-scorecard">
    <div class="opponent-info">
      <span v-if="game.opponent">vs. {{ game.opponent.full_display_name }}</span>
      <span v-else>Waiting for opponent...</span>
    </div>

    <div v-if="game.status === 'in_progress' && gameState" class="game-details">
      <div class="score-inning">
        <div class="score">
          <span>{{ awayTeamAbbr }}: {{ gameState.awayScore }}</span>
          <span>{{ homeTeamAbbr }}: {{ gameState.homeScore }}</span>
        </div>
        <div class="inning">{{ inningDescription }}</div>
      </div>
      <div class="game-state">
        <div class="runners">{{ runnersOnBaseText }}</div>
        <OutsDisplay :outs="gameState.outs" :labelColor="'black'" />
      </div>
    </div>
    <div v-else class="game-status">
       <span class="status">{{ game.status }}</span>
    </div>
  </div>
</template>

<style scoped>
.game-scorecard {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
}

.opponent-info {
  font-weight: bold;
}

.game-details {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.score-inning {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.score {
  display: flex;
  gap: 1rem;
  font-size: 0.9rem;
}

.inning {
  font-size: 0.9rem;
}

.game-state {
  display: flex;
  flex-direction: column; /* Changed to stack runners and outs */
  align-items: flex-end; /* Align to the right */
  gap: 0.25rem;
}

.runners {
  font-style: italic;
  font-size: 0.9rem;
}

.game-status {
    text-transform: capitalize;
    color: #555;
    font-style: italic;
}
</style>