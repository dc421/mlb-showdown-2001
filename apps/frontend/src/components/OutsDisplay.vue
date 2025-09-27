<script setup>
defineProps({
  outs: {
    type: Number,
    required: true,
    default: 0
  }
});
</script>

<template>
  <div class="outs-display">
    <div class="outs-label">Outs</div>
    <div class="dots">
      <span
        v-for="n in 3"
        :key="n"
        class="out-dot"
        :class="{ filled: n <= outs }"
      ></span>
    </div>
  </div>
</template>

<style scoped>
.outs-display {
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  align-items: center;
  min-width: 40px; /* To match other cells */
}

.outs-label {
    font-size: 1em;
    color: white;
    line-height: 0;
}

.dots {
    display: flex;
    gap: 4px;
}

.out-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.3); /* Empty dot color */
  border: 1px solid rgba(255, 255, 255, 0.5);
}

.out-dot.filled {
  background-color: #dc3545; /* Red for outs */
  border-color: #a0202e;
}
</style>