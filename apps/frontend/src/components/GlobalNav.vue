<script setup>
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import Linescore from '@/components/Linescore.vue';
import OutsDisplay from '@/components/OutsDisplay.vue';

const authStore = useAuthStore();
const gameStore = useGameStore();
const route = useRoute();
const isGamePage = computed(() => route.name === 'game');
</script>

<template>
  <nav class="global-nav" :class="{ 'game-page-active': isGamePage }">
    <div class="nav-left">
      <RouterLink to="/dashboard">
        <img v-if="authStore.user?.team" :src="authStore.user.team.logo_url" alt="Team Logo" class="nav-team-logo" />
      </RouterLink>
      <RouterLink to="/dashboard" class="dashboard-link-text">Dashboard</RouterLink>
    </div>
    
    <div class="nav-center">
      <Linescore v-if="isGamePage && gameStore.gameState && gameStore.gameEvents.length > 0" />
      <OutsDisplay
        v-if="isGamePage && gameStore.gameState"
        :outs="gameStore.displayOuts"
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
  padding: 0.5rem 1rem;
  display: flex;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 1000;
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
  gap: .5rem; 
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
}

@media (max-width: 768px) {
  .global-nav {
    padding: 0.5rem;
    gap: 0.5rem; /* Reduced gap for tighter fit */
  }

  .nav-left {
    flex-shrink: 0; /* Prevent logo from shrinking */
    flex-basis: auto;
  }

  .nav-right {
    flex-shrink: 0;
  }

  .nav-center {
    flex-grow: 1; /* Allow this to fill available space */
    min-width: 0; /* Critical for flex-grow in a flex container */
    justify-content: space-between; /* Pushes Linescore and Outs apart */
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

  .nav-center :deep(.linescore-container) {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>

