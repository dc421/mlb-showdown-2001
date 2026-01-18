// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import RosterBuilderView from '../views/RosterBuilderView.vue'
import GameView from '../views/GameView.vue'
import SetLineupView from '../views/SetLineupView.vue';
import RegisterView from '../views/RegisterView.vue';
import GameSetupView from '../views/GameSetupView.vue';
import DevToolView from '../views/DevToolView.vue'
import LeagueView from '../views/LeagueView.vue'
import DraftView from '../views/DraftView.vue'
import OfficialRulesView from '../views/OfficialRulesView.vue'
import ClassicView from '../views/ClassicView.vue'
import TeamPageView from '../views/TeamPageView.vue' // <-- IMPORT NEW VIEW

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
    {
      path: '/league',
      name: 'league',
      component: LeagueView,
      meta: { requiresAuth: true }
    },
    {
      path: '/draft',
      name: 'draft',
      component: DraftView,
      meta: { requiresAuth: true }
    },
    {
      path: '/classic',
      name: 'classic',
      component: ClassicView,
      meta: { requiresAuth: true }
    },
    {
      path: '/teams/:teamId', // <-- NEW ROUTE
      name: 'team-page',
      component: TeamPageView,
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
      path: '/official-rules',
      name: 'official-rules',
      component: OfficialRulesView,
      meta: { requiresAuth: true }
    },
    {
      path: '/',
      redirect: () => {
        const auth = useAuthStore();
        return auth.isAuthenticated ? '/dashboard' : '/login';
      }
    }
  ]
})

router.beforeEach((to, from, next) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next('/login');
  } else {
    next();
  }
});

export default router
