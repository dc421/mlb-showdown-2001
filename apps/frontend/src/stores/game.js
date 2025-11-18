import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from './auth';

const teams = ref({ home: null, away: null });

export const useGameStore = defineStore('game', () => {
  const game = ref(null);
  const series = ref(null);
  const gameState = ref(null);
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
    const response = await fetch(`${auth.API_URL}/api/games/${gameId}/swap-positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
      body: JSON.stringify({ playerAId, playerBId })
    });
    if (!response.ok) throw new Error('Failed to swap player positions');

    // Manually fetch and apply the updated state to win the race against the websocket.
    const updatedGameData = await fetch(`${auth.API_URL}/api/games/${gameId}`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
    });
    if (!updatedGameData.ok) throw new Error('Failed to fetch updated game data after swap');
    updateGameData(await updatedGameData.json());

  } catch (error) {
    console.error('Error swapping player positions:', error);
    alert(`Error: ${error.message}`);
  }
}

// in src/stores/game.js
// in src/stores/game.js
async function fetchGame(gameId) {
  const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await fetch(`${auth.API_URL}/api/games/${gameId}`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch game data');
      
      // The data from the server is now pre-processed and ready to use.
      const data = await response.json();
// ADD THIS LOG
      // --- ADD THIS CRITICAL LOG ---
      console.log(`📥 STORE: Received raw data from server for game ${gameId}. Are events here?`, data.gameEvents);
      
      
      game.value = data.game;
      
      series.value = data.series;
      gameState.value = data.gameState ? data.gameState.state_data : null;
      gameEvents.value = data.gameEvents;
      
      batter.value = data.batter;
      pitcher.value = data.pitcher;
      lineups.value = data.lineups;
      rosters.value = data.rosters;
      teams.value = data.teams;
  console.log(`--- 4. fetchGame FINISHED. Store is updated. ---`);
    } catch (error) {
      console.error(error);
    }
}

  // in src/stores/game.js
async function submitBaserunningDecisions(gameId, decisions) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/submit-decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
      body: JSON.stringify({ decisions })
    });
  } catch (error) { console.error("Error submitting decisions:", error); }
}
// Also, make sure `submitBaserunningDecisions` is in your return object at the end of the file.

async function setGameState(gameId, partialState) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/dev/games/${gameId}/set-state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify(partialState)
    });
    // The game-updated event will refresh the UI automatically
  } catch (error) {
    console.error("Error setting game state:", error);
  }
}

async function loadScenario(gameId, scenario) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/dev/games/${gameId}/load-scenario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify({ scenario })
    });
    // The game-updated event will refresh the UI automatically, but we can fetch
    // for immediate feedback.
    await fetchGame(gameId);
  } catch (error) {
    console.error("Error loading scenario:", error);
  }
}

async function resolveDefensiveThrow(gameId, throwTo) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    const response = await fetch(`${auth.API_URL}/api/games/${gameId}/resolve-throw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
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
    await fetch(`${auth.API_URL}/api/games/${gameId}/set-defense`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
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
      const response = await fetch(`${auth.API_URL}/api/games/${gameId}/setup`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
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
      const response = await fetch(`${auth.API_URL}/api/games/${gameId}/my-lineup`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
      if (!response.ok) throw new Error('Failed to check lineup status');
      const data = await response.json();
      nextLineupIsSet.value = data.hasLineup;
    } catch (error) {
      console.error(error);
      // Assume lineup is not set if the check fails
      nextLineupIsSet.value = false;
    }
  }

  async function submitRoll(gameId) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
        await fetch(`${auth.API_URL}/api/games/${gameId}/roll`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${auth.token}` }
        });
    } catch (error) {
        console.error('Error submitting roll:', error);
    }
  }

  async function submitGameSetup(gameId, setupData) {
    console.log('2. Game Store: submitGameSetup action was called.');
      console.log(' -> Data being sent:', setupData); // <-- ADD THIS LOG
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await fetch(`${auth.API_URL}/api/games/${gameId}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
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
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/pitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
      body: JSON.stringify({ action: action })
    });
    await fetchGame(gameId);
  } catch (error) { console.error('Error submitting pitch:', error); }
}

// in src/stores/game.js
async function submitAction(gameId, action) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/set-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
      body: JSON.stringify({ action })
    });
    await fetchGame(gameId);
  } catch (error) { console.error("Error setting offensive action:", error); }
}

async function submitSwing(gameId, action = null) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/swing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
      body: JSON.stringify({ action: action })
    });
  } catch (error) { console.error('Error submitting swing:', error); }
}
  
  async function submitSubstitution(gameId, substitutionData) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await fetch(`${auth.API_URL}/api/games/${gameId}/substitute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
        body: JSON.stringify(substitutionData)
      });
      if (!response.ok) throw new Error('Failed to make substitution');

      // Manually fetch and apply the updated state to win the race against the websocket.
      const updatedGameData = await fetch(`${auth.API_URL}/api/games/${gameId}`, {
          headers: { 'Authorization': `Bearer ${auth.token}` }
      });
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
    await fetch(`${auth.API_URL}/api/games/${gameId}/resolve-double-play`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${auth.token}` }
    });
  } catch (error) { console.error("Error resolving double play:", error); }
}

  async function nextHitter(gameId) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/next-hitter`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${auth.token}` }
    });
  } catch (error) { console.error("Error advancing to next hitter:", error); }
}

// in src/stores/game.js

async function declareHomeTeam(gameId, homeTeamUserId) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    // This sends the choice to your new backend endpoint
    await fetch(`${auth.API_URL}/api/games/${gameId}/declare-home`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
      body: JSON.stringify({ homeTeamUserId })
    });
    // The websocket event will handle the UI update for the other player
  } catch (error) {
    console.error("Error declaring home team:", error);
  }
}


  async function advanceRunners(gameId, decisions) {
  console.log('2. advanceRunners action called in the store.');
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/advance-runners`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify({ decisions })
    });
    // The websocket event will handle the state update
  } catch (error) {
    console.error("Error advancing runners:", error);
  }
}

  async function submitTagUp(gameId, decisions) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/tag-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
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
      await fetch(`${auth.API_URL}/api/games/${gameId}/initiate-steal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
        body: JSON.stringify({ decisions })
      });
    } catch (error) { console.error("Error initiating steal:", error); }
  }


async function resolveSteal(gameId, throwToBase) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      await fetch(`${auth.API_URL}/api/games/${gameId}/resolve-steal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
        body: JSON.stringify({ throwToBase })
      });
      // The game-updated socket event should refresh the state, but we'll fetch manually to be safe.
      await fetchGame(gameId);
    } catch (error) { console.error("Error resolving steal:", error); }
  }

// in src/stores/game.js
async function submitInfieldInDecision(gameId, sendRunner) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/resolve-infield-in-gb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
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
    await fetch(`${auth.API_URL}/api/games/${gameId}/reset-rolls`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${auth.token}` }
    });
  } catch (error) {
    console.error('Error resetting rolls:', error);
  }
}

  const isOutcomeHidden = ref(false);
  const isSwingResultVisible = ref(false);
  const isStealResultVisible = ref(false);

  async function fetchSnapshots(gameId) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      const response = await fetch(`${auth.API_URL}/api/dev/games/${gameId}/snapshots`, {
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
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
      const response = await fetch(`${auth.API_URL}/api/dev/games/${gameId}/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
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
      const response = await fetch(`${auth.API_URL}/api/dev/games/${gameId}/snapshots/${snapshotId}/restore`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${auth.token}` }
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
      const response = await fetch(`${auth.API_URL}/api/dev/games/${gameId}/snapshots/${snapshotId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${auth.token}` }
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
    const gameId = game.value?.id;
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

    // Condition 1: The outcome is actively being hidden from the user (pre-reveal).
    if (isOutcomeHidden.value && !isStealResultVisible.value) {
      // If it's a third-out play, hide both the play result and the inning change message.
      if (isEffectivelyBetween) {
        return gameEvents.value.slice(0, gameEvents.value.length - 2);
      }

      // NEW LOGIC: Check if the last event is a substitution. If so, hide it AND the play outcome.
      const lastEvent = gameEvents.value[gameEvents.value.length - 1];
      if (lastEvent && lastEvent.event_type === 'substitution') {
        // This handles the case where a pinch hitter comes in, we need to hide their announcement AND the outcome.
        return gameEvents.value.slice(0, gameEvents.value.length - 2);
      }

      // Otherwise, it's a normal mid-inning play; just hide the last event.
      return gameEvents.value.slice(0, gameEvents.value.length - 1);
    }

    // Condition 2: The outcome has been revealed, but the current user hasn't clicked "Next Hitter" yet.
    // We need to continue hiding just the inning change message.
    if (isEffectivelyBetween && !amIReadyForNext.value) {
        // --- THIS IS THE FIX ---
        // Only hide the last event if it's the inning change system message.
        // Otherwise, in the 'awaiting pitcher' scenario, the last event is the
        // 3rd out, and we must show it.
        const lastEvent = gameEvents.value[gameEvents.value.length - 1];
        if (lastEvent && lastEvent.event_type === 'system') {
            return gameEvents.value.slice(0, gameEvents.value.length - 1);
        }
    }

    // In all other cases (e.g., mid-inning play revealed, or after "Next Hitter" is clicked), show the full log.
    return gameEvents.value;
  });


  function updateGameData(data) {
    console.log('📥 STORE: Received game data from socket.');
    if (data.game) game.value = data.game;
    if (data.series) series.value = data.series;
    if (data.gameState) gameState.value = data.gameState.state_data;
    if (data.gameEvents) gameEvents.value = data.gameEvents;
    if (data.batter) batter.value = data.batter;
    if (data.pitcher) pitcher.value = data.pitcher;
    if (data.lineups) lineups.value = data.lineups;
    if (data.rosters) rosters.value = data.rosters;
    if (data.teams) teams.value = data.teams;
  }

  function resetGameState() {
    game.value = null;
    series.value = null;
    gameState.value = null;
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

    return hasBetweenInningsFlags || outsHaveReset;
  });

  const displayOuts = computed(() => {
    if (!gameState.value) return 0;

    if (isOutcomeHidden.value) {
      // NEW LOGIC: When the outcome is hidden, we need to decide which "before" state to show.
      // If the opponent has already seen the result and clicked "Next Hitter",
      // we should show the state *before their action*, which is stored in lastCompletedAtBat.
      if (opponentReadyForNext.value) {
        if (gameState.value.lastCompletedAtBat) {
          return gameState.value.lastCompletedAtBat.outsBeforePlay;
        }
      } else {
        // Otherwise, we show the state before the current at-bat began.
        if (gameState.value.currentAtBat) {
          return gameState.value.currentAtBat.outsBeforePlay;
        }
      }
      return 0; // Fallback if neither at-bat object is available
    }

    // When the inning is over but the user hasn't clicked "Next Hitter" yet,
    // the server reports 0 outs for the *next* inning. We want to show 3
    // to represent the end of the *previous* inning.
    if ((isBetweenHalfInnings.value && isSwingResultVisible.value || isEffectivelyBetweenHalfInnings.value && opponentReadyForNext.value) && gameState.value.outs === 0) {
      return 3;
    }
    return gameState.value.outs;
  });

  const displayGameState = computed(() => {
    if (game.value?.status === 'completed') {
      return gameState.value;
    }
    if (!gameState.value) {
      // Return a default, safe object to prevent crashes.
      return {
        inning: 1, isTop: true, outs: 0, homeScore: 0, awayScore: 0, bases: {},
        isBetweenHalfInningsAway: false, isBetweenHalfInningsHome: false
      };
    }

    // If the steal result is visible, we calculate the outcome of the steal
    // on the frontend to show the result immediately, before the defensive
    // player has even made their throw.
    if (isStealResultVisible.value && gameState.value.currentPlay?.type === 'STEAL_ATTEMPT' && gameState.value.currentPlay.payload.results) {
      const { decisions, results } = gameState.value.currentPlay.payload;
      const newBases = { ...gameState.value.bases };
      let newOuts = gameState.value.outs;
      const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

      for (const fromBaseStr in decisions) {
        if (decisions[fromBaseStr]) {
          const fromBase = parseInt(fromBaseStr, 10);
          const toBase = fromBase + 1;
          // --- THIS IS THE FIX ---
          // Always read the runner's original position from the authoritative gameState
          // to prevent race conditions in multi-runner steals.
          const runner = gameState.value.bases[baseMap[fromBase]];
          const result = results[fromBase];

          if (runner && result) {
            newBases[baseMap[fromBase]] = null; // Runner leaves the base
            if (result.outcome === 'SAFE') {
              if (toBase <= 3) {
                newBases[baseMap[toBase]] = runner;
              }
              // Note: This logic doesn't handle stealing home, as it's not a feature.
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

    // `isOutcomeHidden` is the single source of truth. If it's true, we MUST show the "before" state.
    // The rollback is skipped if `isStealResultVisible` is true, which is handled by the block above.
    if (isOutcomeHidden.value && !isStealResultVisible.value) {
      const rollbackSource = opponentReadyForNext.value ? gameState.value.lastCompletedAtBat : gameState.value.currentAtBat;
      if (rollbackSource && rollbackSource.basesBeforePlay) {
        return {
          ...gameState.value,
          bases: rollbackSource.basesBeforePlay,
          outs: displayOuts.value, // This correctly shows the "before" outs
          homeScore: rollbackSource.homeScoreBeforePlay,
          awayScore: rollbackSource.awayScoreBeforePlay,
          isBetweenHalfInningsAway: false,
          isBetweenHalfInningsHome: false,
        };
      }
    }

    // When the outcome is revealed but we are still showing 3 outs, we need to
    // override the current (empty) bases with the bases from before the play.
    const bases = displayOuts.value === 3
      ? (opponentReadyForNext.value ? gameState.value.lastCompletedAtBat.basesBeforePlay : gameState.value.currentAtBat.basesBeforePlay)
      : gameState.value.bases;

    // --- THIS IS THE COMPREHENSIVE FIX ---
    // If the game is between innings and we're awaiting a pitcher selection,
    // the server state has already advanced to the *next* inning. We need to
    // roll back the inning and isTopInning values to match the display outs and bases.
    let inning = gameState.value.inning;
    let isTopInning = gameState.value.isTopInning;

    if (isEffectivelyBetweenHalfInnings.value && gameState.value.awaiting_lineup_change) {
      if (gameState.value.isTopInning) { // Server says Top 2, we want to show Bottom 1
        inning = gameState.value.inning - 1;
        isTopInning = false;
      } else { // Server says Bottom 1, we want to show Top 1
        isTopInning = true;
      }
    }

    // In all other cases, return the current, authoritative state from the server, but with our overrides.
    return {
      ...gameState.value,
      outs: displayOuts.value,
      bases: bases,
      inning,
      isTopInning,
    };
  });

  return { game, series, gameState, displayGameState, gameEvents, batter, pitcher, lineups, rosters, setupState, teams,
    fetchGame, declareHomeTeam,setGameState,loadScenario,initiateSteal,resolveSteal,submitPitch, submitSwing, fetchGameSetup, submitRoll, submitGameSetup,submitTagUp,
    isOutcomeHidden, setOutcomeHidden, gameEventsToDisplay, isBetweenHalfInnings, displayOuts,
    isSwingResultVisible, setIsSwingResultVisible,
    isStealResultVisible, setIsStealResultVisible,
    submitBaserunningDecisions,submitAction,nextHitter,resolveDefensiveThrow,submitSubstitution, advanceRunners,setDefense,submitInfieldInDecision,resetRolls,resolveDoublePlay,
    updateGameData,
    resetGameState,
    myTeam,
    opponentReadyForNext,
    amIReadyForNext,
    isEffectivelyBetweenHalfInnings,
    playerSelectedForSwap,
    swapPlayerPositions,
    amIDefensivePlayer,
    snapshots,
    fetchSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    checkLineupForNextGame,
    nextLineupIsSet,
  };
})