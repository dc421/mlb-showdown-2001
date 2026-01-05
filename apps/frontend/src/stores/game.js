import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from './auth';
import { calculateDisplayGameState } from '../utils/gameState';
import { apiClient } from '../services/api'; // Import apiClient

const teams = ref({ home: null, away: null });

export const useGameStore = defineStore('game', () => {
  const game = ref(null);
  const series = ref(null);
  const gameState = ref(null);
  const nextGameId = ref(null);
  const gameEvents = ref([]);
  const batter = ref(null);
  const pitcher = ref(null);
  const lineups = ref({ home: null, away: null });
  const nextLineupIsSet = ref(false);
  const rosters = ref({ home: [], away: [] });
  const teams = ref({ home: null, away: null });
  const setupState = ref(null);
  const playerSelectedForSwap = ref(null);
  const snapshots = ref([]);

async function swapPlayerPositions(gameId, playerAId, playerBId) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    const response = await apiClient(`/api/games/${gameId}/swap-positions`, {
      method: 'POST',
      body: JSON.stringify({ playerAId, playerBId })
    });
    if (!response.ok) throw new Error('Failed to swap player positions');

    // Manually fetch and apply the updated state to win the race against the websocket.
    const updatedGameData = await apiClient(`/api/games/${gameId}`);
    if (!updatedGameData.ok) throw new Error('Failed to fetch updated game data after swap');
    updateGameData(await updatedGameData.json());

  } catch (error) {
    console.error('Error swapping player positions:', error);
    alert(`Error: ${error.message}`);
  }
}

async function fetchGame(gameId) {
  const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/games/${gameId}`);
      if (!response.ok) throw new Error('Failed to fetch game data');
      
      const data = await response.json();

      // --- START PRODUCTION DEBUGGING ---
      console.log('--- Raw data from fetchGame ---');
      console.log(JSON.stringify(data, null, 2));
      // --- END PRODUCTION DEBUGGING ---
      
      game.value = data.game;
      if (data.nextGameId) {
        nextGameId.value = data.nextGameId;
      }
      
      series.value = data.series;
      gameState.value = data.gameState ? data.gameState.state_data : null;
      gameEvents.value = data.gameEvents;
      
      batter.value = data.batter;
      pitcher.value = data.pitcher;
      lineups.value = data.lineups;
      rosters.value = data.rosters;
      teams.value = data.teams;
    } catch (error) {
      console.error(error);
    }
}

async function submitBaserunningDecisions(gameId, decisions) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/submit-decisions`, {
      method: 'POST',
      body: JSON.stringify({ decisions })
    });
  } catch (error) { console.error("Error submitting decisions:", error); }
}

async function setGameState(gameId, partialState) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/dev/games/${gameId}/set-state`, {
      method: 'POST',
      body: JSON.stringify(partialState)
    });
  } catch (error) {
    console.error("Error setting game state:", error);
  }
}

async function loadScenario(gameId, scenario) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/dev/games/${gameId}/load-scenario`, {
      method: 'POST',
      body: JSON.stringify({ scenario })
    });
    await fetchGame(gameId);
  } catch (error) {
    console.error("Error loading scenario:", error);
  }
}

async function resolveDefensiveThrow(gameId, throwTo) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    const response = await apiClient(`/api/games/${gameId}/resolve-throw`, {
      method: 'POST',
      body: JSON.stringify({ throwTo })
    });
    if (!response.ok) throw new Error('Failed to resolve throw');
    const updatedGameData = await response.json();
    updateGameData(updatedGameData); // Update the store with the new data
  } catch (error) {
    console.error("Error resolving throw:", error);
  }
}

  async function setDefense(gameId, infieldIn) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/set-defense`, {
      method: 'POST',
      body: JSON.stringify({ infieldIn: infieldIn })
    });
  } catch (error) {
    console.error("Error setting defense:", error);
  }
}

  async function fetchGameSetup(gameId) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/games/${gameId}/setup`);
      if (!response.ok) throw new Error('Failed to fetch setup');
      setupState.value = await response.json();
    } catch (error) {
      console.error("Error in fetchGameSetup:", error);
    }
  }

  async function checkLineupForNextGame(gameId) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/games/${gameId}/my-lineup`);
      if (!response.ok) throw new Error('Failed to check lineup status');
      const data = await response.json();
      nextLineupIsSet.value = data.hasLineup;
    } catch (error) {
      console.error(error);
      nextLineupIsSet.value = false;
    }
  }

  async function submitRoll(gameId) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
        await apiClient(`/api/games/${gameId}/roll`, {
            method: 'POST'
        });
    } catch (error) {
        console.error('Error submitting roll:', error);
    }
  }

  async function submitGameSetup(gameId, setupData) {
    console.log('2. Game Store: submitGameSetup action was called.');
      console.log(' -> Data being sent:', setupData);
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/games/${gameId}/setup`, {
        method: 'POST',
        body: JSON.stringify(setupData)
      });
      if (!response.ok) throw new Error('Failed to submit game setup');
    } catch (error) {
      console.error('Failed to submit setup:', error);
      alert(`Error: ${error.message}`);
    }
  }

async function submitPitch(gameId, action = null) {
  console.log('2. Game Store: submitPitch action was called.');

  // Optimistic Update
  if (gameState.value && gameState.value.currentAtBat) {
      const optimisticAction = action || 'pitch';
      gameState.value.currentAtBat.pitcherAction = optimisticAction;

      if (gameState.value.currentAtBat.batterAction) {
          gameState.value.defensivePlayerWentSecond = true;
      }
      if (optimisticAction === 'intentional_walk') {
          gameState.value.currentAtBat.batterAction = 'take';
      }
  }

  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/pitch`, {
      method: 'POST',
      body: JSON.stringify({ action: action })
    });
    await fetchGame(gameId);
  } catch (error) { console.error('Error submitting pitch:', error); }
}

async function submitAction(gameId, action) {
  // Optimistic Update
  if (gameState.value && gameState.value.currentAtBat) {
      gameState.value.currentAtBat.batterAction = action;
  }

  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/set-action`, {
      method: 'POST',
      body: JSON.stringify({ action })
    });
    await fetchGame(gameId);
  } catch (error) { console.error("Error setting offensive action:", error); }
}

async function submitSwing(gameId, action = null) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/swing`, {
      method: 'POST',
      body: JSON.stringify({ action: action })
    });
  } catch (error) { console.error('Error submitting swing:', error); }
}
  
  async function submitSubstitution(gameId, substitutionData) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/games/${gameId}/substitute`, {
        method: 'POST',
        body: JSON.stringify(substitutionData)
      });
      if (!response.ok) throw new Error('Failed to make substitution');

      // Manually fetch and apply updated state
      const updatedGameData = await apiClient(`/api/games/${gameId}`);
      if (!updatedGameData.ok) throw new Error('Failed to fetch updated game data after substitution');
      updateGameData(await updatedGameData.json());

    } catch (error) {
      console.error('Error making substitution:', error);
      alert(`Error: ${error.message}`);
    }
  }

async function resolveDoublePlay(gameId) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/resolve-double-play`, {
      method: 'POST'
    });
  } catch (error) { console.error("Error resolving double play:", error); }
}

  async function nextHitter(gameId) {
  // Optimistic Update
  if (gameState.value && myTeam.value) {
      if (myTeam.value === 'home') {
          gameState.value.homePlayerReadyForNext = true;
      } else {
          gameState.value.awayPlayerReadyForNext = true;
      }
  }

  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/next-hitter`, {
      method: 'POST'
    });
  } catch (error) { console.error("Error advancing to next hitter:", error); }
}

async function declareHomeTeam(gameId, homeTeamUserId) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/declare-home`, {
      method: 'POST',
      body: JSON.stringify({ homeTeamUserId })
    });
  } catch (error) {
    console.error("Error declaring home team:", error);
  }
}


  async function advanceRunners(gameId, decisions) {
  console.log('2. advanceRunners action called in the store.');
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/advance-runners`, {
      method: 'POST',
      body: JSON.stringify({ decisions })
    });
  } catch (error) {
    console.error("Error advancing runners:", error);
  }
}

  async function submitTagUp(gameId, decisions) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/tag-up`, {
      method: 'POST',
      body: JSON.stringify({ decisions })
    });
  } catch (error) {
    console.error("Error submitting tag up:", error);
  }
}

async function initiateSteal(gameId, decisions) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      await apiClient(`/api/games/${gameId}/initiate-steal`, {
        method: 'POST',
        body: JSON.stringify({ decisions })
      });
    } catch (error) { console.error("Error initiating steal:", error); }
  }


async function resolveSteal(gameId, throwToBase) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      await apiClient(`/api/games/${gameId}/resolve-steal`, {
        method: 'POST',
        body: JSON.stringify({ throwToBase })
      });
      await fetchGame(gameId);
    } catch (error) { console.error("Error resolving steal:", error); }
  }

async function submitInfieldInDecision(gameId, sendRunner) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/resolve-infield-in-gb`, {
      method: 'POST',
      body: JSON.stringify({ sendRunner })
    });
  } catch (error) {
    console.error("Error submitting infield in decision:", error);
  }
}

async function resetRolls(gameId) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await apiClient(`/api/games/${gameId}/reset-rolls`, {
      method: 'POST'
    });
  } catch (error) {
    console.error('Error resetting rolls:', error);
  }
}

  const isOutcomeHidden = ref(false);
  const isSwingResultVisible = ref(false);
  const isStealResultVisible = ref(false);
  const isDraftActive = ref(false);

  async function fetchSnapshots(gameId) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/dev/games/${gameId}/snapshots`);
      if (!response.ok) throw new Error('Failed to fetch snapshots');
      snapshots.value = await response.json();
    } catch (error) {
      console.error('Error fetching snapshots:', error);
    }
  }

  async function createSnapshot(gameId, snapshotName) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/dev/games/${gameId}/snapshots`, {
        method: 'POST',
        body: JSON.stringify({ snapshot_name: snapshotName })
      });
      if (!response.ok) throw new Error('Failed to create snapshot');
      await fetchSnapshots(gameId); // Refresh the list
    } catch (error) {
      console.error('Error creating snapshot:', error);
    }
  }

  async function restoreSnapshot(gameId, snapshotId) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/dev/games/${gameId}/snapshots/${snapshotId}/restore`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to restore snapshot');
      // Game state will be updated via websocket, but we can also fetch manually
      await fetchGame(gameId);
    } catch (error) {
      console.error('Error restoring snapshot:', error);
    }
  }

  async function deleteSnapshot(gameId, snapshotId) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await apiClient(`/api/dev/games/${gameId}/snapshots/${snapshotId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete snapshot');
      await fetchSnapshots(gameId); // Refresh the list
    } catch (error) {
      console.error('Error deleting snapshot:', error);
    }
  }

  function setOutcomeHidden(value) {
    isOutcomeHidden.value = value;
  }

  function setIsSwingResultVisible(value) {
    isSwingResultVisible.value = value;
    // Also persist this to localStorage to survive reloads
    const gameId = game.value?.game_id;
    if (gameId) {
        const rollStorageKey = `showdown-game-${gameId}-swing-result-seen`;
        if (value) {
            localStorage.setItem(rollStorageKey, JSON.stringify(true));
        } else {
            localStorage.removeItem(rollStorageKey);
        }
    }
  }

  function setIsStealResultVisible(value) {
    isStealResultVisible.value = value;
  }

  const gameEventsToDisplay = computed(() => {
    if (!gameEvents.value) return [];

    if (gameState.value?.isStealResultHiddenForDefense && amIDefensivePlayer.value) {
      let nonStealEventIndex = -1;
      for (let i = gameEvents.value.length - 1; i >= 0; i--) {
        if (gameEvents.value[i].event_type !== 'steal') {
          nonStealEventIndex = i;
          break;
        }
      }
      return gameEvents.value.slice(0, nonStealEventIndex + 1);
    }

    // Use the more robust computed property.
    const isEffectivelyBetween = isEffectivelyBetweenHalfInnings.value;

    // --- FIX FOR TAG UP SPOILERS ---
    const isDisplayDefensive = displayGameState.value && myTeam.value ?
        ((displayGameState.value.isTopInning && myTeam.value === 'home') ||
         (!displayGameState.value.isTopInning && myTeam.value === 'away')) :
        amIDefensivePlayer.value;

    if (isDisplayDefensive && gameState.value?.currentPlay?.type === 'TAG_UP' && !amIReadyForNext.value && opponentReadyForNext.value) {
        const filteredEvents = [];
        for (const event of gameEvents.value) {
            if (event.log_message.includes('tags up') || event.log_message.includes('Steal attempt') || event.log_message.includes('inning-change-message')) {
                break;
            }
            filteredEvents.push(event);
        }
        return filteredEvents;
    }


    // Condition 1: The outcome is actively being hidden from the user (pre-reveal).
    if (isOutcomeHidden.value && !isStealResultVisible.value) {

      const currentPlayType = gameState.value?.currentPlay?.type;
      if (['ADVANCE', 'TAG_UP', 'INFIELD_IN_CHOICE'].includes(currentPlayType)) {
        return gameEvents.value;
      }

      if (isEffectivelyBetween) {
        return gameEvents.value.slice(0, gameEvents.value.length - 2);
      }

      const lastEvent = gameEvents.value[gameEvents.value.length - 1];
      if (lastEvent && lastEvent.event_type === 'substitution') {
        return gameEvents.value.slice(0, gameEvents.value.length - 2);
      }

      return gameEvents.value.slice(0, gameEvents.value.length - 1);
    }

    // Condition 2: The outcome has been revealed, but the current user hasn't clicked "Next Hitter" yet.
    if (isEffectivelyBetween && !amIReadyForNext.value) {
        const lastEvent = gameEvents.value[gameEvents.value.length - 1];
        if (lastEvent && lastEvent.event_type === 'system') {
            return gameEvents.value.slice(0, gameEvents.value.length - 1);
        }
    }

    // Condition 3: Consecutive "Automatic" events
    if (!amIReadyForNext.value && opponentReadyForNext.value && gameEvents.value.length >= 2) {
        const lastEvent = gameEvents.value[gameEvents.value.length - 1];
        const prevEvent = gameEvents.value[gameEvents.value.length - 2];
        if (lastEvent.log_message?.includes('intentionally walked') && prevEvent.log_message?.includes('intentionally walked')) {
            return gameEvents.value.slice(0, gameEvents.value.length - 1);
        }
    }

    return gameEvents.value;
  });


  function updateGameData(data) {
    console.log('📥 STORE: Received game data from socket.');
    if (data.game) game.value = data.game;
    if (data.nextGameId) nextGameId.value = data.nextGameId;
    if (data.series) series.value = data.series;
    if (data.gameState) gameState.value = data.gameState.state_data;
    if (data.gameEvents) gameEvents.value = data.gameEvents;
    if (data.batter !== undefined) batter.value = data.batter;
    if (data.pitcher !== undefined) pitcher.value = data.pitcher;
    if (data.lineups) lineups.value = data.lineups;
    if (data.rosters) rosters.value = data.rosters;
    if (data.teams) teams.value = data.teams;
  }

  function resetGameState() {
    game.value = null;
    series.value = null;
    gameState.value = null;
    nextGameId.value = null;
    gameEvents.value = [];
    batter.value = null;
    pitcher.value = null;
    lineups.value = { home: null, away: null };
    rosters.value = { home: [], away: [] };
    teams.value = { home: null, away: null };
    setupState.value = null;
    isOutcomeHidden.value = false;
    isSwingResultVisible.value = false;
    isStealResultVisible.value = false;
  }

  const myTeam = computed(() => {
    const auth = useAuthStore();
    if (!auth.user || !game.value) return null;
    return Number(auth.user.userId) === Number(game.value.home_team_user_id) ? 'home' : 'away';
  });

  const pitcherTeam = computed(() => {
    if (!gameState.value) return null;
    return gameState.value.isTopInning ? 'home' : 'away';
  });

  const amIDefensivePlayer = computed(() => {
    if (!myTeam.value || !gameState.value) return false;
    const isTop = gameState.value.isTopInning;
    return (isTop && myTeam.value === 'home') || (!isTop && myTeam.value === 'away');
  });

  const opponentReadyForNext = computed(() => {
    if (!gameState.value || !myTeam.value) return false;
    if (myTeam.value === 'home') {
        return gameState.value.awayPlayerReadyForNext;
    } else {
        return gameState.value.homePlayerReadyForNext;
    }
  });

  const amIReadyForNext = computed(() => {
    if (!gameState.value || !myTeam.value) return false;
    if (myTeam.value === 'home') {
        return gameState.value.homePlayerReadyForNext;
    } else {
        return gameState.value.awayPlayerReadyForNext;
    }
  });

  const isBetweenHalfInnings = computed(() => {
    if (!gameState.value) return false;
    return gameState.value.isBetweenHalfInningsAway || gameState.value.isBetweenHalfInningsHome;
  });

  const isEffectivelyBetweenHalfInnings = computed(() => {
    if (!gameState.value) return false;

    const hasBetweenInningsFlags = gameState.value.isBetweenHalfInningsAway || gameState.value.isBetweenHalfInningsHome;

    const outsHaveReset = opponentReadyForNext.value &&
                          gameState.value.currentAtBat &&
                          gameState.value.lastCompletedAtBat &&
                          gameState.value.currentAtBat.outsBeforePlay < gameState.value.lastCompletedAtBat.outsBeforePlay;

    if (gameState.value.pendingStealAttempt) {
      return false;
    }

    if (!amIReadyForNext.value && opponentReadyForNext.value && gameState.value.lastStealResult && !isStealResultVisible.value) {
        return false;
    }

    return hasBetweenInningsFlags || outsHaveReset;
  });

  const displayOuts = computed(() => {
    if (!gameState.value) return 0;

    if (isOutcomeHidden.value) {
        if (opponentReadyForNext.value) {
            if (gameState.value.lastCompletedAtBat) {
                return gameState.value.lastCompletedAtBat.outsBeforePlay;
            }
        } else {
            if (gameState.value.currentAtBat) {
                return gameState.value.currentAtBat.outsBeforePlay;
            }
        }
        return 0; // Fallback
    }

    if (isEffectivelyBetweenHalfInnings.value) {
        return 3;
    }

    if (isStealResultVisible.value && gameState.value.currentPlay?.type === 'STEAL_ATTEMPT' && gameState.value.currentPlay.payload.results) {
      const { decisions, results } = gameState.value.currentPlay.payload;
      let newOuts = gameState.value.outs;
      for (const fromBaseStr in decisions) {
        if (decisions[fromBaseStr]) {
            const fromBase = parseInt(fromBaseStr, 10);
            const result = results[fromBase];
            if (result && result.outcome === 'OUT') {
                newOuts++;
            }
        }
      }
      return newOuts;
    }

    return gameState.value.outs;
  });

  const displayGameState = computed(() => {
    const auth = useAuthStore();

    if (game.value?.status === 'completed') {
      return gameState.value;
    }
    if (!gameState.value) {
      // Return a default, safe object to prevent crashes.
      return {
        inning: 1, isTopInning: true, outs: 0, homeScore: 0, awayScore: 0, bases: {},
        isBetweenHalfInningsAway: false, isBetweenHalfInningsHome: false
      };
    }

    if (isStealResultVisible.value && gameState.value.currentPlay?.type === 'STEAL_ATTEMPT' && gameState.value.currentPlay.payload.results) {
      const { decisions, results } = gameState.value.currentPlay.payload;
      const newBases = { ...gameState.value.bases };
      let newOuts = gameState.value.outs;
      const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

      for (const fromBaseStr in decisions) {
        if (decisions[fromBaseStr]) {
          const fromBase = parseInt(fromBaseStr, 10);
          const toBase = fromBase + 1;
          const runner = gameState.value.bases[baseMap[fromBase]];
          const result = results[fromBase];

          if (runner && result) {
            newBases[baseMap[fromBase]] = null; // Runner leaves the base
            if (result.outcome === 'SAFE') {
              if (toBase <= 3) {
                newBases[baseMap[toBase]] = runner;
              }
            } else { // OUT
              newOuts++;
            }
          }
        }
      }

      return {
        ...gameState.value,
        bases: newBases,
        outs: newOuts,
      };
    }

    const isConsecutiveSteal = gameState.value.lastStealResult && gameState.value.pendingStealAttempt;

    if (isConsecutiveSteal && amIDefensivePlayer.value) {
         const pending = gameState.value.pendingStealAttempt;
         const toBase = pending.throwToBase;
         const fromBase = toBase - 1;
         const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

         const newBases = { ...gameState.value.bases };

         if (toBase <= 3) {
            newBases[baseMap[toBase]] = null;
         }

         if (fromBase >= 1 && pending.runner) {
            newBases[baseMap[fromBase]] = pending.runner;
         }

         let outs = gameState.value.outs;
         if (pending.outcome === 'OUT') {
             outs = outs - 1;
         }

         return {
             ...gameState.value,
             bases: newBases,
             outs: outs
         };
    }

    if (!amIReadyForNext.value && opponentReadyForNext.value && gameEvents.value.length >= 2 && gameState.value.lastCompletedAtBat) {
        const lastEvent = gameEvents.value[gameEvents.value.length - 1];
        const prevEvent = gameEvents.value[gameEvents.value.length - 2];
        if (lastEvent.log_message?.includes('intentionally walked') && prevEvent.log_message?.includes('intentionally walked')) {
            const rollbackSource = gameState.value.lastCompletedAtBat;
            return {
                ...gameState.value,
                bases: rollbackSource.basesBeforePlay,
                outs: rollbackSource.outsBeforePlay,
                homeScore: rollbackSource.homeScoreBeforePlay,
                awayScore: rollbackSource.awayScoreBeforePlay,
            };
        }
    }

    if (isOutcomeHidden.value) {
        const rollbackSource = opponentReadyForNext.value ? gameState.value.lastCompletedAtBat : gameState.value.currentAtBat;
        if (rollbackSource && rollbackSource.basesBeforePlay) {
            let inning = gameState.value.inning;
            let isTopInning = gameState.value.isTopInning;
            const displayOutsValue = rollbackSource.outsBeforePlay;

            if (gameState.value.outs === 0 && displayOutsValue !== 0) {
                if (gameState.value.isTopInning) {
                    inning = Math.max(1, gameState.value.inning - 1);
                    isTopInning = false;
                } else {
                    isTopInning = true;
                }
            }

            return {
                ...gameState.value,
                bases: rollbackSource.basesBeforePlay,
                outs: displayOutsValue,
                homeScore: rollbackSource.homeScoreBeforePlay,
                awayScore: rollbackSource.awayScoreBeforePlay,
                inning,
                isTopInning,
                isBetweenHalfInningsAway: false,
                isBetweenHalfInningsHome: false,
            };
        }
        return calculateDisplayGameState(gameState.value, auth.user?.userId, !isOutcomeHidden.value);
    }

    const shouldShowThreeOuts = isEffectivelyBetweenHalfInnings.value;

    let bases = gameState.value.bases;
    let outs = gameState.value.outs;
    let homeScore = gameState.value.homeScore;
    let awayScore = gameState.value.awayScore;

    if (shouldShowThreeOuts) {
        bases = opponentReadyForNext.value ? gameState.value.lastCompletedAtBat.basesBeforePlay : gameState.value.currentAtBat.basesBeforePlay;
        outs = 3;
    } else if (!amIReadyForNext.value && opponentReadyForNext.value) {
        if (gameState.value.pendingStealAttempt || gameState.value.throwRollResult) {
             const src = gameState.value.lastCompletedAtBat;
             if (src) {
                 bases = src.basesBeforePlay || bases;
                 if (src.outsBeforePlay !== undefined) outs = src.outsBeforePlay;
                 if (src.homeScoreBeforePlay !== undefined) homeScore = src.homeScoreBeforePlay;
                 if (src.awayScoreBeforePlay !== undefined) awayScore = src.awayScoreBeforePlay;
             }
        } else {
            const src = gameState.value.currentAtBat;
            if (src) {
                bases = src.basesBeforePlay || bases;
                if (src.outsBeforePlay !== undefined) outs = src.outsBeforePlay;
                if (src.homeScoreBeforePlay !== undefined) homeScore = src.homeScoreBeforePlay;
                if (src.awayScoreBeforePlay !== undefined) awayScore = src.awayScoreBeforePlay;
            }
        }

        if (gameState.value.lastStealResult && !isStealResultVisible.value) {
            if (gameState.value.outs === 0) {
                 if (gameState.value.isTopInning) {
                    return {
                        ...gameState.value,
                        outs: outs,
                        bases: bases,
                        homeScore: homeScore,
                        awayScore: awayScore,
                        inning: Math.max(1, gameState.value.inning - 1),
                        isTopInning: false
                    }
                } else {
                    return {
                        ...gameState.value,
                        outs: outs,
                        bases: bases,
                        homeScore: homeScore,
                        awayScore: awayScore,
                        isTopInning: true
                    }
                }
            }
        }
    }

    let inning = gameState.value.inning;
    let isTopInning = gameState.value.isTopInning;

    if (isEffectivelyBetweenHalfInnings.value && gameState.value.awaiting_lineup_change) {
      if (gameState.value.isTopInning) {
        inning = gameState.value.inning - 1;
        isTopInning = false;
      } else {
        isTopInning = true;
      }
    }

    return {
      ...gameState.value,
      outs,
      bases,
      homeScore,
      awayScore,
      inning,
      isTopInning,
    };
  });


  return {
    game,
    series,
    gameState,
    gameEvents,
    batter,
    pitcher,
    lineups,
    rosters,
    teams,
    setupState,
    nextLineupIsSet,
    nextGameId,
    playerSelectedForSwap,
    isOutcomeHidden,
    isSwingResultVisible,
    isStealResultVisible,
    isDraftActive,
    gameEventsToDisplay,
    myTeam,
    pitcherTeam,
    amIDefensivePlayer,
    opponentReadyForNext,
    amIReadyForNext,
    isBetweenHalfInnings,
    isEffectivelyBetweenHalfInnings,
    displayOuts,
    displayGameState,
    snapshots,
    // Actions
    fetchGame,
    submitBaserunningDecisions,
    submitPitch,
    submitSwing,
    submitAction,
    submitSubstitution,
    resolveDoublePlay,
    nextHitter,
    declareHomeTeam,
    advanceRunners,
    submitTagUp,
    initiateSteal,
    resolveSteal,
    submitInfieldInDecision,
    resetRolls,
    setOutcomeHidden,
    setIsSwingResultVisible,
    setIsStealResultVisible,
    updateGameData,
    resetGameState,
    fetchGameSetup,
    submitGameSetup,
    checkLineupForNextGame,
    submitRoll,
    swapPlayerPositions,
    fetchSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    setGameState,
    loadScenario,
    resolveDefensiveThrow,
    setDefense,
  };
}, {
  // Persist specific state across reloads if needed
  persist: false,
});
