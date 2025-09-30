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
const playerToSubIn = ref(null);
const baserunningChoices = ref({});
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

const haveIRolledForSwing = ref(JSON.parse(localStorage.getItem(rollStorageKey)) || false);


const scoreChangeMessage = ref('');

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

const isBetweenHalfInnings = computed(() => {
  if (!gameStore.gameState) return false;
  return gameStore.gameState.isBetweenHalfInningsAway || gameStore.gameState.isBetweenHalfInningsHome;
});

// NEW: A display-only computed to handle inning-change visuals
const isDisplayTopInning = computed(() => {
  if (!gameStore.gameState) return null;
  if (isBetweenHalfInnings.value) {
    return !gameStore.gameState.isTopInning;
  }
  return gameStore.gameState.isTopInning;
});

// NEW: Display-only computeds for the inning changeover
const amIDisplayOffensivePlayer = computed(() => {
  if (isBetweenHalfInnings.value) {
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
  return amIOffensivePlayer.value && !haveIRolledForSwing.value && !amIReadyForNext.value && 
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
  if (!amIOffensivePlayer.value || !gameStore.gameState || !gameStore.gameState.currentAtBat) {
    return false;
  }
  // Can only steal after the pitch but before the swing
  if (!gameStore.gameState.currentAtBat.pitcherAction || gameStore.gameState.currentAtBat.batterAction) {
    return false;
  }
  const { bases } = gameStore.gameState;
  // Can steal 2nd if runner on 1st and 2nd is empty
  const canStealSecond = bases.first && !bases.second;
  // Can steal 3rd if runner on 2nd and 3rd is empty
  const canStealThird = bases.second && !bases.third;
  return canStealSecond || canStealThird;
});

const showNextHitterButton = computed(() => {
  if (amIReadyForNext.value) {
    return false;
  }

  // Case 1: Inning is over. Both players see the button.
  if (isBetweenHalfInnings.value) {
    return true;
  }

  // Don't show if they haven't rolled for their swing yet.
  if (amIOffensivePlayer.value && !haveIRolledForSwing.value) {
    return false;
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

const groupedGameLog = computed(() => {
  if (!gameStore.gameEvents || gameStore.gameEvents.length === 0) {
    return [];
  }

  const groups = [];
  let currentGroup = { header: 'Pre-Game', plays: [] };

  // Go through events in chronological order
  gameStore.gameEventsToDisplay.forEach(event => {
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
  if (isBetweenHalfInnings.value) {
    return 3;
  }
  if (shouldHidePlayOutcome.value) {
    if (opponentReadyForNext.value) {
      return gameStore.gameState?.lastCompletedAtBat?.outsBeforePlay || 0;
    } else {
      return gameStore.gameState?.currentAtBat?.outsBeforePlay || 0;
    }
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

function handleInitiateSteal() {
    gameStore.initiateSteal(gameId);
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

  if (!opponentReadyForNext.value) {
    anticipatedBatter.value = nextBatterInLineup.value;
  }
  haveIRolledForSwing.value = false;
  localStorage.removeItem(rollStorageKey);
  gameStore.nextHitter(gameId);
}

// in GameView.vue
function handleThrowForSteal() {
  console.log('1. "Roll for Throw" button was clicked.');
  gameStore.resolveSteal(gameId);
}
function confirmBaserunning() {
  console.log('1. "Confirm Decisions" button clicked. Sending:', baserunningChoices.value);
  gameStore.advanceRunners(gameId, baserunningChoices.value);
  baserunningChoices.value = {};
}
function confirmTagUp() {
    gameStore.submitTagUp(gameId, tagUpChoices.value);
    tagUpChoices.value = {}; // Reset choices
}
function confirmOffensiveDecisions() {
    gameStore.submitBaserunningDecisions(gameId, baserunningChoices.value);
    baserunningChoices.value = {};
}
function makeDefensiveThrow(base) {
    gameStore.resolveDefensiveThrow(gameId, base);
}

function handleStealAttempt(fromBase) {
  if (!canAttemptSteal.value) {
      console.log('Steal aborted: canAttemptSteal is false.');
      return;
  }
  if (confirm(`Are you sure you want to attempt to steal from base ${fromBase}?`)) {
      gameStore.initiateSteal(gameId, fromBase);
  }
}

const isStealAttemptInProgress = computed(() => !!gameStore.gameState.stealAttempt);

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

function selectPlayerToSubIn(player) {
    if (!isMyTurn.value) return;
    if (playerToSubIn.value?.card_id === player.card_id) {
        playerToSubIn.value = null; // Deselect
    } else {
        playerToSubIn.value = player;
    }
}
async function executeSubstitution(playerOut, position) {
    if (!isMyTurn.value || !playerToSubIn.value) {
        selectedCard.value = playerOut;
        return;
    }
    const isIncomingPlayerPitcher = playerToSubIn.value.control !== null;
    const isOutgoingPlayerPitcher = position === 'P';
    if (isIncomingPlayerPitcher !== isOutgoingPlayerPitcher) {
        alert('You can only substitute a pitcher for a pitcher, or a position player for a position player.');
        playerToSubIn.value = null;
        return;
    }
    await gameStore.submitSubstitution(gameId, {
        playerInId: playerToSubIn.value.card_id,
        playerOutId: playerOut.card_id,
        position: position
    });
    playerToSubIn.value = null;
}
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
          <BaseballDiamond :bases="basesToDisplay" :canSteal="canAttemptSteal" :isStealAttemptInProgress="isStealAttemptInProgress" :catcherArm="catcherArm" @attempt-steal="handleStealAttempt" />
          <div v-if="atBatToDisplay.pitchRollResult &&
           (gameStore.gameState.currentAtBat.pitchRollResult || !amIReadyForNext.value && opponentReadyForNext) &&
            !(!bothPlayersSetAction.value && amIDisplayOffensivePlayer && !atBatToDisplay.batterAction)" :class="pitchResultClasses" :style="{ backgroundColor: hexToRgba(pitcherTeamColors.primary), borderColor: hexToRgba(pitcherTeamColors.secondary), color: pitcherResultTextColor }">
              Pitch: <strong>{{ atBatToDisplay.pitchRollResult.roll }}</strong>
          </div>
          <div v-if="atBatToDisplay.swingRollResult && (isSwingResultVisible || (amIDisplayOffensivePlayer && haveIRolledForSwing))" :class="swingResultClasses" :style="{ backgroundColor: hexToRgba(batterTeamColors.primary), borderColor: hexToRgba(batterTeamColors.secondary), color: batterResultTextColor }">
              Swing: <strong>{{ atBatToDisplay.swingRollResult.roll }}</strong><br>
              <strong class="outcome-text">{{ atBatToDisplay.swingRollResult.outcome }}</strong>
          </div>
          <div v-if="runScoredOnPlay && !shouldHidePlayOutcome" class="score-update-flash" v-html="scoreChangeMessage"></div>
      </div>

      <!-- PLAYER CARDS & ACTIONS -->
      <div class="player-cards-and-actions-container">
        <!-- Actions (for layout purposes) -->
        <div class="actions-container">
            <!-- Main Action Buttons -->
            <button v-if="amIDisplayDefensivePlayer && !gameStore.gameState.currentAtBat.pitcherAction && !(!amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))" class="action-button tactile-button" @click="handlePitch()"><strong>ROLL FOR PITCH</strong></button>
            <button v-if="amIDisplayOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (amIReadyForNext || bothPlayersCaughtUp)" class="action-button tactile-button" @click="handleOffensiveAction('swing')"><strong>Swing Away</strong></button>
            <button v-else-if="amIDisplayOffensivePlayer && !haveIRolledForSwing && (bothPlayersSetAction || opponentReadyForNext)" class="action-button tactile-button" @click="handleSwing()"><strong>ROLL FOR SWING </strong></button>
            <button v-if="showNextHitterButton && (isSwingResultVisible || (amIDisplayOffensivePlayer && haveIRolledForSwing))" class="action-button tactile-button" @click="handleNextHitter()"><strong>Next Hitter</strong></button>

            <!-- Secondary Action Buttons -->
            <div v-if="!gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction">
                <button v-if="amIDisplayDefensivePlayer && !(!amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))" class="tactile-button" @click="handlePitch('intentional_walk')">Intentional Walk</button>
                <button v-if="amIDisplayOffensivePlayer && !gameStore.gameState.awayPlayerReadyForNext && !gameStore.gameState.homePlayerReadyForNext" class="tactile-button" @click="handleOffensiveAction('bunt')">Bunt</button>
            </div>

            <!-- Waiting Indicators -->
            <div v-if="amIDisplayOffensivePlayer && gameStore.gameState.currentAtBat.batterAction && !gameStore.gameState.currentAtBat.pitcherAction" class="waiting-text">Waiting for pitch...</div>
            <div v-if="(amIDisplayDefensivePlayer && gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction)" class="turn-indicator">Waiting for swing...</div>
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
              <img :src="leftPanelData.team.logo_url" class="lineup-logo" /> {{ leftPanelData.team.city }} Lineup
          </h3>
          <ol>
              <li v-for="(spot, index) in leftPanelData.lineup" :key="spot.player.card_id"
                  :class="{
                      'now-batting': ((leftPanelData.teamKey === 'away' && gameStore.gameState.isTopInning) || (leftPanelData.teamKey === 'home' && !gameStore.gameState.isTopInning)) && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                      'next-up': !((leftPanelData.teamKey === 'away' && gameStore.gameState.isTopInning) || (leftPanelData.teamKey === 'home' && !gameStore.gameState.isTopInning)) && index === defensiveNextBatterIndex,
                      'sub-target': playerToSubIn && leftPanelData.isMyTeam
                  }"
                  @click="selectedCard = spot.player">
                  {{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }})
              </li>
          </ol>
          <div v-if="leftPanelData.pitcher" class="pitcher-info"
               :class="{'sub-target': playerToSubIn && leftPanelData.isMyTeam}"
               @click="executeSubstitution(leftPanelData.pitcher, 'P')">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Pitching:</strong> {{ leftPanelData.pitcher.name }}
          </div>
          <div v-if="leftPanelData.bullpen.length > 0">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Bullpen:</strong>
              <ul>
                  <li v-for="p in leftPanelData.bullpen" :key="p.card_id"
                      @click="leftPanelData.isMyTeam && isMyTurn && selectPlayerToSubIn(p)"
                      :class="{selected: playerToSubIn?.card_id === p.card_id}">
                      {{ p.displayName }} ({{p.ip}} IP)
                  </li>
              </ul>
          </div>
          <div v-if="leftPanelData.bench.length > 0">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Bench:</strong>
              <ul>
                  <li v-for="p in leftPanelData.bench" :key="p.card_id"
                      @click="leftPanelData.isMyTeam && isMyTurn && selectPlayerToSubIn(p)"
                      :class="{selected: playerToSubIn?.card_id === p.card_id}">
                      {{ p.displayName }} ({{p.displayPosition}})
                  </li>
              </ul>
          </div>
          <div v-if="leftPanelData.isMyTeam && isMyTurn">
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
                      'next-up': !((rightPanelData.teamKey === 'away' && gameStore.gameState.isTopInning) || (rightPanelData.teamKey === 'home' && !gameStore.gameState.isTopInning)) && index === defensiveNextBatterIndex,
                      'sub-target': playerToSubIn && rightPanelData.isMyTeam
                  }"
                  @click="selectedCard = spot.player">
                  {{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }})
              </li>
          </ol>
          <div v-if="rightPanelData.pitcher" class="pitcher-info"
               :class="{'sub-target': playerToSubIn && rightPanelData.isMyTeam}"
               @click="executeSubstitution(rightPanelData.pitcher, 'P')">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Pitching:</strong> {{ rightPanelData.pitcher.name }}
          </div>
          <div v-if="rightPanelData.bullpen.length > 0">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Bullpen:</strong>
              <ul>
                  <li v-for="p in rightPanelData.bullpen" :key="p.card_id"
                      @click="rightPanelData.isMyTeam && isMyTurn && selectPlayerToSubIn(p)"
                      :class="{selected: playerToSubIn?.card_id === p.card_id}">
                      {{ p.displayName }} ({{p.ip}} IP)
                  </li>
              </ul>
          </div>
          <div v-if="rightPanelData.bench.length > 0">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Bench:</strong>
              <ul>
                  <li v-for="p in rightPanelData.bench" :key="p.card_id"
                      @click="rightPanelData.isMyTeam && isMyTurn && selectPlayerToSubIn(p)"
                      :class="{selected: playerToSubIn?.card_id === p.card_id}">
                      {{ p.displayName }} ({{p.displayPosition}})
                  </li>
              </ul>
          </div>
          <div v-if="rightPanelData.isMyTeam && isMyTurn">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Defaults:</strong>
              <ul>
                  <li @click="selectPlayerToSubIn(REPLACEMENT_PITCHER)" :class="{selected: playerToSubIn?.card_id === REPLACEMENT_PITCHER.card_id}">Use Replacement Pitcher</li>
                  <li @click="selectPlayerToSubIn(REPLACEMENT_HITTER)" :class="{selected: playerToSubIn?.card_id === REPLACEMENT_HITTER.card_id}">Use Replacement Hitter</li>
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
.lineup-logo { height: 28px; flex-shrink: 0; object-fit: contain; }
.lineup-panel ol, .lineup-panel ul { padding-left: 0; margin: 0.5rem 0; list-style: none; }
.lineup-panel li { cursor: pointer; padding: 2px 0; }
.lineup-panel li:hover { text-decoration: underline; }
.pitcher-info { font-weight: bold; margin-top: 0.5rem; }
.lineup-panel li.sub-target, .pitcher-info.sub-target { background-color: #ffc107; cursor: crosshair; }
.lineup-panel ul li.selected { background-color: #007bff; color: white; }
.now-batting { background-color: #fff8e1; font-weight: bold; font-style: normal !important; color: #000 !important; }
.next-up { background-color: #e9ecef; color: #000 !important; }

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
  bottom: -40px; /* Position it below the container */
  left: 0;
  right: 0;
  font-size: 1.25rem;
  font-weight: bold;
  color: black;
  text-align: center;
  animation: flash 1.5s ease-out;
  pointer-events: none; /* Prevent it from intercepting clicks */
}

@keyframes flash {
  0%, 100% { opacity: 0; }
  25%, 75% { opacity: 1; }
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
