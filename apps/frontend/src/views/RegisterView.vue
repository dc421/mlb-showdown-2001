<script setup>
import { ref, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { RouterLink } from 'vue-router';

const authStore = useAuthStore();

// New state for all form fields
const email = ref('');
const password = ref('');
const owner_first_name = ref('');
const owner_last_name = ref('');
const team_id = ref(null);

async function handleRegister() {
  if (!team_id.value) {
    return alert('Please select a team.');
  }
  await authStore.register({ 
    email: email.value, 
    password: password.value,
    owner_first_name: owner_first_name.value,
    owner_last_name: owner_last_name.value,
    team_id: team_id.value
  });
}

// in RegisterView.vue
onMounted(() => {
  console.log('1. RegisterView mounted. Calling fetchAvailableTeams...');
  authStore.fetchAvailableTeams();
});
</script>

<template>
  <div id="app-container">
    <div class="form-container">
      <h1>Claim Your Team</h1>
      <form @submit.prevent="handleRegister">
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" v-model="email" required />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" v-model="password" required />
        </div>
        <div class="form-group">
          <label for="owner_first_name">Owner First Name</label>
          <input type="text" id="owner_first_name" v-model="owner_first_name" required />
        </div>
        <div class="form-group">
          <label for="owner_last_name">Owner Last Name</label>
          <input type="text" id="owner_last_name" v-model="owner_last_name" required />
        </div>
        <div class="form-group">
          <label for="team_id">Select Your Team</label>
          <select id="team_id" v-model="team_id" required>
            <option :value="null" disabled>-- Available Teams --</option>
            <option v-for="team in authStore.availableTeams" :key="team.team_id" :value="team.team_id">
              {{ team.city }} {{ team.name }}
            </option>
          </select>
        </div>
        <button type="submit">Create Account & Claim Team</button>
      </form>
      <p class="sub-link">
        Already have an account? <RouterLink to="/login">Log In</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
#app-container { display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f0f2f5; }
.form-container { padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
h1 { text-align: center; margin-bottom: 1.5rem; }
.form-group { margin-bottom: 1rem; }
.login-logo {
  max-width: 100%;
  margin-bottom: 1.5rem;
}
label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
input { width: 100%; padding: 0.75rem; border: 1px solid #dddfe2; border-radius: 6px; box-sizing: border-box; }
button { width: 100%; padding: 0.75rem; border: none; border-radius: 6px; background-color: #42b72a; color: white; font-size: 1rem; font-weight: bold; cursor: pointer; }
.sub-link { text-align: center; margin-top: 1rem; }
select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #dddfe2;
  border-radius: 6px;
  box-sizing: border-box;
  background-color: white;
}
</style>