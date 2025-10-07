<script setup>
import { computed } from 'vue';
import { getContrastingTextColor } from '@/utils/colors';

const props = defineProps({
  details: {
    type: Object,
    required: true,
  },
  teamColors: {
    type: Object,
    required: true,
  },
});

const textColor = computed(() => getContrastingTextColor(props.teamColors.primary));

const outcomeText = computed(() => {
  if (props.details.outcome === 'DOUBLE_PLAY') {
    return 'DOUBLE PLAY';
  }
  return 'BATTER SAFE';
});

const rollInfo = computed(() => {
    return `Roll: ${props.details.roll} + Def: ${props.details.defense} = ${props.details.roll + props.details.defense}`;
});

const targetInfo = computed(() => {
    return `Target: ${props.details.target}`;
});

</script>

<template>
  <div class="throw-roll-result" :style="{ backgroundColor: teamColors.primary, borderColor: teamColors.secondary, color: textColor }">
    <div>{{ rollInfo }} vs. {{ targetInfo }}</div>
    <div class="outcome">{{ outcomeText }}</div>
  </div>
</template>

<style scoped>
.throw-roll-result {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.5rem 1rem;
  border: 2px solid;
  border-radius: 8px;
  text-align: center;
  font-weight: bold;
  font-size: 1rem;
  z-index: 10;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
}

.outcome {
  font-size: 1.5rem;
  font-weight: bold;
  margin-top: 0.25rem;
}
</style>