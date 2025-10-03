<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';
import { socket } from '@/services/socket';
import { getContrastingTextColor } from '@/utils/colors';
import PlayerCard from '@/components/PlayerCard.vue';
import BaseballDiamond from '@/components/BaseballDiamond.vue';

const showSubModal = ref(false);
const route = useRoute();
const router = useRouter();
const gameStore = useGameStore();
const authStore = useAuthStore();
const gameId = route.params.id;
const initialLoadComplete = ref(false);
const rollStorageKey = `showdown-game-${gameId}-swing-rolled`;
const seenResultStorageKey = `showdown-game-${gameId}-swing-result-seen`;
const hasSeenResult = ref(JSON.parse(localStorage.getItem(seenResultStorageKey)) || false);
const seriesUpdateMessage = ref('');
const nextGameId = ref(null);

// NEW: Local state to track the offensive player's choice
const choices = ref({});

const selectedCard = ref(null);

// New state for the substitution flow
const isSubModeActive = ref(false);
const playerToSubOut = ref(null);

function toggleSubMode() {
  isSubModeActive.value = !isSubModeActive.value;
  // Always reset the player to sub out when toggling the main mode
  playerToSubOut.value = null;
}

function selectPlayerToSubOut(player, position) {
  // If the player is already selected, clicking again cancels the entire substitution mode.
  if (playerToSubOut.value?.player.card_id === player.card_id) {
    isSubModeActive.value = false;
    playerToSubOut.value = null;
  } else {
    // Otherwise, select the player to be subbed out.
    playerToSubOut.value = { player, position };
  }
}

async function handleSubstitution(playerIn) {
    if (!playerToSubOut.value) return;

    await gameStore.submitSubstitution(gameId, {
        playerInId: playerIn.card_id,
        playerOutId: playerToSubOut.value.player.card_id,
        position: playerToSubOut.value.position
    });

    // Reset the substitution state completely
    isSubModeActive.value = false;
    playerToSubOut.value = null;
}

const runnerDecisionChoices = ref({});

const isAdvancementOrTagUpDecision = computed(() => {
    if (!amIOffensivePlayer.value || !isMyTurn.value || !gameStore.gameState?.currentPlay) {
        return false;
    }
    const type = gameStore.gameState.currentPlay.type;
    return type === 'ADVANCE' || type === 'TAG_UP';
});

const isDefensiveThrowDecision = computed(() => {
    if (!amIDefensivePlayer.value || !isMyTurn.value || !gameStore.gameState?.currentPlay) {
        return false;
    }
    const { type, payload } = gameStore.gameState.currentPlay;
    return (type === 'ADVANCE' || type === 'TAG_UP') && payload && payload.choices;
});
// NEW: Local state for the checkbox

const infieldIn = ref(gameStore.gameState?.infieldIn || false);
const anticipatedBatter = ref(null);


const REPLACEMENT_HITTER = { card_id: 'replacement_hitter', displayName: 'Replacement Hitter', control: null };
const REPLACEMENT_PITCHER = { card_id: 'replacement_pitcher', displayName: 'Replacement Pitcher', control: 0, ip: 1 };

const isMyTurn = computed(() => {
  if (!authStore.user || !gameStore.game) return false;
  return Number(authStore.user.userId) === Number(gameStore.game.current_turn_user_id);
});


const batterLineupInfo = computed(() => {
    if (!gameStore.gameState || !gameStore.lineups.away?.battingOrder) return null;
    const lineup = gameStore.gameState.isTopInning ? gameStore.lineups.away.battingOrder : gameStore.lineups.home.battingOrder;
    if (!lineup || lineup.length === 0) return null;
    const pos = gameStore.gameState.isTopInning ? gameStore.gameState.awayTeam.battingOrderPosition : gameStore.gameState.homeTeam.battingOrderPosition;
    return lineup[pos];
});

const myTeam = computed(() => {
    if (!authStore.user || !gameStore.game) return null;
    return authStore.user.userId === gameStore.game.home_team_user_id ? 'home' : 'away';
});
const myLineup = computed(() => myTeam.value ? gameStore.lineups[myTeam.value] : null);
const myRoster = computed(() => myTeam.value ? gameStore.rosters[myTeam.value] : []);

const myBenchAndBullpen = computed(() => {
    if (!myLineup.value?.battingOrder || !myRoster.value) return [];
    const onFieldIds = new Set(myLineup.value.battingOrder.map(s => s.player.card_id));
    if (myLineup.value.startingPitcher) {
        onFieldIds.add(myLineup.value.startingPitcher.card_id);
    }
    return myRoster.value.filter(p => !onFieldIds.has(p.card_id));
});
const myBench = computed(() => myBenchAndBullpen.value.filter(p => p.control === null));
const myBullpen = computed(() => myBenchAndBullpen.value.filter(p => p.control !== null));

const homePitcher = computed(() => gameStore.gameState?.isTopInning ? gameStore.pitcher : gameStore.lineups.home?.startingPitcher);
const awayPitcher = computed(() => !gameStore.gameState?.isTopInning ? gameStore.pitcher : gameStore.lineups.away?.startingPitcher);

const homeBenchAndBullpen = computed(() => {
    if (!gameStore.lineups.home?.battingOrder || !gameStore.rosters.home) return [];
    const lineupIds = new Set(gameStore.lineups.home.battingOrder.map(s => s.player.card_id));
    if (gameStore.lineups.home.startingPitcher) { lineupIds.add(gameStore.lineups.home.startingPitcher.card_id); }
    return gameStore.rosters.home.filter(p => !lineupIds.has(p.card_id));
});
const awayBenchAndBullpen = computed(() => {
    if (!gameStore.lineups.away?.battingOrder || !gameStore.rosters.away) return [];
    const lineupIds = new Set(gameStore.lineups.away.battingOrder.map(s => s.player.card_id));
    if (gameStore.lineups.away.startingPitcher) { lineupIds.add(gameStore.lineups.away.startingPitcher.card_id); }
    return gameStore.rosters.away.filter(p => !lineupIds.has(p.card_id));
});

const leftPanelData = computed(() => {
    const isHome = myTeam.value === 'home';
    const teamData = isHome ? gameStore.teams.home : gameStore.teams.away;
    const lineupData = isHome ? gameStore.lineups.home : gameStore.lineups.away;
    const benchAndBullpen = isHome ? homeBenchAndBullpen.value : awayBenchAndBullpen.value;
    const pitcher = isHome ? homePitcher.value : awayPitcher.value;
    const colors = isHome ? homeTeamColors.value : awayTeamColors.value;

    return {
        team: teamData,
        lineup: lineupData?.battingOrder,
        pitcher: pitcher,
        bullpen: benchAndBullpen.filter(p => p.displayPosition === 'RP'),
        bench: benchAndBullpen.filter(p => p.control === null),
        colors: colors,
        isMyTeam: true,
        teamKey: myTeam.value
    };
});

const rightPanelData = computed(() => {
    const isHome = myTeam.value === 'home';
    const teamData = isHome ? gameStore.teams.away : gameStore.teams.home;
    const lineupData = isHome ? gameStore.lineups.away : gameStore.lineups.home;
    const benchAndBullpen = isHome ? awayBenchAndBullpen.value : homeBenchAndBullpen.value;
    const pitcher = isHome ? awayPitcher.value : homePitcher.value;
    const colors = isHome ? awayTeamColors.value : homeTeamColors.value;

    return {
        team: teamData,
        lineup: lineupData?.battingOrder,
        pitcher: pitcher,
        bullpen: benchAndBullpen.filter(p => p.displayPosition === 'RP'),
        bench: benchAndBullpen.filter(p => p.control === null),
        colors: colors,
        isMyTeam: false,
        teamKey: myTeam.value === 'home' ? 'away' : 'home'
    };
});

const usedPlayerIds = computed(() => {
    if (!gameStore.gameState) return new Set();
    const homeUsed = gameStore.gameState.homeTeam?.used_player_ids || [];
    const awayUsed = gameStore.gameState.awayTeam?.used_player_ids || [];
    return new Set([...homeUsed, ...awayUsed]);
});

const haveIRolledForSwing = ref(JSON.parse(localStorage.getItem(rollStorageKey)) || false);


const scoreChangeMessage = ref('');
const scoreUpdateVisible = ref(false);

// in GameView.vue
watch([() => gameStore.gameState?.awayScore, () => gameStore.gameState?.homeScore], ([newAwayScore, newHomeScore], [oldAwayScore, oldHomeScore]) => {
  if (newAwayScore !== oldAwayScore || newHomeScore !== oldHomeScore) {
    const awayTeamName = gameStore.teams?.away?.city.toUpperCase() || 'AWAY';
    const homeTeamName = gameStore.teams?.home?.city.toUpperCase() || 'HOME';

    let awayScoreDisplay = `${awayTeamName} ${newAwayScore}`;
    let homeScoreDisplay = `${homeTeamName} ${newHomeScore}`;

    if (newAwayScore > oldAwayScore) {
      awayScoreDisplay = `${awayTeamName} <span style="color: #dc3545;">${newAwayScore}</span>`;
    }
    if (newHomeScore > oldHomeScore) {
      homeScoreDisplay = `${homeTeamName} <span style="color: #dc3545;">${newHomeScore}</span>`;
    }
    
    scoreChangeMessage.value = `${awayScoreDisplay}, ${homeScoreDisplay}`;
  }
});

const runScoredOnPlay = computed(() => {
  if (!gameStore.gameEvents || gameStore.gameEvents.length === 0) {
    return false;
  }
  // Get the most recent event from the log
  const lastEvent = gameStore.gameEvents[gameStore.gameEvents.length - 1];
  // Check if its message contains the word "scores!"
  return lastEvent.log_message?.includes('scores!');
});

watch(runScoredOnPlay, (hasScored) => {
    if (hasScored) {
        scoreUpdateVisible.value = true;
    }
});

// in GameView.vue

const amIOffensivePlayer = computed(() => {
    if (!authStore.user || !gameStore.gameState) return false;
    const offensiveTeam = gameStore.gameState.isTopInning ? gameStore.gameState.awayTeam : gameStore.gameState.homeTeam;
    // This is the most reliable way to check, using the game state
    return Number(authStore.user.userId) === Number(offensiveTeam.userId);
});

const amIDefensivePlayer = computed(() => {
    if (!authStore.user || !gameStore.gameState) return false;
    // By definition, if you are not on offense, you are on defense.
    return !amIOffensivePlayer.value;
});


// NEW: A display-only computed to handle inning-change visuals
const isDisplayTopInning = computed(() => {
  if (!gameStore.gameState) return null;
  if (gameStore.isBetweenHalfInnings) {
    return !gameStore.gameState.isTopInning;
  }
  return gameStore.gameState.isTopInning;
});

// NEW: Display-only computeds for the inning changeover
const amIDisplayOffensivePlayer = computed(() => {
  if (gameStore.isBetweenHalfInnings) {
    return !amIOffensivePlayer.value;
  }
  return amIOffensivePlayer.value;
});

const amIDisplayDefensivePlayer = computed(() => {
  return !amIDisplayOffensivePlayer.value;
});

// UI State Computeds
const pitcherOnlySetActions = computed(() => {
  if (!gameStore.gameState || !gameStore.gameState.currentAtBat) return false;
  return !!gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction;
});

const isOffenseWaitingToRoll = computed(() => {
  return amIDisplayOffensivePlayer.value && !haveIRolledForSwing.value && !amIReadyForNext.value && 
  (bothPlayersSetAction.value || opponentReadyForNext.value)
})

const isDefenseWaitingForReveal = computed(() => {
  return amIDefensivePlayer.value &&
    bothPlayersSetAction.value &&
    !isSwingResultVisible.value
});

// NEW: Centralized logic to determine if the current play's outcome should be hidden from the user.
const shouldHidePlayOutcome = computed(() => {
  // Scenario 1: The offensive player has not yet clicked "ROLL FOR SWING".
  // Both actions are in, but the local `haveIRolledForSwing` flag is false.
  const offenseWaiting = isOffenseWaitingToRoll.value;

  // Scenario 2: The defensive player is waiting for the 900ms reveal delay.
  const defenseWaiting = isDefenseWaitingForReveal.value;

  return offenseWaiting || defenseWaiting;
});

// NEW: Watch this computed and update the central store state
watch(shouldHidePlayOutcome, (newValue) => {
  gameStore.setOutcomeHidden(newValue);
}, { immediate: true });

const offensiveChoiceMade = computed(() => !!gameStore.gameState?.currentAtBat?.batterAction);

const canAttemptSteal = computed(() => {
    // Stealing is an offensive action, must be their turn, and no other play can be in progress.
    if (!amIOffensivePlayer.value || !isMyTurn.value || !gameStore.gameState || gameStore.gameState.currentPlay) {
        return false;
    }
    const { bases } = gameStore.gameState;
    const canStealSecond = bases.first && !bases.second;
    const canStealThird = bases.second && !bases.third;
    // It's possible to steal if at least one of these conditions is met.
    return canStealSecond || canStealThird;
});

const canStealSecond = computed(() => canAttemptSteal.value && gameStore.gameState.bases.first && !gameStore.gameState.bases.second);
const canStealThird = computed(() => canAttemptSteal.value && gameStore.gameState.bases.second && !gameStore.gameState.bases.third);
const canDoubleSteal = computed(() => canAttemptSteal.value && gameStore.gameState.bases.first && gameStore.gameState.bases.second && !gameStore.gameState.bases.third);

const showNextHitterButton = computed(() => {
  if (amIReadyForNext.value) {
    return false;
  }

  // Case 1: Inning is over. Both players see the button.
  if (gameStore.isBetweenHalfInnings) {
    if (amIDisplayOffensivePlayer.value && !haveIRolledForSwing.value) {
    return false;
  } else{
  return true;
  }
  }
  
  const atBatIsResolved = bothPlayersSetAction.value;
  const opponentIsReady = opponentReadyForNext.value;

  return atBatIsResolved || opponentIsReady;
});

const outfieldDefense = computed(() => {
    if (!gameStore.gameState || !gameStore.lineups) return 0;
    const defensiveLineup = gameStore.gameState.isTopInning ? gameStore.lineups.home : gameStore.lineups.away;
    if (!defensiveLineup?.battingOrder) return 0;
    return defensiveLineup.battingOrder
        .filter(spot => ['LF', 'CF', 'RF'].includes(spot.position))
        .reduce((sum, spot) => {
            const rating = spot.player.fielding_ratings[spot.position] || 0;
            return sum + rating;
        }, 0);
});

// in GameView.vue
const catcherArm = computed(() => {
    if (!gameStore.gameState || !gameStore.lineups) return 0;
    const defensiveLineup = gameStore.gameState.isTopInning ? gameStore.lineups.home.battingOrder : gameStore.lineups.away.battingOrder;
    if (!defensiveLineup) return 0;

    const catcher = defensiveLineup.find(spot => spot.position === 'C');
    // The rating is stored in the fielding_ratings object under the 'C' key
    return catcher?.player.fielding_ratings['C'] || 0;
});

// --- NEW: Computed properties to get team color data ---
const homeTeamColors = computed(() => {
    return {
        primary: gameStore.teams?.home?.primary_color || '#343a40',
        secondary: gameStore.teams?.home?.secondary_color || '#ffffff'
    }
});
const awayTeamColors = computed(() => {
    return {
        primary: gameStore.teams?.away?.primary_color || '#343a40',
        secondary: gameStore.teams?.away?.secondary_color || '#ffffff'
    }
});

const eventsForLog = computed(() => {
    // This logic is now centralized in the store's `gameEventsToDisplay` computed property.
    return gameStore.gameEventsToDisplay;
});

watch(() => gameStore.isBetweenHalfInnings, (newValue) => {
  if (newValue) {
    // When the inning ends, set the flag that we are waiting for the user
    // to click "Next Hitter". This triggers the log truncation in the store.
    gameStore.setAwaitingNextHitter(true);
  }
});

const groupedGameLog = computed(() => {
  if (!eventsForLog.value || eventsForLog.value.length === 0) {
    return [];
  }

  const groups = [];
  let currentGroup = { header: 'Pre-Game', plays: [] };

  // Go through events in chronological order
  eventsForLog.value.forEach(event => {
    // A log message with the 'inning-change-message' class indicates a new half-inning
    if (event.log_message && event.log_message.includes('inning-change-message')) {
      // If the current group has plays, save it before starting a new one
      if (currentGroup.plays.length > 0) {
        groups.push(currentGroup);
      }
      // Start a new group
      currentGroup = { header: event.log_message, plays: [] };
    } else {
      // Otherwise, add the play to the current group
      currentGroup.plays.push(event);
    }
  });

  // Add the final, in-progress group
  groups.push(currentGroup);

  // Return the groups in reverse order so the latest inning is at the top
  return groups.reverse();
});

const pitcherTeamColors = computed(() => isDisplayTopInning.value ? homeTeamColors.value : awayTeamColors.value);
const batterTeamColors = computed(() => isDisplayTopInning.value ? awayTeamColors.value : homeTeamColors.value);
const pitcherResultTextColor = computed(() => getContrastingTextColor(pitcherTeamColors.value.primary));
const batterResultTextColor = computed(() => getContrastingTextColor(batterTeamColors.value.primary));

const isSwingResultVisible = ref(false);

// in GameView.vue
const amIReadyForNext = computed(() => {
    if (!gameStore.gameState || !authStore.user) return false;
    if (myTeam.value === 'home') {
        return gameStore.gameState.homePlayerReadyForNext;
    } else {
        return gameStore.gameState.awayPlayerReadyForNext;
    }
});

// in GameView.vue
const opponentReadyForNext = computed(() => {
    if (!gameStore.gameState || !authStore.user) return false;
    if (myTeam.value === 'home') {
        return gameStore.gameState.awayPlayerReadyForNext;
    } else {
        return gameStore.gameState.homePlayerReadyForNext;
    }
});

const atBatToDisplay = computed(() => {
    if (!gameStore.gameState) {
      // During component teardown or initial load, gameState can be null.
      // Return a default, safe structure to prevent cascading errors.
      return { batterAction: null, pitcherAction: null, pitchRollResult: null, swingRollResult: null };
    }
    if (!amIReadyForNext.value && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext)) {
        return gameStore.gameState.lastCompletedAtBat;
    }
    return gameStore.gameState.currentAtBat;
});


const bothPlayersSetAction = computed(() => {
    if (!gameStore.gameState || !gameStore.gameState.currentAtBat) return false;
    return !!atBatToDisplay.value.batterAction && !!atBatToDisplay.value.pitcherAction;
});

// in GameView.vue
watch(bothPlayersSetAction, (isRevealing) => {
  if (isRevealing) {
    // NOTE: This watcher ONLY handles the visibility logic for the DEFENSIVE player.
    // The offensive player's visibility is handled separately and more simply.
    // In the template, the swing result is shown if `isSwingResultVisible || haveIRolledForSwing`.
    // For the offensive player, `isSwingResultVisible` is always false, so the result
    // only appears when `haveIRolledForSwing` becomes true (i.e., when they click the button).
    if (amIDisplayDefensivePlayer.value) {
      // If we've already seen the result (e.g. page refresh), show it immediately.
      if (hasSeenResult.value) {
        isSwingResultVisible.value = true;
        return;
      }

      const defensivePlayerSecond = gameStore.gameState?.defensivePlayerWentSecond;

      // The special case: defensive player is last and it's their turn to see the delay.
      if (defensivePlayerSecond) {
        setTimeout(() => {
          isSwingResultVisible.value = true;
          hasSeenResult.value = true;
          localStorage.setItem(seenResultStorageKey, 'true');
        }, 900);
      } else {
        // Defensive player went first, show result immediately.
        isSwingResultVisible.value = true;
        hasSeenResult.value = true;
        localStorage.setItem(seenResultStorageKey, 'true');
      }
    }
  }
  // The `else` block was removed. The responsibility for resetting the result view
  // has been moved to the `handleNextHitter` function. This prevents a player's
  // view from being reset when their OPPONENT clicks "Next Hitter".
}, { immediate: true });

watch(() => atBatToDisplay.value?.pitcherAction, (newAction) => {
    if (newAction === 'intentional_walk' && amIOffensivePlayer.value) {
        haveIRolledForSwing.value = true;
        localStorage.setItem(rollStorageKey, 'true');
    }
});

const nextBatterInLineup = computed(() => {
  if (!gameStore.gameState || !gameStore.lineups) return null;

  const isTop = gameStore.gameState.isTopInning;
  const offensiveTeamState = isTop ? gameStore.gameState.awayTeam : gameStore.gameState.homeTeam;
  const offensiveLineup = isTop ? gameStore.lineups.away.battingOrder : gameStore.lineups.home.battingOrder;

  if (!offensiveLineup) return null;

  // Calculate the index of the next batter in the order
  const nextIndex = (offensiveTeamState.battingOrderPosition + 1) % 9;
  
  return offensiveLineup[nextIndex]?.player;
});

// Pre-cache the next batter's image
watch(nextBatterInLineup, (newNextBatter) => {
  if (newNextBatter && newNextBatter.image_url) {
    const img = new Image();
    img.src = newNextBatter.image_url;
  }
}, { immediate: true });

const batterToDisplay = computed(() => {
    if (anticipatedBatter.value) {
        return anticipatedBatter.value;
    }
    if (!gameStore.gameState) {
        return null;
    }
    if (!amIReadyForNext.value && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext)) {
        return gameStore.gameState.lastCompletedAtBat.batter;
    }
    return gameStore.gameState.currentAtBat.batter;
});

const pitcherToDisplay = computed(() => {
    if (!gameStore.gameState) return null;
    if (!amIReadyForNext.value && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext)) {
        return gameStore.gameState.lastCompletedAtBat.pitcher;
    }
    // In all other cases, show the data for the current at-bat.
    return gameStore.gameState.currentAtBat.pitcher;
});


// in GameView.vue
const showResolvedState = computed(() => {
  const atBatIsResolved = gameStore.gameState.currentAtBat?.batterAction && gameStore.gameState.currentAtBat?.pitcherAction
  const waitingToSwing = amIOffensivePlayer.value && !haveIRolledForSwing.value;
  return atBatIsResolved && !waitingToSwing;
});


// in GameView.vue
const basesToDisplay = computed(() => {
  if (shouldHidePlayOutcome.value) {
    if (opponentReadyForNext.value) {
      return gameStore.gameState?.lastCompletedAtBat?.basesBeforePlay || { first: null, second: null, third: null };
    } else {
      return gameStore.gameState?.currentAtBat?.basesBeforePlay || { first: null, second: null, third: null };
    }
  }

  // Otherwise, show the current, live bases.
  return gameStore.gameState?.bases;
});

const outsToDisplay = computed(() => {
  // NEW: Always prioritize hiding the outcome if needed. This prevents the
  // UI from jumping to 3 outs before the final out is revealed.
  if (shouldHidePlayOutcome.value) {
    if (opponentReadyForNext.value) {
      return gameStore.gameState?.lastCompletedAtBat?.outsBeforePlay || 0;
    } else {
      return gameStore.gameState?.currentAtBat?.outsBeforePlay || 0;
    }
  }

  // Special condition for the offensive player between innings, before they have rolled.
  // Show the state of the game as it was before the 3rd out was recorded.
  const isOffensivePlayerBetweenInnings = amIDisplayOffensivePlayer.value && !haveIRolledForSwing.value && gameStore.isBetweenHalfInnings;
  if (isOffensivePlayerBetweenInnings) {
    if (opponentReadyForNext.value) {
      return gameStore.gameState?.lastCompletedAtBat?.outsBeforePlay || 0;
    } else {
      return gameStore.gameState?.currentAtBat?.outsBeforePlay || 0;
    }
  }

  // If the inning is over and the outcome is not hidden, show 3 outs.
  if (gameStore.isBetweenHalfInnings) {
    return 3;
  }

  // Otherwise, show the current, live number of outs.
  return gameStore.gameState?.outs;
});

// This watcher automatically updates the store whenever the correct number of outs changes
watch(outsToDisplay, (newOuts) => {
  if (newOuts !== null && newOuts !== undefined) {
    gameStore.setDisplayOuts(newOuts);
  }
}, { immediate: true }); // 'immediate' runs the watcher once on component load

const isGameOver = computed(() => gameStore.game?.status === 'completed');

function proceedToNextGame() {
    if (nextGameId.value) {
        router.push(`/game/${nextGameId.value}/lineup`);
    }
}

 
function hexToRgba(hex, alpha = 0.95) {
  if (!hex || !/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
    return `rgba(200, 200, 200, ${alpha})`; // Fallback for invalid colors
  }
  let c = hex.substring(1).split('');
  if (c.length === 3) {
    c = [c[0], c[0], c[1], c[1], c[2], c[2]];
  }
  c = '0x' + c.join('');
  return `rgba(${[(c>>16)&255, (c>>8)&255, c&255].join(',')},${alpha})`;
}

function handleInitiateSteal(decisions) {
    gameStore.initiateSteal(gameId, decisions);
}

function handleResolveSteal(throwTo) {
    gameStore.resolveSteal(gameId, throwTo);
}

function handlePitch(action = null) {
  console.log('1. GameView: handlePitch function was called.');
  gameStore.submitPitch(gameId, action);
}
function handleOffensiveAction(action) {
  console.log('1. GameView: handleOffensiveAction was called with action:', action);
  gameStore.submitAction(gameId, action);
}

function handleSwing(action = null) {
  haveIRolledForSwing.value = true; // Set the flag immediately
  localStorage.setItem(rollStorageKey, 'true');
  gameStore.submitSwing(gameId, action);
}
function handleNextHitter() {
  // Reset the result visibility for the current player.
  isSwingResultVisible.value = false;
  hasSeenResult.value = false;
  localStorage.removeItem(seenResultStorageKey);
  scoreUpdateVisible.value = false;

  if (!opponentReadyForNext.value) {
    anticipatedBatter.value = nextBatterInLineup.value;
  }
  haveIRolledForSwing.value = false;
  localStorage.removeItem(rollStorageKey);
  gameStore.setAwaitingNextHitter(false);
  gameStore.nextHitter(gameId);
}

function handleRunnerDecisions() {
    gameStore.submitBaserunningDecisions(gameId, runnerDecisionChoices.value);
    runnerDecisionChoices.value = {}; // Reset choices
}

function handleDefensiveThrow(base) {
    gameStore.resolveDefensiveThrow(gameId, base);
}


const isStealAttemptInProgress = computed(() => gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT');

const isInfieldInDecision = computed(() => {
    return amIOffensivePlayer.value && isMyTurn.value && gameStore.gameState?.currentPlay?.type === 'INFIELD_IN_PLAY';
});

const isPitcherTired = (pitcher) => {
    if (!pitcher || !gameStore.gameState?.pitcherStats) {
        return false;
    }
    const stats = gameStore.gameState.pitcherStats[pitcher.card_id];
    if (!stats) {
        return false;
    }
    const fatigueThreshold = pitcher.ip - Math.floor(stats.runs / 3);
    return stats.ip > fatigueThreshold;
};

// in GameView.vue <script setup>

function handleInfieldInDecision(sendRunner) {
    gameStore.submitInfieldInDecision(gameId, sendRunner);
}



// NEW: Watch for changes to the checkbox and send to server

watch(infieldIn, (newValue) => {

    if (amIDefensivePlayer.value) {

        gameStore.setDefense(gameId, newValue);

    }

});

const bothPlayersCaughtUp = computed(() => {
if (!gameStore.gameState) return false;
return !gameStore.gameState.awayPlayerReadyForNext && !gameStore.gameState.homePlayerReadyForNext
});

watch(batterToDisplay, (newBatter, oldBatter) => {
  const newName = newBatter ? newBatter.name : 'null';
  const oldName = oldBatter ? oldBatter.name : 'null';
  console.log(`--- 2. batterToDisplay CHANGED from ${oldName} to ${newName} ---`);
});

watch(bothPlayersCaughtUp, (areThey) => {
    if (areThey) {
        anticipatedBatter.value = null;
    }
});



// NEW: Watch for updates from the server

watch(() => gameStore.gameState?.infieldIn, (newValue) => {

    infieldIn.value = newValue;

});

// --- NEW: On-Deck Logic ---
const defensiveTeamKey = computed(() => gameStore.gameState?.isTopInning ? 'homeTeam' : 'awayTeam');
const defensiveNextBatterIndex = computed(() => {
    if (!gameStore.gameState) return -1;
    return gameStore.gameState[defensiveTeamKey.value].battingOrderPosition;
});



// in GameView.vue
const outcomeBatter = computed(() => {
    // This now correctly looks for the batter object inside the swingRollResult
    return gameStore.gameState?.currentAtBat?.swingRollResult?.batter || null;
});



const controlledPlayer = computed(() => {
  return amIDisplayOffensivePlayer.value ? batterToDisplay.value : pitcherToDisplay.value;
});

const opponentPlayer = computed(() => {
  return amIDisplayOffensivePlayer.value ? pitcherToDisplay.value : batterToDisplay.value;
});

const controlledPlayerRole = computed(() => {
  return amIDisplayOffensivePlayer.value ? 'Batter' : 'Pitcher';
});

const opponentPlayerRole = computed(() => {
  return amIDisplayOffensivePlayer.value ? 'Pitcher' : 'Batter';
});

const controlledPlayerTeamColors = computed(() => {
  return amIDisplayOffensivePlayer.value ? batterTeamColors.value : pitcherTeamColors.value;
});

const opponentPlayerTeamColors = computed(() => {
  return amIDisplayOffensivePlayer.value ? pitcherTeamColors.value : batterTeamColors.value;
});

const showAdvantage = computed(() => {
  return atBatToDisplay.value.pitchRollResult &&
         (gameStore.gameState.currentAtBat.pitchRollResult || !amIReadyForNext.value && !bothPlayersCaughtUp.value) &&
         !(!bothPlayersSetAction.value && amIOffensivePlayer.value && !gameStore.gameState.currentAtBat.batterAction);
});

const controlledPlayerHasAdvantage = computed(() => {
  if (!showAdvantage.value) return null;
  const advantageGoesTo = atBatToDisplay.value.pitchRollResult?.advantage;
  if (amIDisplayOffensivePlayer.value) {
    return advantageGoesTo === 'batter';
  } else {
    return advantageGoesTo === 'pitcher';
  }
});

const opponentPlayerHasAdvantage = computed(() => {
  if (!showAdvantage.value) return null;
  const advantageGoesTo = atBatToDisplay.value.pitchRollResult?.advantage;
  if (amIDisplayOffensivePlayer.value) {
    return advantageGoesTo === 'pitcher';
  } else {
    return advantageGoesTo === 'batter';
  }
});

const pitchResultClasses = computed(() => {
  const classes = ['result-box'];
  // Pitcher is the controlled player (on the left) if I am the defensive player.
  if (amIDisplayDefensivePlayer.value) {
    classes.push('result-box-left');
  } else {
    classes.push('result-box-right');
  }
  return classes;
});

const swingResultClasses = computed(() => {
  const classes = ['result-box'];
  // Batter is the controlled player (on the left) if I am the offensive player.
  if (amIDisplayOffensivePlayer.value) {
    classes.push('result-box-left');
  } else {
    classes.push('result-box-right');
  }
  return classes;
});

// in GameView.vue
onMounted(async () => {
  await gameStore.fetchGame(gameId);
  initialLoadComplete.value = true;

  // NEW: Check if we are returning to a completed at-bat
  const atBat = atBatToDisplay.value;
  if (atBat && atBat.swingRollResult && atBat.pitchRollResult) {
    const isOffensiveAndHasNotRolled = amIOffensivePlayer.value && !haveIRolledForSwing.value;
    if (!isOffensiveAndHasNotRolled) {
      isSwingResultVisible.value = true;
      hasSeenResult.value = true;
      localStorage.setItem(seenResultStorageKey, 'true');
    }
  }
  
  // --- THIS IS THE DEBUG LOG ---
  console.log('--- GameView Mounted: Checking Store Data ---');
  console.log('gameState:', gameStore.gameState);
  console.log('gameEvents:', gameStore.gameEvents);

  socket.connect();
  socket.emit('join-game-room', gameId);
  socket.on('game-updated', (data) => {
    console.log('--- 3. GameView: game-updated event received from socket. ---');
    gameStore.updateGameData(data);
  });

  socket.on('series-next-game-ready', (data) => {
    const series = gameStore.series;
    const myTeamIsSeriesHome = authStore.user.userId === series.series_home_user_id;
    const myWins = myTeamIsSeriesHome ? data.home_wins : data.away_wins;
    const opponentWins = myTeamIsSeriesHome ? data.away_wins : data.home_wins;

    seriesUpdateMessage.value = `Series score is now ${myWins}-${opponentWins}.`;
    nextGameId.value = data.nextGameId;
  });
});

onUnmounted(() => {
  gameStore.resetGameState();
  socket.off('game-updated');
  socket.off('series-next-game-ready');
  socket.disconnect();
});
</script>

<template>
  <div v-if="isGameOver" class="game-over-modal">
    <div class="game-over-content">
        <h2>Game Over</h2>
        <p v-if="seriesUpdateMessage">{{ seriesUpdateMessage }}</p>
        <p v-else>This game is complete.</p>
        <button v-if="nextGameId" @click="proceedToNextGame">Proceed to Next Game's Lineup</button>
        <RouterLink v-else to="/dashboard" class="button-link">Return to Dashboard</RouterLink>
    </div>
  </div>

  <div v-if="selectedCard" class="modal-overlay" @click="selectedCard = null">
    <div @click.stop><PlayerCard :player="selectedCard" /></div>
  </div>

  <div class="game-view-container" v-if="gameStore.gameState && gameStore.lineups?.home && gameStore.lineups?.away">
    
    <!-- TOP SECTION: AT-BAT DISPLAY -->
    <div class="at-bat-container">

      <!-- BASEBALL DIAMOND AND RESULTS -->
      <div class="diamond-and-results-container">
          <BaseballDiamond :bases="basesToDisplay" :canSteal="false" :isStealAttemptInProgress="isStealAttemptInProgress" :catcherArm="catcherArm" />
          <div v-if="atBatToDisplay.pitchRollResult &&
           (gameStore.gameState.currentAtBat.pitchRollResult || !amIReadyForNext.value && opponentReadyForNext) &&
            !(!bothPlayersSetAction.value && amIDisplayOffensivePlayer && !atBatToDisplay.batterAction)" :class="pitchResultClasses" :style="{ backgroundColor: hexToRgba(pitcherTeamColors.primary), borderColor: hexToRgba(pitcherTeamColors.secondary), color: pitcherResultTextColor }">
              Pitch: <strong>{{ atBatToDisplay.pitchRollResult.roll === 'IBB' ? 'IBB' : atBatToDisplay.pitchRollResult.roll }}</strong>
          </div>
          <div v-if="atBatToDisplay.swingRollResult && (isSwingResultVisible || (amIDisplayOffensivePlayer && haveIRolledForSwing))" :class="swingResultClasses" :style="{ backgroundColor: hexToRgba(batterTeamColors.primary), borderColor: hexToRgba(batterTeamColors.secondary), color: batterResultTextColor }">
              Swing: <strong>{{ atBatToDisplay.swingRollResult.roll }}</strong><br>
              <strong class="outcome-text">{{ atBatToDisplay.swingRollResult.outcome }}</strong>
          </div>
          <div v-if="scoreUpdateVisible" class="score-update-flash" v-html="scoreChangeMessage"></div>
      </div>

      <!-- PLAYER CARDS & ACTIONS -->
      <div class="player-cards-and-actions-container">
        <!-- Actions (for layout purposes) -->
        <div class="actions-container">
            <!-- Main Action Buttons -->
            <div v-if="isAdvancementOrTagUpDecision">
                <h3>Runner Decisions</h3>
                <p>Select which runners to send:</p>
                <div v-for="decision in gameStore.gameState.currentPlay.payload.decisions" :key="decision.from" class="decision-checkbox">
                    <label>
                        <input type="checkbox" v-model="runnerDecisionChoices[decision.from]" />
                        Send {{ decision.runner.name }} (from {{ decision.from }}B)
                    </label>
                </div>
                <button @click="handleRunnerDecisions" class="tactile-button">Confirm Decisions</button>
            </div>
            <div v-else-if="isDefensiveThrowDecision">
                <h3>Defensive Throw</h3>
                <p>Opponent is sending runners! Choose where to throw:</p>
                <button v-for="(sent, fromBase) in gameStore.gameState.currentPlay.payload.choices"
                        :key="fromBase"
                        v-if="sent"
                        @click="handleDefensiveThrow(parseInt(fromBase, 10) + 1)"
                        class="tactile-button">
                    Throw to {{ parseInt(fromBase, 10) + 1 }}B
                </button>
            </div>
            <div v-else-if="isStealAttemptInProgress && amIDefensivePlayer">
                <h3>Opponent is stealing!</h3>
                <p>Choose which base to throw to:</p>
                <button @click="handleResolveSteal(2)" v-if="gameStore.gameState.currentPlay.payload.decisions['1']" class="tactile-button">Throw to 2nd</button>
                <button @click="handleResolveSteal(3)" v-if="gameStore.gameState.currentPlay.payload.decisions['2']" class="tactile-button">Throw to 3rd</button>
            </div>
            <div v-else-if="isStealAttemptInProgress && amIOffensivePlayer">
                <div class="waiting-text">Waiting for opponent to throw...</div>
            </div>
            <div v-else-if="isInfieldInDecision">
                <h3>Infield In Play</h3>
                <p>The defense has the infield in. What will the runner on third do?</p>
                <button @click="handleInfieldInDecision(true)" class="tactile-button">Send Runner Home</button>
                <button @click="handleInfieldInDecision(false)" class="tactile-button">Hold Runner</button>
            </div>
            <div v-else>
                <button v-if="amIDisplayDefensivePlayer && !gameStore.gameState.currentAtBat.pitcherAction && !(!amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))" class="action-button tactile-button" @click="handlePitch()"><strong>ROLL FOR PITCH</strong></button>
                <button v-if="amIDisplayOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (amIReadyForNext || bothPlayersCaughtUp)" class="action-button tactile-button" @click="handleOffensiveAction('swing')"><strong>Swing Away</strong></button>
                <button v-else-if="amIDisplayOffensivePlayer && !haveIRolledForSwing && (bothPlayersSetAction || opponentReadyForNext)" class="action-button tactile-button" @click="handleSwing()"><strong>ROLL FOR SWING </strong></button>
                <button v-if="showNextHitterButton && (isSwingResultVisible || (amIDisplayOffensivePlayer && haveIRolledForSwing))" class="action-button tactile-button" @click="handleNextHitter()"><strong>Next Hitter</strong></button>

                <!-- Secondary Action Buttons -->
                <div class="secondary-actions">
                    <button v-if="amIDisplayDefensivePlayer && !gameStore.gameState.currentAtBat.pitcherAction && !(!amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))" class="tactile-button" @click="handlePitch('intentional_walk')">Intentional Walk</button>
                    <div v-if="amIDisplayDefensivePlayer && !gameStore.gameState.currentAtBat.pitcherAction && !(!amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))" class="infield-in-checkbox">
                        <label>
                            <input type="checkbox" v-model="infieldIn" />
                            Infield In
                        </label>
                    </div>
                    <button v-if="amIDisplayOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (amIReadyForNext || bothPlayersCaughtUp)" class="tactile-button" @click="handleOffensiveAction('bunt')">Bunt</button>
                    <button v-if="canStealSecond && amIDisplayOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (amIReadyForNext || bothPlayersCaughtUp)" @click="handleInitiateSteal({ '1': true })" class="tactile-button">Steal 2nd</button>
                    <button v-if="canStealThird && amIDisplayOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (amIReadyForNext || bothPlayersCaughtUp)" @click="handleInitiateSteal({ '2': true })" class="tactile-button">Steal 3rd</button>
                    <button v-if="canDoubleSteal && amIDisplayOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (amIReadyForNext || bothPlayersCaughtUp)" @click="handleInitiateSteal({ '1': true, '2': true })" class="tactile-button">Double Steal</button>
                </div>
            </div>

            <!-- Waiting Indicators -->
            <div v-if="amIDisplayOffensivePlayer && gameStore.gameState.currentAtBat.batterAction && !gameStore.gameState.currentAtBat.pitcherAction && !isStealAttemptInProgress && !isAdvancementOrTagUpDecision && !isDefensiveThrowDecision" class="waiting-text">Waiting for pitch...</div>
            <div v-if="(amIDisplayDefensivePlayer && gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction) && !isStealAttemptInProgress && !isAdvancementOrTagUpDecision && !isDefensiveThrowDecision" class="turn-indicator">Waiting for swing...</div>
        </div>

        <!-- Player Cards Wrapper -->
        <div class="player-cards-wrapper">
          <!-- USER-CONTROLLED PLAYER -->
          <div class="player-container">
            <PlayerCard
              :player="controlledPlayer"
              :role="controlledPlayerRole"
              :is-controlled-player="true"
              :has-advantage="controlledPlayerHasAdvantage"
              :primary-color="controlledPlayerTeamColors.primary"
            />
          </div>

          <!-- OPPONENT PLAYER -->
          <div class="player-container">
            <PlayerCard
              :player="opponentPlayer"
              :role="opponentPlayerRole"
              :is-controlled-player="false"
              :has-advantage="opponentPlayerHasAdvantage"
              :primary-color="opponentPlayerTeamColors.primary"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- BOTTOM SECTION: INFO PANELS -->
    <div class="info-container">
      <!-- Left Panel (User's Team) -->
      <div class="lineup-panel" v-if="leftPanelData.team">
          <h3 :style="{ color: leftPanelData.colors.primary }" class="lineup-header">
              <img :src="leftPanelData.team.logo_url" class="lineup-logo" />
              <span>{{ leftPanelData.team.city }} Lineup</span>
              <span v-if="leftPanelData.isMyTeam && (amIDisplayDefensivePlayer && !gameStore.gameState.currentAtBat.pitcherAction && !(!amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))) ||(amIDisplayOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (amIReadyForNext || bothPlayersCaughtUp))" @click.stop="toggleSubMode" class="sub-icon" :class="{'active': isSubModeActive}">⇄</span>
          </h3>
          <ol>
              <li v-for="(spot, index) in leftPanelData.lineup" :key="spot.player.card_id"
                  :class="{
                      'now-batting': ((leftPanelData.teamKey === 'away' && gameStore.gameState.isTopInning) || (leftPanelData.teamKey === 'home' && !gameStore.gameState.isTopInning)) && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                      'next-up': !((leftPanelData.teamKey === 'away' && gameStore.gameState.isTopInning) || (leftPanelData.teamKey === 'home' && !gameStore.gameState.isTopInning)) && index === defensiveNextBatterIndex,
                      'is-sub-target': playerToSubOut?.player.card_id === spot.player.card_id
                  }"
                  class="lineup-item">
                  <span @click="selectedCard = spot.player">{{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }})</span>
                  <span v-if="isSubModeActive && leftPanelData.isMyTeam && (!playerToSubOut || playerToSubOut.player.card_id === spot.player.card_id)"
                        @click.stop="selectPlayerToSubOut(spot.player, spot.position)"
                        class="sub-icon"
                        :class="{ 'active': playerToSubOut?.player.card_id === spot.player.card_id }">
                      ⇄
                  </span>
              </li>
          </ol>
          <div v-if="leftPanelData.pitcher"
               class="pitcher-info"
               :class="{'is-sub-target': playerToSubOut?.player.card_id === leftPanelData.pitcher.card_id}">
              <hr />
              <span @click="selectedCard = leftPanelData.pitcher">
                  <strong :style="{ color: leftPanelData.colors.primary }">Pitching:</strong> {{ leftPanelData.pitcher.name }} <span v-if="isPitcherTired(leftPanelData.pitcher)" class="tired-indicator">(Tired)</span>
              </span>
              <span v-if="isSubModeActive && leftPanelData.isMyTeam && (!playerToSubOut || playerToSubOut.player.card_id === leftPanelData.pitcher.card_id)"
                    @click.stop="selectPlayerToSubOut(leftPanelData.pitcher, 'P')"
                    class="sub-icon"
                    :class="{ 'active': playerToSubOut?.player.card_id === leftPanelData.pitcher.card_id }">
                  ⇄
              </span>
          </div>
          <div v-if="leftPanelData.bullpen.length > 0">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Bullpen:</strong>
              <ul>
                  <li v-for="p in leftPanelData.bullpen" :key="p.card_id" class="lineup-item">
                      <span @click="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.ip}} IP)</span>
                      <span v-if="isSubModeActive && playerToSubOut && leftPanelData.isMyTeam && !usedPlayerIds.has(p.card_id)"
                            @click.stop="handleSubstitution(p)"
                            class="sub-icon">
                          ⇄
                      </span>
                  </li>
              </ul>
          </div>
          <div v-if="leftPanelData.bench.length > 0">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Bench:</strong>
              <ul>
                  <li v-for="p in leftPanelData.bench" :key="p.card_id" class="lineup-item">
                      <span @click="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.displayPosition}})</span>
                       <span v-if="isSubModeActive && playerToSubOut && leftPanelData.isMyTeam && !usedPlayerIds.has(p.card_id)"
                            @click.stop="handleSubstitution(p)"
                            class="sub-icon">
                          ⇄
                      </span>
                  </li>
              </ul>
          </div>
          <div v-if="isSubModeActive && leftPanelData.isMyTeam">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Defaults:</strong>
              <ul>
                  <li @click="selectPlayerToSubIn(REPLACEMENT_PITCHER)" :class="{selected: playerToSubIn?.card_id === REPLACEMENT_PITCHER.card_id}">Use Replacement Pitcher</li>
                  <li @click="selectPlayerToSubIn(REPLACEMENT_HITTER)" :class="{selected: playerToSubIn?.card_id === REPLACEMENT_HITTER.card_id}">Use Replacement Hitter</li>
              </ul>
          </div>
      </div>

      <!-- Game Log -->
      <div class="event-log">
        <h2>Game Log</h2>
        <div v-for="(group, groupIndex) in groupedGameLog" :key="`group-${groupIndex}`" class="inning-group">
          <div class="inning-header" v-html="group.header"></div>
          <ul>
            <li v-for="event in group.plays.slice().reverse()" :key="event.event_id" v-html="event.log_message"></li>
          </ul>
        </div>
      </div>

      <!-- Right Panel (Opponent's Team) -->
      <div class="lineup-panel" v-if="rightPanelData.team">
          <h3 :style="{ color: rightPanelData.colors.primary }" class="lineup-header">
              <img :src="rightPanelData.team.logo_url" class="lineup-logo" /> {{ rightPanelData.team.city }} Lineup
          </h3>
          <ol>
              <li v-for="(spot, index) in rightPanelData.lineup" :key="spot.player.card_id"
                  :class="{
                      'now-batting': ((rightPanelData.teamKey === 'away' && gameStore.gameState.isTopInning) || (rightPanelData.teamKey === 'home' && !gameStore.gameState.isTopInning)) && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                      'next-up': !((rightPanelData.teamKey === 'away' && gameStore.gameState.isTopInning) || (rightPanelData.teamKey === 'home' && !gameStore.gameState.isTopInning)) && index === defensiveNextBatterIndex
                  }"
                  @click="selectedCard = spot.player">
                  {{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }})
              </li>
          </ol>
          <div v-if="rightPanelData.pitcher" class="pitcher-info" @click="selectedCard = rightPanelData.pitcher">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Pitching:</strong> {{ rightPanelData.pitcher.name }} <span v-if="isPitcherTired(rightPanelData.pitcher)" class="tired-indicator">(Tired)</span>
          </div>
          <div v-if="rightPanelData.bullpen.length > 0">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Bullpen:</strong>
              <ul>
                  <li v-for="p in rightPanelData.bullpen" :key="p.card_id" class="lineup-item">
                      <span @click="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.ip}} IP)</span>
                  </li>
              </ul>
          </div>
          <div v-if="rightPanelData.bench.length > 0">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Bench:</strong>
              <ul>
                  <li v-for="p in rightPanelData.bench" :key="p.card_id" class="lineup-item">
                      <span @click="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.displayPosition}})</span>
                  </li>
              </ul>
          </div>
      </div>
    </div>
  </div>
  <div v-else class="loading-container"><p>Loading game...</p></div>
</template>

<style scoped>
/* Main container for the whole view */
.game-view-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  max-width: 1600px;
  margin: 0 auto;
  padding: 1rem;
  font-family: sans-serif;
  background-color: #fff;
}

/* --- DESKTOP LAYOUT (GRID) --- */
.at-bat-container {
  display: grid;
  grid-template-columns: 320px auto 320px; /* Card | Diamond | Card */
  justify-content: center; /* This will center the grid columns as a group */
  grid-template-rows: auto 1fr; /* Row 1 for cards, Row 2 for actions */
  gap: 1rem 2rem;
  justify-items: center;
  align-items: start;
  margin-top: 1rem;
}

/* We no longer want these to flatten, we need them as grid items */
.player-cards-and-actions-container,
.player-cards-wrapper {
  display: contents;
}

/* Place items in the grid */
.player-container:first-child {
  grid-column: 1 / 2;
  grid-row: 1 / 2;
}
.actions-container {
  grid-column: 1 / 2;
  grid-row: 2 / 3; /* Position below the first player card */
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 320px;
  margin-top: 1rem;
}
.diamond-and-results-container {
  grid-column: 2 / 3;
  grid-row: 1 / 3; /* Span both rows to stay centered */
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: clamp(250px, 30vw, 350px);
}
.player-container:last-child {
  grid-column: 3 / 4;
  grid-row: 1 / 2;
}


/* --- MOBILE LAYOUT (FLEXBOX) --- */
@media (max-width: 992px) {
  .at-bat-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }

  /* This is the key change. By using 'display: contents', we make the children
     of this container direct flex items of '.at-bat-container', which allows
     us to reorder them freely. */
  .player-cards-and-actions-container {
    display: contents;
  }

  /* Reorder the items for mobile */
  .actions-container {
    order: 1; /* Action buttons appear FIRST */
    width: 100%;
    max-width: 350px;
  }
  .diamond-and-results-container {
    order: 2; /* Diamond appears SECOND */
  }
  .player-cards-wrapper {
    order: 3; /* Player cards appear LAST */
    display: flex;
    gap: 1rem;
    justify-content: center; /* This will now correctly center the cards */
    width: 100%;
    flex-wrap: wrap; /* Ensure cards wrap on very small screens */
  }

  /* Reset grid-specific properties */
  .player-container,
  .actions-container,
  .diamond-and-results-container,
  .player-container:last-child {
    grid-column: auto;
    grid-row: auto;
    margin-top: 0;
  }
  .player-container {
    flex: 1 1 45%;
  }
}


/* Bottom section for lineups and game log */
.info-container {
  display: flex;
  justify-content: center;
  gap: 1rem;
  align-items: flex-start; /* Align tops of panels */
}

@media (max-width: 992px) {
  .info-container {
    flex-direction: column;
    align-items: center;
  }
}

.lineup-panel {
  background: #f9f9f9;
  padding: 1rem;
  border-radius: 8px;
  flex: 1; /* Allow panels to grow */
  min-width: 280px; /* Prevent panels from getting too squished */
  max-width: 350px;
}

.event-log {
  background: #f9f9f9;
  padding: 1rem;
  border-radius: 8px;
  flex: 2; /* Give game log more space */
  min-width: 300px;
  max-width: 500px;
  display: flex;
  flex-direction: column;
}

/* --- REUSABLE & MISC STYLES --- */

.loading-container { text-align: center; padding: 5rem; font-size: 1.5rem; }
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000; }
.modal-overlay > div { max-width: 320px; }

/* Lineup Panel Specifics */
.lineup-header { display: flex; align-items: center; gap: 0.75rem; margin-top: 0; }
.lineup-header span:first-of-type { flex-grow: 1; } /* Pushes the icon to the right */
.sub-icon {
  cursor: pointer;
  font-size: 1.5rem;
  padding: 0 0.5rem;
  border-radius: 5px;
  transition: background-color 0.2s;
}
.sub-icon:hover {
  background-color: #e9ecef;
}
.sub-icon.active {
  background-color: #ffc107;
  color: #000;
}
.lineup-logo { height: 28px; flex-shrink: 0; object-fit: contain; }
.lineup-panel ol, .lineup-panel ul { padding-left: 0; margin: 0.5rem 0; list-style: none; }
.lineup-item, .pitcher-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
}
.lineup-item > span:first-child, .pitcher-info > span:first-child {
  cursor: pointer;
}
.lineup-item > span:first-child:hover, .pitcher-info > span:first-child:hover {
  text-decoration: underline;
}
.pitcher-info { font-weight: bold; margin-top: 0.5rem; }
.tired-indicator { color: #dc3545; font-weight: bold; font-style: italic; }
.is-sub-target {
  background-color: #ffc107 !important;
  color: #000;
}
.now-batting { background-color: #fff8e1; font-weight: bold; font-style: normal !important; color: #000 !important; }
.next-up { background-color: #e9ecef; color: #000 !important; }
.is-used {
  color: #6c757d; /* A muted text color */
  text-decoration: line-through;
  pointer-events: none; /* Prevent clicking on used players */
}
.is-used > span:first-child {
  cursor: default;
}


/* Game Log Specifics */
.event-log ul { list-style: none; padding: 0; margin-top: 0; overflow-y: auto; }
.event-log li { padding: 0.5rem; border-bottom: 1px solid #eee; }
.inning-group { margin-bottom: 1rem; }
.inning-header { font-weight: bold; padding: 0.5rem; background-color: #e9ecef; border-bottom: 1px solid #dee2e6; }

/* --- STYLES FOR INNING HEADER --- */
.inning-header >>> .inning-change-message {
  display: flex;
  align-items: center;
  gap: 0.75rem; /* Space between logo and text */
}

.inning-header >>> .team-logo-small {
  height: 28px; /* Control the size of the logo */
  width: 28px;
  object-fit: contain;
}

.inning-header >>> .inning-change-message b {
  font-size: 1.1rem;
  font-weight: bold;
}

.inning-header >>> .pitcher-announcement {
  margin-top: 0.25rem; /* Space above the pitcher's name */
  font-size: 0.9rem;
  font-style: italic;
  font-weight: normal;
  color: #555;
}

/* Action Buttons */
.action-button, .tactile-button {
  padding: .5rem 1rem;
  font-size: 1rem;
  border-radius: 5px;
  color: #3A3A3A;
  border: 1px solid #495057;
  transition: all 0.1s ease-in-out;
  cursor: pointer;
  background-color: #F0F0F0;
  width: 100%;
  margin: 0;
}
.secondary-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1rem;
}
.infield-in-checkbox {
    text-align: center;
}
.action-button:hover, .tactile-button:hover { background-color: #E4E4E4; }
.action-button:active, .tactile-button:active { background-color: #C4C4C4; box-shadow: none; }
.action-button { font-size: 1.2rem; }

/* Roll Result Boxes */
.result-box {
  padding: 0.5rem 1rem;
  border-radius: 1px;
  color: black;
  border: 1px solid;
  text-align: center;
  position: absolute; /* Position relative to the diamond container */
  top: 20px;
}
.result-box-left { left: 8px; }
.result-box-right { right: 12px; }
.result-box .outcome-text { font-size: 2.5rem; line-height: 1; }

/* Indicators & Flashes */
.turn-indicator, .waiting-text { font-style: italic; color: #555; text-align: center; padding-top: 0.5rem; }
.score-update-flash {
  position: absolute;
  bottom: 10px; /* Position it below the container */
  left: 0;
  right: 0;
  font-size: 1.25rem;
  font-weight: bold;
  color: black;
  text-align: center;
  pointer-events: none; /* Prevent it from intercepting clicks */
}

.game-over-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.game-over-content {
  background-color: white;
  padding: 2rem 3rem;
  border-radius: 8px;
  text-align: center;
}

.game-over-content h2 {
  margin-top: 0;
}

.game-over-content button, .game-over-content .button-link {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: bold;
    color: white;
    background-color: #28a745;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    text-decoration: none;
}
</style>
