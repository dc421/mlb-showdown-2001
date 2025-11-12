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
      if (event.log_message.includes('scores') || event.log_message.includes('HOME RUN') || event.log_message.includes('SAFE at home')) {
        const runsFromScores = (event.log_message.match(/scores/g) || []).length;
        const runsFromHomeRun = event.log_message.includes('HOME RUN') ? 1 : 0;
        const totalRunsInEvent = runsFromScores + runsFromHomeRun;
        if (isTop) {
          awayRunsInInning += totalRunsInEvent;
        } else {
          homeRunsInInning += totalRunsInEvent;
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

  // After processing all visible events, we handle the state of the score.

  // Case 1: We are between half-innings. The final "inning change" event is hidden,
  // so we need to manually add the score for the inning that just concluded.
  if (gameStore.isBetweenHalfInnings) {
    // The `isBetweenHalfInningsAway` flag means the away team just finished batting.
    if (gameStore.gameState?.isBetweenHalfInningsAway) {
      scores.away.push(awayRunsInInning);
    }
    // The `isBetweenHalfInningsHome` flag means the home team just finished batting.
    else if (gameStore.gameState?.isBetweenHalfInningsHome) {
      // Before adding the home score, ensure the away team has a score for this inning.
      // This is crucial for innings where the away team didn't score.
      if (scores.away.length === scores.home.length) {
          scores.away.push(0);
      }
      scores.home.push(homeRunsInInning);
    }
  }
  // Case 2: We are in the middle of an inning. Add the current, in-progress score.
  else {
    if (isTop) {
      scores.away.push(awayRunsInInning);
    } else {
      // For the home team, if we are in the middle of their half-inning,
      // we need to ensure the away team has a score for this inning first (can be 0).
      if (scores.away.length === scores.home.length) {
        scores.away.push(0);
      }
      scores.home.push(homeRunsInInning);
    }
  }

  return { innings, scores };
});

const awayTeamAbbr = computed(() => gameStore.teams?.away?.abbreviation || 'AWAY');
const homeTeamAbbr = computed(() => gameStore.teams?.home?.abbreviation || 'HOME');

const awayTotalRuns = computed(() => {
  // Sum the per-inning scores from the linescore to ensure consistency,
  // especially when the game state is being rolled back.
  return linescore.value.scores.away.reduce((total, runs) => total + runs, 0);
});

const homeTotalRuns = computed(() => {
  // Sum the per-inning scores from the linescore to ensure consistency.
  return linescore.value.scores.home.reduce((total, runs) => total + runs, 0);
});
</script>

<template>
  <table class="linescore-table">
      <thead>
        <tr>
          <th></th>
          <th v-for="inning in linescore.innings"
              :key="inning"
              :class="{ 'current-inning': inning === gameStore.displayGameState?.inning && !(((gameStore.isEffectivelyBetweenHalfInnings || gameStore.isBetweenHalfInnings) && gameStore.isSwingResultVisible) && !gameStore.opponentReadyForNext) }">
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
            :class="{ 'current-inning': gameStore.displayGameState?.isTopInning && (index + 1) === gameStore.displayGameState?.inning && !(gameStore.displayGameState.outs===3) }"
          >{{ run }}</td>
          <td v-for="i in linescore.innings.length - linescore.scores.away.length" :key="`away-empty-${i}`"></td>
          <td>{{ awayTotalRuns }}</td>
        </tr>
        <tr>
          <td>{{ homeTeamAbbr }}</td>
          <td 
            v-for="(run, index) in linescore.scores.home" 
            :key="`home-${index}`"
            :class="{ 'current-inning': !gameStore.displayGameState?.isTopInning && (index + 1) === gameStore.displayGameState?.inning && !(gameStore.displayGameState.outs===3) }"
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
    font-size: 0.8em;
    white-space: nowrap;
  }
  .linescore-table th,
  .linescore-table td {
    min-width: 18px;
    padding: 0.1rem;
  }
  .linescore-table td:first-child {
    min-width: unset;
    padding-right: 0.3rem;
  }
}
</style>

