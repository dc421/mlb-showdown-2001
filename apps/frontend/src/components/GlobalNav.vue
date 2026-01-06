<script setup>
import { computed, onMounted } from 'vue';
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

onMounted(async () => {
  // Check draft status on mount
  if (authStore.token) {
    try {
        const res = await apiClient('/api/draft/state');
        if (res.ok) {
            const data = await res.json();
            gameStore.isDraftActive = data.is_active;
        }
    } catch (e) { console.error(e); }
  }
});
</script>

<template>
  <nav class="global-nav" :class="{ 'game-page-active': isGamePage, 'dashboard-page': isDashboardPage }">
    <div class="nav-left">
      <RouterLink to="/dashboard">
        <img v-if="authStore.user?.team" :src="authStore.user.team.logo_url" alt="Team Logo" class="nav-team-logo" />
      </RouterLink>
      <RouterLink to="/dashboard" class="dashboard-link-text">Dashboard</RouterLink>
      <RouterLink v-if="!isGamePage" to="/league" class="dashboard-link-text">League</RouterLink>
      <RouterLink v-if="!isGamePage" to="/classic" class="dashboard-link-text">Classic</RouterLink>
      <RouterLink v-if="!isGamePage" to="/draft" class="dashboard-link-text" :class="{ 'active-draft': gameStore.isDraftActive }">Draft</RouterLink>
    </div>
    
    <div class="nav-center">
      <Linescore v-if="isGamePage && gameStore.gameState && gameStore.gameEvents.length > 0" />
      <OutsDisplay
        v-if="isGamePage && gameStore.displayGameState"
        :outs="gameStore.displayGameState.outs"
      />
    </div>

    <div class="nav-right">
      <button class="logout-button" @click="authStore.logout()">Logout</button>
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
    /* Prevent expansion on scroll */
    max-height: 80px;
    overflow-y: hidden;
  }
}
.global-nav a {
  color: white;
  text-decoration: none;
  font-weight: bold;
}
.nav-left {
  display: flex;
  align-items: center;
  flex-basis: 200px;
  gap: 1.25rem; 
}
.global-nav a:hover {
  opacity: 0.8;
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

@media (max-width: 768px) {
  .global-nav {
    padding: 0.5rem;
    gap: 0.5rem; /* Reduced gap for tighter fit */
    max-height: unset; /* Allow mobile nav to grow if needed */
    overflow-y: visible;
  }

  .nav-left {
    flex-shrink: 0; /* Prevent logo from shrinking */
    flex-basis: auto;
  }

  .nav-right {
    flex-shrink: 0;
    flex-basis: auto;
  }

  .nav-center {
    flex-grow: 1; /* Allow this to fill available space */
    min-width: 0; /* Critical for flex-grow in a flex container */
    justify-content: center; /* Center the items */
    gap: 1rem; /* Add some space between items */
    overflow-x: auto;
  }

  /* REMOVED: The transform was causing the overlap issue.
     Flexbox properties now handle the layout. */

  .dashboard-link-text {
    display: none;
  }
  
  .global-nav.game-page-active .logout-button {
    display: none;
  }


  /* Ensure the outs are visible against the dark background */
  .nav-center :deep(.outs-display) {
    background-color: transparent; /* Or whatever matches the nav */
    flex-shrink: 0;
  }

  .nav-center :deep(.linescore-table) {
    min-width: 0;
  }
}

.active-draft {
  color: #ffc107 !important; /* Gold/Yellow */
  font-weight: bold;
}
</style>
