<script setup>
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { RouterLink } from 'vue-router';

const authStore = useAuthStore();
const email = ref('');
const password = ref('');

async function handleLogin() {
  await authStore.login(email.value, password.value);
}
</script>

<template>
  <div id="app-container">
    <div class="login-form">
      <img src="https://i.ibb.co/CKmxGGGw/showdown-logo.png" alt="MLB Showdown Logo" class="login-logo" />
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" v-model="email" required />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" v-model="password" required />
        </div>
        <button type="submit">Login</button>
      </form>
      <p class="sub-link">
        Don't have an account? <RouterLink to="/register">Sign Up</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
#app-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: #f0f2f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.login-form {
  padding: 2rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
}

h1 {
  text-align: center;
  margin-bottom: 1.5rem;
  color: #1c1e21;
}

.form-group {
  margin-bottom: 1rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: #4b4f56;
}

input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #dddfe2;
  border-radius: 6px;
  box-sizing: border-box;
}

.login-logo {
  max-width: 100%;
  margin-bottom: 1.5rem;
}

button {
  width: 100%;
  padding: 0.75rem;
  border: none;
  border-radius: 6px;
  background-color: #1877f2;
  color: white;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: background-color 0.2s;
}
.sub-link { text-align: center; margin-top: 1rem; }

button:hover {
  background-color: #166fe5;
}
</style>