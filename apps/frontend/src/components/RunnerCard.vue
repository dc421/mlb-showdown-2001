<script setup>
import { computed } from 'vue';

const props = defineProps({
  runner: Object,
});

// Determines the border color based on the runner's speed
const speedClass = computed(() => {
  if (!props.runner) return '';
  const speed = parseInt(props.runner.speed, 10);
  if (speed === 20) return 'speed-fast';
  if (speed === 15) return 'speed-medium';
  if (speed === 10) return 'speed-slow';
  return '';
});

function handleImageError(event) {
  event.target.src = 'https://via.placeholder.com/220x308/CCCCCC/FFFFFF?text=No+Image';
}
</script>

<template>
  <div class="runner-card" :class="speedClass" v-if="runner">
    <img 
        :src="runner.image_url" 
        :alt="runner.name"
        class="card-image"
        @error="handleImageError"
    />
  </div>
</template>

<style scoped>
.runner-card {
  width: 100%;
  height: 100%;
  /* BORDER IS NOW 2PX THICK */
  border: 5px solid transparent; 
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  background-color: #ccc;
  display: flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}
.card-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}
/* Speed indicator colors */
.speed-fast {
  border-color: #28a745; /* Green */
}
.speed-medium {
  /* NEW BRIGHTER YELLOW */
  border-color: #ffeb3b; 
}
.speed-slow {
  border-color: #dc3545; /* Red */
}
</style>


