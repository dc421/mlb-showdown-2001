<script setup>
import { computed } from 'vue';
import BaseballDiamond from './BaseballDiamond.vue';
import OutsDisplay from './OutsDisplay.vue';

const props = defineProps({
  game: {
    type: Object,
    required: true,
  },
});

const gameState = computed(() => props.game.gameState);

const inningDescription = computed(() => {
  if (!gameState.value) return '';
  const inningHalf = gameState.value.isTopInning ? 'Top' : 'Bottom';
  const inningNumber = gameState.value.inning;
  return `${inningHalf} ${inningNumber}`;
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
          <span>AWAY: {{ gameState.awayScore }}</span>
          <span>HOME: {{ gameState.homeScore }}</span>
        </div>
        <div class="inning">{{ inningDescription }}</div>
      </div>
      <div class="game-state">
        <BaseballDiamond :bases="gameState.bases" />
        <OutsDisplay :outs="gameState.outs" />
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
  font-style: italic;
  font-size: 0.9rem;
}

.game-state {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.game-status {
    text-transform: capitalize;
    color: #555;
    font-style: italic;
}
</style>