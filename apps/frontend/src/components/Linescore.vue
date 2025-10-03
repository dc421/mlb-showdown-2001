<script setup>
import { computed } from 'vue';
import { useGameStore } from '@/stores/game';

const gameStore = useGameStore();

const linescore = computed(() => {
  const state = gameStore.displayGameState;
  if (!state || !gameStore.gameEventsToDisplay) {
    return { innings: Array.from({ length: 9 }, (_, i) => i + 1), scores: { away: [], home: [] } };
  }

  const innings = Array.from({ length: Math.max(9, state.inning || 0) }, (_, i) => i + 1);
  const scores = { away: [], home: [] };

  let awayRunsInInning = 0;
  let homeRunsInInning = 0;
  let isTop = true;
  let inningMarkersFound = 0;

  gameStore.gameEventsToDisplay.forEach(event => {
    if (typeof event.log_message === 'string') {
      if (event.log_message.includes('scores!')) {
        const runsScored = (event.log_message.match(/scores!/g) || []).length;
        if (isTop) {
          awayRunsInInning += runsScored;
        } else {
          homeRunsInInning += runsScored;
        }
      } else if (event.log_message.includes('inning-change-message')) {
        if (inningMarkersFound > 0) {
          if (isTop) {
            scores.away.push(awayRunsInInning);
          } else {
            scores.home.push(homeRunsInInning);
          }
        }
        inningMarkersFound++;
        awayRunsInInning = 0;
        homeRunsInInning = 0;
        isTop = event.log_message.includes('Top');
      }
    }
  });

  // Add the current (or last) inning's score to the array
  if (gameStore.isBetweenHalfInnings) {
    // If the inning just ended, `isTop` will reflect the inning that just finished.
    if (isTop) {
      scores.away.push(awayRunsInInning);
    } else {
      scores.home.push(homeRunsInInning);
    }
  } else {
    // If we're in the middle of an inning
    if (isTop) {
      scores.away.push(awayRunsInInning);
    } else {
      // For the home team, if we are in the middle of their half-inning,
      // we need to ensure the away team has a score for this inning first (can be 0).
      if (scores.away.length === scores.home.length) {
         scores.away.push(0); // This logic might need review, but preserves original behavior
      }
      scores.home.push(homeRunsInInning);
    }
  }

  return { innings, scores };
});

const awayTeamAbbr = computed(() => gameStore.teams?.away?.abbreviation || 'AWAY');
const homeTeamAbbr = computed(() => gameStore.teams?.home?.abbreviation || 'HOME');

const awayTotalRuns = computed(() => {
  // Always trust the game state for the total score.
  return gameStore.displayGameState?.awayScore ?? 0;
});

const homeTotalRuns = computed(() => {
  // Always trust the game state for the total score.
  return gameStore.displayGameState?.homeScore ?? 0;
});
</script>

<template>
  <table class="linescore-table">
      <thead>
        <tr>
          <th></th>
          <th v-for="inning in linescore.innings"
              :key="inning"
              :class="{ 'current-inning': inning === gameStore.displayGameState?.inning && !gameStore.isBetweenHalfInnings }">
              {{ inning }}
          </th>
          <th>R</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{{ awayTeamAbbr }}</td>
          <td 
            v-for="(run, index) in linescore.scores.away" 
            :key="`away-${index}`"
            :class="{ 'current-inning': gameStore.displayGameState?.isTopInning && (index + 1) === gameStore.displayGameState?.inning && !gameStore.isBetweenHalfInnings }"
          >{{ run }}</td>
          <td v-for="i in linescore.innings.length - linescore.scores.away.length" :key="`away-empty-${i}`"></td>
          <td>{{ awayTotalRuns }}</td>
        </tr>
        <tr>
          <td>{{ homeTeamAbbr }}</td>
          <td 
            v-for="(run, index) in linescore.scores.home" 
            :key="`home-${index}`"
            :class="{ 'current-inning': !gameStore.displayGameState?.isTopInning && (index + 1) === gameStore.displayGameState?.inning && !gameStore.isBetweenHalfInnings }"
          >{{ run }}</td>
          <td v-for="i in linescore.innings.length - linescore.scores.home.length" :key="`home-empty-${i}`"></td>
          <td>{{ homeTotalRuns }}</td>
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
  padding: 0.1rem 0.1rem;
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
.linescore-table tr td:last-child {
  font-weight: bold;
  border-left: 1px solid rgba(255, 255, 255, 0.5);
}
.current-inning {
  color: #ffc107;
  font-weight: bold;
}

@media (max-width: 768px) {
  .linescore-table {
    font-size: 0.9em;
  }
  .linescore-table th,
  .linescore-table td {
    min-width: unset;
    padding: 0.1rem;
  }
  .linescore-table td:first-child {
    min-width: unset;
  }
}
</style>

