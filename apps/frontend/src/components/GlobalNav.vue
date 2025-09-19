<script setup>
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import Linescore from '@/components/Linescore.vue';

const authStore = useAuthStore();
const gameStore = useGameStore();
const route = useRoute();
const isGamePage = computed(() => route.name === 'game');
</script>

<template>
  <nav class="global-nav">
    <div class="nav-left">
      <img v-if="authStore.user?.team" :src="authStore.user.team.logo_url" alt="Team Logo" class="nav-team-logo" />
      <RouterLink to="/dashboard">Dashboard</RouterLink>
    </div>
    
    <div class="nav-center">
      <!-- This component is now much simpler. It just needs to be shown. -->
      <Linescore v-if="isGamePage && gameStore.gameState && gameStore.gameEvents.length > 0" />
    </div>

    <div class="nav-right">
      <button @click="authStore.logout()">Logout</button>
    </div>
  </nav>
</template>


<style scoped>
.global-nav {
  background-color: #343a40;
  padding: 0.5rem 1rem; /* Adjusted padding */
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* ADD THESE THREE LINES */
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
  gap: .5rem; /* This adds space between the logo and the link */
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
  height: 30px; /* Keep a fixed height */
  width: auto;   /* Allow the width to adjust automatically */
  border-radius: 4px; /* A squircle looks better than a forced circle */
}
</style>