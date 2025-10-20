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
  if (props.details.outcome === 'FIELDERS_CHOICE') {
    return 'BATTER SAFE';
  }
    if (props.details.outcome === 'SAFE') {
    return 'SAFE';
  }
    if (props.details.outcome === 'OUT') {
    return 'OUT';
  }
  return props.details.outcome;
});

const runnerInfo = computed(() => {
    if (props.details.runner) {
        return `${props.details.runner}`;
    }
    return '';
});

const rollInfo = computed(() => {
    let base = `Throw: ${props.details.roll} +${props.details.defense}`;
    if (props.details.throwToBase) {
        base = `Throw to ${props.details.throwToBase}B: ${props.details.roll} +${props.details.defense}`;
    }
    if (props.details.penalty) {
        return `${base} ${props.details.penalty}`;
    }
    return base;
});

const targetInfo = computed(() => {
    return `${props.details.target}`;
});

</script>

<template>
  <div class="throw-roll-result" :style="{ backgroundColor: teamColors.primary, borderColor: teamColors.secondary, color: textColor }">
    <div v-if="runnerInfo">{{ runnerInfo }}</div>
    <div>{{ rollInfo }} vs. {{ targetInfo }}</div>
    <div class="outcome">{{ outcomeText }}</div>
  </div>
</template>

<style scoped>
.throw-roll-result {
  opacity: 0.95;
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