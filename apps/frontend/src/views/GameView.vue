<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';
import { socket } from '@/services/socket';
import PlayerCard from '@/components/PlayerCard.vue';
import Linescore from '@/components/Linescore.vue';
import BaseballDiamond from '@/components/BaseballDiamond.vue';

const showSubModal = ref(false);
const route = useRoute();
const gameStore = useGameStore();
const authStore = useAuthStore();
const gameId = route.params.id;
const initialLoadComplete = ref(false);
const rollStorageKey = `showdown-game-${gameId}-swing-rolled`;
const seenResultStorageKey = `showdown-game-${gameId}-swing-result-seen`;
const hasSeenResult = ref(JSON.parse(localStorage.getItem(seenResultStorageKey)) || false);

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

// UI State Computeds
const pitcherOnlySetActions = computed(() => {
  if (!gameStore.gameState || !gameStore.gameState.currentAtBat) return false;
  return !!gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction;
});
const bothPlayersSetAction = computed(() => {
    if (!gameStore.gameState || !gameStore.gameState.currentAtBat) return false;
    return !!gameStore.gameState.currentAtBat.batterAction && !!gameStore.gameState.currentAtBat.pitcherAction;
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
  // Rule 1: If I've already clicked "Next Hitter", never show the button.
  if (amIReadyForNext.value) {
    return false;
  }

  // Rule 2: If I'm the batter and I haven't rolled for my swing yet, don't show the button.
  if (amIOffensivePlayer.value && !haveIRolledForSwing.value) {
    return false;
  }
  
  // Rule 3: The at-bat must be fully resolved (both players have acted).
  const atBatIsResolved = bothPlayersSetAction.value;

  // Exception to Rule 3: Or, the other player has already moved on.
  const opponentIsReady = opponentReadyForNext.value;

  // Show the button if the at-bat is resolved OR the opponent is already ready.
  if (atBatIsResolved || opponentIsReady) {
    return true;
  }

  // In all other cases, hide the button.
  return false;
});

const homeBench = computed(() => homeBenchAndBullpen.value.filter(p => p.control === null));
const homeBullpen = computed(() => homeBenchAndBullpen.value.filter(p => p.displayPosition === 'RP'));
const awayBench = computed(() => awayBenchAndBullpen.value.filter(p => p.control === null));
const awayBullpen = computed(() => awayBenchAndBullpen.value.filter(p => p.displayPosition === 'RP'));
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
    // A '---' indicates the start of a new half-inning
    if (event.log_message && event.log_message.includes('---')) {
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

const pitcherTeamColors = computed(() => gameStore.gameState?.isTopInning ? homeTeamColors.value : awayTeamColors.value);
const batterTeamColors = computed(() => gameStore.gameState?.isTopInning ? awayTeamColors.value : homeTeamColors.value);

const pitcherTeamLogo = computed(() => {
  if (!gameStore.gameState || !gameStore.teams) return '';
  return gameStore.gameState.isTopInning ? gameStore.teams.home?.logo_url : gameStore.teams.away?.logo_url;
});

const batterTeamLogo = computed(() => {
  if (!gameStore.gameState || !gameStore.teams) return '';
  return gameStore.gameState.isTopInning ? gameStore.teams.away?.logo_url : gameStore.teams.home?.logo_url;
});

const isSwingResultVisible = ref(false);

// in GameView.vue
watch(bothPlayersSetAction, (isRevealing) => {
  if (isRevealing) {
    // If we've already seen the result (e.g. page refresh), show it immediately.
    if (hasSeenResult.value) {
      isSwingResultVisible.value = true;
      return;
    }

    const defensivePlayerSecond = gameStore.gameState?.defensivePlayerWentSecond;

    // The special case: defensive player is last and it's their turn to see the delay.
    if (amIDefensivePlayer.value && defensivePlayerSecond) {
      setTimeout(() => {
        isSwingResultVisible.value = true;
        hasSeenResult.value = true;
        localStorage.setItem(seenResultStorageKey, 'true');
      }, 900);
    } else {
      // In all other cases, show the result immediately.
      isSwingResultVisible.value = true;
      hasSeenResult.value = true;
      localStorage.setItem(seenResultStorageKey, 'true');
    }
  } else {
    if (!initialLoadComplete.value) return;
    // A new at-bat is starting (currentAtBat changed), so reset the UI state.
    isSwingResultVisible.value = false;
    hasSeenResult.value = false;
    localStorage.removeItem(seenResultStorageKey);
  }
}, { immediate: true });

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
  if (gameStore.isBetweenHalfInnings) {
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


const isBetweenHalfInnings = computed(() => {
  if (!gameStore.gameState || !gameStore.gameState.lastCompletedAtBat) {
    return false;
  }
  // State is true if the half-inning has flipped and the current player hasn't moved on
  return !amIReadyForNext.value &&
         gameStore.gameState.lastCompletedAtBat.isTopInning !== gameStore.gameState.isTopInning;
});

watch(isBetweenHalfInnings, (newValue) => {
  gameStore.setIsBetweenHalfInnings(newValue);
}, { immediate: true });


function hexToRgba(hex, alpha = 1) {
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
});

onUnmounted(() => {
  socket.off('game-updated');
  socket.disconnect();
});
</script>

<template>
  <div v-if="selectedCard" class="modal-overlay" @click="selectedCard = null">
    <div @click.stop><PlayerCard :player="selectedCard" /></div>
  </div>

  <div class="game-container" v-if="gameStore.gameState && gameStore.lineups?.home && gameStore.lineups?.away">
    <div class="side-panels">
        <div class="lineup-panel">
            <h3 :style="{ color: awayTeamColors.primary}" class="lineup-header"><img v-if="gameStore.teams.away" :src="gameStore.teams.away.logo_url" class="lineup-logo" /> {{gameStore.teams.away.city}} Lineup</h3>
            <ol><li v-for="(spot, index) in gameStore.lineups.away.battingOrder" :key="spot.player.card_id" :class="{
                  'now-batting': gameStore.gameState.isTopInning && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                  'next-up': !gameStore.gameState.isTopInning && index === defensiveNextBatterIndex,
                  'sub-target': playerToSubIn && myTeam === 'away'}" @click="selectedCard = spot.player"> {{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }}) </li></ol>
            <div v-if="awayPitcher" class="pitcher-info" :class="{'sub-target': playerToSubIn && myTeam === 'away' && isMyTurn}" @click="executeSubstitution(awayPitcher, 'P')"> <hr /><strong :style="{ color: awayTeamColors.primary}">Pitching:</strong> {{ awayPitcher.name }} </div>
            <div v-if="awayBullpen.length > 0"> <hr /><strong :style="{ color: awayTeamColors.primary}">Bullpen:</strong> <ul><li v-for="p in awayBullpen" :key="p.card_id" @click="isMyTurn && selectPlayerToSubIn(p)" :class="{selected: playerToSubIn?.card_id === p.card_id}">{{ p.displayName }} ({{p.ip}} IP)</li></ul> </div>
            <div v-if="awayBench.length > 0"> <hr /><strong :style="{ color: awayTeamColors.primary}">Bench:</strong> <ul><li v-for="p in awayBench" :key="p.card_id" @click="isMyTurn && selectPlayerToSubIn(p)" :class="{selected: playerToSubIn?.card_id === p.card_id}">{{ p.displayName }} ({{p.displayPosition}})</li></ul> </div>
            <div v-if="myTeam === 'away' && isMyTurn"><hr /><strong :style="{ color: awayTeamColors.primary}">Defaults:</strong><ul> <li @click="selectPlayerToSubIn(REPLACEMENT_PITCHER)" :class="{selected: playerToSubIn?.card_id === REPLACEMENT_PITCHER.card_id}">Use Replacement Pitcher</li> <li @click="selectPlayerToSubIn(REPLACEMENT_HITTER)" :class="{selected: playerToSubIn?.card_id === REPLACEMENT_HITTER.card_id}">Use Replacement Hitter</li> </ul></div>
        </div>
    </div>
    
    <div class="main-view">
        <div class="at-bat-display">
          <PlayerCard :player="pitcherToDisplay" role="Pitcher" :has-advantage="atBatToDisplay.pitchRollResult && (gameStore.gameState.currentAtBat.pitchRollResult || !amIReadyForNext.value && !(!gameStore.gameState.awayPlayerReadyForNext && !gameStore.gameState.homePlayerReadyForNext)) && !(!bothPlayersSetAction && amIOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction) ? atBatToDisplay.pitchRollResult?.advantage === 'pitcher' : null" :primary-color="pitcherTeamColors.primary" :team-logo-url="pitcherTeamLogo" />
          <div class="vs-area">
    <div class="action-box">
        <button v-if="amIDefensivePlayer && !gameStore.gameState.currentAtBat.pitcherAction && !(!amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))" class="action-button tactile-button" @click="handlePitch()"><strong>ROLL FOR PITCH</strong></button>
                <div v-else-if="atBatToDisplay.pitchRollResult &&
                (gameStore.gameState.currentAtBat.pitchRollResult || !amIReadyForNext.value && opponentReadyForNext) &&
                !(!bothPlayersSetAction && amIOffensivePlayer && !!gameStore.gameState.currentAtBat.batterAction)" class="result-box pitch-result" :style="{ backgroundColor: hexToRgba(pitcherTeamColors.primary, 0.25), borderColor: hexToRgba(pitcherTeamColors.secondary, 0.25) }">
                    Pitch: <strong>{{ atBatToDisplay.pitchRollResult.roll }}</strong>
                </div>
    </div>
            <div class="vs">VS</div>
            <div class="action-box">
                <button v-if="amIOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (amIReadyForNext || bothPlayersCaughtUp)" class="action-button tactile-button" @click="handleOffensiveAction('swing')">Swing Away</button>
                <button v-else-if="amIOffensivePlayer && !haveIRolledForSwing && (bothPlayersSetAction || opponentReadyForNext)" class="action-button tactile-button" @click="handleSwing()"><strong>ROLL FOR SWING </strong></button>
                <div v-else-if="atBatToDisplay.swingRollResult && (isSwingResultVisible || haveIRolledForSwing)" class="result-box swing-result" :style="{ backgroundColor: hexToRgba(batterTeamColors.primary, 0.25), borderColor: hexToRgba(batterTeamColors.secondary, 0.25) }">
                    Swing: <strong>{{ atBatToDisplay.swingRollResult.roll }}</strong><br>
                    <strong class="outcome-text">{{ atBatToDisplay.swingRollResult.outcome }}</strong>
                </div>
    </div>
        <button v-if="showNextHitterButton && (isSwingResultVisible || amIOffensivePlayer)" class="action-button tactile-button" @click="handleNextHitter()">Next Hitter</button>
    </div>
                    <PlayerCard :player="batterToDisplay" role="Batter" :has-advantage="atBatToDisplay.pitchRollResult && (gameStore.gameState.currentAtBat.pitchRollResult || !amIReadyForNext.value && !(!gameStore.gameState.awayPlayerReadyForNext && !gameStore.gameState.homePlayerReadyForNext)) && !(!bothPlayersSetAction && amIOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction) ? atBatToDisplay.pitchRollResult?.advantage === 'batter' : null" :primary-color="batterTeamColors.primary" :team-logo-url="batterTeamLogo" />
        </div>
        <div v-if="amIOffensivePlayer && gameStore.gameState.currentAtBat.batterAction && !gameStore.gameState.currentAtBat.pitcherAction" class="waiting-text">
            Waiting for pitch...
        </div>
                    <div v-if="(amIDefensivePlayer && gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction)" class="turn-indicator">
                Waiting for swing...
            </div>
            <div v-if="runScoredOnPlay && !shouldHidePlayOutcome" class="score-update-flash" v-html="scoreChangeMessage"></div>

        <BaseballDiamond :bases="basesToDisplay" :canSteal="canAttemptSteal" :isStealAttemptInProgress="isStealAttemptInProgress" :catcherArm="catcherArm" @attempt-steal="handleStealAttempt" />
        <div class="actions">
        
        <!-- Screen 1: Secondary Action Buttons -->
        <div v-if="bothPlayersNoSetAction">
            <div class="button-group">
                <button v-if="amIDefensivePlayer && !gameStore.gameState.currentAtBat.pitcherAction && !(!amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))" class="tactile-button" @click="handlePitch('intentional_walk')">Intentional Walk</button>
                <button v-if="amIOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction  && !gameStore.gameState.awayPlayerReadyForNext && !gameStore.gameState.homePlayerReadyForNext" class="tactile-button" @click="handleOffensiveAction('bunt')">Bunt</button>
            </div>
        </div>
    </div>
    <div class="event-log">
    <h2>Game Log</h2>
    <div v-for="(group, groupIndex) in groupedGameLog" :key="`group-${groupIndex}`" class="inning-group">
      <div class="inning-header" v-html="group.header"></div>
      <ul>
        <li v-for="event in group.plays.slice().reverse()" :key="event.event_id" v-html="event.log_message"></li>
      </ul>
    </div>
</div>
</div>

    <div class="side-panels">
        <div class="lineup-panel">
            <h3 :style="{ color: homeTeamColors.primary}" class="lineup-header"><img v-if="gameStore.teams.home" :src="gameStore.teams.home.logo_url" class="lineup-logo" /> {{gameStore.teams.home.city}} Lineup</h3>
            <ol><li v-for="(spot, index) in gameStore.lineups.home.battingOrder" :key="spot.player.card_id" :class="{
                  'now-batting': !gameStore.gameState.isTopInning && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                  'next-up': gameStore.gameState.isTopInning && index === defensiveNextBatterIndex,
                  'sub-target': playerToSubIn && myTeam === 'home'}" @click="selectedCard = spot.player"> {{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }}) </li></ol>
            <div v-if="homePitcher" class="pitcher-info" :class="{'sub-target': playerToSubIn && myTeam === 'home'}" @click="executeSubstitution(homePitcher, 'P')"> <hr /><strong :style="{ color: homeTeamColors.primary}">Pitching:</strong> {{ homePitcher.name }} </div>
            <div v-if="homeBullpen.length > 0"> <hr /><strong :style="{ color: homeTeamColors.primary}">Bullpen:</strong> <ul><li v-for="p in homeBullpen" :key="p.card_id" @click="isMyTurn && selectPlayerToSubIn(p)" :class="{selected: playerToSubIn?.card_id === p.card_id}">{{ p.displayName }} ({{p.ip}} IP)</li></ul> </div>
            <div v-if="homeBench.length > 0"> <hr /><strong :style="{ color: homeTeamColors.primary}">Bench:</strong> <ul><li v-for="p in homeBench" :key="p.card_id" @click="isMyTurn && selectPlayerToSubIn(p)" :class="{selected: playerToSubIn?.card_id === p.card_id}">{{ p.displayName }} ({{p.displayPosition}})</li></ul> </div>
            <div v-if="myTeam === 'home'"><hr /><strong :style="{ color: homeTeamColors.primary}">Defaults:</strong><ul> <li @click="selectPlayerToSubIn(REPLACEMENT_PITCHER)" :class="{selected: playerToSubIn?.card_id === REPLACEMENT_PITCHER.card_id}">Use Replacement Pitcher</li> <li @click="selectPlayerToSubIn(REPLACEMENT_HITTER)" :class="{selected: playerToSubIn?.card_id === REPLACEMENT_HITTER.card_id}">Use Replacement Hitter</li> </ul></div>
        </div>
    </div>
  </div>
  <div v-else class="loading-container"><p>Loading game...</p></div>
</template>

<style scoped>
.game-container { background-color: #fff; display: grid; grid-template-columns: 1fr 2.5fr 1fr; gap: 1rem; max-width: 1600px; margin: 0rem auto; font-family: sans-serif; }
.at-bat-display { display: flex; justify-content: center; align-items: flex-start; gap: 1.5rem; margin-top: .75rem; margin-bottom: 1.5rem; }
.vs-area { text-align: center; padding-top: 5rem; position: relative; }
.actions { text-align: center; margin-bottom: 1.5rem; min-height: 50px; }
.vs { font-size: 2.5rem; font-weight: bold; color: #888; }
.pitch-result, .swing-result { margin-top: 0; padding: 0.5rem; border-radius: 4px; margin-bottom: 1rem;}
.pitch-result { background: #fff8e1; border: 1px solid #ffecb3; }
.swing-result { background: #e7f5ff; border: 1px solid #b3e0ff; }
.scoreboard { display: grid; grid-template-columns: 1fr auto 1fr; grid-template-rows: auto auto; padding: 1rem; background-color: #343a40; color: white; border-radius: 8px; margin-bottom: 1.5rem; text-align: center; }
.team-score { font-size: 2rem; font-weight: bold; }
.inning-display { grid-column: 2 / 3; display: flex; align-items: center; gap: 1rem; font-size: 1.5rem; }
.inning-arrow { opacity: 0.2; }
.inning-arrow.top, .inning-arrow.bottom { opacity: 1; }
.outs-display { grid-column: 1 / 4; font-size: 1.2rem; margin-top: 0.5rem; }
.turn-indicator { font-style: italic; color: #555; padding-top: 1rem; text-align: center}
.side-panels { display: flex; flex-direction: column; gap: 1rem; }
.lineup-panel { background: #f9f9f9; padding: 1rem; border-radius: 8px; }
.lineup-panel h3 { margin-top: 0; }
.lineup-panel ol { padding-left: 0px; margin: 0.5rem 0; list-style: none;}
.lineup-panel ul { padding-left: 17px; margin: 0.5rem 0; list-style: none;}
.lineup-panel li { cursor: pointer; padding: 2px 0; }
.lineup-panel li:hover { text-decoration: underline; }
.pitcher-info { font-weight: bold; margin-top: 0.5rem; }
.event-log { flex-grow: 1; background: #f9f9f9; padding: 1rem; border-radius: 8px; display: flex; flex-direction: column; }
.event-log ul { list-style: none; padding: 0; min-height: 300px; overflow-y: auto; flex-grow: 1; }
.event-log li { padding: 0.5rem; border-bottom: 1px solid #eee; }
.loading-container { text-align: center; padding: 5rem; font-size: 1.5rem; }
.diamond-area { position: relative; }
.outfield-defense { position: absolute; top: 0; left: 0; background: rgba(0,0,0,0.5); color: white; padding: 4px; border-radius: 4px; font-size: 0.8em; }
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000; }
.modal-overlay > div { max-width: 320px; }
.actions .sub-btn { font-size: 0.8rem; padding: 0.4rem 0.8rem; position: absolute; top: 0; right: 0; }
.sub-modal { background: white; padding: 2rem; border-radius: 8px; width: 800px; max-width: 90vw; }
.sub-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
.sub-list { height: 400px; overflow-y: auto; border: 1px solid #ccc; border-radius: 4px; }
.sub-item-header { background-color: #eee; padding: 0.5rem; font-weight: bold; position: sticky; top: 0; }
.sub-item { padding: 0.5rem; border-bottom: 1px solid #eee; cursor: pointer; }
.sub-item:hover { background-color: #f0f8ff; }
.sub-item.available:hover { background-color: #eef8ff; }
.sub-item.available.selected { background-color: #007bff; color: white; }
.selection-info { text-align: center; background: #fff8e1; padding: 0.5rem; border-radius: 4px; }
.close-btn { margin-top: 1rem; }
.lineup-panel li.sub-target, .pitcher-info.sub-target { background-color: #ffc107; cursor: crosshair; }
.side-panels ul li.selected { background-color: #007bff; color: white; }
.pitcher-info.sub-target { background-color: #ffc107; cursor: crosshair; }
.defense-strategy {
  margin-top: .25rem;
  margin-bottom: 1rem;
  font-weight: bold;
}
.button-group button {
    margin: 0 0.5rem;}
    .game-over {
  text-align: center;
  padding: 1rem;
  background-color: #28a745;
  color: white;
  border-radius: 8px;
}
.swing-result .outcome-text {
  font-size: 2rem; /* Or any size you like */
  color: black; /* A slightly darker blue for emphasis */ 
}
.game-over h2 {
  margin: 0;
}
.action-box {
  min-height: 50px;
  margin-top: 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
}
.steal-result {
  margin-top: 1rem;
  background: #ffe3e3; /* Reddish for a defensive play */
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid #ffc107;
}

.lineup-header {
  display: flex;         /* This is the main fix */
  align-items: center;   /* This vertically centers the text with the logo */
  gap: 0.75rem;          /* This creates a nice space between the logo and text */
  margin-top: 0;
}

.lineup-logo {
  height: 28px;
  flex-shrink: 0; /* Prevent it from being squished or stretched */
  object-fit: contain;
}
.vs-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 1rem; /* Reduced padding */
}
.vs {
  font-size: 2rem;
  font-weight: bold;
  color: #888;
  margin: 0.5rem 0;
}
/* This is the base style for ALL action buttons */
.actions button {
  padding: 0.5rem 1rem;
  font-size: 1rem;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s ease-in-out;
  margin: 0 0.5rem;
}

/* This is the specific style for our "tactile" buttons */
.actions .tactile-button {
  /* Size and Shape */
  padding: .5rem 1rem;
  font-size: 1rem;
  border-radius: 5px; /* Rounded edges */

  /* 3D Effect */
  
  color: #3A3A3A;
  border: 1px solid #495057;

  transition: all 0.1s ease-in-out;
  cursor: pointer; /* <-- THIS IS THE NEW LINE */
}

.actions .tactile-button:hover {
  background-color: #E4E4E4; /* Slightly lighter on hover */
}

.actions .tactile-button:active {
  background-color: #C4C4C4; /* A solid, neutral gray */
  box-shadow: none;
}

/* This styles the main "Roll" button in the vs-area */
.vs-area .action-button {
  padding: .5rem .75rem;
  font-size: 1.2rem;
  cursor: pointer; /* <-- THIS IS THE NEW LINE */
}
.result-box {
  padding: 0.5rem 1rem;
  border-radius: 1px;
  color: black;
  border: 1px solid;
  text-align: center;
}
.result-box .outcome-text {
  font-size: 2.5rem;
  line-height: 1;
}
.now-batting { 
  background-color: #fff8e1; 
  font-weight: bold; 
  font-style: normal !important;
  color: #000 !important;
}
.next-up {
  background-color: #e9ecef; /* A neutral light gray */
  color: #000 !important;
}
.inning-group {
  margin-bottom: 1rem;
}
.inning-header {
  font-weight: bold;
  padding: 0.5rem;
  background-color: #e9ecef;
  border-bottom: 1px solid #dee2e6;
}
.event-log ul {
  margin-top: 0;
}
.action-panel-container {
    display: flex;
    justify-content: center;
    gap: 2rem;
}
.action-panel {
  border: 1px solid #ddd;
  padding: 1rem;
  margin-bottom: 1rem;
  border-radius: 8px;
  width: 300px;
}
.waiting-text { font-style: italic; color: #555; text-align: center;}
.score-update-flash {
  font-size: 1.25rem;
  font-weight: bold;
  color: black;
  text-align: center
}
</style>