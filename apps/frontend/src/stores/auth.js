import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || null);
  const user = ref(JSON.parse(localStorage.getItem('user')) || null);
const myRoster = ref(null);
  const allPlayers = ref([]);
  const myGames = ref([]);
  const openGames = ref([]);
  const activeRosterCards = ref([]);
  const API_URL = import.meta.env.VITE_API_URL;
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

  async function fetchAllPlayers() {
  console.log('2. fetchAllPlayers action in auth.js was called.');
  if (!token.value) return;
  try {
    const response = await fetch(`${API_URL}/api/cards/player`, {
      headers: { 'Authorization': `Bearer ${token.value}` }
    });
    console.log('3. Received response from server with status:', response.status);
    if (!response.ok) throw new Error('Failed to fetch player cards');
    
    const players = await response.json();
    allPlayers.value = players;
  } catch (error) {
    console.error('Failed to fetch players:', error);
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
async function createGame(rosterId) {
  if (!token.value) return;
  try {
    const response = await fetch(`${API_URL}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
      body: JSON.stringify({ roster_id: rosterId, home_or_away: 'home', league_designation: 'AL' })
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

// in src/stores/auth.js
async function fetchRosterDetails(rosterId) {
  if (!token.value) return;
  try {
    // This is new: Ensure the master player list is available for context.
    if (allPlayers.value.length === 0) {
      await fetchAllPlayers();
    }

    const response = await fetch(`${API_URL}/api/rosters/${rosterId}`, {
      headers: { 'Authorization': `Bearer ${token.value}` }
    });
    if (!response.ok) throw new Error('Failed to fetch roster details');
    const rosterPlayers = await response.json();

    // This is new: Create a map of name counts from the master list.
    const nameCounts = {};
    allPlayers.value.forEach(p => { nameCounts[p.name] = (nameCounts[p.name] || 0) + 1; });

    // Process each player on the active roster
    rosterPlayers.forEach(p => {
      // THIS IS THE FIX: Add the displayName property.
      p.displayName = nameCounts[p.name] > 1 ? `${p.name} (${p.team})` : p.name;
      
      // Keep the existing logic for displayPosition.
      if (p.control !== null) {
        p.displayPosition = Number(p.ip) > 3 ? 'SP' : 'RP';
      } else {
        const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings).join(',') : 'DH';
        p.displayPosition = positions.replace(/LFRF/g, 'LF/RF');
      }
    });

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
    isAuthenticated, login, register, logout, myRoster,fetchMyRoster, saveRoster,
    fetchAllPlayers, fetchMyGames, fetchOpenGames, joinGame,fetchAvailableTeams,
    submitLineup, fetchRosterDetails, createGame, fetchMyParticipantInfo,availableTeams
  }
})