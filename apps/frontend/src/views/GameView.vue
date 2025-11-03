<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';
import { socket } from '@/services/socket';
import { getContrastingTextColor } from '@/utils/colors';
import PlayerCard from '@/components/PlayerCard.vue';
import BaseballDiamond from '@/components/BaseballDiamond.vue';
import ThrowRollResult from '@/components/ThrowRollResult.vue';

const showSubModal = ref(false);
const route = useRoute();
const router = useRouter();
const gameStore = useGameStore();
const { isSwingResultVisible, isStealResultVisible } = storeToRefs(gameStore);
const authStore = useAuthStore();
const gameId = route.params.id;
const initialLoadComplete = ref(false);
const seenResultStorageKey = `showdown-game-${gameId}-swing-result-seen`;
const hasSeenResult = ref(JSON.parse(localStorage.getItem(seenResultStorageKey)) || false);
const seriesUpdateMessage = ref('');
const nextGameId = ref(null);
const offensiveDPResultVisible = ref(false);
const defensiveDPRollClicked = ref(false);
const hasRolledForSteal = ref(false);
const isTransitioningToNextHitter = ref(false);

// NEW: Local state to track the offensive player's choice
const choices = ref({});

const selectedCard = ref(null);
const black = ref('#000000');

// New state for the substitution flow
const isSubModeActive = ref(false);
const playerToSubOut = ref(null);

function toggleSubMode() {
  isSubModeActive.value = !isSubModeActive.value;
  playerToSubOut.value = null;
  gameStore.playerSelectedForSwap = null;
}

function selectPlayerToSubOut(player, position) {
  if (gameStore.playerSelectedForSwap) {
    // A player is already selected, so this click completes the action.
    const isPlayerOnField = myLineup.value.battingOrder.some(p => p.player.card_id === player.card_id);

    if (isPlayerOnField) {
      // It's a position swap
      gameStore.swapPlayerPositions(gameId, gameStore.playerSelectedForSwap.card_id, player.card_id);
    } else {
      // It's a substitution from the bench/bullpen
      handleSubstitution(player);
    }
    // Reset for the next action
    isSubModeActive.value = false;
    gameStore.playerSelectedForSwap = null;
    playerToSubOut.value = null;

  } else {
    // This is the first player selected in a potential swap/sub.
    if (playerToSubOut.value?.player.card_id === player.card_id) {
      // Clicking the same player again cancels.
      isSubModeActive.value = false;
      playerToSubOut.value = null;
      gameStore.playerSelectedForSwap = null;
    } else {
      // Select the player.
      playerToSubOut.value = { player, position };
      gameStore.playerSelectedForSwap = player;
    }
  }
}

async function handleSubstitution(playerIn) {
    if (!gameStore.playerSelectedForSwap) return;

    await gameStore.submitSubstitution(gameId, {
        playerInId: playerIn.card_id,
        playerOutId: gameStore.playerSelectedForSwap.card_id,
        position: playerToSubOut.value.position // Position comes from the player being subbed out
    });

    // Reset the substitution state completely
    isSubModeActive.value = false;
    playerToSubOut.value = null;
    gameStore.playerSelectedForSwap = null;
}

const runnerDecisionsWithLabels = computed(() => {
    if (!gameStore.gameState?.currentPlay?.payload?.decisions) {
        return [];
    }
    const decisions = gameStore.gameState.currentPlay.payload.decisions;
    return decisions.map(decision => {
        const fromBase = parseInt(decision.from, 10);
        let toBase;
        const isTagUp = gameStore.gameState.currentPlay.type === 'TAG_UP';
        const hitType = gameStore.gameState.currentPlay.payload.hitType;

        // The `decision.to` indicates the base they are *attempting* to reach.
        // For tag ups, this has been buggy, so we override it.
        if (isTagUp) {
            toBase = fromBase + 1;
        } else if (hitType === '2B' && fromBase === 1) {
            toBase = 4; // On a 2B, the decision for a runner on 1st is always to go home.
        } else if (decision.to) {
            toBase = parseInt(decision.to, 10);
        } else {
            // If `to` is not specified, it's a standard advancement of two bases (e.g., 1st to 3rd on a single).
            toBase = fromBase + 2;
        }

        let toBaseLabel = '';
        switch (toBase) {
            case 2: toBaseLabel = 'to 2nd'; break;
            case 3: toBaseLabel = 'to 3rd'; break;
            case 4: toBaseLabel = 'Home'; break;
            default: toBaseLabel = `to base ${toBase}`; // Fallback
        }
        return {
            ...decision,
            toBase,
            toBaseLabel
        };
    });
});

const defensiveThrowOptions = computed(() => {
    if (!isDefensiveThrowDecision.value) {
        return [];
    }
    const choices = gameStore.gameState.currentPlay.payload.choices;
    const allDecisions = runnerDecisionsWithLabels.value;

    return allDecisions.filter(decision => choices[decision.from]);
});

const baserunningOptionGroups = computed(() => {
    if (!gameStore.gameState?.currentPlay?.payload?.decisions) {
        return [];
    }
    const decisions = runnerDecisionsWithLabels.value;
    // Sort decisions by the runner's starting base, from lead runner to trail runner.
    const sortedDecisions = [...decisions].sort((a, b) => parseInt(b.from, 10) - parseInt(a.from, 10));
    const runnersOn = decisions.map(d => parseInt(d.from, 10));

    // SPECIAL SCENARIO: Single with runners on 1st & 2nd (user request)
    const isAdvanceWithRunnersOnFirstAndSecond = gameStore.gameState.currentPlay.type === 'ADVANCE' &&
                                                runnersOn.length === 2 &&
                                                runnersOn.includes(1) &&
                                                runnersOn.includes(2);

    if (isAdvanceWithRunnersOnFirstAndSecond) {
        const leadRunnerDecision = sortedDecisions.find(d => parseInt(d.from, 10) === 2);
        return [
            { text: `Send ${leadRunnerDecision.runner.name} ${leadRunnerDecision.toBaseLabel}`, choices: { '2': true } },
            { text: "Send Both Runners", choices: { '1': true, '2': true } }
        ];
    }

    // NEW LOGIC for Multi-Runner TAG UP
    const isTagUp = gameStore.gameState.currentPlay.type === 'TAG_UP';
    const runnerCount = sortedDecisions.length;

    if (isTagUp && runnerCount > 1) {
        const cumulativeOptions = [];
        let cumulativeChoices = {};
        const runnerDestinations = [];

        for (let i = 0; i < runnerCount; i++) {
            const decision = sortedDecisions[i];
            cumulativeChoices[decision.from] = true;
            runnerDestinations.push(decision.toBaseLabel.replace('to ', ''));

            let text = '';
            if (i === 0) {
                text = `Send ${decision.runner.name} ${decision.toBaseLabel}`;
            } else if (i === runnerCount - 1) {
                text = "Send All Runners";
            } else {
                const destinations = [...runnerDestinations].reverse();
                text = `Send Runners to ${destinations.join(' & ')}`;
            }

            cumulativeOptions.push({
                text,
                choices: { ...cumulativeChoices }
            });
        }
        return cumulativeOptions;
    }

    // --- Default Logic for all other cases (non-tag-ups, single runner tag-ups) ---
    const defaultOptions = [];
    for (const decision of sortedDecisions) {
        const choices = { [decision.from]: true };
        const text = `Send ${decision.runner.name} ${decision.toBaseLabel}`;
        defaultOptions.push({ text, choices });
    }
    return defaultOptions;
});

const isAdvancementOrTagUpDecision = computed(() => {
    if (!amIOffensivePlayer.value || !isMyTurn.value || !gameStore.gameState?.currentPlay || !isSwingResultVisible.value) {
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

const isAwaitingBaserunningDecision = computed(() => {
    if (amIDefensivePlayer.value && !isMyTurn.value && gameStore.gameState?.currentPlay) {
        const type = gameStore.gameState.currentPlay.type;
        return (type === 'ADVANCE' || type === 'TAG_UP');
    }
    return false;
});
const anticipatedBatter = ref(null);
const infieldIn = ref(false);


const REPLACEMENT_HITTER = { card_id: 'replacement_hitter', displayName: 'Replacement Hitter', control: null };
const REPLACEMENT_PITCHER = { card_id: 'replacement_pitcher', displayName: 'Replacement Pitcher', control: 0, ip: 1 };

const isMyTurn = computed(() => {
  if (!authStore.user || !gameStore.game) return false;
  if (Number(gameStore.game.current_turn_user_id) === 0) return true;
  return Number(authStore.user.userId) === Number(gameStore.game.current_turn_user_id);
});

const isMyTeamAwaitingLineupChange = computed(() => {
    if (!gameStore.gameState || !gameStore.myTeam) return false;
    // NEW: Also check that the invalid lineup *is mine* before showing the message.
    return gameStore.gameState.awaiting_lineup_change &&
           amIDisplayDefensivePlayer.value &&
           playersInInvalidPositions.value.size > 0 &&
           !gameStore.opponentReadyForNext.value;
});

const playersInInvalidPositions = computed(() => {
    if (!myLineup.value) return new Set();
    const invalidPlayerIds = new Set();

    myLineup.value.battingOrder.forEach(spot => {
        const player = spot.player;
        const position = spot.position;

        if (!player || position === 'DH') {
            return; // Skip empty spots and Designated Hitters
        }

        const isAPitcher = player.control !== null;
        const ratings = player.fielding_ratings || {};

        let isInvalid = false;

        switch (position) {
            case 'P':
                if (!isAPitcher) isInvalid = true;
                break;
            case '1B':
                if (isAPitcher) isInvalid = true;
                break;
            case 'LF':
            case 'RF':
                if (ratings[position] === undefined && ratings['LFRF'] === undefined) {
                    isInvalid = true;
                }
                break;
            default:
                if (ratings[position] === undefined) {
                    isInvalid = true;
                }
                break;
        }

        if (isInvalid) {
            invalidPlayerIds.add(player.card_id);
        }
    });

    return invalidPlayerIds;
});


const myLineup = computed(() => gameStore.myTeam ? gameStore.lineups[gameStore.myTeam] : null);
const myRoster = computed(() => gameStore.myTeam ? gameStore.rosters[gameStore.myTeam] : []);

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
    const isHome = gameStore.myTeam === 'home';
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
        teamKey: gameStore.myTeam
    };
});

const rightPanelData = computed(() => {
    const isHome = gameStore.myTeam === 'home';
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
        teamKey: gameStore.myTeam === 'home' ? 'away' : 'home'
    };
});

const usedPlayerIds = computed(() => {
    if (!gameStore.gameState) return new Set();
    const homeUsed = gameStore.gameState.homeTeam?.used_player_ids || [];
    const awayUsed = gameStore.gameState.awayTeam?.used_player_ids || [];
    return new Set([...homeUsed, ...awayUsed]);
});



const scoreChangeMessage = computed(() => {
    // Rely on displayGameState for current scores, as it handles rollbacks.
    const newAwayScore = gameStore.displayGameState?.awayScore;
    const newHomeScore = gameStore.displayGameState?.homeScore;

    // The "before" scores come from the last *completed* at-bat.
    const oldAwayScore = gameStore.gameState?.lastCompletedAtBat?.awayScoreBeforePlay;
    const oldHomeScore = gameStore.gameState?.lastCompletedAtBat?.homeScoreBeforePlay;

    // Fallback if scores are not available yet.
    if (newAwayScore === undefined || newHomeScore === undefined) {
        return null;
    }

    const awayTeamName = gameStore.teams?.away?.abbreviation.toUpperCase() || 'AWAY';
    const homeTeamName = gameStore.teams?.home?.abbreviation.toUpperCase() || 'HOME';

    const awayScored = oldAwayScore !== undefined && newAwayScore > oldAwayScore;
    const homeScored = oldHomeScore !== undefined && newHomeScore > oldHomeScore;

    return {
        away: {
            text: `${awayTeamName} ${newAwayScore}`,
            scored: awayScored
        },
        home: {
            text: `${homeTeamName} ${newHomeScore}`,
            scored: homeScored
        }
    };
});

const runScoredOnPlay = computed(() => {
  if (!gameStore.gameEvents || gameStore.gameEvents.length === 0) {
    return false;
  }
  // Get the most recent event from the log
  const lastEvent = gameStore.gameEvents[gameStore.gameEvents.length - 1];
  // Check if its message contains the word "scores!" or "HOME RUN"
  return lastEvent.log_message?.includes('scores!') || lastEvent.log_message?.includes('HOME RUN');
});

const scoreUpdateVisible = computed(() => {
  const swingIsVisible = isSwingResultVisible.value || (amIDisplayOffensivePlayer.value && isSwingResultVisible.value);
  return runScoredOnPlay.value && swingIsVisible;
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
  // If we are between innings, the "isTopInning" flag has already flipped to the *next*
  // inning. For display purposes, we want to show the state of the inning that just
  // concluded, so we flip it back.
  if (gameStore.isEffectivelyBetweenHalfInnings.value) {
    return !gameStore.gameState.isTopInning;
  }
  return gameStore.gameState.isTopInning;
});

const batterLineupInfo = computed(() => {
    if (!gameStore.gameState || !gameStore.lineups.away?.battingOrder) return null;
    const lineup = isDisplayTopInning.value ? gameStore.lineups.away.battingOrder : gameStore.lineups.home.battingOrder;
    if (!lineup || lineup.length === 0) return null;
    const pos = isDisplayTopInning.value ? gameStore.gameState.awayTeam.battingOrderPosition : gameStore.gameState.homeTeam.battingOrderPosition;
    return lineup[pos];
});



// NEW: Display-only computeds for the inning changeover
const amIDisplayOffensivePlayer = computed(() => {
  if (!authStore.user || !gameStore.gameState) return false;
  // The offensive team is the away team if it's the top of the inning for display purposes.
  const offensiveTeam = isDisplayTopInning.value ? gameStore.gameState.awayTeam : gameStore.gameState.homeTeam;
  return Number(authStore.user.userId) === Number(offensiveTeam.userId);
});

const amIDisplayDefensivePlayer = computed(() => {
  return !amIDisplayOffensivePlayer.value;
});

// UI State Computeds
const pitcherOnlySetActions = computed(() => {
  if (!gameStore.gameState || !gameStore.gameState.currentAtBat) return false;
  return !!gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction;
});

// NEW: Centralized logic to determine if the current play's outcome should be hidden from the user.
// This refactored computed property avoids the reactive loop by not depending on `displayGameState`.
const shouldHideCurrentAtBatOutcome = computed(() => {
  // THIS IS THE FIX. When we are transitioning, we are DONE with the previous
  // at-bat, and there is no longer an outcome to hide. This prevents the
  // flicker that happens when `isSwingResultVisible` is reset to false.
  if (isTransitioningToNextHitter.value) return false;
  if (!gameStore.gameState) return false;

  // NEW: Scenario 0: Always hide the outcome while awaiting the double play roll result.
  if (showRollForDoublePlayButton.value) {
    return true;
  }

  //if(isStealAttemptInProgress.value && !showThrowRollResult.value && !gameStore.gameState.currentPlay.payload.decisions){
  if(!!gameStore.gameState.stealAttemptDetails && (!showThrowRollResult.value && amIDisplayDefensivePlayer.value)){
    return true
  }

  // If the game state or current at-bat isn't available, there's nothing to hide.
  if (!gameStore.gameState.currentAtBat) return false;

  const atBatIsResolved = !!gameStore.gameState.currentAtBat.batterAction && !!gameStore.gameState.currentAtBat.pitcherAction;

  // If the at-bat isn't resolved, no outcome exists yet to be hidden.
  if (!atBatIsResolved && !gameStore.opponentReadyForNext) return false;

  // Scenario 1: Offensive player has resolved the at-bat but hasn't "rolled" to see the result.
  const isOffensivePlayerWaitingToRoll = amIDisplayOffensivePlayer.value && !isSwingResultVisible.value && !gameStore.gameState.inningEndedOnCaughtStealing;
  if (isOffensivePlayerWaitingToRoll) {
    return true;
  }

  // Scenario 2: Defensive player acted second and is waiting for the 900ms reveal timer.
  const isDefensivePlayerWaitingForReveal = amIDisplayDefensivePlayer.value &&
                                            gameStore.gameState.defensivePlayerWentSecond &&
                                            !isSwingResultVisible.value;
  if (isDefensivePlayerWaitingForReveal) {
    return true;
  }

  // In all other cases, the outcome should be visible.
  return false;
});


// Watch the new computed property and update the central store state.
// This is the link that tells the store whether to provide a "rolled-back" game state.
watch(shouldHideCurrentAtBatOutcome, (newValue) => {
  // Guard against unmount race conditions where the watcher might fire after
  // the store has been cleared but before the component is fully gone.
  if (!gameStore.gameState) return;
  gameStore.setOutcomeHidden(newValue);
}, { immediate: true });

const offensiveChoiceMade = computed(() => !!gameStore.gameState?.currentAtBat?.batterAction);

const isOffensiveStealInProgress = computed(() => {
    return amIOffensivePlayer.value && gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT';
});

const canAttemptSteal = computed(() => {
    if (!amIOffensivePlayer.value || !gameStore.gameState) {
        return false;
    }
    const isStealPhase = isMyTurn.value && (
        !gameStore.gameState.currentPlay ||
        (gameStore.gameState.currentPlay.type === 'STEAL_ATTEMPT' && !gameStore.gameState.currentPlay.payload.queuedDecisions)
    );
    if (!isStealPhase) {
        return false;
    }
    const { bases } = gameStore.gameState;
    const canStealSecond = bases.first && !bases.second;
    const canStealThird = bases.second && !bases.third;
    return canStealSecond || canStealThird;
});

const canStealSecond = computed(() => {
    if (!canAttemptSteal.value) return false;
    return gameStore.gameState.bases.first && !gameStore.gameState.bases.second;
});

const canStealThird = computed(() => {
    if (!canAttemptSteal.value) return false;
    // During an in-progress steal, check the decision payload, not the final base state.
    if (isOffensiveStealInProgress.value) {
        const decisions = gameStore.gameState.currentPlay.payload.decisions;
        // True if a runner is going TO second and third is open.
        return decisions['1'] && !gameStore.gameState.bases.third;
    }
    // Standard check for a runner on second with third base open.
    return gameStore.gameState.bases.second && !gameStore.gameState.bases.third;
});

const canDoubleSteal = computed(() => {
    // Disable double steals if a steal is already in progress to avoid complex states.
    if (!canAttemptSteal.value || isOffensiveStealInProgress.value) return false;
    const { bases } = gameStore.gameState;
    return bases.first && bases.second && !bases.third;
});

const isRunnerOnThird = computed(() => !!gameStore.gameState?.bases?.third);

const showRollForPitchButton = computed(() => {
  const result = amIDisplayDefensivePlayer.value && !gameStore.gameState.currentAtBat.pitcherAction && !(!gameStore.amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext)) && !(gameStore.gameState.inningEndedOnCaughtStealing && gameStore.amIReadyForNext.value);
  console.log(`showRollForPitchButton: ${result}`);
  return result;
});

const showSwingAwayButton = computed(() => {
  const result = amIDisplayOffensivePlayer.value && !gameStore.gameState.currentAtBat.batterAction && (gameStore.amIReadyForNext || bothPlayersCaughtUp.value) && !(amIDisplayOffensivePlayer.value && !!gameStore.gameState.currentPlay && !!gameStore.gameState.currentPlay?.payload.decisions[1]) && !isWaitingForQueuedStealResolution.value && !gameStore.gameState.inningEndedOnCaughtStealing;
  console.log(`showSwingAwayButton: ${result}`);
  return result;
});

const showNextHitterButton = computed(() => {
  let reason = '';
  let result = false;

  if (gameStore.gameState?.inningEndedOnCaughtStealing && !gameStore.amIReadyForNext) {
    reason = 'Inning ended on caught stealing';
    result = true;
  } else if (showRollForDoublePlayButton.value && (amIDefensivePlayer.value || !offensiveDPResultVisible.value)) {
    reason = 'Waiting for double play resolution';
    result = false;
  } else if (isAwaitingBaserunningDecision.value) {
    reason = 'Awaiting baserunning decision';
    result = false;
  } else if (gameStore.gameState.currentPlay?.type === 'ADVANCE' && isSwingResultVisible && !!gameStore.gameState.currentPlay.payload.choices) {
    reason = 'Awaiting advance throw decision';
    result = false;
  } else if (gameStore.amIReadyForNext) {
    reason = 'I am ready for the next hitter';
    result = false;
  } else {
    const atBatIsResolved = bothPlayersSetAction.value;
    if ((atBatIsResolved || amIDisplayOffensivePlayer.value) && !isSwingResultVisible.value) {
      reason = 'At-bat is resolved but result not visible';
      result = false;
    } else if (amIOffensivePlayer.value && offensiveDPResultVisible.value) {
      reason = 'Offensive player DP timer is up';
      result = true;
    } else if (gameStore.isBetweenHalfInnings) {
      reason = 'Between half innings';
      result = true;
    } else {
      const opponentIsReady = gameStore.opponentReadyForNext;
      result = atBatIsResolved || opponentIsReady;
      reason = `Standard condition: atBatIsResolved=${atBatIsResolved}, opponentIsReady=${opponentIsReady}`;
    }
  }

  console.log(`showNextHitterButton: ${result} (Reason: ${reason})`);
  return result;
});


const showRollForSwingButton = computed(() => {
  let reason = '';
  let result = false;

  if (isTransitioningToNextHitter.value) {
    reason = 'Transitioning to next hitter';
    result = false;
  } else if (!amIDisplayOffensivePlayer.value) {
    reason = 'Not the offensive player';
    result = false;
  } else if (isSwingResultVisible.value) {
    reason = 'Swing result is already visible';
    result = false;
  } else if (gameStore.gameState.inningEndedOnCaughtStealing) {
    reason = 'inningEndedOnCaughtStealing true';
    result = false;
  } else {
    result = bothPlayersSetAction.value || gameStore.opponentReadyForNext;
    reason = `Ready for swing roll: bothPlayersSetAction=${bothPlayersSetAction.value}, opponentReadyForNext=${gameStore.opponentReadyForNext}`;
  }

  console.log(`showRollForSwingButton: ${result} (Reason: ${reason})`);
  return result;
});

const showRollForDoublePlayButton = computed(() => {
  const isDPBall = !!gameStore.gameState?.doublePlayDetails;
  return isDPBall && amIDisplayDefensivePlayer.value && !defensiveDPRollClicked.value && !!gameStore.amIReadyForNext;
});

const isWaitingForDoublePlayResolution = computed(() => {
  const isDPBall = !!gameStore.gameState?.doublePlayDetails;
  return isDPBall && amIOffensivePlayer.value && !offensiveDPResultVisible.value;
});

const isWaitingForQueuedStealResolution = computed(() => {
    return amIOffensivePlayer.value &&
           gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT' &&
           !!gameStore.gameState.currentPlay.payload.queuedDecisions;
});

function handleRollForDoublePlay() {
  defensiveDPRollClicked.value = true;
}

watch(() => gameStore.gameState?.doublePlayDetails, (newDetails, oldDetails) => {
  const isNewDPPlay = newDetails && !oldDetails;
  const isDPPlayOver = !newDetails && oldDetails;

  // Only reset the local state at the very beginning or very end of the DP sequence.
  // This prevents the flag from flipping mid-sequence when the object is updated.
  if (isNewDPPlay || isDPPlayOver) {
    defensiveDPRollClicked.value = false;
    offensiveDPResultVisible.value = false;
  }

  // If it's a new double play, start the timer for the offensive player.
  if (isNewDPPlay) {
    if (amIOffensivePlayer.value) {
      setTimeout(() => {
        offensiveDPResultVisible.value = true;
      }, 900);
    }
  }
}, { immediate: true });

const showThrowRollResult = computed(() => {
  const hasDetails = !!gameStore.gameState?.doublePlayDetails;
  if (!hasDetails) return false;

  // Defensive player sees it only after clicking.
  if (amIDefensivePlayer.value) {
    return defensiveDPRollClicked.value;
  }

  // Offensive player sees it after their timer.
  if (amIOffensivePlayer.value) {
    return offensiveDPResultVisible.value && isSwingResultVisible.value;
  }

  // Spectators see it immediately.
  return true;
});

const showAutoThrowResult = computed(() => {
  // This computed is now ONLY for post-at-bat throws (e.g., fielder's choice).
  // Steals are handled by the new `showStealResult` computed.
  return isSwingResultVisible.value && !!gameStore.gameState?.throwRollResult;
});

// NEW: This computed specifically controls the visibility of the steal result box.
const showStealResult = computed(() => {
  return !!gameStore.gameState?.lastStealResult;
});

const defensiveRatingsToDisplay = computed(() => {
  if (!gameStore.gameState) return { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 };
  // If we are displaying the top of the inning, the HOME team is on defense.
  return isDisplayTopInning.value
    ? gameStore.gameState.homeDefensiveRatings
    : gameStore.gameState.awayDefensiveRatings;
});

const outfieldDefense = computed(() => defensiveRatingsToDisplay.value?.outfieldDefense ?? 0);

const infieldDefense = computed(() => defensiveRatingsToDisplay.value?.infieldDefense ?? 0);

const catcherArm = computed(() => defensiveRatingsToDisplay.value?.catcherArm ?? 0);

const catcherArmDisplay = computed(() => {
    const value = catcherArm.value;
    return `C ${value >= 0 ? '+' : ''}${value}`;
});

const infieldDefenseDisplay = computed(() => {
    const value = infieldDefense.value;
    return `IF ${value >= 0 ? '+' : ''}${value}`;
});

const outfieldDefenseDisplay = computed(() => {
    const value = outfieldDefense.value;
    return `OF ${value >= 0 ? '+' : ''}${value}`;
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

const atBatToDisplay = computed(() => {
    if (!gameStore.gameState) {
      // During component teardown or initial load, gameState can be null.
      // Return a default, safe structure to prevent cascading errors.
      return { batterAction: null, pitcherAction: null, pitchRollResult: null, swingRollResult: null };
    }
    if (!gameStore.amIReadyForNext && gameStore.opponentReadyForNext) {
        return gameStore.gameState.lastCompletedAtBat;
    }
    return gameStore.gameState.currentAtBat;
});


const bothPlayersSetAction = computed(() => {
    // This logic must be based on the *actual* current at-bat, not the one for display.
    if (!gameStore.gameState?.currentAtBat) return false;
    return !!gameStore.gameState.currentAtBat.batterAction && !!gameStore.gameState.currentAtBat.pitcherAction;
});

// in GameView.vue
watch(bothPlayersSetAction, (isRevealing) => {
  // Guard against both the initial load and unmount race conditions.
  if (!initialLoadComplete.value || !gameStore.gameState) return;

  if (isRevealing) {
    if (amIDisplayDefensivePlayer.value) {
      if (hasSeenResult.value) {
        gameStore.setIsSwingResultVisible(true);
        return;
      }
      const defensivePlayerSecond = gameStore.gameState.defensivePlayerWentSecond;
      if (defensivePlayerSecond) {
        setTimeout(() => {
          gameStore.setIsSwingResultVisible(true);
          hasSeenResult.value = true;
          localStorage.setItem(seenResultStorageKey, 'true');
        }, 900);
      } else {
        gameStore.setIsSwingResultVisible(true);
        hasSeenResult.value = true;
        localStorage.setItem(seenResultStorageKey, 'true');
      }
    }
  }
}, { immediate: true });

watch(() => atBatToDisplay.value?.pitcherAction, (newAction) => {
    if (newAction === 'intentional_walk' && amIOffensivePlayer.value) {
        gameStore.setIsSwingResultVisible(true);
    }
});

const nextBatterInLineup = computed(() => {
  if (!gameStore.gameState || !gameStore.lineups?.home || !gameStore.lineups?.away) return null;

  // If the inning is over, the "next" batter is the leadoff for the OTHER team.
  if (gameStore.isEffectivelyBetweenHalfInnings) {
    const isCurrentlyTop = gameStore.gameState.isTopInning;
    // The NEW offensive team is the opposite of the current inning.
    const offensiveTeamState = isCurrentlyTop ? gameStore.gameState.awayTeam : gameStore.gameState.homeTeam;
    const offensiveLineup = isCurrentlyTop ? gameStore.lineups.away.battingOrder : gameStore.lineups.home.battingOrder;

    if (!offensiveLineup) return null;

    // The next batter is whoever is at the current batting order position for that team.
    return offensiveLineup[offensiveTeamState.battingOrderPosition]?.player;

  } else {
    // It's mid-inning, so find the next batter for the CURRENT offensive team.
    const isTop = gameStore.gameState.isTopInning;
    const offensiveTeamState = isTop ? gameStore.gameState.awayTeam : gameStore.gameState.homeTeam;
    const offensiveLineup = isTop ? gameStore.lineups.away.battingOrder : gameStore.lineups.home.battingOrder;

    if (!offensiveLineup) return null;

    // Calculate the index of the next batter in the order
    const nextIndex = (offensiveTeamState.battingOrderPosition + 1) % 9;

    return offensiveLineup[nextIndex]?.player;
  }
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
    // NEW: Only show the "last at bat" to the player who is WAITING for the other player.
    if (!gameStore.amIReadyForNext && (gameStore.opponentReadyForNext || (gameStore.isEffectivelyBetweenHalfInnings && !(!gameStore.opponentReadyForNext && !gameStore.amIReadyForNext))) && !isStealAttemptInProgress.value) {
        return gameStore.gameState.lastCompletedAtBat.batter;
    }
    // MODIFIED: The single source of truth for the current batter is the lineup,
    // as `currentAtBat.batter` can become stale after a substitution.
    return batterLineupInfo.value?.player ?? gameStore.gameState.currentAtBat?.batter ?? null;
});

const pitcherToDisplay = computed(() => {
    if (!gameStore.gameState) return null;
    // NEW: Only show the "last at bat" to the player who is WAITING for the other player.
    if (!gameStore.amIReadyForNext && (gameStore.opponentReadyForNext || (gameStore.isEffectivelyBetweenHalfInnings && !(!gameStore.opponentReadyForNext && !gameStore.amIReadyForNext))) && !isStealAttemptInProgress.value) {
        return gameStore.gameState.lastCompletedAtBat.pitcher;
    }
    // In all other cases, show the data for the current at-bat.
    return isDisplayTopInning.value ? gameStore.lineups.home.startingPitcher : gameStore.lineups.away.startingPitcher
});


// in GameView.vue
const showResolvedState = computed(() => {
  const atBatIsResolved = gameStore.gameState.currentAtBat?.batterAction && gameStore.gameState.currentAtBat?.pitcherAction
  const waitingToSwing = amIOffensivePlayer.value && !isSwingResultVisible.value;
  return atBatIsResolved && !waitingToSwing;
});


// in GameView.vue
const basesToDisplay = computed(() => {
  // Now simply returns the bases from the authoritative displayGameState.
  return gameStore.displayGameState?.bases || { first: null, second: null, third: null };
});

const outsToDisplay = computed(() => {
  // This now fully trusts the authoritative `displayGameState` to provide the correct
  // out count at all times, whether the state is rolled back or not.
  return gameStore.displayGameState?.outs ?? 0;
});

const isGameOver = computed(() => gameStore.game?.status === 'completed');

const seriesStatusText = computed(() => {
  const game = gameStore.game;
  const series = gameStore.series;
  const teams = gameStore.teams;

  if (!game || !series) {
    return 'Exhibition';
  }

  const gameNumber = game.game_in_series;
  const homeWins = series.home_wins;
  const awayWins = series.away_wins;

  if (homeWins === awayWins) {
    return `Game ${gameNumber}, Tied ${homeWins}-${awayWins}`;
  }

  const homeTeamAbbr = teams.home?.abbreviation || 'HOME';
  const awayTeamAbbr = teams.away?.abbreviation || 'AWAY';

  const leadingTeamAbbr = homeWins > awayWins ? homeTeamAbbr : awayTeamAbbr;
  const leadingWins = Math.max(homeWins, awayWins);
  const trailingWins = Math.min(homeWins, awayWins);
  return `Game ${gameNumber}, ${leadingTeamAbbr} leads ${leadingWins}-${trailingWins}`;
});

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
    gameStore.setIsStealResultVisible(true);
    gameStore.initiateSteal(gameId, decisions);
}

function handlePitch(action = null) {
  console.log('1. GameView: handlePitch function was called.');
  gameStore.submitPitch(gameId, action);
}
function handleOffensiveAction(action) {
  console.log('1. GameView: handleOffensiveAction was called with action:', action);
  if (action === 'bunt') {
    gameStore.setIsSwingResultVisible(true);
  }
  gameStore.submitAction(gameId, action);
}

function handleSwing(action = null) {
  gameStore.setIsSwingResultVisible(true); // Set the flag immediately
  gameStore.submitSwing(gameId, action);
}
function handleNextHitter() {
  console.log('--- 1. handleNextHitter called ---');
  isTransitioningToNextHitter.value = true;
  // Reset the result visibility for the current player.
  gameStore.setIsSwingResultVisible(false);
  gameStore.setIsStealResultVisible(false);
  hasSeenResult.value = false;
  localStorage.removeItem(seenResultStorageKey);

  if (!gameStore.opponentReadyForNext && !gameStore.isEffectivelyBetweenHalfInnings) {
    console.log('--- 1a. Setting anticipated batter ---');
    anticipatedBatter.value = nextBatterInLineup.value;
  }
  gameStore.setIsSwingResultVisible(false);
  gameStore.nextHitter(gameId);
}

function handleRunnerDecisions(choices) {
    gameStore.submitBaserunningDecisions(gameId, choices);
}

function handleDefensiveThrow(base) {
    gameStore.resolveDefensiveThrow(gameId, base);
}

function handleResolveSteal(throwToBase = null) {
  hasRolledForSteal.value = true;
  gameStore.resolveSteal(gameId, throwToBase);
}


const isStealAttemptInProgress = computed(() => {
    if (!amIDefensivePlayer.value || !isMyTurn.value) return false;
    // A steal is in progress if there is a pending steal attempt from the backend.
    const isSingleStealInProgress = !!gameStore.gameState?.pendingStealAttempt;
    // A double steal is in progress if the currentPlay indicates a steal, but there is no pending single steal.
    const isDoubleStealInProgress = gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT' && !isSingleStealInProgress;
    return isSingleStealInProgress || isDoubleStealInProgress;
});

const isSingleSteal = computed(() => {
    return isStealAttemptInProgress.value && !!gameStore.gameState.pendingStealAttempt;
});

const stealingRunner = computed(() => {
    if (!isSingleSteal.value) return null;
    return gameStore.gameState.pendingStealAttempt.runnerName;
});

const targetBase = computed(() => {
    if (!isSingleSteal.value) return null;
    const baseNumber = gameStore.gameState.pendingStealAttempt.throwToBase;
    const getOrdinal = (n) => {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    return getOrdinal(baseNumber);
});

const isInfieldInDecision = computed(() => {
    return amIOffensivePlayer.value && isMyTurn.value && gameStore.gameState?.currentPlay?.type === 'INFIELD_IN_CHOICE';
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



watch(infieldIn, (newValue, oldValue) => {
    // Only send an update if the value was changed by the user,
    // not when it's being sync'd from the server.
    if (newValue !== oldValue && amIDefensivePlayer.value) {
        gameStore.setDefense(gameId, newValue);
    }
});

// This watcher keeps the checkbox sync'd with the actual state of the at-bat being viewed.
watch(() => atBatToDisplay.value?.infieldIn, (newValue) => {
    infieldIn.value = !!newValue;
}, { immediate: true });

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
        isTransitioningToNextHitter.value = false;
    }
});

watch(isStealAttemptInProgress, (newValue) => {
  if (newValue) {
    hasRolledForSteal.value = false;
  }
});



const defensiveTeamKey = computed(() => gameStore.gameState?.isDisplayTopInning ? 'homeTeam' : 'awayTeam');
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
         (gameStore.gameState.currentAtBat.pitchRollResult || !gameStore.amIReadyForNext && !bothPlayersCaughtUp.value) &&
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

  // Initialize isSwingResultVisible from localStorage on component mount
  const storedResultSeen = JSON.parse(localStorage.getItem(seenResultStorageKey)) || false;
  if (storedResultSeen) {
      gameStore.setIsSwingResultVisible(true);
      hasSeenResult.value = true;
  }

  initialLoadComplete.value = true;

  // NEW: Check if we are returning to a completed at-bat
  const atBat = atBatToDisplay.value;
  if (atBat && atBat.swingRollResult && atBat.pitchRollResult) {
    const isOffensiveAndHasNotRolled = amIOffensivePlayer.value && !isSwingResultVisible.value;
    if (!isOffensiveAndHasNotRolled) {
      gameStore.setIsSwingResultVisible(true);
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
    console.log('--- 3. GameView: game-updated event received from socket. ---', data);
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

  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onUnmounted(() => {
  gameStore.resetGameState();
  socket.off('game-updated');
  socket.off('series-next-game-ready');
  socket.disconnect();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    gameStore.fetchGame(gameId);
  }
}
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
          <ThrowRollResult
            v-if="showThrowRollResult"
            :details="gameStore.gameState.doublePlayDetails"
            :teamColors="pitcherTeamColors"
          />
          <ThrowRollResult
            v-if="showAutoThrowResult"
            :details="gameStore.gameState.throwRollResult"
            :teamColors="pitcherTeamColors"
          />
          <ThrowRollResult
            v-if="showStealResult"
            :details="gameStore.gameState.lastStealResult"
            :teamColors="pitcherTeamColors"
          />
          <div class="defensive-ratings">
            <div>{{ catcherArmDisplay }}</div>
            <div>{{ infieldDefenseDisplay }}</div>
            <div>{{ outfieldDefenseDisplay }}</div>
            <div v-if="atBatToDisplay.infieldIn" style="color: red;">IF IN</div>
          </div>
          <div v-if="atBatToDisplay.pitchRollResult &&
           (gameStore.gameState.currentAtBat.pitchRollResult || !gameStore.amIReadyForNext && gameStore.opponentReadyForNext) &&
            !(!bothPlayersSetAction.value && amIDisplayOffensivePlayer && !atBatToDisplay.batterAction) &&
            !isStealAttemptInProgress && !(showAutoThrowResult && !atBatToDisplay.swingRollResult)" :class="pitchResultClasses" :style="{ backgroundColor: hexToRgba(pitcherTeamColors.primary), borderColor: hexToRgba(pitcherTeamColors.secondary), color: pitcherResultTextColor }">
              Pitch: <strong>{{ atBatToDisplay.pitchRollResult.roll === 'IBB' ? 'IBB' : atBatToDisplay.pitchRollResult.roll }}</strong>
          </div>
          <div v-if="atBatToDisplay.swingRollResult && isSwingResultVisible" :class="swingResultClasses" :style="{ backgroundColor: hexToRgba(batterTeamColors.primary), borderColor: hexToRgba(batterTeamColors.secondary), color: batterResultTextColor }">
              Swing: <strong>{{ atBatToDisplay.swingRollResult.roll }}</strong><br>
              <strong class="outcome-text">{{ atBatToDisplay.swingRollResult.outcome }}</strong>
          </div>
          <div v-if="scoreUpdateVisible && scoreChangeMessage" class="score-update-flash">
            <span
              :class="{ 'score-box-highlight': scoreChangeMessage.away.scored }"
              :style="scoreChangeMessage.away.scored
                ? {
                    backgroundColor: hexToRgba(awayTeamColors.primary),
                    borderColor: hexToRgba(awayTeamColors.secondary),
                    color: getContrastingTextColor(awayTeamColors.primary)
                  }
                : {}"
            >
              {{ scoreChangeMessage.away.text }}
            </span>
            <span>, </span>
            <span
              :class="{ 'score-box-highlight': scoreChangeMessage.home.scored }"
              :style="scoreChangeMessage.home.scored
                ? {
                    backgroundColor: hexToRgba(homeTeamColors.primary),
                    borderColor: hexToRgba(homeTeamColors.secondary),
                    color: getContrastingTextColor(homeTeamColors.primary)
                  }
                : {}"
            >
              {{ scoreChangeMessage.home.text }}
            </span>
          </div>
      </div>

      <!-- PLAYER CARDS & ACTIONS -->
      <div class="player-cards-and-actions-container">
        <!-- Actions (for layout purposes) -->
        <div class="actions-container">
            <!-- PITCHER SELECTION STATE -->
        <div v-if="isMyTeamAwaitingLineupChange" class="waiting-text">
                <h3>Invalid Lineup</h3>
                <p>One or more players are out of position. Please correct your lineup to continue.</p>
            </div>

            <!-- Main Action Buttons -->
            <div v-else-if="isAdvancementOrTagUpDecision">
                <div class="runner-decisions-group">
                    <button v-for="(group, index) in baserunningOptionGroups"
                            :key="index"
                            @click="handleRunnerDecisions(group.choices)"
                            class="tactile-button">
                        {{ group.text }}
                    </button>
                    <button @click="handleRunnerDecisions({})" class="tactile-button">
                        Hold Runners
                    </button>
                </div>
            </div>
            <div v-else-if="isDefensiveThrowDecision">
                <h3>Defensive Throw</h3>
                <p>Opponent is sending runners! Choose where to throw:</p>
                <div class="defensive-throw-decisions">
                    <button v-for="option in defensiveThrowOptions"
                            :key="option.from"
                            @click="handleDefensiveThrow(option.toBase)"
                            class="tactile-button">
                        Throw {{ option.toBaseLabel }}
                    </button>
                </div>
            </div>
            <div v-else-if="isStealAttemptInProgress && amIDefensivePlayer">
                <div v-if="isSingleSteal">
                    <h3>{{ stealingRunner }} is stealing {{ targetBase }}!</h3>
                    <button @click="handleResolveSteal()" class="action-button tactile-button"><strong>ROLL FOR THROW</strong></button>
                </div>
                <div v-else>
                    <h3>Opponent is attempting a double steal!</h3>
                    <p>Choose which base to throw to:</p>
                    <div class="steal-throw-decisions">
                      <button @click="handleResolveSteal(2)" v-if="gameStore.gameState.currentPlay.payload.decisions['1']" class="tactile-button">Throw to 2nd</button>
                      <button @click="handleResolveSteal(3)" v-if="gameStore.gameState.currentPlay.payload.decisions['2']" class="tactile-button">Throw to 3rd</button>
                    </div>
                </div>
            </div>
            <div v-else-if="isInfieldInDecision">
                <h3>Infield In Play</h3>
                <p>The defense has the infield in. What will the runner on third do?</p>
                <button @click="handleInfieldInDecision(true)" class="tactile-button">Send Runner Home</button>
                <button @click="handleInfieldInDecision(false)" class="tactile-button">Hold Runner</button>
            </div>
            <div v-else>
                <button v-if="showRollForDoublePlayButton" class="action-button tactile-button" @click="handleRollForDoublePlay()"><strong>ROLL FOR DOUBLE PLAY</strong></button>
                <button v-else-if="showRollForPitchButton" class="action-button tactile-button" @click="handlePitch()"><strong>ROLL FOR PITCH</strong></button>
                <button v-else-if="showSwingAwayButton" class="action-button tactile-button" @click="handleOffensiveAction('swing')"><strong>Swing Away</strong></button>
                <button v-else-if="showRollForSwingButton" class="action-button tactile-button" @click="handleSwing()"><strong>ROLL FOR SWING </strong></button>
                <button v-if="showNextHitterButton" class="action-button tactile-button" @click="handleNextHitter()"><strong>Next Hitter</strong></button>

                <!-- Secondary Action Buttons -->
                <div class="secondary-actions">
                    <button v-if="showRollForPitchButton" class="tactile-button" @click="handlePitch('intentional_walk')">Intentional Walk</button>
                    <div v-if="showRollForPitchButton && isRunnerOnThird && outsToDisplay < 2" class="infield-in-checkbox">
                        <label>
                            <input type="checkbox" v-model="infieldIn" />
                            Infield In
                        </label>
                    </div>
                    <button v-if="showSwingAwayButton" class="tactile-button" @click="handleOffensiveAction('bunt')">Bunt</button>
                    <button v-if="canStealSecond && showSwingAwayButton" @click="handleInitiateSteal({ '1': true })" class="tactile-button">Steal 2nd</button>
                    <button v-if="canStealThird && showSwingAwayButton" @click="handleInitiateSteal({ '2': true })" class="tactile-button">Steal 3rd</button>
                    <button v-if="canDoubleSteal && showSwingAwayButton" @click="handleInitiateSteal({ '1': true, '2': true })" class="tactile-button">Double Steal</button>
                </div>
            </div>

            <!-- Waiting Indicators -->
            <div v-if="isAwaitingBaserunningDecision" class="waiting-text">Waiting on baserunning decision...</div>
            <div v-else-if="amIDisplayOffensivePlayer && gameStore.gameState.currentAtBat.batterAction && !gameStore.gameState.currentAtBat.pitcherAction && !isStealAttemptInProgress && !isAdvancementOrTagUpDecision && !isDefensiveThrowDecision" class="waiting-text">Waiting for pitch...</div>
            <div v-else-if="amIDisplayDefensivePlayer && gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction && !isStealAttemptInProgress && !isAdvancementOrTagUpDecision && !isDefensiveThrowDecision && !gameStore.isEffectivelyBetweenHalfInnings" class="turn-indicator">Waiting for swing...</div>
            <div v-else-if="isWaitingForDoublePlayResolution || isWaitingForQueuedStealResolution || (amIDisplayOffensivePlayer && (gameStore.gameState.currentPlay?.type === 'STEAL_ATTEMPT' && !!gameStore.gameState.currentPlay?.payload.decisions[1] || gameStore.gameState.currentPlay?.type === 'ADVANCE' && isSwingResultVisible && !!gameStore.gameState.currentPlay.payload.choices))" class="waiting-text">Waiting for throw...</div>
        </div>

        <!-- Player Cards Wrapper -->
        <div class="player-cards-wrapper">
          <!-- USER-CONTROLLED PLAYER -->
          <div class="player-container">
            <PlayerCard
              v-if="controlledPlayer"
              :player="controlledPlayer"
              :role="controlledPlayerRole"
              :is-controlled-player="true"
              :has-advantage="controlledPlayerHasAdvantage"
              :primary-color="controlledPlayerTeamColors.primary"
            />
            <div v-else class="tbd-pitcher-card" :style="{ borderColor: controlledPlayerTeamColors.primary }">
                <div v-if="gameStore.gameState.awaiting_lineup_change" class="selecting-pitcher-text">
                    <h3><em>Selecting Pitcher...</em></h3>
                </div>
                <template v-else>
                    <span v-if="!gameStore.gameState.awaiting_lineup_change" class="tbd-role">{{ controlledPlayerRole }}</span>
                    <span class="tbd-name">TBD</span>
                </template>
            </div>
          </div>

          <!-- OPPONENT PLAYER -->
          <div class="player-container">
            <PlayerCard
              v-if="opponentPlayer"
              :player="opponentPlayer"
              :role="opponentPlayerRole"
              :is-controlled-player="false"
              :has-advantage="opponentPlayerHasAdvantage"
              :primary-color="opponentPlayerTeamColors.primary"
            />
             <div v-else class="tbd-pitcher-card" :style="{ borderColor: opponentPlayerTeamColors.primary }">
                <div v-if="gameStore.gameState.awaiting_lineup_change" class="selecting-pitcher-text">
                     <h3><em>Selecting Pitcher...</em></h3>
                </div>
                <template v-else>
                    <span v-if="!gameStore.gameState.awaiting_lineup_change" class="tbd-role">{{ opponentPlayerRole }}</span>
                    <span class="tbd-name">TBD</span>
                </template>
            </div>
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
              <span v-if="leftPanelData.isMyTeam && ((amIDisplayDefensivePlayer && !gameStore.gameState.currentAtBat.pitcherAction && !(!gameStore.amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext))) ||(amIDisplayOffensivePlayer && !gameStore.gameState.currentAtBat.batterAction && (gameStore.amIReadyForNext || bothPlayersCaughtUp)) || (gameStore.gameState?.awaiting_lineup_change && amIDisplayDefensivePlayer))" @click.stop="toggleSubMode" class="sub-icon visible" :class="{'active': isSubModeActive}">⇄</span>
          </h3>
          <ol>
              <li v-for="(spot, index) in leftPanelData.lineup" :key="spot.player.card_id"
                  :class="{
                      'now-batting': amIDisplayOffensivePlayer && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                      'next-up': amIDisplayDefensivePlayer && index === defensiveNextBatterIndex,
                      'is-sub-target': playerToSubOut?.player.card_id === spot.player.card_id,
                      'invalid-position': isMyTeamAwaitingLineupChange && playersInInvalidPositions.has(spot.player.card_id)
                  }"
                  :style="playerToSubOut && spot.player && playerToSubOut.player.card_id === spot.player.card_id ? { backgroundColor: leftPanelData.colors.primary, color: getContrastingTextColor(leftPanelData.colors.primary) } : {}"
                  class="lineup-item">
                  <span @click.stop="selectPlayerToSubOut(spot.player, spot.position)"
                        class="sub-icon"
                        :class="{
                            'visible': isSubModeActive && leftPanelData.isMyTeam && spot.position !== 'DH',
                            'active': playerToSubOut?.player.card_id === spot.player.card_id
                        }">
                      ⇄
                  </span>
                  <span @click="selectedCard = spot.player">{{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }})</span>
              </li>
          </ol>
          <div class="pitcher-info" :class="{'is-sub-target': playerToSubOut?.player.card_id === leftPanelData.pitcher?.card_id}" :style="playerToSubOut && leftPanelData.pitcher && playerToSubOut.player.card_id === leftPanelData.pitcher.card_id ? { backgroundColor: leftPanelData.colors.primary, color: getContrastingTextColor(leftPanelData.colors.primary) } : {}">
            <hr />
            <span @click.stop="selectPlayerToSubOut(leftPanelData.pitcher, 'P')"
                  class="sub-icon"
                  :class="{
                      'visible': isSubModeActive && leftPanelData.isMyTeam && leftPanelData.pitcher,
                      'active': playerToSubOut?.player.card_id === leftPanelData.pitcher?.card_id
                  }">
                ⇄
            </span>
            <span @click="selectedCard = leftPanelData.pitcher">
                <strong :style="playerToSubOut && leftPanelData.pitcher && playerToSubOut.player.card_id === leftPanelData.pitcher.card_id ? { color: 'inherit' } : { color: black }">Pitching: </strong>
                <template v-if="leftPanelData.pitcher && leftPanelData.pitcher.card_id !== 'replacement_pitcher'">{{ leftPanelData.pitcher.name }} <span v-if="isPitcherTired(leftPanelData.pitcher)" class="tired-indicator">(Tired)</span></template>
                <template v-else>TBD</template>
            </span>
          </div>
          <div v-if="leftPanelData.bullpen.length > 0">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Bullpen:</strong>
              <ul>
                  <li v-for="p in leftPanelData.bullpen" :key="p.card_id" class="lineup-item" :class="{'is-sub-in-candidate': isSubModeActive && playerToSubOut && !usedPlayerIds.has(p.card_id)}">
                      <span @click.stop="handleSubstitution(p)"
                            class="sub-icon"
                            :class="{ 'visible': isSubModeActive && playerToSubOut && leftPanelData.isMyTeam && !usedPlayerIds.has(p.card_id) }">
                          ⇄
                      </span>
                      <span @click="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.ip}} IP)</span>
                  </li>
              </ul>
          </div>
          <div v-if="leftPanelData.bench.length > 0">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Bench:</strong>
              <ul>
                  <li v-for="p in leftPanelData.bench" :key="p.card_id" class="lineup-item" :class="{'is-sub-in-candidate': isSubModeActive && playerToSubOut && !usedPlayerIds.has(p.card_id)}">
                      <span @click.stop="handleSubstitution(p)"
                            class="sub-icon"
                            :class="{ 'visible': isSubModeActive && playerToSubOut && leftPanelData.isMyTeam && !usedPlayerIds.has(p.card_id) }">
                          ⇄
                      </span>
                      <span @click="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.displayPosition}})</span>
                  </li>
              </ul>
          </div>
          <div v-if="isSubModeActive && playerToSubOut && leftPanelData.isMyTeam">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Defaults:</strong>
              <ul>
                  <li class="lineup-item replacement-player" :class="{'is-sub-in-candidate': isSubModeActive && playerToSubOut}">
                       <span @click.stop="handleSubstitution(REPLACEMENT_PITCHER)"
                            class="sub-icon"
                            :class="{ 'visible': isSubModeActive && playerToSubOut && leftPanelData.isMyTeam }">
                          ⇄
                      </span>
                      <span>Replacement Pitcher</span>
                  </li>
                  <li class="lineup-item replacement-player" :class="{'is-sub-in-candidate': isSubModeActive && playerToSubOut}">
                       <span @click.stop="handleSubstitution(REPLACEMENT_HITTER)"
                            class="sub-icon"
                            :class="{ 'visible': isSubModeActive && playerToSubOut && leftPanelData.isMyTeam }">
                          ⇄
                      </span>
                      <span>Replacement Hitter</span>
                  </li>
              </ul>
          </div>
      </div>

      <!-- Game Log -->
      <div class="event-log">
        <div class="log-header">
          <h2>Game Log</h2>
          <span class="series-status">{{ seriesStatusText }}</span>
        </div>
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
                      'now-batting': amIDisplayDefensivePlayer && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                      'next-up': amIDisplayOffensivePlayer && index === defensiveNextBatterIndex
                  }"
                  class="lineup-item">
                  <span @click="selectedCard = spot.player">{{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }})</span>
              </li>
          </ol>
          <div class="pitcher-info">
              <hr />
              <span @click="selectedCard = rightPanelData.pitcher">
                <strong :style="{ color: black }">Pitching: </strong>
                <template v-if="rightPanelData.pitcher">{{ rightPanelData.pitcher.name }} <span v-if="isPitcherTired(rightPanelData.pitcher)" class="tired-indicator">(Tired)</span></template>
                <template v-else>TBD</template>
              </span>
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
    max-width: 280px; /* Prevent cards from getting too large but allow shrinking */
}

.tbd-pitcher-card {
    border: 4px solid #343a40; /* Default border color */
    border-radius: 10px;
    padding: 1rem;
    background-color: #f8f9fa;
    width: 100%;
    max-width: 320px;
    height: 446px; /* Match PlayerCard height */
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 0.5rem;
}
.tbd-role {
    font-size: 1.2rem;
    font-weight: bold;
    color: #6c757d;
}
.tbd-name {
    font-size: 2rem;
    font-weight: bold;
  }

.selecting-pitcher-text h3 {
    font-size: 2rem;
    font-weight: bold;
    margin: 0;
}

.selecting-pitcher-text p {
    font-size: 1.5rem;
    font-style: italic;
    color: #555;
    margin: 0;
}

  /* --- Mobile Positioning Overrides --- */
  .result-box-left {
    left: -60px;
  }
  .result-box-right {
    right: -60px;
  }
  .defensive-ratings {
    bottom: 10px;
    left: -20px;
  }
  .score-update-flash {
    bottom: 100px;
  }
  /* Target the ThrowRollResult component's root class */
  .diamond-and-results-container > .throw-roll-result {
    bottom: 10px;
    left: auto;
    right: -20px;
    transform: translateX(0);
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
  font-size: 1.2rem; /* Smaller icon */
  border-radius: 5px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 18px;
  visibility: hidden; /* Hide by default, but reserve space */
}
.sub-icon.visible, .sub-icon.active {
  visibility: visible; /* Make visible when conditions are met */
}
.sub-icon.visible:hover:not(.active) {
  background-color: rgba(0,0,0,0.05);
}
.sub-icon.active {
  /* This is for the main toggle button */
  background-color: #ffc107;
  color: #000;
}
.lineup-logo { height: 28px; flex-shrink: 0; object-fit: contain; }
.lineup-panel ol, .lineup-panel ul { padding-left: 0; margin: 0.5rem 0; list-style: none; }
.lineup-item, .pitcher-info {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  padding: 2px 8px;
  gap: 0.5rem;
  border-radius: 6px;
  margin: 0px -8px; /* Counteract padding to make selection full-width */
  transition: background-color 0.2s, color 0.2s;
}
.lineup-item > span:not(.sub-icon), .pitcher-info > span:not(.sub-icon) {
  cursor: pointer;
  flex-grow: 1;
}
.lineup-item > span:not(.sub-icon):hover, .pitcher-info > span:not(.sub-icon):hover {
  text-decoration: underline;
}
.pitcher-info { font-weight: bold; margin-top: 0.5rem; margin-left: -1.2rem}
.tired-indicator { color: #dc3545; font-weight: bold; font-style: italic; }
.is-sub-target {
  /* Now handled by inline :style binding for dynamic team colors */
}
.is-sub-target .sub-icon {
    /* When a row is highlighted, we might not want a separate hover on the icon */
    background-color: transparent;
}
.is-sub-target .tired-indicator {
    color: white; /* Make tired indicator visible on dark backgrounds */
}
.is-sub-in-candidate:hover {
    background-color: #e9ecef;
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

.invalid-position {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.replacement-player span:first-child {
  font-style: italic;
}

/* Game Log Specifics */
.log-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #dee2e6;
  margin-bottom: 0.5rem;
}
.log-header h2 {
  margin: 0;
}
.series-status {
  font-style: italic;
  font-size: 0.9rem;
  color: #6c757d;
}
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
.runner-decisions-group, .steal-throw-decisions, .defensive-throw-decisions {
    margin-top: 1rem;
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.tactile-button-hold {
    background-color: #6c757d;
    color: white;
    border-color: #5a6268;
}

.tactile-button-hold:hover {
    background-color: #5a6268;
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

.defensive-ratings {
  position: absolute;
  bottom: 50px;
  left: 30px;
  display: flex;
  flex-direction: column;
  background: #f8f9fa;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: bold;
  box-shadow: 0 0px 0px rgba(0,0,0,0.1);
  border: 1px solid #dee2e6;
  color: #212529;
  text-align: center;
}

/* Indicators & Flashes */
.turn-indicator, .waiting-text { font-style: italic; color: #555; text-align: center; padding-top: 0rem; }
.score-update-flash {
  position: absolute;
  top: -25px; /* Position it below the container */
  left: 0;
  right: 0;
  font-size: 1.5rem;
  color: black;
  text-align: center;
  pointer-events: none; /* Prevent it from intercepting clicks */
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.25rem;
}

.score-box-highlight {
  padding: 0.25rem 0.75rem;
  border-radius: 0px;
  border: 3px solid;
  font-weight: bold;
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
