<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import Linescore from '@/components/Linescore.vue';
import OutsDisplay from '@/components/OutsDisplay.vue';
import { apiClient } from '@/services/api';

const authStore = useAuthStore();
const gameStore = useGameStore();
const route = useRoute();
const isGamePage = computed(() => route.name === 'game');
const isDashboardPage = computed(() => route.name === 'dashboard');

// Which top-level nav item the current page belongs to (for tab-style highlighting)
const currentNav = computed(() => {
  switch (route.name) {
    case 'dashboard': return 'dashboard';
    case 'league': return 'league';
    case 'classic': return 'classic';
    case 'draft': return 'draft';
    case 'players': return 'players';
    case 'team-page':
    case 'team-season-page': return 'teams';
    default: return null;
  }
});

const isMenuOpen = ref(false);
const isTeamsMenuOpen = ref(false); // For desktop dropdown
const isMobileTeamsExpanded = ref(false); // For mobile toggle
const teamsList = ref([]);

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value;
};

const closeMenu = () => {
    isMenuOpen.value = false;
};

const toggleTeamsMenu = () => {
  isTeamsMenuOpen.value = !isTeamsMenuOpen.value;
}

const closeTeamsMenu = () => {
  isTeamsMenuOpen.value = false;
}

const toggleMobileTeams = () => {
    isMobileTeamsExpanded.value = !isMobileTeamsExpanded.value;
}

async function fetchTeams() {
    try {
        const leagueRes = await apiClient('/api/league?point_set_id=1'); // ID doesn't matter for team list
        if (leagueRes.ok) {
            const leagueData = await leagueRes.json();
            teamsList.value = leagueData.map(t => ({
                team_id: t.team_id,
                name: t.full_display_name,
                city: t.city
            })).sort((a,b) => a.city.localeCompare(b.city));
        }

    } catch (e) { console.error(e); }
}

onMounted(async () => {
  if (authStore.token) {
    try {
        const [draftRes, classicRes, leagueRes] = await Promise.all([
            apiClient('/api/draft/state'),
            apiClient('/api/classic/state'),
            apiClient('/api/league/state')
        ]);

        if (draftRes.ok) {
            const data = await draftRes.json();
            gameStore.isDraftActive = data.is_active;
        }

        if (classicRes.ok) {
            const data = await classicRes.json();
            gameStore.isClassicActive = data.isActive ?? (data.classic?.is_active || false);
        }

        if (leagueRes.ok) {
            const data = await leagueRes.json();
            gameStore.isLeagueActive = data.isActive;
        }
    } catch (e) { console.error(e); }

    await fetchTeams();
  }
});
</script>

<template>
  <nav class="global-nav" :class="{ 'game-page-active': isGamePage, 'dashboard-page': isDashboardPage }">
    <div class="nav-left">
      <RouterLink to="/dashboard" @click="closeMenu">
        <img v-if="authStore.user?.team" :src="authStore.user.team.logo_url" alt="Team Logo" class="nav-team-logo" />
      </RouterLink>
      <RouterLink to="/dashboard" class="dashboard-link-text" :class="{ 'nav-current': currentNav === 'dashboard' }">Dashboard</RouterLink>
      <RouterLink v-if="!isGamePage" to="/league" class="dashboard-link-text" :class="{ 'active-league': gameStore.isLeagueActive, 'nav-current': currentNav === 'league' }">League</RouterLink>

      <!-- Teams Dropdown (Desktop) -->
      <div v-if="!isGamePage" class="teams-dropdown-container" @mouseenter="isTeamsMenuOpen = true" @mouseleave="closeTeamsMenu">
          <span class="dashboard-link-text teams-link" :class="{ 'nav-current': currentNav === 'teams' }" @click="toggleTeamsMenu">
              Teams
          </span>
          <div v-if="isTeamsMenuOpen" class="teams-dropdown-menu">
              <RouterLink
                v-for="team in teamsList"
                :key="team.team_id"
                :to="`/teams/${team.team_id}`"
                class="dropdown-item"
                @click="closeTeamsMenu"
              >
                  {{ team.city }}
              </RouterLink>
          </div>
      </div>

      <RouterLink v-if="!isGamePage" to="/classic" class="dashboard-link-text" :class="{ 'active-classic': gameStore.isClassicActive, 'nav-current': currentNav === 'classic' }">Classic</RouterLink>
      <RouterLink v-if="!isGamePage" to="/draft" class="dashboard-link-text" :class="{ 'active-draft': gameStore.isDraftActive, 'nav-current': currentNav === 'draft' }">Draft</RouterLink>
      <RouterLink v-if="!isGamePage" to="/players" class="dashboard-link-text" :class="{ 'nav-current': currentNav === 'players' }">Players</RouterLink>
    </div>

    <div class="nav-center">
      <Linescore v-if="isGamePage && gameStore.gameState && gameStore.gameEvents.length > 0" />
      <OutsDisplay
        v-if="isGamePage && gameStore.displayGameState"
        :outs="gameStore.displayGameState.outs"
      />
    </div>

    <div class="nav-right">
      <button class="logout-button desktop-logout" @click="authStore.logout()">Logout</button>

      <button class="menu-toggle" @click="toggleMenu">
        <svg v-if="!isMenuOpen" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-menu"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <div v-if="isMenuOpen" class="mobile-menu">
      <RouterLink to="/dashboard" @click="closeMenu" class="mobile-link" :class="{ 'nav-current': currentNav === 'dashboard' }">Dashboard</RouterLink>
      <RouterLink to="/league" @click="closeMenu" class="mobile-link" :class="{ 'active-league': gameStore.isLeagueActive, 'nav-current': currentNav === 'league' }">League</RouterLink>

      <!-- Mobile Teams List (Toggleable) -->
      <div class="mobile-teams-section">
          <div class="mobile-link-header" @click="toggleMobileTeams">
              Teams
              <span class="toggle-icon">{{ isMobileTeamsExpanded ? '▲' : '▼' }}</span>
          </div>
          <div v-if="isMobileTeamsExpanded" class="mobile-teams-list">
              <RouterLink
                v-for="team in teamsList"
                :key="team.team_id"
                :to="`/teams/${team.team_id}`"
                class="mobile-link indented"
                @click="closeMenu"
              >
                  {{ team.city }}
              </RouterLink>
          </div>
      </div>

      <RouterLink to="/classic" @click="closeMenu" class="mobile-link" :class="{ 'active-classic': gameStore.isClassicActive, 'nav-current': currentNav === 'classic' }">Classic</RouterLink>
      <RouterLink to="/draft" @click="closeMenu" class="mobile-link" :class="{ 'active-draft': gameStore.isDraftActive, 'nav-current': currentNav === 'draft' }">Draft</RouterLink>
      <RouterLink to="/players" @click="closeMenu" class="mobile-link" :class="{ 'nav-current': currentNav === 'players' }">Players</RouterLink>
      <button class="logout-button mobile-logout" @click="authStore.logout(); closeMenu()">Logout</button>
    </div>
  </nav>
</template>

<style scoped>
.global-nav {
  background-color: #343a40;
  padding: 0.35rem 1rem;
  display: flex;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 1000;
  margin-bottom: 0rem;
  box-sizing: border-box;
}
@media (min-width: 769px) {
  .global-nav {
    max-height: 80px;
    min-height: 48px;
    padding-top: 0;
    padding-bottom: 0;
    align-items: stretch;
  }
  /* The game page has no full-height tab to keep flush, and its linescore sets
     the bar height — restore the vertical padding so it isn't cramped. */
  .global-nav.game-page-active {
    padding-top: 0.35rem;
    padding-bottom: 0.35rem;
  }
}
.global-nav a, .teams-link {
  color: white;
  text-decoration: none;
  font-weight: bold;
  cursor: pointer;
}
.nav-left {
  display: flex;
  align-items: center;
  flex-basis: 200px;
  gap: 0.5rem;
}
.global-nav a:hover, .teams-link:hover {
  opacity: 0.8;
}

/* Tab-style nav items: full-height shading marks the current page */
.dashboard-link-text, .teams-link {
  padding: 0 14px;
  transition: background-color 0.15s ease;
}
.dashboard-link-text:hover, .teams-link:hover {
  background-color: rgba(255, 255, 255, 0.08);
}
.dashboard-link-text.nav-current, .teams-link.nav-current {
  background-color: #5a626b;
}
.dashboard-link-text.nav-current:hover, .teams-link.nav-current:hover {
  background-color: #5a626b;
  opacity: 1;
}
.global-nav button {
  background-color: #6c757d;
  color: white;
  border: none;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  cursor: pointer;
}
.nav-team-logo {
  height: 30px; 
  width: auto;  
  border-radius: 4px;
  display: block;
}

.nav-center {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 auto;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-basis: 200px;
  justify-content: flex-end;
}

/* Teams Dropdown */
.teams-dropdown-container {
    position: relative;
    height: 100%;
    display: flex;
    align-items: center;
}
.teams-dropdown-menu {
    position: absolute;
    top: 100%; /* Below the nav item */
    left: 0;
    background-color: #343a40;
    min-width: 150px;
    box-shadow: 0 8px 16px rgba(0,0,0,0.2);
    border-radius: 4px;
    padding: 0.5rem 0;
    z-index: 1001;
    display: flex;
    flex-direction: column;
}
.dropdown-item {
    padding: 0.5rem 1rem;
    color: white;
    text-decoration: none;
    transition: background-color 0.2s;
}
.dropdown-item:hover {
    background-color: #495057;
}

/* Mobile Menu Styles */
.menu-toggle {
  display: none;
  background: none !important;
  padding: 0;
  margin: 0;
}

.mobile-menu {
  display: none;
}

@media (max-width: 768px) {
  .global-nav {
    padding: 0.5rem;
    gap: 0.5rem;
    max-height: unset;
    overflow-y: visible;
    flex-wrap: wrap;
  }

  .nav-left {
    flex-shrink: 0;
    flex-basis: auto;
  }

  .nav-right {
    flex-shrink: 0;
    flex-basis: auto;
  }

  .nav-center {
    flex-grow: 1;
    min-width: 0;
    justify-content: center;
    gap: 1rem;
    overflow-x: auto;
  }

  .dashboard-link-text, .teams-dropdown-container {
    display: none;
  }
  
  .global-nav.game-page-active .logout-button {
    display: none;
  }

  .nav-center :deep(.outs-display) {
    background-color: transparent;
    flex-shrink: 0;
  }

  .nav-center :deep(.linescore-table) {
    min-width: 0;
  }

  .menu-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .desktop-logout {
    display: none;
  }

  .mobile-menu {
    display: flex;
    flex-direction: column;
    width: 100%;
    background-color: #343a40;
    padding: 0rem;
    gap: 0rem;
    order: 4;
  }

  .mobile-link {
    padding: 0.5rem;
    border-radius: 4px;
    text-align: left;
  }

  .mobile-link.indented {
      padding-left: 2rem;
      font-weight: normal;
  }

  .mobile-link-header {
      padding: 0.5rem;
      color: #adb5bd;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
  }

  .mobile-link-header:hover {
      background-color: #495057;
  }

  .toggle-icon {
      font-size: 0.8rem;
  }

  .mobile-teams-list {
      display: flex;
      flex-direction: column;
  }

  .mobile-link:hover {
    background-color: #495057;
  }

  .mobile-link.nav-current {
    background-color: #5a626b;
  }

  .mobile-logout {
    width: 100%;
    margin-top: 0.5rem;
  }
}

/* Live status: color change only (no surrounding box/border) */
.active-draft, .active-league {
  color: #ffc107 !important;
  font-weight: bold;
}

.active-classic {
  color: #20c997 !important;
  font-weight: bold;
}

/* Desktop: stretch the left-side nav items to the full bar height so the
   active tab's shading runs flush to the top and bottom edges. Declared after
   the base rules so it wins (media queries don't add specificity). */
@media (min-width: 769px) {
  .nav-left {
    align-items: stretch;
  }
  .nav-left > a {
    display: flex;
    align-items: center;
  }
  .teams-dropdown-container {
    height: auto;
    align-items: stretch;
  }
  .teams-link {
    display: flex;
    align-items: center;
  }
}
</style>
