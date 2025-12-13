import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from './auth';
import { calculateDisplayGameState } from '../utils/gameState';

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

  // Optimistic Update: Immediately update the local state to reflect the action.
  if (gameState.value && gameState.value.currentAtBat) {
      const optimisticAction = action || 'pitch';
      gameState.value.currentAtBat.pitcherAction = optimisticAction;

      // If batter has already acted, then defensive player is going second.
      if (gameState.value.currentAtBat.batterAction) {
          gameState.value.defensivePlayerWentSecond = true;
      }

      // For intentional walks, the batter automatically 'takes'.
      if (optimisticAction === 'intentional_walk') {
          gameState.value.currentAtBat.batterAction = 'take';
      }
  }

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
  // Optimistic Update: Immediately update the local state.
  if (gameState.value && gameState.value.currentAtBat) {
      gameState.value.currentAtBat.batterAction = action;
  }

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
  // Optimistic Update: Immediately mark myself as ready.
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
    // Calculate "Display Defensive Player" dynamically because server state (amIDefensivePlayer)
    // might be flipped if the game has already advanced to the next half-inning.
    const isDisplayDefensive = displayGameState.value && myTeam.value ?
        ((displayGameState.value.isTopInning && myTeam.value === 'home') ||
         (!displayGameState.value.isTopInning && myTeam.value === 'away')) :
        amIDefensivePlayer.value;

    // If the defensive player is facing a Tag Up decision, and they are NOT ready for the next play
    // (indicating they haven't seen the result yet), we must hide any events that occurred AFTER the Tag Up.
    // This prevents the game log from showing "SAFE at 2nd" or a subsequent Steal result while the user
    // is still deciding on the throw.
    if (isDisplayDefensive && gameState.value?.currentPlay?.type === 'TAG_UP' && !amIReadyForNext.value && opponentReadyForNext.value) {
        // Stop including events if we hit a baserunning result or inning change
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

      // Exception: If the play is waiting for a baserunning decision, the log message
      // for the hit has not been generated yet. The "last event" currently in the log
      // is actually the PREVIOUS play's outcome, so we must NOT hide it.
      const currentPlayType = gameState.value?.currentPlay?.type;
      if (['ADVANCE', 'TAG_UP', 'INFIELD_IN_CHOICE'].includes(currentPlayType)) {
        return gameEvents.value;
      }

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

    // Condition 3: Consecutive "Automatic" events (like Intentional Walks) where the user hasn't acknowledged the first.
    // If the opponent walked twice in a row, we want to show the result of the FIRST walk, hiding the second one.
    if (!amIReadyForNext.value && opponentReadyForNext.value && gameEvents.value.length >= 2) {
        const lastEvent = gameEvents.value[gameEvents.value.length - 1];
        const prevEvent = gameEvents.value[gameEvents.value.length - 2];
        if (lastEvent.log_message?.includes('intentionally walked') && prevEvent.log_message?.includes('intentionally walked')) {
            return gameEvents.value.slice(0, gameEvents.value.length - 1);
        }
    }

    // In all other cases (e.g., mid-inning play revealed, or after "Next Hitter" is clicked), show the full log.
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

    // Fix for Third-Out Steal Sync: If a steal is still pending (meaning we need to roll for it,
    // or see the result), do NOT consider it "between innings" yet, even if the outs have reset.
    // This allows the "Stealing..." UI to persist instead of jumping to the "3 Outs" display.
    if (gameState.value.pendingStealAttempt) {
      return false;
    }

    // --- FIX FOR SKIPPED STEAL ---
    // If the opponent has advanced the inning, but we are still waiting to resolve (or see) a steal
    // that happened (e.g., resulted in the 3rd out), we are NOT between innings yet.
    // We check this by seeing if the 'lastStealResult' is recent and hasn't been 'cleared' by our readiness.
    // If we are NOT ready, and the opponent IS ready, and there was a steal...
    if (!amIReadyForNext.value && opponentReadyForNext.value && gameState.value.lastStealResult && !isStealResultVisible.value) {
        return false;
    }

    return hasBetweenInningsFlags || outsHaveReset;
  });

  const displayOuts = computed(() => {
    if (!gameState.value) return 0;

    if (isOutcomeHidden.value) {
        // Case 1: Outcome is hidden.
        // Logic restored based on user feedback: Explicitly show state from before the current action.
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

    // Case 2: Outcome revealed, but we are showing the "End of Inning" state (3 outs).
    if (isEffectivelyBetweenHalfInnings.value) {
        return 3;
    }

    // Case 3: Normal gameplay
    // Also handle duplicate logic for calculating steal outs if steal result is visible,
    // matching displayGameState logic.
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

    // Condition: Consecutive Steals (Defense View)
    // If there is a pending steal attempt AND a last steal result, and we are the defense,
    // we are viewing the result of the *last* steal (2nd), but the bases have already updated
    // for the *pending* steal (3rd). We must visually roll back the runner.
    const isConsecutiveSteal = gameState.value.lastStealResult && gameState.value.pendingStealAttempt;

    if (isConsecutiveSteal && amIDefensivePlayer.value) {
         // Get the runner from the pending attempt (which is the one causing the future state)
         const pending = gameState.value.pendingStealAttempt;
         const toBase = pending.throwToBase;
         const fromBase = toBase - 1;
         const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

         const newBases = { ...gameState.value.bases };

         // Remove from toBase (if there, meaning they were SAFE in the pending steal)
         if (toBase <= 3) {
            newBases[baseMap[toBase]] = null;
         }

         // Add to fromBase (restoring their position before the pending steal)
         if (fromBase >= 1 && pending.runner) {
            newBases[baseMap[fromBase]] = pending.runner;
         }

         let outs = gameState.value.outs;
         // If the pending steal resulted in an out, the global out count is already incremented.
         // We need to roll it back to show the state before that attempt.
         if (pending.outcome === 'OUT') {
             outs = outs - 1;
         }

         return {
             ...gameState.value,
             bases: newBases,
             outs: outs
         };
    }

    // Condition: Consecutive "Automatic" events (Double IBB fix).
    // If we detected this pattern in gameEventsToDisplay, we must also roll back the board state.
    if (!amIReadyForNext.value && opponentReadyForNext.value && gameEvents.value.length >= 2 && gameState.value.lastCompletedAtBat) {
        const lastEvent = gameEvents.value[gameEvents.value.length - 1];
        const prevEvent = gameEvents.value[gameEvents.value.length - 2];
        if (lastEvent.log_message?.includes('intentionally walked') && prevEvent.log_message?.includes('intentionally walked')) {
            // Roll back to the state BEFORE the second walk (which is the state AFTER the first walk).
            // The last completed at-bat is the 2nd walk (Event N). Its 'basesBeforePlay'
            // represents the state of the bases when that batter stepped up (i.e., after the 1st walk).
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
        // Restored explicit rollback logic.
        const rollbackSource = opponentReadyForNext.value ? gameState.value.lastCompletedAtBat : gameState.value.currentAtBat;
        if (rollbackSource && rollbackSource.basesBeforePlay) {
            // We also need to check if the inning needs to be rolled back (if the outs crossed a boundary).
            let inning = gameState.value.inning;
            let isTopInning = gameState.value.isTopInning;
            const displayOutsValue = rollbackSource.outsBeforePlay; // Using direct source value

            if (gameState.value.outs === 0 && displayOutsValue !== 0) {
                // We advanced to a new half-inning. Roll back to previous.
                if (gameState.value.isTopInning) {
                    // Currently Top X. Previous was Bottom X-1.
                    inning = Math.max(1, gameState.value.inning - 1);
                    isTopInning = false;
                } else {
                    // Currently Bottom X. Previous was Top X.
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
        // Fallback to helper if source is missing, though this shouldn't happen.
        return calculateDisplayGameState(gameState.value, auth.user?.userId, !isOutcomeHidden.value);
    }

    // When the outcome is revealed but we are still showing 3 outs, we need to
    // override the current (empty) bases with the bases from before the play.
    // Use isEffectivelyBetweenHalfInnings.value directly instead of displayOuts.value
    const shouldShowThreeOuts = isEffectivelyBetweenHalfInnings.value;

    let bases = gameState.value.bases;
    let outs = gameState.value.outs;
    let homeScore = gameState.value.homeScore;
    let awayScore = gameState.value.awayScore;

    if (shouldShowThreeOuts) {
        bases = opponentReadyForNext.value ? gameState.value.lastCompletedAtBat.basesBeforePlay : gameState.value.currentAtBat.basesBeforePlay;
        outs = 3;
    } else if (!amIReadyForNext.value && opponentReadyForNext.value) {
        // Case: The opponent has advanced to the next at-bat (or triggered an IBB), but I am still viewing the previous result.

        // SPECIAL CASE: If a steal is pending OR if we are viewing a throw result (like a Tag Up) that hasn't been cleared,
        // we are viewing a past action. The 'currentAtBat' is the NEW one (next batter), so we must use 'lastCompletedAtBat'
        // to get the state BEFORE the result was applied to avoid spoilers.
        if (gameState.value.pendingStealAttempt || gameState.value.throwRollResult) {
             const src = gameState.value.lastCompletedAtBat;
             if (src) {
                 bases = src.basesBeforePlay || bases;
                 // Show the outs *before* the steal (e.g. 2 outs)
                 if (src.outsBeforePlay !== undefined) outs = src.outsBeforePlay;
                 if (src.homeScoreBeforePlay !== undefined) homeScore = src.homeScoreBeforePlay;
                 if (src.awayScoreBeforePlay !== undefined) awayScore = src.awayScoreBeforePlay;
             }
        } else {
            // Normal Case: The 'currentAtBat' on the server represents the *next* play.
            // Its 'basesBeforePlay' represents the state *after* the play I am supposed to be viewing.
            const src = gameState.value.currentAtBat;
            if (src) {
                bases = src.basesBeforePlay || bases;
                // Only override outs and score if they are available on the source object.
                if (src.outsBeforePlay !== undefined) outs = src.outsBeforePlay;
                if (src.homeScoreBeforePlay !== undefined) homeScore = src.homeScoreBeforePlay;
                if (src.awayScoreBeforePlay !== undefined) awayScore = src.awayScoreBeforePlay;
            }
        }

        // --- FIX FOR SKIPPED STEAL ---
        // If we are lagging and the opponent has advanced the inning (meaning currentAtBat is the new inning),
        // but we are still viewing the last Steal result, we need to ensure the inning/isTopInning
        // are rolled back so we aren't showing the new inning's context.
        if (gameState.value.lastStealResult && !isStealResultVisible.value) {
            // Determine if the *last* inning ended on this steal.
            // If the server's outs are 0, it means the inning ended.
            // We should display the *end* of the *previous* inning.

            // We need to check if the outs *were* 0 in the new state (meaning new inning started).
            if (gameState.value.outs === 0) {
                 if (gameState.value.isTopInning) {
                    // Server: Top X. We want Bottom X-1.
                    return {
                        ...gameState.value,
                        outs: outs, // Use rolled back outs (should be 2 or 3 from loop above)
                        bases: bases,
                        homeScore: homeScore,
                        awayScore: awayScore,
                        inning: Math.max(1, gameState.value.inning - 1),
                        isTopInning: false
                    }
                } else {
                    // Server: Bottom X. We want Top X.
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