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
    return `Throw: ${props.details.roll} +${props.details.defense}`;
});

const targetInfo = computed(() => {
    return `${props.details.target}`;
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
  bottom: 40px;
  left: 70%;
  transform: translateX(-50%);
  padding: 0.5rem 1rem;
  border: 1px solid;
  border-radius: 0px;
  text-align: center;
  font-size: 1rem;
  z-index: 10;
  box-shadow: 0 0px 0px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
}

.outcome {
  font-size: 1.5rem;
  font-weight: bold;
  margin-top: 0.25rem;
}
</style>