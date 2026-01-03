<script setup>
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { calculateDisplayGameState } from '@/utils/gameState';
import { formatNameShort } from '@/utils/playerUtils';

const props = defineProps({
  game: {
    type: Object,
    required: true,
  },
});

const authStore = useAuthStore();

// Determine the displayGameState, potentially rolling back to hide spoilers
const gameState = computed(() => {
    const rawState = props.game.gameState;
    if (!rawState) return null;

    const userId = authStore.user?.userId;
    const gameId = props.game.game_id;

    // Retrieve the "seen" flag from localStorage
    const storageKey = `showdown-game-${gameId}-swing-result-seen`;
    let isSwingResultVisible = false;
    try {
        const storedValue = localStorage.getItem(storageKey);
        isSwingResultVisible = storedValue ? JSON.parse(storedValue) : false;
    } catch (e) {
        console.error('Error reading from localStorage', e);
    }

    return calculateDisplayGameState(rawState, userId, isSwingResultVisible);
});

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
    const dateString = props.game.status === 'completed' ? props.game.completed_at : props.game.created_at;
    const date = new Date(dateString).toLocaleDateString();
    let seriesInfo = 'Exhibition';

    if (props.game.series_type !== 'exhibition' && props.game.series) {
        seriesInfo = `Game ${props.game.game_in_series}`;
    }
    return `${seriesInfo} · ${date}`;
});

const gameHeaderText = computed(() => {
    if (props.game.game_in_series) {
        return `Game ${props.game.game_in_series}`;
    }
    return 'Exhibition';
});

const pitcherDisplay = computed(() => {
    if (!gameState.value) return '';
    const isTop = gameState.value.isTopInning;
    const pitcher = isTop ? gameState.value.currentHomePitcher : gameState.value.currentAwayPitcher;
    if (!pitcher || !pitcher.name) return 'P: TBD';

    return `P: ${formatNameShort(pitcher.name)}`;
});

const batterDisplay = computed(() => {
    if (!gameState.value || !gameState.value.currentAtBat || !gameState.value.currentAtBat.batter) return '';
    const batter = gameState.value.currentAtBat.batter;

    return `AB: ${formatNameShort(batter.name)}`;
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
      <!-- Row 1 -->
      <div class="line-1">
        <div class="opponent-info">
          <span v-if="game.opponent">
            {{ gameHeaderText }}
          </span>
          <span v-else-if="isPreGame">Waiting for opponent...</span>
        </div>
        <div class="top-right" v-if="game.status === 'in_progress' && gameState">
          <span>{{ outsText }}</span>
          <span class="inning">{{ inningDescription }}</span>
        </div>
      </div>

      <!-- Row 2 (Active Game Only) -->
      <div class="line-2" v-if="game.status === 'in_progress' && gameState">
          <div class="left">
              {{ pitcherDisplay }}
          </div>
          <div class="right">
              <span class="runners">{{ runnersOnBaseText }}</span>
          </div>
      </div>

      <!-- Row 3 (Active Game) or Row 2 (PreGame) -->
      <div class="line-3" v-if="game.status === 'in_progress' && gameState">
        <div class="left">
            {{ batterDisplay }}
        </div>
        <div class="right score-display">
            <span :class="{ 'bold-team': gameState.isTopInning }">{{ awayTeamAbbr }} {{ gameState.awayScore }}</span>,
            <span :class="{ 'bold-team': !gameState.isTopInning }">{{ homeTeamAbbr }} {{ gameState.homeScore }}</span>
        </div>
      </div>
      <div class="line-2" v-else-if="game.opponent">
        <span class="status" v-if="isUsersTurn">Your Turn!</span>
        <span class="status not-your-turn" v-else>{{ statusText }}</span>
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
  gap: 0.25rem;
  width: 100%;
}

.line-1, .line-2, .line-3 {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  width: 100%;
}

.opponent-info {
  font-weight: bold;
}

.top-right {
  display: flex;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.inning {
    font-weight: bold;
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

.status {
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
  color: #28a745;
}

.final-score.loss {
  color: #dc3545;
}

.series-score {
  font-style: italic;
  font-size: 0.9rem;
  color: #555;
}

.completed-game {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
}

.bold-team {
    font-weight: bold;
}
</style>
