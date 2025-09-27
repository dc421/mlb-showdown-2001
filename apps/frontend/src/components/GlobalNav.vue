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
    </div>

    <div class="nav-right">
      <OutsDisplay
        v-if="isGamePage && gameStore.gameState"
        :outs="gameStore.displayOuts"
      />
      <button class="logout-button" @click="authStore.logout()">Logout</button>
    </div>
  </nav>
</template>


<style scoped>
.global-nav {
  background-color: #343a40;
  padding: 0.5rem 1rem;
  display: flex;
  justify-content: space-between;
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

.nav-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

@media (max-width: 768px) {
  .global-nav {
    padding: 0.5rem;
    gap: 1rem;
  }

  .nav-left, .nav-right {
    flex-shrink: 0;
  }

  .nav-center {
    flex-grow: 1;
    min-width: 0; /* Allows the container to shrink */
    /* ADDED: These properties help center the scaled content */
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* ADDED: This is the shrinking magic.
    :deep() allows this component's styles to affect its direct child (Linescore).
    We are scaling the Linescore component down to 85% of its original size.
  */
  .nav-center :deep(> *) {
    transform: scale(0.85);
    transform-origin: center;
  }

  .nav-left {
      flex-basis: auto;
  }

  .dashboard-link-text {
    display: none;
  }
  
  .global-nav.game-page-active .logout-button {
    display: none;
  }
}
</style>

