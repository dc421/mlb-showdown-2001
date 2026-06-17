<script setup>
import RunnerCard from './RunnerCard.vue';
import { computed } from 'vue';
import { getContrastingTextColor } from '@/utils/colors';

const props = defineProps({
  bases: Object,
  canSteal: Boolean,
  catcherArm: Number,
  isStealAttemptInProgress: Boolean,
  // Cards for runners who scored on the current play (fanned at home plate).
  runnersScored: { type: Array, default: () => [] },
  // A runner thrown out on the current play: { runner, base } where base is 2/3/4.
  thrownOutRunner: { type: Object, default: null },
  // Colors of the scoring (batting) team, for the "RUN" splash.
  scoredColors: { type: Object, default: () => ({ primary: '#343a40', secondary: '#ffffff' }) },
  // During the home-run celebration, lift the runner cards above the full-screen dim
  // so they (and the run splash) stay lit while the field darkens.
  celebrating: { type: Boolean, default: false },
});
const emit = defineEmits(['attempt-steal']);

// Get the API URL from the environment variable
const apiUrl = import.meta.env.VITE_API_URL || '';
const diamondUrl = computed(() => `${apiUrl}/images/diamond.png`);

// Runner thrown out at a specific base (2 = 2nd, 3 = 3rd, 4 = home), if any.
const outAtBase = (base) =>
  props.thrownOutRunner && props.thrownOutRunner.base === base ? props.thrownOutRunner.runner : null;

// Players already shown elsewhere on this play (scored at home, or thrown out). A runner
// who advanced off their base is still listed at the base they started from in the frozen
// pre-play state, so we hide them there to avoid showing the same player twice.
const elsewhereCardIds = computed(() => {
  const ids = new Set();
  for (const r of props.runnersScored || []) {
    if (r?.card_id != null) ids.add(r.card_id);
  }
  if (props.thrownOutRunner?.runner?.card_id != null) {
    ids.add(props.thrownOutRunner.runner.card_id);
  }
  return ids;
});

// The runner to render at a base, unless that player is being shown elsewhere this play.
const baseRunner = (base) => {
  const r = props.bases?.[base];
  return r && r.card_id != null && elsewhereCardIds.value.has(r.card_id) ? null : r;
};

// "RUN" / "N RUNS" splash over the scored cards at home.
const runLabel = computed(() =>
  props.runnersScored.length === 1 ? 'RUN' : `${props.runnersScored.length} RUNS`
);
const runTextColor = computed(() => getContrastingTextColor(props.scoredColors?.primary || '#343a40'));

// Stack the scored cards with a small offset (up and to the right, most recent on top)
// so you can see there's more than one without the stack reaching the third-base card.
const fanStyle = (i) => {
  return {
    transform: `translateX(-50%) translate(${i * 11}px, ${i * -6}px)`,
    zIndex: 10 + i,
  };
};
</script>

<template>
  <div v-if="bases" class="diamond-container" :class="{ celebrating }" :style="{ backgroundImage: `url('${diamondUrl}')` }">
    <!-- Runner slots are now absolutely positioned divs -->
    <div class="runner-slot" style="top: 48%; left: 78%;">
      <RunnerCard v-if="baseRunner('first')" :runner="baseRunner('first')" />
    </div>
    <div class="runner-slot" style="top: 27%; left: 50%;">
      <RunnerCard v-if="outAtBase(2)" :runner="outAtBase(2)" thrownOut />
      <RunnerCard v-else-if="baseRunner('second')" :runner="baseRunner('second')" />
    </div>
    <div class="runner-slot" style="top: 48%; left: 22%;">
      <RunnerCard v-if="outAtBase(3)" :runner="outAtBase(3)" thrownOut />
      <RunnerCard v-else-if="baseRunner('third')" :runner="baseRunner('third')" />
    </div>
    <!-- Home plate: scored runners (fanned) + a runner thrown out at home -->
    <div class="runner-slot home-slot" style="top: 78%; left: 50%;">
      <RunnerCard
        v-for="(r, i) in runnersScored"
        :key="r && r.card_id ? `${r.card_id}-${i}` : i"
        :runner="r"
        scored
        class="home-card scored-card"
        :style="fanStyle(i)"
      />
      <div
        v-if="runnersScored.length"
        class="run-splash"
        :style="{ backgroundColor: scoredColors.primary, borderColor: scoredColors.secondary, color: runTextColor }"
      >{{ runLabel }}</div>
      <RunnerCard
        v-if="outAtBase(4)"
        :runner="outAtBase(4)"
        thrownOut
        class="home-card"
        :style="fanStyle(runnersScored.length)"
      />
    </div>
  </div>
</template>

<style scoped>
.diamond-container {
  width: 100%;
  max-width: 350px;
  margin: 0 auto 1rem;
  aspect-ratio: 1 / 1;
  position: relative; /* This is crucial for positioning children */

  /* Background image is now set dynamically via style binding */
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

/* Home-run celebration: keep the runners (and their run splash) lit above the
   full-screen dim (z-index 50) while the field behind them darkens. */
.diamond-container.celebrating .runner-slot {
  z-index: 55;
}

/* Home plate holds a fan of scored cards, so let them overflow the slot box. */
.home-slot {
  overflow: visible;
}
.home-card {
  position: absolute;
  top: 0;
  left: 50%;
  width: 100%;
  height: 100%;
}
.scored-card {
  transform-origin: bottom center;
}
/* Single "RUN" / "N RUNS" splash over the fan, low on the cards, in team colors. */
.run-splash {
  position: absolute;
  left: 50%;
  top: 76%;
  transform: translateX(-50%);
  padding: 0.15rem 0.7rem;
  border: 3px solid;
  border-radius: 2px;
  font-weight: 800;
  font-size: 1.1rem;
  letter-spacing: 1.5px;
  line-height: 1;
  white-space: nowrap;
  z-index: 30;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
@media (max-width: 480px) {
  .runner-slot {
    width: 60px;
    height: 84px;
  }
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
