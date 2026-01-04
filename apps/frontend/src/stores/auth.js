import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import { apiClient } from '../services/api' // Import the new service

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
  // API_URL is handled inside apiClient, but we expose it if needed by components
  // (though they should prefer using apiClient or store actions)
  const API_URL = import.meta.env.VITE_API_URL || '';
  const isAuthenticated = computed(() => !!token.value);
  const availableTeams = ref([]);

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
      // Login endpoint is public, so we might not want the auto-redirect behavior of apiClient
      // if it fails with 401 (invalid creds). However, apiClient redirects on 401 response.
      // Standard fetch is safer here to distinguish "Bad Credentials" (401) from "Expired Token".
      // But typically login returns 401 for bad creds anyway.
      // Let's use raw fetch for login/register to handle errors manually without global redirect loop risk.
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      
      setToken(data.token);
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
      // Use apiClient
      const response = await apiClient(`/api/point-sets`);
      if (!response.ok) throw new Error('Failed to fetch point sets');
      const sets = await response.json();
      pointSets.value = sets;

      // Only set default if not already set (allows components to override before fetch)
      if (sets.length > 0 && !selectedPointSetId.value) {
        const currentSeasonSet = sets.find(set => set.name === "8/4/25 Season");
        if (currentSeasonSet) {
          selectedPointSetId.value = currentSeasonSet.point_set_id;
        } else {
          selectedPointSetId.value = sets[0].point_set_id;
        }
      }
    } catch (error) {
      console.error('Failed to fetch point sets:', error);
    }
  }

async function fetchMyRoster(type = 'league') {
    if (!token.value) return;
    try {
      const response = await apiClient(`/api/my-roster?type=${type}`);
      if (!response.ok) throw new Error('Failed to fetch roster');
      myRoster.value = await response.json();
    } catch (error) {
      console.error('Failed to fetch roster:', error);
    }
  }

  async function fetchAllPlayers(pointSetId) {
    if (!token.value || !pointSetId) return;
    try {
      const response = await apiClient(`/api/cards/player?point_set_id=${pointSetId}`);
      if (!response.ok) throw new Error('Failed to fetch player cards');

      const players = await response.json();
      allPlayers.value = players;
    } catch (error) {
      console.error('Failed to fetch players:', error);
      allPlayers.value = [];
    }
}

async function fetchAvailableTeams() {
  console.log('2. fetchAvailableTeams action in auth.js was called.');
  try {
    // This endpoint seems public or at least accessible. If it requires auth, apiClient handles it.
    // If it's public, apiClient works too (just won't attach token if missing, or will if present).
    const response = await apiClient(`/api/available-teams`);
    if (!response.ok) throw new Error('Failed to fetch teams');
    const teamsData = await response.json();
    console.log('3. Received available teams data from server:', teamsData);
    availableTeams.value = teamsData;
  } catch (error) {
    console.error('Error fetching available teams:', error);
  }
}

  async function saveRoster(rosterData, type = 'league') {
  if (!token.value) return;
  try {
    const response = await apiClient(`/api/my-roster`, {
      method: 'POST',
      body: JSON.stringify({ ...rosterData, type })
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.errors && Array.isArray(data.errors)) {
        const errorDetails = data.errors.join('\n- ');
        throw new Error(`Invalid Roster:\n\n- ${errorDetails}`);
      }
      throw new Error(data.message || 'Failed to create roster');
    }

    await fetchMyRoster(type);
    router.push('/dashboard');

  } catch (error) {
    console.error('Failed to create roster:', error);
    alert(error.message);
  }
}
  
  async function fetchMyGames() {
    if (!token.value) return;
    try {
        const response = await apiClient(`/api/games`);
        if (!response.ok) throw new Error('Failed to fetch games');
        myGames.value = await response.json();
    } catch (error) {
        console.error(error);
    }
  }

  async function fetchOpenGames() {
    if (!token.value) return;
    try {
        const response = await apiClient(`/api/games/open`);
        if (!response.ok) throw new Error('Failed to fetch open games');
        openGames.value = await response.json();
    } catch (error) {
        console.error(error);
    }
  }

async function createGame(rosterId, seriesType) {
  if (!token.value) return;
  try {
    const response = await apiClient(`/api/games`, {
      method: 'POST',
      body: JSON.stringify({ roster_id: rosterId, home_or_away: 'home', league_designation: 'AL', series_type: seriesType })
    });
    if (!response.ok) throw new Error('Failed to create game');

    await fetchMyGames();
    await fetchOpenGames();
  } catch (error) {
     console.error("Create game error:", error);
     alert(`Error: ${error.message}`);
  }
}

async function joinGame(gameId, rosterId) {
  if (!token.value) return;
  try {
      const response = await apiClient(`/api/games/${gameId}/join`, {
          method: 'POST',
          body: JSON.stringify({ roster_id: rosterId })
      });
      if (!response.ok) throw new Error('Failed to join game');

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
        const response = await apiClient(`/api/rosters/${rosterId}?point_set_id=${pointSetId}`);
        if (!response.ok) throw new Error('Failed to fetch roster details');

        const rosterPlayers = await response.json();
        activeRosterCards.value = rosterPlayers;

    } catch (error) {
        console.error('Failed to fetch roster details:', error);
    }
}

async function submitLineup(gameId, lineupData) {
  if (!token.value) return;
  try {
    await apiClient(`/api/games/${gameId}/lineup`, {
      method: 'POST',
      body: JSON.stringify(lineupData)
    });
  } catch (error) {
    console.error('Failed to submit lineup:', error);
    alert('Error submitting lineup.');
  }
}

  async function fetchMyParticipantInfo(gameId) {
    if (!token.value) return null;
    try {
      const response = await apiClient(`/api/games/${gameId}/my-roster`);
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
