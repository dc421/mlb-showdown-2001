import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || null);
  const user = ref(JSON.parse(localStorage.getItem('user')) || null);
const myRoster = ref(null);
  const allPlayers = ref([]);
  const pointSets = ref([]);
  const selectedPointSetId = ref(null);
  const myGames = ref([]);
  const openGames = ref([]);
  const activeRosterCards = ref([]);
  const API_URL = import.meta.env.VITE_API_URL || '';
  const isAuthenticated = computed(() => !!token.value);
    const availableTeams = ref([]); // New state for registration

  function setToken(newToken) {
    token.value = newToken;
    localStorage.setItem('token', newToken);
  }

  function setUser(newUser) {
    user.value = newUser;
    localStorage.setItem('user', JSON.stringify(newUser));
  }

  async function login(email, password) {
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      
      setToken(data.token);
      // The payload from the token now contains the full user and team object
      const payload = JSON.parse(atob(data.token.split('.')[1]));
      setUser(payload);

      router.push('/dashboard');
    } catch (error) {
      console.error('Login failed:', error);
      alert(`Login Failed: ${error.message}`);
    }
  }
  
  async function register(credentials) {
    try {
        const response = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        
        alert('Registration successful! Please log in.');
        router.push('/login');
    } catch (error) {
        console.error('Registration failed:', error);
        alert(`Registration Failed: ${error.message}`);
    }
  }

  function logout() {
    token.value = null;
    user.value = null;
    myRoster.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  }

  async function fetchPointSets() {
    if (!token.value) return;
    try {
      const response = await fetch(`${API_URL}/api/point-sets`, {
        headers: { 'Authorization': `Bearer ${token.value}` }
      });
      if (!response.ok) throw new Error('Failed to fetch point sets');
      const sets = await response.json();
      pointSets.value = sets;
      // Default to "Current Season" (i.e., "8/4/25 Season") if available, otherwise newest set.
      if (sets.length > 0 && !selectedPointSetId.value) {
        const currentSeasonSet = sets.find(set => set.name === "8/4/25 Season");
        if (currentSeasonSet) {
          selectedPointSetId.value = currentSeasonSet.point_set_id;
        } else {
          selectedPointSetId.value = sets[0].point_set_id; // Fallback
        }
      }
    } catch (error) {
      console.error('Failed to fetch point sets:', error);
    }
  }

  // in src/stores/auth.js
async function fetchMyRoster() {
    if (!token.value) return;
    try {
      const response = await fetch(`${API_URL}/api/my-roster`, {
        headers: { 'Authorization': `Bearer ${token.value}` }
      });
      if (!response.ok) throw new Error('Failed to fetch roster');
      myRoster.value = await response.json();
    } catch (error) {
      console.error('Failed to fetch roster:', error);
    }
  }

  async function fetchAllPlayers(pointSetId) {
    if (!token.value || !pointSetId) return;
    try {
      const response = await fetch(`${API_URL}/api/cards/player?point_set_id=${pointSetId}`, {
        headers: { 'Authorization': `Bearer ${token.value}` }
      });
      if (!response.ok) throw new Error('Failed to fetch player cards');

      const players = await response.json();
      allPlayers.value = players;
    } catch (error) {
      console.error('Failed to fetch players:', error);
      allPlayers.value = []; // Clear players on error to prevent using stale data
    }
}

async function fetchAvailableTeams() {
  console.log('2. fetchAvailableTeams action in auth.js was called.');
  try {
    const response = await fetch(`${API_URL}/api/available-teams`);
    if (!response.ok) throw new Error('Failed to fetch teams');
    const teamsData = await response.json();
    console.log('3. Received available teams data from server:', teamsData);
    availableTeams.value = teamsData;
  } catch (error) {
    console.error('Error fetching available teams:', error);
  }
}

  async function saveRoster(rosterData) {
  if (!token.value) return;
  try {
    const response = await fetch(`${API_URL}/api/my-roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
      body: JSON.stringify(rosterData)
    });

    const data = await response.json(); // Read the response body

    if (!response.ok) {
      // If the server sent a detailed list of errors, format and throw them.
      if (data.errors && Array.isArray(data.errors)) {
        const errorDetails = data.errors.join('\n- ');
        throw new Error(`Invalid Roster:\n\n- ${errorDetails}`);
      }
      // Otherwise, throw the generic message.
      throw new Error(data.message || 'Failed to create roster');
    }

    // On success:
    await fetchMyRoster();
    router.push('/dashboard');

  } catch (error) {
    console.error('Failed to create roster:', error);
    // The alert will now show our detailed, formatted error message
    alert(error.message);
  }
}
  
  async function fetchMyGames() {
    if (!token.value) return;
    try {
        const response = await fetch(`${API_URL}/api/games`, {
            headers: { 'Authorization': `Bearer ${token.value}` }
        });
        if (!response.ok) throw new Error('Failed to fetch games');
        myGames.value = await response.json();
    } catch (error) {
        console.error(error);
    }
  }

  async function fetchOpenGames() {
    if (!token.value) return;
    try {
        const response = await fetch(`${API_URL}/api/games/open`, {
            headers: { 'Authorization': `Bearer ${token.value}` }
        });
        if (!response.ok) throw new Error('Failed to fetch open games');
        openGames.value = await response.json();
    } catch (error) {
        console.error(error);
    }
  }

  // in src/stores/auth.js
async function createGame(rosterId, seriesType) {
  if (!token.value) return;
  try {
    const response = await fetch(`${API_URL}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
      body: JSON.stringify({ roster_id: rosterId, home_or_away: 'home', league_designation: 'AL', series_type: seriesType })
    });
    if (!response.ok) throw new Error('Failed to create game');

    // This is the fix: Refresh the lists directly after the action is confirmed.
    await fetchMyGames();
    await fetchOpenGames();
  } catch (error) {
     console.error("Create game error:", error);
     alert(`Error: ${error.message}`);
  }
}

  // in src/stores/auth.js
async function joinGame(gameId, rosterId) {
  if (!token.value) return;
  try {
      const response = await fetch(`${API_URL}/api/games/${gameId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
          body: JSON.stringify({ roster_id: rosterId })
      });
      if (!response.ok) throw new Error('Failed to join game');

      // This is the fix: Refresh the lists directly after the action is confirmed.
      await fetchMyGames();
      await fetchOpenGames();
  } catch (error) {
     console.error(error);
     alert(`Error: ${error.message}`);
  }
}

async function fetchRosterDetails(rosterId, pointSetId) {
    if (!token.value || !rosterId || !pointSetId) return;
    try {
        const response = await fetch(`${API_URL}/api/rosters/${rosterId}?point_set_id=${pointSetId}`, {
            headers: { 'Authorization': `Bearer ${token.value}` }
        });
        if (!response.ok) throw new Error('Failed to fetch roster details');

        // The backend now returns fully processed players with displayName, displayPosition, and points.
        const rosterPlayers = await response.json();

        activeRosterCards.value = rosterPlayers;

    } catch (error) {
        console.error('Failed to fetch roster details:', error);
    }
}


  // in src/stores/auth.js
async function submitLineup(gameId, lineupData) {
  if (!token.value) return;
  try {
    await fetch(`${API_URL}/api/games/${gameId}/lineup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
      body: JSON.stringify(lineupData)
    });
    // The WebSocket event will handle the redirect. There should be NO router.push here.
  } catch (error) {
    console.error('Failed to submit lineup:', error);
    alert('Error submitting lineup.');
  }
}

  async function fetchMyParticipantInfo(gameId) {
    if (!token.value) return null;
    try {
      const response = await fetch(`${API_URL}/api/games/${gameId}/my-roster`, {
        headers: { 'Authorization': `Bearer ${token.value}` }
      });
      if (!response.ok) throw new Error('Failed to fetch participant info');
      return await response.json();
    } catch (error) {
      console.error('Fetch participant info failed:', error);
      return null;
    }
  }

  return { 
    token, user, allPlayers, myGames, openGames, activeRosterCards, API_URL, router,
    pointSets, selectedPointSetId,
    isAuthenticated, login, register, logout, myRoster,fetchMyRoster, saveRoster,
    fetchAllPlayers, fetchMyGames, fetchOpenGames, joinGame,fetchAvailableTeams,
    submitLineup, fetchRosterDetails, createGame, fetchMyParticipantInfo,availableTeams,
    fetchPointSets
  }
})