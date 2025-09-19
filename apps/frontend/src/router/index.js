// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import RosterBuilderView from '../views/RosterBuilderView.vue' // <-- IMPORT NEW VIEW
import GameView from '../views/GameView.vue' // <-- IMPORT NEW VIEW
import SetLineupView from '../views/SetLineupView.vue';
import RegisterView from '../views/RegisterView.vue';
import GameSetupView from '../views/GameSetupView.vue';
import DevToolView from '../views/DevToolView.vue' // <-- ADD THIS

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: DashboardView,
      meta: { requiresAuth: true }
    },
    {
      path: '/roster-builder',
      name: 'roster-builder',
      component: RosterBuilderView,
      meta: { requiresAuth: true }
    },
    // ADD THIS NEW DYNAMIC ROUTE
    {
      path: '/game/:id',
      name: 'game',
      component: GameView,
      meta: { requiresAuth: true }
    },
    {
      path: '/game/:id',
      name: 'game',
      component: GameView,
      meta: { requiresAuth: true }
    },
    {
      path: '/game/:id/setup',
      name: 'game-setup',
      component: GameSetupView,
      meta: { requiresAuth: true }
    },
    {
      path: '/game/:id/lineup',
      name: 'set-lineup',
      component: SetLineupView,
      meta: { requiresAuth: true }
    },
    {
      path: '/dev-tool/:id',
      name: 'dev-tool',
      component: DevToolView,
      meta: { requiresAuth: true }
    },
    {
      // Redirect root to dashboard if logged in, otherwise to login
      path: '/',
      redirect: () => {
        const auth = useAuthStore();
        return auth.isAuthenticated ? '/dashboard' : '/login';
      }
    }
  ]
})

// Navigation Guard
router.beforeEach((to, from, next) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    // If a route requires auth and the user isn't logged in, redirect to login
    next('/login');
  } else {
    // Otherwise, allow navigation
    next();
  }
});

export default router