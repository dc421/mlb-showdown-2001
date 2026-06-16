<script setup>
import { computed } from 'vue';

const props = defineProps({
  runner: Object,
  // When true the runner was thrown out: grayscale the image + outline, mark with a red X.
  thrownOut: { type: Boolean, default: false },
  // When true the runner scored (used for fan positioning by the parent).
  scored: { type: Boolean, default: false },
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
  // Use a local, relative path to the replacement image
  event.target.src = '/card_images/replacement.jpg';
}
</script>

<template>
  <div class="runner-card" :class="[speedClass, { 'thrown-out': thrownOut, 'scored': scored }]" v-if="runner">
    <img
        :src="runner.image_url"
        :alt="runner.name"
        class="card-image"
        @error="handleImageError"
    />
    <div v-if="thrownOut" class="out-x">✕</div>
  </div>
</template>

<style scoped>
.runner-card {
  position: relative;
  width: 100%;
  height: 95%;
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

/* Thrown-out treatment: gray the image + speed outline, mark with a red X. */
.runner-card.thrown-out {
  border-color: #9aa0a6 !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  overflow: visible;
}
.runner-card.thrown-out .card-image {
  filter: grayscale(1);
  opacity: 0.5;
}
.out-x {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #d62020;
  font-size: 4rem;
  font-weight: 900;
  line-height: 1;
  z-index: 3;
  text-shadow: 0 0 5px rgba(255, 255, 255, 0.95), 0 1px 2px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
</style>


