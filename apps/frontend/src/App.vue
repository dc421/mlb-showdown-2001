<script setup>
import { RouterView } from 'vue-router'
import GlobalNav from '@/components/GlobalNav.vue'; // <-- Import
import { useAuthStore } from './stores/auth';
const authStore = useAuthStore();
</script>

<template>
  <div class="app-wrapper">
    <GlobalNav v-if="authStore.isAuthenticated" />
    <div class="main-content-wrapper">
      <RouterView />
    </div>
  </div>
</template>

<style>
  .app-wrapper {
    background-color: white;
  }
  /* Global styles for the entire application */
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
  }

  .main-content-wrapper {
    background-color: white; /* White background for the content area */
    min-height: 100vh;
  }
</style>