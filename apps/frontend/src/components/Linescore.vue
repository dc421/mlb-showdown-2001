<script setup>
import { computed } from 'vue';
import { useGameStore } from '@/stores/game';

const gameStore = useGameStore();

const linescore = computed(() => {
  // Use the direct store state: gameState, not gameStateToDisplay
  const innings = Array.from({ length: Math.max(9, gameStore.gameState?.inning || 0) }, (_, i) => i + 1);
  const scores = { away: [], home: [] };

  // Use the direct store state: gameEvents, not gameEventsToDisplay
  if (!gameStore.gameEvents || !gameStore.gameState) {
    return { innings, scores };
  }

  let awayRunsInInning = 0;
  let homeRunsInInning = 0;
  let isTop = true;
  let inningMarkersFound = 0;

  // Use the direct store state: gameEvents, not gameEventsToDisplay
  gameStore.gameEvents.forEach(event => {
    if (typeof event.log_message === 'string') {
        if (event.log_message.includes('scores!')) {
          if (isTop) { awayRunsInInning++; } 
          else { homeRunsInInning++; }
        }
        else if (event.log_message.includes('---')) {
          if (inningMarkersFound > 0) {
              if (isTop) { scores.away.push(awayRunsInInning); } 
              else { scores.home.push(homeRunsInInning); }
          }
          inningMarkersFound++;
          awayRunsInInning = 0;
          homeRunsInInning = 0;
          isTop = event.log_message.includes('Top');
        }
    }
  });
  
  if (isTop) {
    scores.away.push(awayRunsInInning);
  } else {
    if(scores.away.length === scores.home.length) {
       scores.away.push(awayRunsInInning);
    }
    scores.home.push(homeRunsInInning);
  }

  return { innings, scores };
});

const awayTeamAbbr = computed(() => gameStore.teams?.away?.abbreviation || 'AWAY');
const homeTeamAbbr = computed(() => gameStore.teams?.home?.abbreviation || 'HOME');
</script>

<template>
  <table class="linescore-table">
      <thead>
        <tr>
          <th></th>
          <th v-for="inning in linescore.innings" :key="inning">{{ inning }}</th>
          <th>R</th>
          <th>Outs</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{{ awayTeamAbbr }}</td>
          <td 
            v-for="(run, index) in linescore.scores.away" 
            :key="`away-${index}`"
            :class="{ 'current-inning': gameStore.gameState?.isTopInning && (index + 1) === gameStore.gameState?.inning }"
          >{{ run }}</td>
          <td v-for="i in linescore.innings.length - linescore.scores.away.length" :key="`away-empty-${i}`"></td>
          <td>{{ gameStore.gameState?.awayScore }}</td>
          <td>
          <span v-if="gameStore.gameState?.isTopInning">{{ gameStore.displayOuts }}</span>
          </td>

        </tr>
        <tr>
          <td>{{ homeTeamAbbr }}</td>
          <td 
            v-for="(run, index) in linescore.scores.home" 
            :key="`home-${index}`"
            :class="{ 'current-inning': !gameStore.gameState?.isTopInning && (index + 1) === gameStore.gameState?.inning }"
          >{{ run }}</td>
          <td v-for="i in linescore.innings.length - linescore.scores.home.length" :key="`home-empty-${i}`"></td>
          <td>{{ gameStore.gameState?.homeScore }}</td>
          <td>
            <span v-if="!gameStore.gameState?.isTopInning">{{ gameStore.displayOuts }}</span>
          </td>
        </tr>
      </tbody>
    </table>
</template>

<style scoped>
.linescore-table {
  color: white;
  font-family: monospace;
  border-collapse: collapse;
  font-size: 1em;
}
.linescore-table th,
.linescore-table td {
  text-align: center;
  padding: 0.1rem 0.4rem;
  min-width: 25px;
}
.linescore-table th {
  font-weight: normal;
  color: rgba(255, 255, 255, 0.7);
}
.linescore-table td:first-child {
  text-align: left;
  font-weight: bold;
  min-width: 40px;
}
.linescore-table tr td:nth-last-child(2) {
  font-weight: bold;
  border-left: 1px solid rgba(255, 255, 255, 0.5);
}
.linescore-table tr td:last-child {
  font-weight: bold;
  color: #dc3545; /* Red for outs */
}
.current-inning {
  color: #ffc107;
  font-weight: bold;
}
</style>

