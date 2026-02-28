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
const { isSwingResultVisible, isStealResultVisible, nextGameId } = storeToRefs(gameStore);
const authStore = useAuthStore();
const gameId = route.params.id;
const initialLoadComplete = ref(false);
const seenResultStorageKey = `showdown-game-${gameId}-swing-result-seen`;
const hasSeenResult = ref(JSON.parse(localStorage.getItem(seenResultStorageKey)) || false);
const seriesUpdateMessage = ref('');
const offensiveDPResultVisible = ref(false);
const defensiveDPRollClicked = ref(false);
const defensiveThrowRollClicked = ref(false);
const hasRolledForSteal = ref(false);
const isTransitioningToNextHitter = ref(false);
const wasMultiThrowSituation = ref(false);
const isConnected = ref(true);

// ============================================================
// SIMULTANEOUS MODE
// ============================================================
// In simultaneous mode, both players see results at the same time.
// - ROLL FOR PITCH still submits the pitch (real action)
// - Swing Away still submits the swing (real action)
// - ROLL FOR SWING is removed (auto-reveal after 900ms delay)
// - ROLL FOR DOUBLE PLAY is removed (auto-reveal after 900ms delay)
// - ROLL FOR THROW (single-runner) is removed (auto-reveal)
// - Single steal ROLL FOR THROW is auto-resolved (no click needed)
// - Double steal still requires defensive choice of where to throw
const simulPitchVisible = ref(false);

// NEW: Local state to track the offensive player's choice
const choices = ref({});

const selectedCard = ref(null);
const black = ref('#000000');

const getSpeedValue = (runner) => {
  if (!runner) return 0;
  if (runner.control !== null && typeof runner.control !== 'undefined') {
    return 10;
  }
  const speed = runner.speed;
  if (speed === 'A') return 20;
  if (speed === 'B') return 15;
  if (speed === 'C') return 10;
  return parseInt(speed, 10);
};

const useDh = computed(() => gameStore.game?.use_dh !== false);

const isSubModeActive = ref(false);
const playerToSubOut = ref(null);

const isStartingPitcherEligible = computed(() => {
    if (!myLineup.value?.startingPitcher) return true;
    return isPlayerSubEligible(myLineup.value.startingPitcher);
});

function isPlayerSubEligible(player) {
    if (!player) return true;
    if (!myLineup.value) return true;

    const startingPitcher = myLineup.value.startingPitcher;
    if (!startingPitcher || player.card_id !== startingPitcher.card_id) {
        return true;
    }

    const pitcherStats = gameStore.gameState?.pitcherStats;
    const stats = pitcherStats ? pitcherStats[player.card_id] : null;
    if (!stats) {
        return false;
    }

    if (stats.outs_recorded >= 12) {
        return true;
    }

    const inningsPitchedCount = stats.innings_pitched?.length || 0;

    let projectedInnings = inningsPitchedCount;
    if (amIDisplayOffensivePlayer.value) {
        projectedInnings += 1;
    }

    if (projectedInnings > 0) {
        const fatigueModifier = stats.fatigue_modifier || 0;
        const modifiedIp = player.ip + fatigueModifier;
        const fatigueThreshold = modifiedIp - Math.floor((stats.runs || 0) / 3);

        if (projectedInnings >= fatigueThreshold) {
            return true;
        }
    }

    return false;
}

function toggleSubMode() {
  isSubModeActive.value = !isSubModeActive.value;
  playerToSubOut.value = null;
  gameStore.playerSelectedForSwap = null;
}

function selectPlayerToSubOut(player, position, index = null, source = 'lineup') {
  if (gameStore.playerSelectedForSwap) {
    const isPlayerOnField = myLineup.value.battingOrder.some(p => p.player.card_id === player.card_id);

    const isSamePlayer = playerToSubOut.value?.player.card_id === player.card_id &&
                         playerToSubOut.value?.index === index &&
                         playerToSubOut.value?.source === source;

    if (isSamePlayer) {
        isSubModeActive.value = false;
        playerToSubOut.value = null;
        gameStore.playerSelectedForSwap = null;
        return;
    }

    if (isPlayerOnField) {
      gameStore.swapPlayerPositions(gameId, gameStore.playerSelectedForSwap.card_id, player.card_id);
    } else {
      handleSubstitution(player);
    }
    isSubModeActive.value = false;
    gameStore.playerSelectedForSwap = null;
    playerToSubOut.value = null;

  } else {
    playerToSubOut.value = { player, position, index, source };
    gameStore.playerSelectedForSwap = player;
  }
}

async function handleSubstitution(playerIn) {
    if (!gameStore.playerSelectedForSwap) return;

    await gameStore.submitSubstitution(gameId, {
        playerInId: playerIn.card_id,
        playerOutId: gameStore.playerSelectedForSwap.card_id,
        position: playerToSubOut.value.position,
        lineupIndex: playerToSubOut.value.source === 'lineup' ? playerToSubOut.value.index : -1
    });

    isSubModeActive.value = false;
    playerToSubOut.value = null;
    gameStore.playerSelectedForSwap = null;
}

const isMyTurn = computed(() => {
  if (!authStore.user || !gameStore.game) return false;
  if (Number(gameStore.game.current_turn_user_id) === 0) return true;
  return Number(authStore.user.userId) === Number(gameStore.game.current_turn_user_id);
});

const isGameOver = computed(() => gameStore.game?.status === 'completed');

const amIOffensivePlayer = computed(() => {
    if (!authStore.user || !gameStore.gameState) return false;
    const offensiveTeam = gameStore.gameState.isTopInning ? gameStore.gameState.awayTeam : gameStore.gameState.homeTeam;
    return Number(authStore.user.userId) === Number(offensiveTeam.userId);
});

const amIDefensivePlayer = computed(() => {
    if (!authStore.user || !gameStore.gameState) return false;
    return !amIOffensivePlayer.value;
});


const shouldDelayStealRoll = computed(() => {
  if (!gameStore.gameState) return false;

  const hitterPlay = !!(gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT');
  const stealPlay = gameStore.gameState.pendingStealAttempt;

  if (!hitterPlay || !stealPlay) return false;

  const lastBatterId = gameStore.gameState.lastCompletedAtBat?.batter?.card_id;
  
  if (!lastBatterId || !batterToDisplay.value) return true;

  if (shouldShowDoublePlayFirst.value) return false;
  return stealPlay.batterPlayerId !== batterToDisplay.value.card_id;
});

watch(() => gameStore.displayGameState?.outs, (newOuts) => {
  console.log('GameViewSimul sees displayGameState.outs change to:', newOuts);
}, { immediate: true });


const shouldShowDoublePlayFirst = computed(() => {
  if (!gameStore.gameState) return false;

  const dpDetails = gameStore.gameState.doublePlayDetails;
  const stealPlay = gameStore.gameState.pendingStealAttempt;

  if (!dpDetails || !stealPlay) return false;

  const lastBatterId = gameStore.gameState.lastCompletedAtBat?.batter?.card_id;
  const currentBatterId = gameStore.gameState.currentAtBat?.batter?.card_id;

  if (!lastBatterId || !currentBatterId) return false;

  return dpDetails.batterPlayerId === lastBatterId && stealPlay.batterPlayerId === currentBatterId;
});


const isDefensiveThrowDecision = computed(() => {
    if (isGameOver.value || !amIDefensivePlayer.value || !isMyTurn.value || !gameStore.gameState?.currentPlay) {
        return false;
    }
    if (shouldDelayStealRoll.value && gameStore.gameState.currentPlay.payload.choices) return true;
    if (gameStore.gameState.pendingStealAttempt) return false;

    const { type, payload } = gameStore.gameState.currentPlay;
    return (type === 'ADVANCE' || type === 'TAG_UP') && payload && payload.choices;
});

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

        if (isTagUp) {
            toBase = fromBase + 1;
        } else if (hitType === '2B' && fromBase === 1) {
            toBase = 4;
        } else if (decision.to) {
            toBase = parseInt(decision.to, 10);
        } else {
            toBase = fromBase + 2;
        }

        let toBaseLabel = '';
        switch (toBase) {
            case 2: toBaseLabel = 'to 2nd'; break;
            case 3: toBaseLabel = 'to 3rd'; break;
            case 4: toBaseLabel = 'Home'; break;
            default: toBaseLabel = `to base ${toBase}`;
        }

        const runnerSpeed = parseInt(decision.runner.speed, 10);
        let adjustedSpeed = runnerSpeed;

        if (gameStore.gameState.currentPlay.type === 'ADVANCE') {
            if (toBase === 4) adjustedSpeed += 5;
            if (outsToDisplay.value === 2) adjustedSpeed += 5;
        } else if (gameStore.gameState.currentPlay.type === 'TAG_UP') {
            if (toBase === 4) adjustedSpeed += 5;
            if (toBase === 2) adjustedSpeed -= 5;
        }

        let threshold = (adjustedSpeed - outfieldDefense.value) + 1;
        threshold = Math.max(1, threshold);

        return {
            ...decision,
            toBase,
            toBaseLabel,
            outThreshold: threshold
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

watch(defensiveThrowOptions, (newOptions) => {
    if (newOptions.length > 1) {
        wasMultiThrowSituation.value = true;
    }
});

const defensiveThrowRollThreshold = computed(() => {
    if (!gameStore.gameState?.throwRollResult) return null;
    const { target, defense } = gameStore.gameState.throwRollResult;
    return Math.max(1, target - defense + 1);
});


const baserunningOptionGroups = computed(() => {
    if (!gameStore.gameState?.currentPlay?.payload?.decisions) {
        return [];
    }
    const decisions = runnerDecisionsWithLabels.value;
    const sortedDecisions = [...decisions].sort((a, b) => parseInt(b.from, 10) - parseInt(a.from, 10));
    const runnersOn = decisions.map(d => parseInt(d.from, 10));

    const isAdvanceWithRunnersOnFirstAndSecond = gameStore.gameState.currentPlay.type === 'ADVANCE' &&
                                                runnersOn.length === 2 &&
                                                runnersOn.includes(1) &&
                                                runnersOn.includes(2);

    if (isAdvanceWithRunnersOnFirstAndSecond) {
        const leadRunnerDecision = sortedDecisions.find(d => parseInt(d.from, 10) === 2);
        const trailRunnerDecision = sortedDecisions.find(d => parseInt(d.from, 10) === 1);

        return [
            { text: `Send ${leadRunnerDecision.runner.name} ${leadRunnerDecision.toBaseLabel} (${leadRunnerDecision.outThreshold}+)`, choices: { '2': true } },
            { text: `Send Both Runners (${leadRunnerDecision.outThreshold}+, ${trailRunnerDecision.outThreshold}+)`, choices: { '1': true, '2': true } }
        ];
    }

    const isTagUp = gameStore.gameState.currentPlay.type === 'TAG_UP';
    const runnerCount = sortedDecisions.length;

    if (isTagUp && runnerCount > 1) {
        const cumulativeOptions = [];
        let cumulativeChoices = {};
        const runnerDestinations = [];
        const runnerThresholds = [];

        for (let i = 0; i < runnerCount; i++) {
            const decision = sortedDecisions[i];
            cumulativeChoices[decision.from] = true;
            runnerDestinations.push(decision.toBaseLabel.replace('to ', ''));
            runnerThresholds.push(decision.outThreshold);

            let text = '';
            if (i === 0) {
                text = `Send ${decision.runner.name} ${decision.toBaseLabel} (${decision.outThreshold}+)`;
            } else if (i === runnerCount - 1) {
                text = `Send All Runners (${runnerThresholds.join('+, ')}+)`;
            } else {
                text = `Send Runners to ${runnerDestinations.join(' & ')} (${runnerThresholds.join('+, ')}+)`;
            }

            cumulativeOptions.push({
                text,
                choices: { ...cumulativeChoices }
            });
        }
        return cumulativeOptions;
    }

    const defaultOptions = [];
    for (const decision of sortedDecisions) {
        const choices = { [decision.from]: true };
        const text = `Send ${decision.runner.name} ${decision.toBaseLabel} (${decision.outThreshold}+)`;
        defaultOptions.push({ text, choices });
    }
    return defaultOptions;
});

const isAdvancementOrTagUpDecision = computed(() => {
    if (isGameOver.value || !amIOffensivePlayer.value || !isMyTurn.value || !gameStore.gameState?.currentPlay || !isSwingResultVisible.value) {
        return false;
    }
    const type = gameStore.gameState.currentPlay.type;
    return type === 'ADVANCE' || type === 'TAG_UP';
});

const isAwaitingBaserunningDecision = computed(() => {
    if (amIDefensivePlayer.value && !isMyTurn.value && gameStore.gameState?.currentPlay) {
        const type = gameStore.gameState.currentPlay.type;
        return (type === 'ADVANCE' || type === 'TAG_UP' || type === 'INFIELD_IN_CHOICE');
    }
    return false;
});
const anticipatedBatter = ref(null);
const infieldIn = ref(false);


const REPLACEMENT_HITTER = { card_id: 'replacement_hitter', displayName: 'Replacement Hitter', control: null };
const REPLACEMENT_PITCHER = { card_id: 'replacement_pitcher', displayName: 'Replacement Pitcher', control: 0, ip: 1 };

const isMyTeamAwaitingLineupChange = computed(() => {
    if (!gameStore.gameState || !gameStore.myTeam) return false;
    return gameStore.gameState.awaiting_lineup_change &&
           amIDisplayDefensivePlayer.value &&
           playersInInvalidPositions.value.size > 0;
});

const playersInInvalidPositions = computed(() => {
    if (!myLineup.value) return new Set();
    const invalidPlayerIds = new Set();

    myLineup.value.battingOrder.forEach(spot => {
        const player = spot.player;
        const position = spot.position;

        if (!player || position === 'DH') {
            return;
        }

        if (gameStore.gameState?.inning < 7 && player.assignment === 'BENCH') {
            invalidPlayerIds.add(player.card_id);
            return;
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

    const myPitcher = gameStore.myTeam === 'home' ? homePitcher.value : awayPitcher.value;
    if (myPitcher) {
        onFieldIds.add(myPitcher.card_id);
    }

    const benchAndBullpen = myRoster.value.filter(p => !onFieldIds.has(p.card_id));

    const originalSP = gameStore.rosters[gameStore.myTeam]?.find(p => p.card_id === myLineup.value.startingPitcher?.card_id);
    if (originalSP && !onFieldIds.has(originalSP.card_id) && !benchAndBullpen.some(p => p.card_id === originalSP.card_id)) {
        benchAndBullpen.push(originalSP);
    }

    return benchAndBullpen;
});
const myBench = computed(() => myBenchAndBullpen.value.filter(p => p.control === null));
const myBullpen = computed(() => myBenchAndBullpen.value.filter(p => p.control !== null));

const homePitcher = computed(() => gameStore.gameState?.currentHomePitcher || gameStore.lineups.home?.startingPitcher);
const awayPitcher = computed(() => gameStore.gameState?.currentAwayPitcher || gameStore.lineups.away?.startingPitcher);

const homeBenchAndBullpen = computed(() => {
    if (!gameStore.lineups.home?.battingOrder || !gameStore.rosters.home) return [];
    const lineupIds = new Set(gameStore.lineups.home.battingOrder.map(s => s.player.card_id));

    if (homePitcher.value) {
        lineupIds.add(homePitcher.value.card_id);
    }
    if (isDisplayTopInning.value && pitcherToDisplay.value) {
        lineupIds.add(pitcherToDisplay.value.card_id);
    }

    const benchAndBullpen = gameStore.rosters.home.filter(p => !lineupIds.has(p.card_id));

    const originalSP = gameStore.rosters.home?.find(p => p.card_id === gameStore.lineups.home.startingPitcher?.card_id);
    if (originalSP && !lineupIds.has(originalSP.card_id) && !benchAndBullpen.some(p => p.card_id === originalSP.card_id)) {
        benchAndBullpen.push(originalSP);
    }

    return benchAndBullpen;
});
const awayBenchAndBullpen = computed(() => {
    if (!gameStore.lineups.away?.battingOrder || !gameStore.rosters.away) return [];
    const lineupIds = new Set(gameStore.lineups.away.battingOrder.map(s => s.player.card_id));

    if (awayPitcher.value) {
        lineupIds.add(awayPitcher.value.card_id);
    }
    if (isDisplayTopInning.value === false && pitcherToDisplay.value) {
        lineupIds.add(pitcherToDisplay.value.card_id);
    }

    const benchAndBullpen = gameStore.rosters.away.filter(p => !lineupIds.has(p.card_id));

    const originalSP = gameStore.rosters.away?.find(p => p.card_id === gameStore.lineups.away.startingPitcher?.card_id);
    if (originalSP && !lineupIds.has(originalSP.card_id) && !benchAndBullpen.some(p => p.card_id === originalSP.card_id)) {
        benchAndBullpen.push(originalSP);
    }

    return benchAndBullpen;
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
    const newAwayScore = gameStore.displayGameState?.awayScore;
    const newHomeScore = gameStore.displayGameState?.homeScore;

    const oldAwayScore = gameStore.opponentReadyForNext ? gameStore.displayGameState?.lastCompletedAtBat?.awayScoreBeforePlay : gameStore.displayGameState?.currentAtBat?.awayScoreBeforePlay;
    const oldHomeScore = gameStore.opponentReadyForNext ? gameStore.displayGameState?.lastCompletedAtBat?.homeScoreBeforePlay : gameStore.displayGameState?.currentAtBat?.homeScoreBeforePlay;

    if (newAwayScore === undefined || newHomeScore === undefined) {
        return null;
    }

    const awayTeamName = gameStore.teams?.away?.abbreviation.toUpperCase() || 'AWAY';
    const homeTeamName = gameStore.teams?.home?.abbreviation.toUpperCase() || 'HOME';

    let awayScored = oldAwayScore !== undefined && newAwayScore > oldAwayScore;
    let homeScored = oldHomeScore !== undefined && newHomeScore > oldHomeScore;

    const isDuringBaserunningDecision = isAdvancementOrTagUpDecision.value || isAwaitingBaserunningDecision.value;
    if (isDuringBaserunningDecision && runScoredOnPlay.value) {
        if (isDisplayTopInning.value) {
            awayScored = true;
        } else {
            homeScored = true;
        }
    }

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
  const lastEvent = gameStore.gameEvents[gameStore.gameEvents.length - 1];
  return lastEvent.log_message?.includes('scores') || lastEvent.log_message?.includes('HOME RUN') || lastEvent.log_message?.includes('SAFE at home');
});

const scoreUpdateVisible = computed(() => {
  const swingIsVisible = isSwingResultVisible.value || (amIDisplayOffensivePlayer.value && isSwingResultVisible.value);
  return runScoredOnPlay.value && swingIsVisible && !shouldHideCurrentAtBatOutcome.value;
});


const isDisplayTopInning = computed(() => {
  if (!gameStore.gameState) return null;

  if (gameStore.gameState.awaiting_lineup_change &&
           playersInInvalidPositions.value.size > 0) {
      return gameStore.gameState.isTopInning;
  }

  if (shouldHideCurrentAtBatOutcome.value && gameStore.displayGameState) {
      return gameStore.displayGameState.isTopInning;
  }

  if (gameStore.isEffectivelyBetweenHalfInnings) {
    if (gameStore.gameState.isBetweenHalfInningsAway || gameStore.gameState.isBetweenHalfInningsHome) {
      return gameStore.gameState.isTopInning;
    }
    return !gameStore.gameState.isTopInning;
  }
  return gameStore.gameState.isTopInning;
});

const batterLineupInfo = computed(() => {
    if (!gameStore.gameState || !gameStore.lineups?.away?.battingOrder) return null;
    const lineup = isDisplayTopInning.value ? gameStore.lineups.away.battingOrder : gameStore.lineups.home.battingOrder;
    if (!lineup || lineup.length === 0) return null;
    const pos = isDisplayTopInning.value ? gameStore.gameState.awayTeam.battingOrderPosition : gameStore.gameState.homeTeam.battingOrderPosition;
    return lineup[pos];
});



const amIDisplayOffensivePlayer = computed(() => {
  if (!authStore.user || !gameStore.gameState) return false;
  const offensiveTeam = isDisplayTopInning.value ? gameStore.gameState.awayTeam : gameStore.gameState.homeTeam;
  return Number(authStore.user.userId) === Number(offensiveTeam.userId);
});

const amIDisplayDefensivePlayer = computed(() => {
  if (!authStore.user || !gameStore.gameState) return false;
  return !amIDisplayOffensivePlayer.value;
});

const pitcherOnlySetActions = computed(() => {
  if (!gameStore.gameState || !gameStore.gameState.currentAtBat) return false;
  return !!gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction;
});

const shouldHideCurrentAtBatOutcome = computed(() => {
  if (isTransitioningToNextHitter.value) return false;
  if (!gameStore.gameState) return false;

  if (gameStore.gameState.inningEndedOnCaughtStealing && 
      gameStore.gameState.lastStealResult && 
      !gameStore.gameState.pendingStealAttempt) {
    return false;
  }
  
  if (gameStore.game?.status === 'completed' && !gameStore.gameState.currentAtBat?.batterAction) {
    if (amIDefensivePlayer.value && gameStore.gameState.pendingStealAttempt) {
        return true;
    }
    // Hide for offensive player until defensive player acknowledges the game-ending steal
    if (amIOffensivePlayer.value && 
        gameStore.gameState.inningEndedOnCaughtStealing &&
        !gameStore.opponentReadyForNext) {
        return true;
    }
    return false;
}

// Resolved steal where players haven't synced up yet — hide until both are on same at-bat
  if (gameStore.gameState.lastStealResult && 
      !gameStore.gameState.currentAtBat?.batterAction && 
      !gameStore.gameState.currentAtBat?.pitcherAction &&
      !gameStore.gameState.inningEndedOnCaughtStealing &&
      amIOffensivePlayer.value &&
      !gameStore.opponentReadyForNext) {
    return true;
  }

  if (gameStore.gameState.currentAtBat && 
      !gameStore.gameState.currentAtBat.pitcherAction && 
      !gameStore.gameState.currentAtBat.batterAction &&
      !gameStore.gameState.pendingStealAttempt &&
      !gameStore.gameState.currentPlay &&
      !gameStore.gameState.lastStealResult) {
    return false;
  }

  // SIMUL: DP and throw auto-reveal, so these buttons are always false,
  // but we still want to hide outcome until the timer fires.
  if (gameStore.gameState?.doublePlayDetails && !offensiveDPResultVisible.value) {
    return true;
  }

if(!!gameStore.gameState.pendingStealAttempt && 
   amIDefensivePlayer.value &&
   !gameStore.gameState.inningEndedOnCaughtStealing) {
    return true;
  }

  // NEW: Also hide for offensive player while steal is pending but not yet resolved
  if (!!gameStore.gameState.pendingStealAttempt && 
      !gameStore.gameState.lastStealResult && 
      amIOffensivePlayer.value) {
    return true;
  }

  // NEW: Hide resolved steal result until both players are on the same at-bat
  if (gameStore.gameState.lastStealResult && 
      !gameStore.gameState.currentAtBat?.batterAction && 
      !gameStore.gameState.currentAtBat?.pitcherAction &&
      !gameStore.gameState.inningEndedOnCaughtStealing) {
    if (amIOffensivePlayer.value && !gameStore.opponentReadyForNext) {
        return true;
    }
    if (amIDefensivePlayer.value && gameStore.opponentReadyForNext && !gameStore.amIReadyForNext) {
        return true;
    }
  }

  if (!gameStore.gameState.currentAtBat) return false;

  const atBatIsResolved = !!gameStore.gameState.currentAtBat.batterAction && !!gameStore.gameState.currentAtBat.pitcherAction;

  if (!atBatIsResolved && !gameStore.opponentReadyForNext) return false;

  if ((gameStore.gameState.currentPlay?.type === 'STEAL_ATTEMPT' || gameStore.gameState.throwRollResult) && 
      !gameStore.gameState.currentAtBat?.pitcherAction &&
      !gameStore.gameState.currentAtBat?.batterAction) {
    return false;
  }

  // SIMUL: Both players wait for the simultaneous reveal (isSwingResultVisible).
  const isPlayerWaitingForReveal = !isSwingResultVisible.value && !(gameStore.gameState.inningEndedOnCaughtStealing);
  if (isPlayerWaitingForReveal) {
    return true;
  }

  return false;
});


watch(shouldHideCurrentAtBatOutcome, (newValue) => {
  if (!gameStore.gameState) return;
  gameStore.setOutcomeHidden(newValue);
}, { immediate: true });

const offensiveChoiceMade = computed(() => !!gameStore.gameState?.currentAtBat?.batterAction);

const isOffensiveStealInProgress = computed(() => {
    return amIOffensivePlayer.value && gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT' && !gameStore.gameState?.inningEndedOnCaughtStealing;
});

const canAttemptSteal = computed(() => {
    if (isGameOver.value || !amIOffensivePlayer.value || !gameStore.gameState) {
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
    if (isOffensiveStealInProgress.value) {
        const decisions = gameStore.gameState.currentPlay.payload.decisions;
        return decisions['1'] && !gameStore.gameState.bases.third;
    }
    return gameStore.gameState.bases.second && !gameStore.gameState.bases.third;
});

const canDoubleSteal = computed(() => {
    if (!canAttemptSteal.value || isOffensiveStealInProgress.value) return false;
    const { bases } = gameStore.gameState;
    return bases.first && bases.second && !bases.third;
});

const isRunnerOnThird = computed(() => !!gameStore.gameState?.bases?.third);

const showRollForPitchButton = computed(() => {
  if (isGameOver.value && (isSwingResultVisible.value || gameStore.displayGameState.outs === 3)) return false;
  const result = amIDisplayDefensivePlayer.value && !gameStore.gameState.currentAtBat.pitcherAction && !(!gameStore.amIReadyForNext && (gameStore.gameState.awayPlayerReadyForNext || gameStore.gameState.homePlayerReadyForNext)) && !(gameStore.gameState.inningEndedOnCaughtStealing && gameStore.displayGameState?.outs > 0);
  return result;
});

const showSwingAwayButton = computed(() => {
  if (isGameOver.value && (isSwingResultVisible.value || gameStore.displayGameState.outs === 3)) return false;
  return amIDisplayOffensivePlayer.value && !gameStore.gameState.currentAtBat.batterAction && !shouldHideCurrentAtBatOutcome.value && (gameStore.amIReadyForNext || bothPlayersCaughtUp.value) && !gameStore.gameState.pendingStealAttempt && !(isOffensiveStealInProgress.value && !gameStore.gameState.pendingStealAttempt) && !isWaitingForQueuedStealResolution.value && !(gameStore.gameState?.inningEndedOnCaughtStealing && gameStore.displayGameState?.outs === 3);
});

const showNextHitterButton = computed(() => {
  if (gameStore.gameState?.pendingStealAttempt && amIOffensivePlayer.value) {
    return false;
  }
  if (gameStore.gameState?.inningEndedOnCaughtStealing && 
    gameStore.gameState.outs === 3 &&
    amIDisplayDefensivePlayer.value &&
    !delayInningChange.value) {
    return true;
  // SIMUL: DP auto-reveals, but still wait for the offensive timer
  } else if (gameStore.gameState?.doublePlayDetails && !offensiveDPResultVisible.value) {
    return false;
  } else if (isAwaitingBaserunningDecision.value) {
    return false;
  } else if (amIDisplayDefensivePlayer.value && gameStore.gameState.currentPlay?.type === 'INFIELD_IN_CHOICE' && isSwingResultVisible) {
    return false;
  } else if ((amIDisplayOffensivePlayer.value && ((gameStore.gameState.currentPlay?.type === 'ADVANCE' || gameStore.gameState.currentPlay?.type === 'TAG_UP') && isSwingResultVisible && !!gameStore.gameState.currentPlay.payload.choices))) {
    return false;
  } else if (gameStore.amIReadyForNext) {
    return false;
  } else {
    const atBatIsResolved = bothPlayersSetAction.value;
    if ((atBatIsResolved || amIDisplayOffensivePlayer.value) && !isSwingResultVisible.value && !gameStore.gameState?.inningEndedOnCaughtStealing) {
      return false;
    } else if (amIOffensivePlayer.value && offensiveDPResultVisible.value) {
      return true;
    } else if (gameStore.isBetweenHalfInnings && !delayInningChange.value && !gameStore.gameState?.pendingStealAttempt) {
      return true;
    } else {
      const opponentIsReady = gameStore.opponentReadyForNext;
      return atBatIsResolved || opponentIsReady;
    }
  }
});


// SIMUL: ROLL FOR SWING is never shown — auto-reveal handles it
const showRollForSwingButton = computed(() => {
  return false;
});

// SIMUL: ROLL FOR DOUBLE PLAY is never shown — auto-reveal handles it
const showRollForDoublePlayButton = computed(() => {
  return false;
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

// SIMUL: DP watcher — auto-reveal for both players (no click needed)
watch(() => gameStore.gameState?.doublePlayDetails, (newDetails, oldDetails) => {
  const isNewDPPlay = newDetails && !oldDetails;
  const isDPPlayOver = !newDetails && oldDetails;

  if (isNewDPPlay || isDPPlayOver) {
    defensiveDPRollClicked.value = false;
    offensiveDPResultVisible.value = false;
  }

  if (isNewDPPlay) {
    // SIMUL: Defense sees it immediately (auto-click)
    defensiveDPRollClicked.value = true;
    // Both players see it after 900ms delay
    setTimeout(() => {
      offensiveDPResultVisible.value = true;
    }, 900);
  }
}, { immediate: true });

// SIMUL: ROLL FOR THROW (single-runner) is never shown — auto-reveal handles it
const showDefensiveRollForThrowButton = computed(() => {
    return false;
});

const defensiveThrowMessage = computed(() => {
  // SIMUL: No throw button, so no message needed
  return null;
});

function handleRollForThrow() {
    defensiveThrowRollClicked.value = true;
}

// SIMUL: Auto-reveal throw results for single-runner advance/tag-up situations
watch(() => gameStore.gameState?.throwRollResult, (newVal, oldVal) => {
  if (newVal && !oldVal && !newVal.consolidatedOutcome) {
    // Auto-reveal the throw result (replaces the ROLL FOR THROW click)
    defensiveThrowRollClicked.value = true;
  }
});

const showThrowRollResult = computed(() => {
  const hasDetails = !!gameStore.gameState?.doublePlayDetails;
  if (!hasDetails) return false;
  if(gameStore.amIReadyForNext) return false;

  if (amIDisplayDefensivePlayer.value) {
    return defensiveDPRollClicked.value;
  }

  if (amIDisplayOffensivePlayer.value && !gameStore.amIReadyForNext) {
    return (offensiveDPResultVisible.value || gameStore.opponentReadyForNext) && isSwingResultVisible.value;
  }

  return true;
});

const isGameEndingSteal = computed(() => {
    if (!gameStore.gameState) return false;
    const isStealFinish = (!!gameStore.gameState.lastStealResult || !!gameStore.gameState.throwRollResult || !!gameStore.gameState.pendingStealAttempt) && !gameStore.gameState.currentAtBat?.batterAction;

    if (amIDisplayDefensivePlayer.value) {
        if (!!gameStore.gameState.pendingStealAttempt && !gameStore.gameState.lastStealResult && !gameStore.gameState.throwRollResult) {
            return false;
        }
    }

    // Don't show game-ending state until defensive player has clicked Next Hitter
if (amIDisplayDefensivePlayer.value && !gameStore.amIReadyForNext) {
    return false;
}
if (amIDisplayOffensivePlayer.value && !gameStore.opponentReadyForNext) {
    return false;
}

return isGameOver.value && gameStore.displayGameState.outs === 3 && isStealFinish && !isSwingResultVisible.value;
});

const showAutoThrowResult = computed(() => {
    if (isGameEndingSteal.value) return true;

    if (!isSwingResultVisible.value || !gameStore.gameState?.throwRollResult ||
    (gameStore.gameState?.currentAtBat.batterAction === 'take' && !gameStore.opponentReadyForNext && gameStore.gameState?.currentAtBat.pitcherAction !== 'intentional_walk') || gameStore.gameState?.currentAtBat.batterAction === 'bunt') {
        return false;
    }
    if (wasMultiThrowSituation.value) {
        return true;
    }
    // SIMUL: Always auto-show for defensive player (defensiveThrowRollClicked is auto-set)
    if (amIDisplayDefensivePlayer.value) {
        return defensiveThrowRollClicked.value;
    }
    return true;
});

const isRunnerOnOffensiveTeam = computed(() => {
  if (isDoubleStealResultAvailable.value) {
    return true;
  }

  if(gameStore.gameState?.pendingStealAttempt && !gameStore.gameState?.inningEndedOnCaughtStealing){
      return true
  }

  if (isDoubleStealResultAvailable.value) return true;

  if (!gameStore.gameState?.lastStealResult?.runnerTeamId) {
    return false;
  }

  const myTeamSide = gameStore.myTeam;
  const myTeamData = gameStore.teams?.[myTeamSide];

  if (myTeamData && Number(gameStore.gameState.lastStealResult.runnerTeamId) === Number(myTeamData.team_id)) {
      return true;
  }

  const offensiveTeamKey = isDisplayTopInning.value ? 'away' : 'home';
  const offensiveTeam = gameStore.teams ? gameStore.teams[offensiveTeamKey] : null;

  if (!offensiveTeam) {
      return false;
  }
  
  return Number(gameStore.gameState.lastStealResult.runnerTeamId) === Number(offensiveTeam.team_id);
});

const isDoubleStealResultAvailable = computed(() => {
    if (gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT' && gameStore.amIReadyForNext) {
        return false;
    }
    return !!gameStore.gameState?.throwRollResult?.consolidatedOutcome;
});

const stealOutThresholds = computed(() => {
    const thresholds = {};
    const bases = gameStore.gameState?.bases;
    if (!bases) return {};

    if (bases.first) {
        const speed = getSpeedValue(bases.first);
        const t = speed - catcherArm.value;
        thresholds['2'] = Math.max(1, t);
    }
    if (bases.second) {
        const speed = getSpeedValue(bases.second);
        const t = (speed - 5) - catcherArm.value;
        thresholds['3'] = Math.max(1, t);
    }
    return thresholds;
});

const doubleStealDefenseThresholds = computed(() => {
     if (!gameStore.gameState?.currentPlay?.payload?.decisions) return {};
     const decisions = gameStore.gameState.currentPlay.payload.decisions;
     const res = {};
     Object.keys(decisions).forEach(k => {
         if (decisions[k]) {
             const from = parseInt(k, 10);
             const to = from + 1;
             const runner = gameStore.gameState.bases[from === 1 ? 'first' : 'second'];
             if (runner) {
                 const speed = getSpeedValue(runner);
                 const penalty = to === 3 ? 5 : 0;
                 res[to] = Math.max(1, (speed - penalty) - catcherArm.value);
             }
         }
     });
     return res;
});

const stealingRunnerOutThreshold = computed(() => {
    if (!isSingleSteal.value) return null;

    if (gameStore.gameState.pendingStealAttempt) {
        const { target, penalty, defense } = gameStore.gameState.pendingStealAttempt;
        return Math.max(1, (target - penalty) - defense);
    }

    let runner = null;
    let toBase = null;

    if (gameStore.gameState.currentPlay?.type === 'STEAL_ATTEMPT') {
        const decisions = gameStore.gameState.currentPlay.payload.decisions || {};
        const fromBaseStr = Object.keys(decisions).find(k => decisions[k]);
        if (fromBaseStr) {
             const fromBase = parseInt(fromBaseStr, 10);
             const baseMap = { 1: 'first', 2: 'second', 3: 'third' };
             runner = gameStore.gameState.bases[baseMap[fromBase]];
             toBase = fromBase + 1;
        }
    }

    if (runner && toBase) {
        const speed = getSpeedValue(runner);
        const penalty = toBase === 3 ? 5 : 0;
        return Math.max(1, (speed - penalty) - catcherArm.value);
    }

    return null;
});

const doublePlayOutThreshold = computed(() => {
    const batter = atBatToDisplay.value?.batter;
    if (!batter) return null;
    const speed = getSpeedValue(batter);
    const t = (speed - infieldDefense.value) + 1;
    return Math.max(1, t);
});

const infieldInOutThreshold = computed(() => {
    if (!isInfieldInDecision.value) return null;
    const runner = gameStore.gameState.currentPlay.payload.runnerOnThird;
    if (!runner) return null;
    const speed = getSpeedValue(runner);
    const t = (speed - infieldDefense.value) + 1;
    return Math.max(1, t);
});


const showStealResult = computed(() => {
  const hasStealData = !!gameStore.gameState?.pendingStealAttempt || 
                       !!gameStore.gameState?.lastStealResult || 
                       isDoubleStealResultAvailable.value;

  if (!hasStealData) return false;
  // Don't show steal result to offensive player while defense hasn't resolved yet
  if (amIDisplayOffensivePlayer.value && 
      gameStore.gameState.pendingStealAttempt && 
      !gameStore.gameState.lastStealResult) {
      return false;
  }

  if (gameStore.gameState.lastStealResult && 
      !gameStore.gameState.currentAtBat?.batterAction && 
      !gameStore.gameState.currentAtBat?.pitcherAction &&
      !gameStore.gameState.inningEndedOnCaughtStealing &&
      (gameStore.amIReadyForNext !== gameStore.opponentReadyForNext)) {
      return false;
  }
  
  if (gameStore.gameState?.inningEndedOnCaughtStealing) {
    return !(gameStore.amIReadyForNext && gameStore.gameState?.currentAtBat.batterAction) &&
     !(amIDisplayDefensivePlayer.value && (!gameStore.gameState?.lastStealResult && !isDoubleStealResultAvailable.value)) &&
     !(amIDisplayOffensivePlayer.value && amIOffensivePlayer.value && gameStore.gameState?.currentAtBat.outsBeforePlay === 0) &&
     !(amIDisplayDefensivePlayer.value && amIDefensivePlayer.value && gameStore.gameState?.currentAtBat.outsBeforePlay === 0) &&
     isRunnerOnOffensiveTeam.value;
  }

  if (gameStore.amIReadyForNext && gameStore.gameState?.currentAtBat.batterAction) return false;

  if (amIDisplayOffensivePlayer.value) {
      if (!isRunnerOnOffensiveTeam.value) return false;
      // NEW: Don't show steal result to offensive player while awaiting defensive roll
      if (gameStore.gameState.pendingStealAttempt && !gameStore.gameState.lastStealResult) return false;
      const prevIBB =  gameStore.gameState?.lastCompletedAtBat?.pitcherAction === 'intentional_walk' && gameStore.gameState?.lastStealResult?.batterPlayerId === gameStore.gameState?.lastCompletedAtBat?.batter.card_id;
      
      return !gameStore.gameState.currentAtBat.batterAction && !prevIBB || gameStore.opponentReadyForNext && !prevIBB;
  }

  if (amIDisplayDefensivePlayer.value) {
      const hasDefensiveResult = !!gameStore.gameState?.lastStealResult || isDoubleStealResultAvailable.value;
      if (!hasDefensiveResult) return false;

      const pitcherHasActed = !!gameStore.gameState.currentAtBat.pitcherAction;
      const isIBB = gameStore.gameState.currentAtBat.pitcherAction === 'intentional_walk';
      const prevIBB =  gameStore.gameState.lastCompletedAtBat.pitcherAction === 'intentional_walk' && gameStore.gameState?.lastStealResult?.batterPlayerId === gameStore.gameState.lastCompletedAtBat?.batter.card_id;
      
      return (!pitcherHasActed && !isIBB && !prevIBB & !(amIDisplayDefensivePlayer.value && !isRunnerOnOffensiveTeam.value)) || gameStore.opponentReadyForNext;
  }

  return false;
});

const stealDisplayDetails = computed (() => {
  if (isDoubleStealResultAvailable.value) {
    return gameStore.gameState.throwRollResult;
  }
  return !!gameStore.gameState?.pendingStealAttempt && amIDisplayOffensivePlayer.value
   ? gameStore.gameState.pendingStealAttempt
   : gameStore.gameState.lastStealResult
})



const defensiveRatingsToDisplay = computed(() => {
  if (!gameStore.gameState) return { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 };
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
    return gameStore.gameEventsToDisplay;
});


const groupedGameLog = computed(() => {
  if (!eventsForLog.value || eventsForLog.value.length === 0) {
    return [];
  }

  const groups = [];
  let currentGroup = { header: 'Pre-Game', plays: [] };

  eventsForLog.value.forEach(event => {
    if (event.log_message && event.log_message.includes('inning-change-message')) {
      if (currentGroup.plays.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = { header: event.log_message, plays: [] };
    } else {
      currentGroup.plays.push(event);
    }
  });

  groups.push(currentGroup);

  return groups.reverse();
});

const pitcherTeamColors = computed(() => isDisplayTopInning.value ? homeTeamColors.value : awayTeamColors.value);
const batterTeamColors = computed(() => isDisplayTopInning.value ? awayTeamColors.value : homeTeamColors.value);
const pitcherResultTextColor = computed(() => getContrastingTextColor(pitcherTeamColors.value.primary));
const batterResultTextColor = computed(() => getContrastingTextColor(batterTeamColors.value.primary));

const atBatToDisplay = computed(() => {
    if (!gameStore.gameState) {
      return { batterAction: null, pitcherAction: null, pitchRollResult: null, swingRollResult: null };
    }
    if (!gameStore.amIReadyForNext && gameStore.opponentReadyForNext) {
        if (gameStore.gameState.pendingStealAttempt &&
            !gameStore.gameState.currentAtBat.pitcherAction &&
            !gameStore.gameState.currentAtBat.batterAction) {
            return gameStore.gameState.currentAtBat;
        }
        return gameStore.gameState.lastCompletedAtBat;
    }
    return gameStore.gameState.currentAtBat;
});


const bothPlayersSetAction = computed(() => {
    if (!gameStore.gameState?.currentAtBat) return false;
    return !!gameStore.gameState.currentAtBat.batterAction && !!gameStore.gameState.currentAtBat.pitcherAction;
});

// SIMUL: When both players have acted, do a staged reveal:
// - Pitch result appears immediately (0ms)
// - Swing result appears after 900ms
watch(bothPlayersSetAction, (isRevealing) => {
  if (!initialLoadComplete.value || !gameStore.gameState) return;

  if (isRevealing) {
    // SIMUL: Reveal pitch to both players immediately
    simulPitchVisible.value = true;

    // SIMUL: Reveal swing to both players after 900ms delay
    setTimeout(() => {
      gameStore.setIsSwingResultVisible(true);
      hasSeenResult.value = true;
      localStorage.setItem(seenResultStorageKey, 'true');
    }, 900);
  }
}, { immediate: true });

// SIMUL: Handle IBB — reveal immediately since there's no contest
watch(() => atBatToDisplay.value?.pitcherAction, (newAction) => {
    if (newAction === 'intentional_walk') {
        simulPitchVisible.value = true;
        gameStore.setIsSwingResultVisible(true);
    }
});

// SIMUL: Auto-resolve single steals (no ROLL FOR THROW click needed)
watch(() => gameStore.gameState?.pendingStealAttempt, (newVal, oldVal) => {
  // Reset hasRolledForSteal on new/different steal attempts (consecutive steals)
  if (newVal && oldVal && (newVal.throwToBase !== oldVal.throwToBase || newVal.runnerPlayerId !== oldVal.runnerPlayerId)) {
    hasRolledForSteal.value = false;
  }

  // Auto-resolve single steals for the defensive player
  if (newVal && !hasRolledForSteal.value && amIDefensivePlayer.value) {
    const currentPlay = gameStore.gameState?.currentPlay;
    // Determine if this is a single steal (not a double steal requiring a choice)
    const isDoubleSteal = currentPlay?.type === 'STEAL_ATTEMPT' && currentPlay.payload?.decisions &&
      Object.keys(currentPlay.payload.decisions).filter(k => currentPlay.payload.decisions[k]).length > 1;
    
    if (!isDoubleSteal) {
      // Single steal: auto-resolve after a short delay for UX
      hasRolledForSteal.value = true;
      gameStore.resolveSteal(gameId, null);
    }
  }
}, { immediate: true });

const nextBatterInLineup = computed(() => {
  if (!gameStore.gameState || !gameStore.lineups?.home || !gameStore.lineups?.away) return null;

  if (gameStore.isEffectivelyBetweenHalfInnings) {
    const isCurrentlyTop = gameStore.gameState.isTopInning;
    const offensiveTeamState = isCurrentlyTop ? gameStore.gameState.homeTeam : gameStore.gameState.awayTeam;
    const offensiveLineup = isCurrentlyTop ? gameStore.lineups.home.battingOrder : gameStore.lineups.away.battingOrder;

    if (!offensiveLineup) return null;

    return offensiveLineup[offensiveTeamState.battingOrderPosition]?.player;

  } else {
    const isTop = gameStore.gameState.isTopInning;
    const offensiveTeamState = isTop ? gameStore.gameState.awayTeam : gameStore.gameState.homeTeam;
    const offensiveLineup = isTop ? gameStore.lineups.away.battingOrder : gameStore.lineups.home.battingOrder;

    if (!offensiveLineup) return null;

    const nextIndex = (offensiveTeamState.battingOrderPosition + 1) % 9;

    return offensiveLineup[nextIndex]?.player;
  }
});

watch(nextBatterInLineup, (newNextBatter) => {
  if (newNextBatter && newNextBatter.image_url) {
    const img = new Image();
    img.src = newNextBatter.image_url;
  }
}, { immediate: true });

watch(nextGameId, (newId) => {
  if (newId) {
    gameStore.checkLineupForNextGame(newId);
  }
}, { immediate: true });

const batterToDisplay = computed(() => {
    if (isGameOver.value && isSwingResultVisible.value) {
        return gameStore.gameState?.currentAtBat?.batter ?? null;
    }
    if (anticipatedBatter.value) {
        return anticipatedBatter.value;
    }
    if (!gameStore.gameState) {
        return null;
    }

    if (gameStore.gameState?.inningEndedOnCaughtStealing && 
    gameStore.isEffectivelyBetweenHalfInnings) {
    const stealBatterId = gameStore.gameState.pendingStealAttempt?.batterPlayerId || 
                          gameStore.gameState.lastStealResult?.batterPlayerId ||
                          gameStore.gameState.currentPlay?.payload?.batterPlayerId;
    if (!stealBatterId || gameStore.gameState.currentAtBat?.batter?.card_id === stealBatterId) {
        return gameStore.gameState.currentAtBat?.batter ?? gameStore.gameState.lastCompletedAtBat?.batter;
    }
    return gameStore.gameState.lastCompletedAtBat?.batter;
}

    if (!gameStore.amIReadyForNext &&
 (gameStore.opponentReadyForNext || (gameStore.isEffectivelyBetweenHalfInnings && !(!gameStore.opponentReadyForNext && !gameStore.amIReadyForNext))
  || (!gameStore.gameState.lastStealResult && gameStore.gameState.pendingStealAttempt && false)) &&
  !(!!gameStore.gameState.lastStealResult && !gameStore.gameState.pendingStealAttempt && !gameStore.gameState.inningEndedOnCaughtStealing && !gameStore.opponentReadyForNext)) {
    if (gameStore.gameState.pendingStealAttempt &&
        !gameStore.gameState.currentAtBat?.pitcherAction &&
        !gameStore.gameState.currentAtBat?.batterAction) {
        return gameStore.batter;
    }
    return gameStore.gameState.lastCompletedAtBat.batter;
}

// NEW: During a pending steal, the defensive player should keep showing the previous batter
// until they've clicked Next Hitter (this handles edge cases where opponentReadyForNext
// might not correctly gate the display)
if (!gameStore.amIReadyForNext && amIDefensivePlayer.value &&
    gameStore.gameState.pendingStealAttempt && !gameStore.gameState.lastStealResult &&
    gameStore.gameState.lastCompletedAtBat?.batter) {
    return gameStore.gameState.lastCompletedAtBat.batter;
}

    return gameStore.batter;
});

const pitcherToDisplay = computed(() => {
    if (gameStore.gameState?.awaiting_lineup_change) {
        if (amIDisplayDefensivePlayer.value) {
            const pitcherOnMound = gameStore.pitcher;
            if (!pitcherOnMound || playersInInvalidPositions.value.has(pitcherOnMound.card_id)) {
                 return null;
            }
        } else {
            const opponentPitcher = gameStore.pitcher;
            if (!opponentPitcher || opponentPitcher.control === null) {
                return null;
            }
        }
    }
    if (isGameOver.value) {
        return gameStore.gameState?.lastCompletedAtBat?.pitcher ?? null;
    }
    if (!gameStore.gameState) return null;

    let basePitcher = null;
    
    if (gameStore.gameState?.inningEndedOnCaughtStealing && 
        gameStore.isEffectivelyBetweenHalfInnings &&
        isStealAttemptInProgress.value) {
        if (gameStore.gameState.currentAtBat?.pitcher?.card_id === gameStore.gameState.pendingStealAttempt?.pitcherPlayerId) {
            basePitcher = gameStore.gameState.currentAtBat.pitcher;
        } else {
            basePitcher = gameStore.gameState.lastCompletedAtBat?.pitcher;
        }

      } else if (shouldHideCurrentAtBatOutcome.value && !isStealAttemptInProgress.value && !showRollForSwingButton.value) {
        basePitcher = atBatToDisplay.value?.pitcher ?? null;
    } else if (!gameStore.amIReadyForNext && 
          (gameStore.opponentReadyForNext || (gameStore.isEffectivelyBetweenHalfInnings && !(!gameStore.opponentReadyForNext && !gameStore.amIReadyForNext)))
          && !(isStealAttemptInProgress.value && !gameStore.gameState.inningEndedOnCaughtStealing)) {
        basePitcher = gameStore.gameState.lastCompletedAtBat.pitcher;
    } else {
        basePitcher = gameStore.pitcher;
    }

    if (!basePitcher || typeof basePitcher.control !== 'number') {
        return basePitcher;
    }

    let pitcherToProcess = { ...basePitcher };
    const hasBeenSubstituted = basePitcher.card_id !== gameStore.gameState.lastCompletedAtBat?.pitcher?.card_id;

    if (!shouldHideCurrentAtBatOutcome.value || hasBeenSubstituted) {
        const pitcherTeamKey = isDisplayTopInning.value ? 'home' : 'away';
        const fullPitcherFromRoster = gameStore.rosters[pitcherTeamKey]?.find(p => p.card_id === basePitcher.card_id);
        if (fullPitcherFromRoster) {
            pitcherToProcess = { ...pitcherToProcess, ...fullPitcherFromRoster };
        }
    }

    const pitcherStats = gameStore.gameState?.pitcherStats;
    if (!pitcherStats) {
        return { ...pitcherToProcess, effectiveControl: pitcherToProcess.control };
    }

    const pitcherId = pitcherToProcess.card_id;
    const stats = pitcherStats[pitcherId] || { runs: 0, innings_pitched: [], fatigue_modifier: 0 };
    const inningsPitched = stats.innings_pitched || [];
    const inningsPitchedCount = inningsPitched.length;

    let controlPenalty = 0;
    const modifiedIp = pitcherToProcess.ip + (stats.fatigue_modifier || 0);
    const fatigueThreshold = modifiedIp - Math.floor((stats.runs || 0) / 3);

    if (inningsPitchedCount > fatigueThreshold) {
        controlPenalty = inningsPitchedCount - fatigueThreshold;
    }

    if (pitcherToProcess.fatigueStatus === 'tired') {
        controlPenalty = Math.max(controlPenalty, 1);
    }

    const effectiveControl = pitcherToProcess.control - controlPenalty;

    return {
        ...pitcherToProcess,
        effectiveControl,
    };
});


const showResolvedState = computed(() => {
  const atBatIsResolved = gameStore.gameState.currentAtBat?.batterAction && gameStore.gameState.currentAtBat?.pitcherAction
  const waitingToSwing = amIOffensivePlayer.value && !isSwingResultVisible.value;
  return atBatIsResolved && !waitingToSwing;
});


const basesToDisplay = computed(() => {
  return gameStore.displayGameState?.bases || { first: null, second: null, third: null };
});

const outsToDisplay = computed(() => {
  return gameStore.displayGameState?.outs ?? 0;
});

const finalScoreMessage = computed(() => {
  const basicVisibility = (isGameOver.value && gameStore.displayGameState.outs === 3) && (isSwingResultVisible.value || isGameEndingSteal.value);
  if (!basicVisibility || (!showAutoThrowResult.value && gameStore.gameState.throwRollResult) || (gameStore.gameState?.doublePlayDetails && !showThrowRollResult.value)) {
    return null;
  }
  const homeTeam = gameStore.teams.home;
  const awayTeam = gameStore.teams.away;
  const homeScore = gameStore.gameState.homeScore;
  const awayScore = gameStore.gameState.awayScore;

  let winningTeam;
  let losingTeam;
  let isWalkOff = false;

  if (homeScore > awayScore) {
    winningTeam = homeTeam;
    losingTeam = awayTeam;
    if (!gameStore.gameState.isTopInning && gameStore.gameState.inning >= 9) {
      isWalkOff = true;
    }
  } else {
    winningTeam = awayTeam;
    losingTeam = homeTeam;
  }

  const winningTeamName = isWalkOff ? winningTeam.abbreviation.toUpperCase() : winningTeam.abbreviation.toUpperCase();

  return {
    message: `<strong>FINAL</strong>: ${winningTeam.abbreviation.toUpperCase()} ${homeScore > awayScore ? homeScore : awayScore}, ${losingTeam.abbreviation.toUpperCase()} ${homeScore < awayScore ? homeScore : awayScore}`,
    colors: {
      primary: winningTeam.primary_color,
      secondary: winningTeam.secondary_color,
    }
  };
});

const seriesScoreMessage = computed(() => {
  const basicVisibility = (isGameOver.value && gameStore.displayGameState.outs === 3) && (isSwingResultVisible.value || isGameEndingSteal.value);
  if (!basicVisibility || (!showAutoThrowResult.value && gameStore.gameState.throwRollResult) || (gameStore.gameState?.doublePlayDetails && !showThrowRollResult.value)) {
    return null;
  }

  const series = gameStore.series;
  if (!series) {
    return null;
  }
  const homeTeam = gameStore.teams.home;
  const awayTeam = gameStore.teams.away;
  const homeWins = series.home_wins;
  const awayWins = series.away_wins;

  const gamesToWin = series.number_of_games ? Math.ceil(series.number_of_games / 2) : 999;

  if (homeWins === awayWins) {
    return {
      message: `<strong>SERIES</strong>: TIED ${homeWins}-${awayWins}`,
      colors: { primary: '#acadb0', secondary: '#000000', forTie: true }
    };
  }

  if (homeWins > awayWins) {
    return {
      message: `<strong>SERIES</strong>: ${homeTeam.abbreviation.toUpperCase()} ${homeWins}-${awayWins}`,
      colors: { primary: homeTeam.primary_color, secondary: homeTeam.secondary_color }
    };
  }

  if (awayWins > homeWins) {
     return {
      message: `<strong>SERIES</strong>: ${awayTeam.abbreviation.toUpperCase()} ${awayWins}-${homeWins}`,
      colors: { primary: awayTeam.primary_color, secondary: awayTeam.secondary_color }
    };
  }

  return null;
});

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
        if (gameStore.game?.game_in_series === 2) {
            router.push(`/game/${nextGameId.value}/setup`);
        } else {
            router.push(`/game/${nextGameId.value}/lineup`);
        }
    }
}

const showSetLineupForNextGameButton = computed(() => {
  return isGameOver.value && nextGameId.value && !gameStore.nextLineupIsSet
   && (isSwingResultVisible.value || isGameEndingSteal.value) 
   && !(!showAutoThrowResult.value && gameStore.gameState?.throwRollResult)
   && !(gameStore.gameState?.pendingStealAttempt && amIDisplayDefensivePlayer.value)
   ;
});
 
function hexToRgba(hex, alpha = 0.95) {
  if (!hex || !/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
    return `rgba(200, 200, 200, ${alpha})`;
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
  defensiveThrowRollClicked.value = false;
  gameStore.submitPitch(gameId, action);
}

// SIMUL: Always reset visibility — the bothPlayersSetAction watcher handles staged reveal
function handleOffensiveAction(action) {
  gameStore.setIsSwingResultVisible(false);
  simulPitchVisible.value = false;
  gameStore.submitAction(gameId, action);
}

function handleSwing(action = null) {
  gameStore.setIsSwingResultVisible(true);
  gameStore.submitSwing(gameId, action);
}

function handleNextHitter() {
  isTransitioningToNextHitter.value = true;
  gameStore.setIsSwingResultVisible(false);
  gameStore.setIsStealResultVisible(false);
  // SIMUL: Reset pitch visibility for next at-bat
  simulPitchVisible.value = false;
  hasSeenResult.value = false;
  localStorage.removeItem(seenResultStorageKey);
  defensiveThrowRollClicked.value = false;
  wasMultiThrowSituation.value = false;

  if (!gameStore.opponentReadyForNext && !gameStore.isEffectivelyBetweenHalfInnings && outsToDisplay.value < 3 && !gameStore.gameState.inningEndedOnCaughtStealing) {
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
    if (shouldDelayStealRoll.value && !gameStore.gameState?.inningEndedOnCaughtStealing) return true;
    if (shouldShowDoublePlayFirst.value) return false;

  if (isGameOver.value && 
    !!gameStore.gameState?.pendingStealAttempt && 
    amIDisplayDefensivePlayer.value) {
    return true;
  }
  if ((isGameOver.value && gameStore.displayGameState.outs < 3 && !gameStore.gameState?.pendingStealAttempt) || 
    !amIDisplayDefensivePlayer.value || !isMyTurn.value) return false;
    
    if (gameStore.gameState?.inningEndedOnCaughtStealing && 
        amIDisplayDefensivePlayer.value && 
        gameStore.gameState.pendingStealAttempt &&
        gameStore.amIReadyForNext) {
        return true;
    }
    if ((isGameOver.value && gameStore.displayGameState.outs < 3 && !gameStore.gameState?.pendingStealAttempt) || !amIDisplayDefensivePlayer.value || !isMyTurn.value) return false;
    

    const isSingleStealInProgress = (!!gameStore.gameState?.pendingStealAttempt || !!gameStore.gameState?.lastStealResult) &&
                                 (
                                   (isRunnerOnOffensiveTeam.value && !(gameStore.gameState?.inningEndedOnCaughtStealing && amIDisplayDefensivePlayer.value && !gameStore.amIReadyForNext)) ||
                                   (gameStore.gameState?.inningEndedOnCaughtStealing && gameStore.displayGameState?.outs > 0 && gameStore.amIReadyForNext)
                                 ) &&
                                 !(gameStore.gameState?.lastStealResult?.batterPlayerId === gameStore.gameState?.currentAtBat.batter.card_id && gameStore.gameState?.currentAtBat?.batterAction === 'take')
                                 ;

    const isDoubleStealInProgress = gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT' && 
                                !isSingleStealInProgress &&
                                !(gameStore.gameState?.inningEndedOnCaughtStealing && amIDisplayDefensivePlayer.value && !gameStore.amIReadyForNext);
    
    const isViewingPastTurn = !gameStore.opponentReadyForNext && gameStore.amIReadyForNext;
    const isBehindOpponent = gameStore.opponentReadyForNext && !gameStore.amIReadyForNext;

    const isPastStealDef = !!gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction && !gameStore.gameState.inningEndedOnCaughtStealing

    const isConsecutiveSteal = !!gameStore.gameState?.lastStealResult && !!gameStore.gameState?.pendingStealAttempt;
    
    const finalResult = (isSingleStealInProgress || isDoubleStealInProgress) && (!showStealResult.value || isConsecutiveSteal) && !isViewingPastTurn && !isBehindOpponent && !isPastStealDef && !gameStore.gameState?.throwRollResult;
    return finalResult;
});

const isSingleSteal = computed(() => {
    if (gameStore.gameState?.throwRollResult?.consolidatedOutcome) {
         return false;
    }

    const hasPendingOrLast = !!gameStore.gameState.pendingStealAttempt || !!gameStore.gameState?.lastStealResult;

    if (isStealAttemptInProgress.value && hasPendingOrLast) {
         return true;
    }

    if (isStealAttemptInProgress.value && gameStore.gameState?.currentPlay?.type === 'STEAL_ATTEMPT') {
         const decisions = gameStore.gameState.currentPlay.payload.decisions || {};
         const activeDecisions = Object.keys(decisions).filter(k => decisions[k]);
         return activeDecisions.length === 1;
    }

    return false;
});

const stealingRunner = computed(() => {
    if (!isSingleSteal.value) return null;

    if (gameStore.gameState.pendingStealAttempt) {
        return gameStore.gameState.pendingStealAttempt.runnerName;
    }
    if (gameStore.gameState.lastStealResult) {
        return gameStore.gameState.lastStealResult.runnerName;
    }

    if (gameStore.gameState.currentPlay?.type === 'STEAL_ATTEMPT') {
        const decisions = gameStore.gameState.currentPlay.payload.decisions || {};
        const fromBase = Object.keys(decisions).find(k => decisions[k]);
        if (fromBase) {
             const baseMap = { 1: 'first', 2: 'second', 3: 'third' };
             const runner = gameStore.gameState.currentAtBat.basesBeforePlay[baseMap[fromBase]];
             return runner ? (runner.displayName || runner.name) : 'Runner';
        }
    }
    return null;
});

const targetBase = computed(() => {
    if (!isSingleSteal.value) return null;

    let baseNumber;
    if (gameStore.gameState.pendingStealAttempt) {
        baseNumber = gameStore.gameState.pendingStealAttempt.throwToBase;
    } else if (gameStore.gameState.lastStealResult) {
        baseNumber = gameStore.gameState.lastStealResult.throwToBase;
    } else if (gameStore.gameState.currentPlay?.type === 'STEAL_ATTEMPT') {
        const decisions = gameStore.gameState.currentPlay.payload.decisions || {};
        const fromBase = Object.keys(decisions).find(k => decisions[k]);
        if (fromBase) {
            baseNumber = parseInt(fromBase, 10) + 1;
        }
    }

    if (!baseNumber) return null;

    const getOrdinal = (n) => {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    return getOrdinal(baseNumber);
});

const isInfieldInDecision = computed(() => {
    if (isGameOver.value) return false;
    return amIOffensivePlayer.value && isMyTurn.value && gameStore.gameState?.currentPlay?.type === 'INFIELD_IN_CHOICE' && !showRollForSwingButton.value;
});


function handleInfieldInDecision(sendRunner) {
    gameStore.submitInfieldInDecision(gameId, sendRunner);
}



watch(infieldIn, (newValue, oldValue) => {
    if (newValue !== oldValue && amIDefensivePlayer.value) {
        gameStore.setDefense(gameId, newValue);
    }
});

watch(() => atBatToDisplay.value?.infieldIn, (newValue) => {
    infieldIn.value = !!newValue;
}, { immediate: true });

const bothPlayersCaughtUp = computed(() => {
if (!gameStore.gameState) return false;
return !gameStore.gameState.awayPlayerReadyForNext && !gameStore.gameState.homePlayerReadyForNext
});

watch(batterToDisplay, (newBatter, oldBatter) => {
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


const defensiveTeamKey = computed(() => isDisplayTopInning.value ? 'homeTeam' : 'awayTeam');
const defensiveNextBatterIndex = computed(() => {
    if (!gameStore.gameState) return -1;
    return gameStore.gameState[defensiveTeamKey.value].battingOrderPosition;
});



const outcomeBatter = computed(() => {
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

// SIMUL: Advantage only shows after simultaneous pitch reveal
const showAdvantage = computed(() => {
  return atBatToDisplay.value.pitchRollResult && simulPitchVisible.value;
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
  if (amIDisplayDefensivePlayer.value) {
    classes.push('result-box-left');
  } else {
    classes.push('result-box-right');
  }
  return classes;
});

const swingResultClasses = computed(() => {
  const classes = ['result-box'];
  if (amIDisplayOffensivePlayer.value) {
    classes.push('result-box-left');
  } else {
    classes.push('result-box-right');
  }
  return classes;
});

const delayInningChange = computed(() => {
  if (!gameStore.gameState?.inningEndedOnCaughtStealing) return false;
  
  const stealData = gameStore.gameState.pendingStealAttempt || gameStore.gameState.lastStealResult || gameStore.gameState.throwRollResult;
  if (stealData) {
    const runnerTeamId = stealData.runnerTeamId;
    const myTeamId = gameStore.teams?.[gameStore.myTeam]?.team_id;
    const wasIOffensive = Number(runnerTeamId) === Number(myTeamId);
    
    if (!wasIOffensive) return false;
    if (gameStore.gameState.lastStealResult || gameStore.gameState.throwRollResult) return false;
  } else {
    // All steal data cleared — steal is fully resolved, nothing to delay
    return false;
  }
  
  return (!gameStore.gameState.isBetweenHalfInningsHome || 
          !gameStore.gameState.isBetweenHalfInningsAway);
});

onMounted(async () => {
  await gameStore.fetchGame(gameId);

  const storedResultSeen = JSON.parse(localStorage.getItem(seenResultStorageKey)) || false;
  if (storedResultSeen) {
      gameStore.setIsSwingResultVisible(true);
      // SIMUL: Also restore pitch visibility
      simulPitchVisible.value = true;
      hasSeenResult.value = true;
  }

  initialLoadComplete.value = true;

  // Check if we are returning to a completed at-bat
  const atBat = atBatToDisplay.value;
  if (atBat && atBat.swingRollResult && atBat.pitchRollResult) {
    if (authStore.user) {
      // SIMUL: If returning to a completed at-bat, show everything
      if (!isSwingResultVisible.value) {
        // Only if the result hasn't been seen yet — could be a reconnection mid-reveal
      } else {
        simulPitchVisible.value = true;
      }
    }
  }
  
  if (import.meta.env.DEV) {
    window.socket = socket;
  }

  socket.connect();

  if (socket.connected) {
      isConnected.value = true;
      socket.emit('join-game-room', gameId);
  }

  socket.on('connect', () => {
      console.log('Socket connected/reconnected. Joining room:', gameId);
      isConnected.value = true;
      socket.emit('join-game-room', gameId);
  });

  socket.on('disconnect', () => {
      console.warn('Socket disconnected.');
      isConnected.value = false;
  });

  socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      isConnected.value = false;
  });

  socket.on('game-updated', (data) => {
    gameStore.updateGameData(data);
  });

  socket.on('series-next-game-ready', (data) => {
    const series = gameStore.series;
    const myTeamIsSeriesHome = authStore.user.userId === series.series_home_user_id;
    const myWins = myTeamIsSeriesHome ? data.home_wins : data.away_wins;
    const opponentWins = myTeamIsSeriesHome ? data.away_wins : data.home_wins;

    seriesUpdateMessage.value = `Series score is now ${myWins}-${opponentWins}.`;
    gameStore.nextGameId = data.nextGameId;
    gameStore.checkLineupForNextGame(data.nextGameId);
  });

  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onUnmounted(() => {
  gameStore.resetGameState();
  socket.off('game-updated');
  socket.off('series-next-game-ready');
  socket.off('connect');
  socket.off('disconnect');
  socket.off('connect_error');
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    gameStore.fetchGame(gameId);
  }
}
</script>

<template>
  <div v-if="selectedCard" class="modal-overlay" @click="selectedCard = null">
    <div @click.stop><PlayerCard :player="selectedCard" /></div>
  </div>

  <!-- CONNECTION ERROR BANNER -->
  <div v-if="!isConnected" class="connection-banner">
      ⚠️ Connection Lost. Reconnecting...
  </div>

  <div class="game-view-container" v-if="gameStore.gameState && (isGameOver || (gameStore.lineups?.home && gameStore.lineups?.away))">
    
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
            :details="stealDisplayDetails || gameStore.gameState.throwRollResult"
            :teamColors="pitcherTeamColors"
          />
          <ThrowRollResult
            v-if="showStealResult && stealDisplayDetails"
            :details="stealDisplayDetails"
            :teamColors="pitcherTeamColors"
          />
          <div class="defensive-ratings">
            <div>{{ catcherArmDisplay }}</div>
            <div>{{ infieldDefenseDisplay }}</div>
            <div>{{ outfieldDefenseDisplay }}</div>
            <div v-if="atBatToDisplay.infieldIn" style="color: red;">IF IN</div>
          </div>
          <!-- SIMUL: Pitch box only shows after simulPitchVisible is set (when both players have acted) -->
          <div v-if="atBatToDisplay.pitchRollResult && simulPitchVisible &&
            !(isDoubleStealResultAvailable.value && !(gameStore.gameState.currentAtBat.pitcherAction && !gameStore.gameState.currentAtBat.batterAction)) &&
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
          <div v-if="finalScoreMessage" class="final-score-message" :style="{ backgroundColor: hexToRgba(finalScoreMessage.colors.primary), borderColor: hexToRgba(finalScoreMessage.colors.secondary), color: getContrastingTextColor(finalScoreMessage.colors.primary) }" v-html="finalScoreMessage.message">
          </div>
           <div v-if="seriesScoreMessage" class="series-score-message" :style="{ backgroundColor: hexToRgba(seriesScoreMessage.colors.primary), borderColor: hexToRgba(seriesScoreMessage.colors.secondary), color: getContrastingTextColor(seriesScoreMessage.colors.primary) }" v-html="seriesScoreMessage.message">
          </div>
      </div>

      <!-- PLAYER CARDS & ACTIONS -->
      <div class="player-cards-and-actions-container">
        <!-- Actions (for layout purposes) -->
<div v-if="!showSetLineupForNextGameButton && !(isGameOver && isSwingResultVisible && !((gameStore.gameState?.doublePlayDetails && !showThrowRollResult)))" class="actions-container">
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
                        Throw {{ option.toBaseLabel }} ({{ option.outThreshold }}+)
                    </button>
                </div>
            </div>
            <!-- SIMUL: Steal UI — single steals auto-resolve, double steals still need choice -->
            <div v-else-if="isStealAttemptInProgress && amIDisplayDefensivePlayer && (!showStealResult || (!!gameStore.gameState?.lastStealResult && !!gameStore.gameState?.pendingStealAttempt))">
                <div v-if="isSingleSteal">
                    <h3>{{ stealingRunner }} is stealing {{ targetBase }}!</h3>
                    <!-- SIMUL: Auto-resolved, just show rolling indicator -->
                    <div class="waiting-text">Rolling...</div>
                </div>
                <div v-else>
                    <h3>Opponent is attempting a double steal!</h3>
                    <div v-if="!hasRolledForSteal">
                      <p>Choose which base to throw to:</p>
                      <div class="steal-throw-decisions">
                        <button @click="handleResolveSteal(2)" v-if="gameStore.gameState.currentPlay.payload.decisions['1']" class="tactile-button">Throw to 2nd ({{ doubleStealDefenseThresholds[2] }}+)</button>
                        <button @click="handleResolveSteal(3)" v-if="gameStore.gameState.currentPlay.payload.decisions['2']" class="tactile-button">Throw to 3rd ({{ doubleStealDefenseThresholds[3] }}+)</button>
                      </div>
                    </div>
                    <div v-else class="waiting-text">Rolling...</div>
                </div>
            </div>
            <div v-else-if="isInfieldInDecision">
                <h3>Infield In Play</h3>
                <p>The defense has the infield in. What will the runner on third do?</p>
                <div class="infield-in-decisions">
                    <button @click="handleInfieldInDecision(true)" class="tactile-button">Send Runner Home ({{ infieldInOutThreshold }}+)</button>
                    <button @click="handleInfieldInDecision(false)" class="tactile-button">Hold Runner</button>
                </div>
            </div>
            <div v-else>
                <!-- SIMUL: No ROLL FOR THROW, ROLL FOR DOUBLE PLAY, or ROLL FOR SWING buttons -->
                <button v-if="showRollForPitchButton" class="action-button tactile-button" @click="handlePitch()"><strong>ROLL FOR PITCH</strong></button>
                <button v-else-if="showSwingAwayButton" class="action-button tactile-button" @click="handleOffensiveAction('swing')"><strong>SWING AWAY</strong></button>
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
                    <button v-if="canStealSecond && showSwingAwayButton" @click="handleInitiateSteal({ '1': true })" class="tactile-button">Steal 2nd ({{ stealOutThresholds['2'] }}+)</button>
                    <button v-if="canStealThird && showSwingAwayButton" @click="handleInitiateSteal({ '2': true })" class="tactile-button">Steal 3rd ({{ stealOutThresholds['3'] }}+)</button>
                    <button v-if="canDoubleSteal && showSwingAwayButton" @click="handleInitiateSteal({ '1': true, '2': true })" class="tactile-button">Double Steal ({{ stealOutThresholds['3'] }}+, {{ stealOutThresholds['2'] }}+)</button>
                </div>
            </div>

            <!-- Waiting Indicators -->
            <div v-if="isAwaitingBaserunningDecision" class="waiting-text">Waiting on baserunning decision...</div>
            <div v-else-if="(delayInningChange && !showNextHitterButton) || (amIDisplayOffensivePlayer && gameStore.gameState?.lastStealResult && !gameStore.gameState.currentAtBat?.batterAction && !gameStore.gameState.currentAtBat?.pitcherAction && !gameStore.opponentReadyForNext && !gameStore.gameState?.inningEndedOnCaughtStealing)" class="waiting-text">Waiting for opponent...</div>
            <div v-else-if="amIDisplayOffensivePlayer && gameStore.gameState.currentAtBat.batterAction && !gameStore.gameState.currentAtBat.pitcherAction && !isStealAttemptInProgress && !isAdvancementOrTagUpDecision && !isDefensiveThrowDecision && !gameStore.opponentReadyForNext" class="waiting-text">Waiting for pitch...</div>
            <div v-else-if="amIDisplayDefensivePlayer && gameStore.gameState.currentAtBat.pitcherAction && (!gameStore.gameState.currentAtBat.batterAction || gameStore.gameState.currentAtBat.batterAction === 'take' && !showNextHitterButton) && !isStealAttemptInProgress && !isAdvancementOrTagUpDecision && !isDefensiveThrowDecision && !gameStore.isEffectivelyBetweenHalfInnings && !(gameStore.inningEndedOnCaughtStealing && gameStore.displayGameState.outs > 0)" class="turn-indicator">Waiting for swing...</div>
            <div v-else-if="isWaitingForQueuedStealResolution || (amIDisplayOffensivePlayer && ((gameStore.gameState.currentPlay?.type === 'ADVANCE' || gameStore.gameState.currentPlay?.type === 'TAG_UP') && isSwingResultVisible && !!gameStore.gameState.currentPlay.payload.choices)) || (isOffensiveStealInProgress && !gameStore.gameState.pendingStealAttempt)" class="waiting-text">Waiting for throw...</div>
            <!-- SIMUL: Show "Revealing..." during the staged reveal window -->
            <!--div v-else-if="bothPlayersSetAction && !isSwingResultVisible && simulPitchVisible" class="waiting-text">Revealing...</div-->
        </div>

        <div v-else-if="showSetLineupForNextGameButton" class="actions-container">
            <button class="action-button tactile-button" @click="proceedToNextGame()"><strong>Set Lineup for Next Game</strong></button>
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
            <div v-else class="tbd-pitcher-card" :class="{ 'selecting-pitcher-mode': gameStore.gameState.awaiting_lineup_change && !pitcherToDisplay }" :style="{ borderColor: controlledPlayerTeamColors.primary }">
                <div v-if="(gameStore.gameState.awaiting_lineup_change && !pitcherToDisplay)" class="selecting-pitcher-text">
                    <h3><em></em></h3>
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
             <div v-else class="tbd-pitcher-card" :class="{ 'selecting-pitcher-mode': gameStore.gameState.awaiting_lineup_change && !pitcherToDisplay }" :style="{ borderColor: opponentPlayerTeamColors.primary }">
                <div v-if="gameStore.gameState.awaiting_lineup_change && !pitcherToDisplay" class="selecting-pitcher-text">
                     <h3><em>Selecting Pitcher...</em></h3>
                </div>
                <template v-else>
                    <span v-if="!gameStore.gameState.awaiting_lineup_change" class="tbd-role">{{ opponentPlayerRole }}</span>
                    <span class="tbd-name"></span>
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
              <li v-for="(spot, index) in leftPanelData.lineup" :key="index"
                  :class="{
                      'now-batting': amIDisplayOffensivePlayer && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                      'next-up': amIDisplayDefensivePlayer && index === defensiveNextBatterIndex,
                      'is-sub-target': playerToSubOut?.source === 'lineup' && playerToSubOut?.index === index,
                      'invalid-position': isMyTeamAwaitingLineupChange && playersInInvalidPositions.has(spot.player.card_id)
                  }"
                  :style="playerToSubOut && playerToSubOut.source === 'lineup' && playerToSubOut.index === index ? { backgroundColor: leftPanelData.colors.primary, color: getContrastingTextColor(leftPanelData.colors.primary) } : {}"
                  class="lineup-item">
                  <span @click.stop="selectPlayerToSubOut(spot.player, spot.position, index, 'lineup')"
                        class="sub-icon"
                        :class="{
                            'visible': isSubModeActive && leftPanelData.isMyTeam && spot.position !== 'DH' && isPlayerSubEligible(spot.player),
                            'active': playerToSubOut?.source === 'lineup' && playerToSubOut?.index === index
                        }">
                      ⇄
                  </span>
                  <span @click="selectedCard = spot.player">{{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }})</span>
              </li>
          </ol>
          <div v-if="useDh" class="pitcher-info" :class="{'is-sub-target': playerToSubOut?.source === 'pitcher'}" :style="playerToSubOut && playerToSubOut.source === 'pitcher' ? { backgroundColor: leftPanelData.colors.primary, color: getContrastingTextColor(leftPanelData.colors.primary) } : {}">
            <hr />
            <span @click.stop="selectPlayerToSubOut(leftPanelData.pitcher, 'P', -1, 'pitcher')"
                  class="sub-icon"
                  :class="{
                      'visible': isSubModeActive && leftPanelData.isMyTeam && leftPanelData.pitcher && isStartingPitcherEligible,
                      'active': playerToSubOut?.source === 'pitcher'
                  }">
                ⇄
            </span>
            <span @click="selectedCard = leftPanelData.pitcher">
                <strong :style="playerToSubOut && playerToSubOut.source === 'pitcher' ? { color: 'inherit' } : { color: black }">Pitching: </strong>
                <template v-if="leftPanelData.pitcher">{{ leftPanelData.pitcher.name }}</template>
            </span>
          </div>
          <div v-if="leftPanelData.bullpen.length > 0">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Bullpen:</strong>
              <ul>
                  <li v-for="p in leftPanelData.bullpen" :key="p.card_id" class="lineup-item" :class="{'is-sub-in-candidate': isSubModeActive && playerToSubOut && !usedPlayerIds.has(p.card_id)}">
                      <span @click.stop="handleSubstitution(p)"
                            class="sub-icon"
                            :class="{ 'visible': isSubModeActive && playerToSubOut && leftPanelData.isMyTeam && !usedPlayerIds.has(p.card_id) && isStartingPitcherEligible }">
                          ⇄
                      </span>
                      <span @click="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id), 'is-tired': p.fatigueStatus === 'tired' && !usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.ip}} IP)</span>
                      <span v-if="p.fatigueStatus === 'tired' && !usedPlayerIds.has(p.card_id)" class="status-indicators">
                          <span v-for="n in Math.abs(p.fatigue_modifier || 0)" :key="n" class="status-icon tired" :title="`Penalty: -${p.fatigue_modifier}`"></span>
                      </span>
                      <span v-else-if="p.isBufferUsed && !usedPlayerIds.has(p.card_id)" class="status-icon used" title="Buffer Used"></span>
                  </li>
              </ul>
          </div>
          <div v-if="leftPanelData.bench.length > 0">
              <hr /><strong :style="{ color: leftPanelData.colors.primary }">Bench:</strong>
              <ul>
                  <li v-for="(p, index) in leftPanelData.bench" :key="index" class="lineup-item" :class="{'is-sub-in-candidate': isSubModeActive && playerToSubOut && !usedPlayerIds.has(p.card_id)}">
                      <span @click.stop="handleSubstitution(p)"
                            class="sub-icon"
                            :class="{ 'visible': isSubModeActive && playerToSubOut && leftPanelData.isMyTeam && !usedPlayerIds.has(p.card_id) && (amIDisplayOffensivePlayer || gameStore.gameState.inning >= 7 || p.assignment !== 'BENCH') }">
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
              <li v-for="(spot, index) in rightPanelData.lineup" :key="index"
                  :class="{
                      'now-batting': amIDisplayDefensivePlayer && batterToDisplay && spot.player.card_id === batterToDisplay.card_id,
                      'next-up': amIDisplayOffensivePlayer && index === defensiveNextBatterIndex
                  }"
                  class="lineup-item">
                  <span class="sub-icon"></span>
                  <span @click.stop="selectedCard = spot.player">{{ index + 1 }}. {{ spot.player.displayName }} ({{ spot.position }})</span>
              </li>
          </ol>
          <div v-if="useDh" class="pitcher-info">
              <hr />
              <span class="sub-icon"></span>
              <span @click.stop="selectedCard = rightPanelData.pitcher">
                <strong :style="{ color: black }">Pitching: </strong>
                <template v-if="rightPanelData.pitcher">{{ rightPanelData.pitcher.name }}</template>
                <template v-else>TBD</template>
              </span>
          </div>
          <div v-if="rightPanelData.bullpen.length > 0">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Bullpen:</strong>
              <ul>
                  <li v-for="p in rightPanelData.bullpen" :key="p.card_id" class="lineup-item">
                          <span class="sub-icon"></span>
                          <span @click.stop="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id), 'is-tired': p.fatigueStatus === 'tired' && !usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.ip}} IP)</span>
                          <span v-if="p.fatigueStatus === 'tired' && !usedPlayerIds.has(p.card_id)" class="status-indicators">
                              <span v-for="n in Math.abs(p.fatigue_modifier || 0)" :key="n" class="status-icon tired" :title="`Penalty: -${p.fatigue_modifier}`"></span>
                          </span>
                          <span v-else-if="p.isBufferUsed && !usedPlayerIds.has(p.card_id)" class="status-icon used" title="Buffer Used"></span>
                  </li>
              </ul>
          </div>
          <div v-if="rightPanelData.bench.length > 0">
              <hr /><strong :style="{ color: rightPanelData.colors.primary }">Bench:</strong>
              <ul>
                  <li v-for="p in rightPanelData.bench" :key="p.card_id" class="lineup-item">
                      <span class="sub-icon"></span>
                      <span @click.stop="selectedCard = p" :class="{'is-used': usedPlayerIds.has(p.card_id)}">{{ p.displayName }} ({{p.displayPosition}})</span>
                  </li>
              </ul>
          </div>
      </div>
    </div>
  </div>
  <div v-else class="loading-container"><p>Loading game...</p></div>
</template>

<style scoped>
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

.at-bat-container {
  display: grid;
  grid-template-columns: 320px auto 320px;
  justify-content: center;
  grid-template-rows: auto 1fr;
  gap: 1rem 2rem;
  justify-items: center;
  align-items: start;
  margin-top: 1rem;
}

.player-cards-and-actions-container,
.player-cards-wrapper {
  display: contents;
}

.player-container:first-child {
  grid-column: 1 / 2;
  grid-row: 1 / 2;
}
.actions-container {
  grid-column: 1 / 2;
  grid-row: 2 / 3;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 320px;
  margin-top: 1rem;
}
.diamond-and-results-container {
  grid-column: 2 / 3;
  grid-row: 1 / 3;
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


@media (max-width: 992px) {
  .at-bat-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }

  .player-cards-and-actions-container {
    display: contents;
  }

  .actions-container {
    order: 1;
    width: 100%;
    max-width: 350px;
  }
  .diamond-and-results-container {
    order: 2;
  }
  .player-cards-wrapper {
    order: 3;
    display: flex;
    gap: 1rem;
    justify-content: center;
    width: 100%;
    flex-wrap: wrap;
  }

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
    max-width: 280px;
}

.tbd-pitcher-card {
    border: 4px solid #343a40;
    border-radius: 10px;
    padding: 1rem;
    background-color: #f8f9fa;
    width: 100%;
    max-width: 320px;
    height: 446px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 0.5rem;
}
.tbd-pitcher-card.selecting-pitcher-mode {
    max-width: 200px;
    height: auto;
    aspect-ratio: 220 / 308;
    background-color: white;
    border: none !important;
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
  .diamond-and-results-container > .throw-roll-result {
    bottom: 10px;
    left: auto;
    right: -20px;
    transform: translateX(0);
  }
}


.info-container {
  display: flex;
  justify-content: center;
  gap: 1rem;
  align-items: flex-start;
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
  flex: 1;
  min-width: 280px;
  max-width: 350px;
}

.event-log {
  background: #f9f9f9;
  padding: 1rem;
  border-radius: 8px;
  flex: 2;
  min-width: 300px;
  max-width: 500px;
  display: flex;
  flex-direction: column;
}

.connection-banner {
    background-color: #dc3545;
    color: white;
    text-align: center;
    padding: 0.5rem;
    font-weight: bold;
    position: sticky;
    top: 0;
    z-index: 2000;
}

.loading-container { text-align: center; padding: 5rem; font-size: 1.5rem; }
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000; }
.modal-overlay > div { max-width: 320px; }

.lineup-header { display: flex; align-items: center; gap: 0.75rem; margin-top: 0; }
.lineup-header span:first-of-type { flex-grow: 1; }
.sub-icon {
  cursor: pointer;
  font-size: 1.2rem;
  border-radius: 5px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 18px;
  visibility: hidden;
}
.sub-icon.visible, .sub-icon.active {
  visibility: visible;
}
.sub-icon.visible:hover:not(.active) {
  background-color: rgba(0,0,0,0.05);
}
.sub-icon.active {
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
  margin: 0px -8px;
  transition: background-color 0.2s, color 0.2s;
}
.lineup-item > span:not(.sub-icon), .pitcher-info > span:not(.sub-icon) {
  cursor: pointer;
}
.lineup-item > span:not(.sub-icon):hover, .pitcher-info > span:not(.sub-icon):hover {
  text-decoration: underline;
}
.pitcher-info { font-weight: bold; margin-top: 0.5rem; margin-left: -1.2rem}
.is-tired {
}
.is-sub-target {
}
.is-sub-target .sub-icon {
    background-color: transparent;
}
.is-sub-target .tired-indicator {
    color: white;
}
.status-indicators {
    display: flex;
    gap: 2px;
    margin-left: -3px;
}
.status-icon {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}
.status-icon.tired {
    background-color: #dc3545;
    border: 2px solid #dc3545;
}
.status-icon.used {
    background-color: transparent;
    border: 2px solid #dc3545;
    margin-left: -3px;
}
.is-sub-in-candidate:hover {
    background-color: #e9ecef;
}
.now-batting { background-color: #fff8e1; font-weight: bold; font-style: normal !important; color: #000 !important; }
.next-up { background-color: #e9ecef; color: #000 !important; }
.is-used {
  color: #6c757d;
  text-decoration: line-through;
  pointer-events: none;
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

.inning-header >>> .inning-change-message {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.inning-header >>> .team-logo-small {
  height: 28px;
  width: 28px;
  object-fit: contain;
}

.inning-header >>> .inning-change-message b {
  font-size: 1.1rem;
  font-weight: bold;
}

.inning-header >>> .pitcher-announcement {
  margin-top: 0.25rem;
  font-size: 0.9rem;
  font-style: italic;
  font-weight: normal;
  color: #555;
}

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
.runner-decisions-group, .steal-throw-decisions, .defensive-throw-decisions, .infield-in-decisions {
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

.result-box {
  padding: 0.5rem 1rem;
  border-radius: 1px;
  color: black;
  border: 1px solid;
  text-align: center;
  position: absolute;
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

.turn-indicator, .waiting-text { font-style: italic; color: #555; text-align: center; padding-top: 0rem; }
.score-update-flash {
  position: absolute;
  top: -25px;
  left: 0;
  right: 0;
  font-size: 1.5rem;
  color: black;
  text-align: center;
  pointer-events: none;
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
.final-score-message, .series-score-message {
  padding: 0.5rem 1.5rem;
  border-radius: 1px;
  border: 3px solid;
  text-align: center;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: auto;
  white-space: nowrap;
}

.final-score-message {
  font-size: 2rem;
  top: 100px;
}

.series-score-message {
  font-size: 3rem;
  bottom: 120px;
}

</style>