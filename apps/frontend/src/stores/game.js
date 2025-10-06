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
  const rosters = ref({ home: [], away: [] });
  const teams = ref({ home: null, away: null });
  const setupState = ref(null);

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

async function resolveDefensiveThrow(gameId, throwTo) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/resolve-throw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify({ throwTo })
    });
    // The websocket event will handle the state update
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
    } catch (error) {
      console.error('Error making substitution:', error);
      alert(`Error: ${error.message}`);
    }
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


async function resolveSteal(gameId, throwTo) {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      await fetch(`${auth.API_URL}/api/games/${gameId}/resolve-steal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
        body: JSON.stringify({ throwTo })
      });
    } catch (error) { console.error("Error resolving steal:", error); }
  }

// in src/stores/game.js
async function submitInfieldInDecision(gameId, sendRunner) {
  const auth = useAuthStore();
  if (!auth.token) return;
  try {
    await fetch(`${auth.API_URL}/api/games/${gameId}/infield-in-play`, {
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

// --- ADD THIS LINE ---
  const displayOuts = ref(0);
  const isOutcomeHidden = ref(false);
  // --- ADD THIS ACTION ---
  function setDisplayOuts(count) {
    displayOuts.value = count;
  }

  function setOutcomeHidden(value) {
    isOutcomeHidden.value = value;
  }

  const gameEventsToDisplay = computed(() => {
    if (!gameEvents.value) return [];

    // The only time we truncate the log is when the outcome of a play is actively being hidden.
    if (isOutcomeHidden.value) {
      // If the REAL state is between innings, it means the last play was the third out.
      // The server sends two events: the play and the inning change message.
      // We need to hide both to avoid spoiling the outcome.
      if (gameState.value?.isBetweenHalfInningsAway || gameState.value?.isBetweenHalfInningsHome) {
        return gameEvents.value.slice(0, gameEvents.value.length - 2);
      }
      // Otherwise, it's a normal mid-inning play, just hide the last event.
      return gameEvents.value.slice(0, gameEvents.value.length - 1);
    }

    // If the outcome is not hidden, always show the full log.
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
    displayOuts.value = 0;
    isOutcomeHidden.value = false;
  }

  const myTeam = computed(() => {
    const auth = useAuthStore();
    if (!auth.user || !game.value) return null;
    return Number(auth.user.userId) === Number(game.value.home_team_user_id) ? 'home' : 'away';
  });

  const opponentReadyForNext = computed(() => {
    if (!gameState.value || !myTeam.value) return false;
    if (myTeam.value === 'home') {
        return gameState.value.awayPlayerReadyForNext;
    } else {
        return gameState.value.homePlayerReadyForNext;
    }
  });

  const isBetweenHalfInnings = computed(() => {
    if (!displayGameState.value) return false;
    return displayGameState.value.isBetweenHalfInningsAway || displayGameState.value.isBetweenHalfInningsHome;
  });

  const shouldHideEndOfInningOutcome = computed(() => {
    const auth = useAuthStore();
    const isBetweenInnings = gameState.value?.isBetweenHalfInningsAway || gameState.value?.isBetweenHalfInningsHome;
    if (!isBetweenInnings) return false;

    // Defensive check: ensure all required data is loaded.
    if (!gameState.value?.lastCompletedAtBat || !game.value || !auth.user) {
      return false;
    }

    const lastBatterTeamId = gameState.value.lastCompletedAtBat.batterTeamId;

    // Determine the user's team ID directly from the game object to avoid race conditions.
    let myTeamId = null;
    if (game.value.home_team_user_id === auth.user.id) {
      myTeamId = game.value.home_team_id;
    } else if (game.value.away_team_user_id === auth.user.id) {
      myTeamId = game.value.away_team_id;
    }

    if (!myTeamId) return false;

    // Was the last batter on the user's team? If so, hide the outcome.
    return lastBatterTeamId === myTeamId;
  });

  const displayGameState = computed(() => {
    if (!gameState.value) {
      // Return a default, safe object to prevent crashes.
      return {
        inning: 1, isTop: true, outs: 0, homeScore: 0, awayScore: 0, bases: {},
        isBetweenHalfInningsAway: false, isBetweenHalfInningsHome: false
      };
    }

    const isBetweenInnings = gameState.value.isBetweenHalfInningsAway || gameState.value.isBetweenHalfInningsHome;
    const shouldRollback = isOutcomeHidden.value || shouldHideEndOfInningOutcome.value;

    if (shouldRollback) {
      const rollbackSource = (isBetweenInnings || opponentReadyForNext.value)
        ? gameState.value.lastCompletedAtBat
        : gameState.value.currentAtBat;

      if (rollbackSource && rollbackSource.basesBeforePlay) {
        return {
          ...gameState.value,
          bases: rollbackSource.basesBeforePlay,
          outs: rollbackSource.outsBeforePlay,
          homeScore: rollbackSource.homeScoreBeforePlay,
          awayScore: rollbackSource.awayScoreBeforePlay,
          // When rolling back a third out, we must also reset the between-innings flags
          // to prevent the UI from changing (e.g., linescore color) before the outcome is shown.
          isBetweenHalfInningsAway: false,
          isBetweenHalfInningsHome: false,
        };
      }
    }

    // In all other cases, return the current state.
    return gameState.value;
  });

  return { game, series, gameState, displayGameState, gameEvents, batter, pitcher, lineups, rosters, setupState, teams,
    fetchGame, declareHomeTeam,setGameState,initiateSteal,resolveSteal,submitPitch, submitSwing, fetchGameSetup, submitRoll, submitGameSetup,submitTagUp,
    displayOuts, setDisplayOuts, isOutcomeHidden, setOutcomeHidden, gameEventsToDisplay, isBetweenHalfInnings,
    submitBaserunningDecisions,submitAction,nextHitter,resolveDefensiveThrow,submitSubstitution, advanceRunners,setDefense,submitInfieldInDecision,resetRolls,
    updateGameData,
    resetGameState,
    myTeam,
    opponentReadyForNext
  };
})