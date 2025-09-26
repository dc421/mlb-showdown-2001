<script setup>
import { RouterView } from 'vue-router'
import GlobalNav from '@/components/GlobalNav.vue'; // <-- Import
import { useAuthStore } from './stores/auth';
const authStore = useAuthStore();
</script>

<template>
  <GlobalNav v-if="authStore.isAuthenticated" />
  <div class="main-content-wrapper">
    <RouterView />
  </div>
</template>

<style>
  /* Global styles for the entire application */
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
    background-color: #343a40; /* Dark background for the whole page */
  }

  .main-content-wrapper {
    background-color: white; /* White background for the content area */
    min-height: 100vh;
  }

  @media (max-width: 768px) {
    body {
      background-color: #fff; /* White background for mobile */
    }
  }
</style>