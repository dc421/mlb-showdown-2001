// src/main.js

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)

const pinia = createPinia();
app.use(pinia);
app.use(router);

// Expose the store to the window object in development/testing environments
if (import.meta.env.DEV) {
  window.pinia = pinia;
}

app.mount('#app');