<script setup>
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

const props = defineProps({
  game: {
    type: Object,
    required: true,
  },
});

const authStore = useAuthStore();
const gameState = computed(() => props.game.gameState);
const isUsersTurn = computed(() => Number(props.game.current_turn_user_id) === authStore.user?.userId);

const awayTeamAbbr = computed(() => {
    return props.game.away_team_abbr || 'AWAY';
});
const homeTeamAbbr = computed(() => {
    return props.game.home_team_abbr || 'HOME';
});

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

const isPreGame = computed(() => {
    return ['pending', 'lineups'].includes(props.game.status);
});

const statusText = computed(() => {
  const text = props.game.status_text;
  if (text === 'in progress') {
    return 'In Progress';
  }
  if (text === 'Waiting for opponent') {
    return 'Waiting for opponent...';
  }
  return text;
});

const isWin = computed(() => {
    if (props.game.status !== 'completed' || !gameState.value) return false;
    const myUserId = authStore.user?.userId;
    const isHome = props.game.home_team_user_id === myUserId;
    const myRuns = isHome ? gameState.value.homeScore : gameState.value.awayScore;
    const oppRuns = isHome ? gameState.value.awayScore : gameState.value.homeScore;
    return myRuns > oppRuns;
});

const formattedFinalScore = computed(() => {
    if (props.game.status !== 'completed' || !gameState.value) return '';

    const { homeScore, awayScore, inning } = gameState.value;
    const homeAbbr = homeTeamAbbr.value;
    const awayAbbr = awayTeamAbbr.value;

    const winningAbbr = homeScore > awayScore ? homeAbbr : awayAbbr;
    const winningScore = Math.max(homeScore, awayScore);
    const losingAbbr = homeScore < awayScore ? homeAbbr : awayAbbr;
    const losingScore = Math.min(homeScore, awayScore);

    let scoreString = `FINAL: ${winningAbbr} ${winningScore}, ${losingAbbr} ${losingScore}`;
    if (inning > 9) {
        scoreString += ` (${inning})`;
    }
    return scoreString;
});

const gameSubtitle = computed(() => {
    const date = new Date(props.game.created_at).toLocaleDateString();
    let seriesInfo = 'Exhibition';

    if (props.game.series_type !== 'exhibition' && props.game.series) {
        const myUserId = authStore.user?.userId;
        const isSeriesHome = props.game.series.series_home_user_id === myUserId;
        const myWins = isSeriesHome ? props.game.series.home_wins : props.game.series.away_wins;
        const oppWins = isSeriesHome ? props.game.series.away_wins : props.game.series.home_wins;

        if (myWins === oppWins) {
            seriesInfo = `Series Tied ${myWins}-${oppWins}`;
        } else if (myWins > oppWins) {
            seriesInfo = `You Lead Series ${myWins}-${oppWins}`;
        } else {
            seriesInfo = `You Trail Series ${oppWins}-${myWins}`;
        }
    }
    return `${seriesInfo} · ${date}`;
});

</script>

<template>
  <div class="game-scorecard">
    <div v-if="game.status === 'completed' && gameState" class="game-details completed-game">
      <div class="final-score" :class="{ 'win': isWin, 'loss': !isWin }">
        {{ formattedFinalScore }}
      </div>
      <div class="series-score">
        {{ gameSubtitle }}
      </div>
    </div>
    <div v-else-if="(game.status === 'in_progress' && gameState) || isPreGame" class="game-details">
      <div class="line-1">
        <div class="opponent-info">
          <span v-if="game.opponent">
            <span v-if="game.game_in_series" class="game-number">Game {{ game.game_in_series }}</span>
            vs. {{ game.opponent.full_display_name }}
          </span>
          <span v-else-if="isPreGame">Waiting for opponent...</span>
        </div>
        <div class="score-inning" v-if="game.status === 'in_progress' && gameState">
          <span>{{ scoreText }}</span>
          <span class="inning">{{ inningDescription }}</span>
        </div>
      </div>
      <div class="line-2" v-if="game.opponent">
        <span class="status" v-if="isUsersTurn">Your Turn!</span>
        <span class="status not-your-turn" v-else>{{ statusText }}</span>

        <div class="state" v-if="game.status === 'in_progress' && gameState">
            <span class="runners">{{ runnersOnBaseText }}</span>
            <span class="outs" v-if="outsText">
                <template v-if="runnersOnBaseText">, </template>
                <i>{{ outsText }}</i>
            </span>
        </div>
      </div>
    </div>
    <div v-else class="game-status">
       <span class="status">{{ statusText }}</span>
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

.game-number {
    font-weight: bold;
}

.score-inning {
  display: flex;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.inning {
    font-weight: bold;
}

.state {
    display: flex;
    align-items: baseline;
}

.runners {
  font-style: italic;
  font-size: 0.9rem;
}

.outs {
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

.status.not-your-turn {
    color: black;
    font-style: italic;
    font-weight: normal;
}

.final-score {
  font-weight: bold;
}

.final-score.win {
  color: #28a745; /* Green for win */
}

.final-score.loss {
  color: #dc3545; /* Red for loss */
}

.series-score {
  font-style: italic;
  font-size: 0.9rem;
  color: #555;
}

.completed-game {
    display: flex;
    flex-direction: column;
    align-items: center; /* Center align the content */
    gap: 0.25rem;
}
</style>