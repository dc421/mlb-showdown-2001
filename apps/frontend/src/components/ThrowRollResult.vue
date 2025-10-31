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

const isSingleRunner = computed(() => {
  return !props.details.attempts || props.details.attempts.length <= 1;
});

const outcomeText = computed(() => {
  // Handle steals (single and double) first, as they have throwToBase.
  if (props.details.throwToBase) {
    if (isSingleRunner.value && props.details.outcome === 'SAFE') {
      return 'SAFE!';
    }
    const base = props.details.throwToBase;
    const ordinal = base === 2 ? '2nd' : base === 3 ? '3rd' : base === 4 ? 'HOME' : `${base}th`;
    return `${props.details.outcome} AT ${ordinal}!`;
  }

  // Simplified logic for other plays
  switch (props.details.outcome) {
    case 'DOUBLE_PLAY':
      return 'DOUBLE PLAY';
    case 'FIELDERS_CHOICE':
      return 'BATTER SAFE';
    case 'SAFE':
      return 'SAFE';
    case 'OUT':
      return 'OUT';
    default:
      return props.details.outcome;
  }
});

const rollDetails = computed(() => {
  if (props.details.attempts?.length > 0) {
    return props.details.attempts[0];
  }
  return props.details;
});

const rollInfo = computed(() => {
    if (rollDetails.value.summary) {
        return rollDetails.value.summary;
    }
    let base;
    if (rollDetails.value.throwToBase && !isSingleRunner.value) {
        const baseDisplay = rollDetails.value.throwToBase === 4 ? 'Home' : `${rollDetails.value.throwToBase}B`;
        base = `Throw to ${baseDisplay}: ${rollDetails.value.roll} +${rollDetails.value.defense}`;
    } else {
        base = `Throw: ${rollDetails.value.roll} +${rollDetails.value.defense}`;
    }
    return base;
});

const targetInfo = computed(() => {
    if (rollDetails.value.baseSpeed !== undefined) {
        let result = `${rollDetails.value.baseSpeed}`;
        if (rollDetails.value.penalty > 0) {
            result += ` +${rollDetails.value.penalty}`;
        } else if (rollDetails.value.penalty < 0) {
            result += ` ${rollDetails.value.penalty}`;
        }
        return result;
    }
    return `${rollDetails.value.target}`;
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
