<script setup>
import { computed } from 'vue';

const props = defineProps({
  game: {
    type: Object,
    required: true,
  },
});

const gameState = computed(() => props.game.gameState);
const awayTeamAbbr = computed(() => props.game.away_team?.abbreviation || 'AWAY');
const homeTeamAbbr = computed(() => props.game.home_team?.abbreviation || 'HOME');

const scoreText = computed(() => {
  if (!gameState.value) return '';
  return `${awayTeamAbbr.value} ${gameState.value.awayScore}, ${homeTeamAbbr.value} ${gameState.value.homeScore}`;
});

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

const outsText = computed(() => {
  if (!gameState.value) return '';
  const outs = gameState.value.outs;
  return `${outs} ${outs === 1 ? 'out' : 'outs'}`;
});
</script>

<template>
  <div class="game-scorecard">
    <div v-if="game.status === 'in_progress' && gameState" class="game-details">
      <div class="line-1">
        <div class="opponent-info">
          <span v-if="game.opponent">vs. {{ game.opponent.full_display_name }}</span>
          <span v-else>Waiting for opponent...</span>
        </div>
        <div class="score-inning">
          <span>{{ scoreText }}</span>
          <span>{{ inningDescription }}</span>
        </div>
      </div>
      <div class="line-2">
        <span class="status">{{ game.status_text }}</span>
        <div class="state">
            <span class="runners">{{ runnersOnBaseText }}</span>
            <span class="outs">{{ outsText }}</span>
        </div>
      </div>
    </div>
    <div v-else class="game-status">
       <span class="status">{{ game.status_text }}</span>
    </div>
  </div>
</template>

<style scoped>
.game-scorecard {
  display: flex;
  flex-direction: column;
  gap: 0.25rem; /* Reduced gap */
  width: 100%;
}

.line-1, .line-2 {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  width: 100%;
}

.opponent-info {
  font-weight: bold;
}

.score-inning {
  display: flex;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.state {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
}

.runners, .outs {
  font-style: italic;
  font-size: 0.9rem;
}

.game-status {
    text-transform: capitalize;
    color: #555;
    font-style: italic;
}

.status {
    /* Assuming status text like 'Your Turn!' might be colored */
    color: green;
    font-weight: bold;
}
</style>