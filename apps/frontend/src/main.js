// src/main.js

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)

// These two lines are the most important part.
// They tell Vue to use Pinia and the router.
app.use(createPinia())
app.use(router)

app.mount('#app')