<script setup>
import RunnerCard from './RunnerCard.vue';

defineProps({
  bases: Object,
  canSteal: Boolean,
  catcherArm: Number,
  atBatStatus: String,
});
const emit = defineEmits(['attempt-steal']);
</script>

<template>
  <div class="diamond-container">
    <!-- Runner slots are now absolutely positioned divs -->
    <div class="runner-slot" style="top: 48%; left: 78%;">
      <RunnerCard v-if="bases.first" :runner="bases.first" />
    </div>
    <div class="runner-slot" style="top: 27%; left: 50%;">
      <RunnerCard v-if="bases.second" :runner="bases.second" />
    </div>
    <div class="runner-slot" style="top: 48%; left: 22%;">
      <RunnerCard v-if="bases.third" :runner="bases.third" />
    </div>

    <!-- Steal Buttons and Defense Ratings -->
    <div class="button-slot" style="top: 15%; left: 40%;">
      <button v-if="canSteal && bases.second" @click="emit('attempt-steal', 2)" class="steal-button">Steal 3rd</button>
    </div>
    <div class="button-slot" style="top: 75%; left: 65%;">
      <button v-if="canSteal && bases.first" @click="emit('attempt-steal', 1)" class="steal-button">Steal 2nd</button>
    </div>
    <div class="button-slot" style="top: 75%; left: 20%;">
      <div v-if="canSteal || atBatStatus === 'defensive-steal-throw'" class="defense-rating">
          Catcher Arm: {{ catcherArm >= 0 ? '+' : '' }}{{ catcherArm }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.diamond-container {
  width: 100%;
  max-width: 350px;
  margin: 1rem auto;
  aspect-ratio: 1 / 1;
  position: relative; /* This is crucial for positioning children */
  
  /* THIS IS THE KEY CHANGE */
  background-image: url('https://i.ibb.co/Jjy2kfhR/diamond-for-app.png');
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

.runner-slot {
  position: absolute;
  width: 90px; /* Adjust size of runner cards */
  height: 126px;
  transform: translate(-50%, -50%); /* Center the card on the coordinates */
}

.button-slot {
  position: absolute;
  width: 70px;
  height: 25px;
}

.steal-button {
    width: 100%; height: 100%; font-size: 10px; padding: 0;
    cursor: pointer; background-color: #dc3545; color: white;
    border: 1px solid #fff; border-radius: 3px;
}
.defense-rating {
    width: 100%; height: 100%; background: rgba(0,0,0,0.6);
    color: white; font-size: 10px; text-align: center;
    border-radius: 2px; padding: 2px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
}
</style>

