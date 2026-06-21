<script setup>
import { computed } from 'vue';
import { useGameStore } from '@/stores/game';

const gameStore = useGameStore();

// Runs scored on a pending ADVANCE/TAG_UP play are already applied to the
// server's score, but the log event is held in currentPlay.payload.initialEvent
// until the baserunning decision resolves. Once the swing result is revealed,
// tally that message as if it were logged so the linescore doesn't lag.
const pendingPlayEvent = computed(() => {
  const playType = gameStore.gameState?.currentPlay?.type;
  if (playType !== 'ADVANCE' && playType !== 'TAG_UP') return null;
  if (!gameStore.isSwingResultVisible || gameStore.isOutcomeHidden) return null;
  const initialEvent = gameStore.gameState.currentPlay.payload?.initialEvent;
  return initialEvent ? { log_message: initialEvent } : null;
});

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

  const eventsToTally = pendingPlayEvent.value
    ? [...gameStore.gameEventsToDisplay, pendingPlayEvent.value]
    : gameStore.gameEventsToDisplay;

  eventsToTally.forEach(event => {
    if (typeof event.log_message === 'string') {
      if (event.log_message.includes('scores') || event.log_message.includes('HOME RUN') || event.log_message.includes('SAFE at home') || event.log_message.includes('SENT HOME... SAFE!')) {
        const runsFromScores = (event.log_message.match(/scores/g) || []).length;
        const runsFromHomeRun = event.log_message.includes('HOME RUN') ? 1 : 0;
        const runsFromSAFEathome = event.log_message.includes('SAFE at home') ? 1 : 0;
        const runsFromSentHomeSafe = event.log_message.includes('SENT HOME... SAFE!') ? 1 : 0;
        const totalRunsInEvent = runsFromScores + runsFromHomeRun + runsFromSAFEathome + runsFromSentHomeSafe;
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

  const isBetweenHalfInnings = state.isBetweenHalfInningsAway || state.isBetweenHalfInningsHome;

  // Case 1: We are between half-innings. The final "inning change" event is hidden,
  // so we need to manually add the score for the inning that just concluded.
  if (isBetweenHalfInnings) {
    // The `isBetweenHalfInningsAway` flag means the away team just finished batting.
    if (state.isBetweenHalfInningsAway) {
      scores.away.push(awayRunsInInning);
    }
    // The `isBetweenHalfInningsHome` flag means the home team just finished batting.
    else if (state.isBetweenHalfInningsHome) {
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

// Series games (playoffs) get a "GAME N" label and a per-team series-win column;
// exhibition games have neither.
const hasSeries = computed(() => !!(gameStore.series && gameStore.game?.game_in_series));

const gameLabel = computed(() => {
  const num = gameStore.game?.game_in_series;
  return hasSeries.value ? `GAME ${num}` : '';
});

const isGameOver = computed(() => gameStore.game?.status === 'completed');

// Mid-game the series-win column shows the PRE-game standing (live home_wins/away_wins);
// once the game is final AND its outcome is revealed it shows the POST-game snapshot
// (historical_*), matching the SERIES line in the game log. The reveal gate mirrors the
// store's own "game completed" check (game.js displayGameState) so the series score
// flips in lockstep with the final runs in the linescore — no spoiler, no lag.
const showPostGameSeries = computed(() => isGameOver.value && !gameStore.isOutcomeHidden);

// Per-team series wins, mapped from series-home/away onto the current game's home/away,
// mirroring the logic in GameView's seriesScoreMessage.
const seriesWins = computed(() => {
  const series = gameStore.series;
  const homeTeam = gameStore.teams?.home;
  if (!series || !homeTeam) return { away: null, home: null };

  const isHomeTeamSeriesHome = homeTeam.user_id === series.series_home_user_id;

  let sHomeWins = series.home_wins;
  let sAwayWins = series.away_wins;
  if (showPostGameSeries.value &&
      series.historical_home_wins !== undefined &&
      series.historical_away_wins !== undefined) {
    sHomeWins = series.historical_home_wins;
    sAwayWins = series.historical_away_wins;
  }

  return {
    home: isHomeTeamSeriesHome ? sHomeWins : sAwayWins,
    away: isHomeTeamSeriesHome ? sAwayWins : sHomeWins,
  };
});

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
          <th class="game-label" :colspan="hasSeries ? 2 : 1">{{ gameLabel }}</th>
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
          <td v-if="hasSeries" class="series-wins">{{ seriesWins.away }}</td>
          <td class="team-abbr">{{ awayTeamAbbr }}</td>
          <td
            v-for="(run, index) in linescore.scores.away"
            :key="`away-${index}`"
            :class="{ 'current-inning': gameStore.displayGameState?.isTopInning && (index + 1) === gameStore.displayGameState?.inning && !(gameStore.displayGameState.outs===3) }"
          >{{ run }}</td>
          <td v-for="i in linescore.innings.length - linescore.scores.away.length" :key="`away-empty-${i}`"></td>
          <td>{{ awayTotalRuns }}</td>
        </tr>
        <tr>
          <td v-if="hasSeries" class="series-wins">{{ seriesWins.home }}</td>
          <td class="team-abbr">{{ homeTeamAbbr }}</td>
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
.linescore-table th.game-label {
  text-align: left;
  color: rgba(255, 255, 255, 0.45);
}
.linescore-table td.team-abbr {
  text-align: left;
  font-weight: bold;
  min-width: 40px;
}
.linescore-table td.series-wins {
  text-align: center;
  font-weight: normal;
  color: rgba(255, 255, 255, 0.55);
  min-width: 16px;
  padding-right: 0.4rem;
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
  .linescore-table td.team-abbr {
    min-width: unset;
    padding-right: 0.3rem;
  }
  .linescore-table td.series-wins {
    min-width: 14px;
    padding-right: 0.2rem;
  }
}
</style>
