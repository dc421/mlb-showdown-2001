<script setup>
import { RouterView } from 'vue-router'
import GlobalNav from '@/components/GlobalNav.vue'; // <-- Import
import { useAuthStore } from './stores/auth';
const authStore = useAuthStore();
</script>

<template>
  <GlobalNav v-if="authStore.isAuthenticated" /> 
  <RouterView />
</template>

<style>
  /* Global styles for the entire application */
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
  }
</style>