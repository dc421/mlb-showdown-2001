<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { getContrastingTextColor } from '@/utils/colors';

const props = defineProps({
  details: {
    type: Object,
    required: false,
    default: () => ({}),
  },
  teamColors: {
    type: Object,
    required: true,
  },
  // Lift the box up so it clears a card shown on home plate.
  shiftUp: {
    type: Boolean,
    default: false,
  },
});

const textColor = computed(() => getContrastingTextColor(props.teamColors.primary));

// Subtle gauge across the bottom of the box: the d20 roll axis (1 → 20).
// The whole bar is colored by zone — green where the roll would be safe, red
// where it would be an out — and a white slash marks the actual roll.
const gauge = computed(() => {
  const d = rollDetails.value || {};
  const roll = Number(d.roll);
  const defense = Number(d.defense);
  if (!Number.isFinite(roll) || !Number.isFinite(defense)) return null;

  let thresholdOut;
  if (d.penalty !== undefined && d.baseSpeed === undefined) {
    // Steal: out when roll + defense >= (target - penalty)
    const target = Number(d.target) - Number(d.penalty || 0);
    if (!Number.isFinite(target)) return null;
    thresholdOut = target - defense;
  } else {
    // Advance / tag-up / double play: out when roll + defense > target
    const target = Number(d.target);
    if (!Number.isFinite(target)) return null;
    thresholdOut = target - defense + 1;
  }

  // Boundary between the safe (lower rolls) and out (higher rolls) zones.
  const boundaryPct = Math.max(0, Math.min(100, ((thresholdOut - 1) / 20) * 100));
  // Slash centered on the rolled value.
  const rollPct = Math.max(0, Math.min(100, ((Math.max(1, Math.min(20, roll)) - 0.5) / 20) * 100));

  const outcome = d.outcome || props.details?.outcome;
  const isOut = outcome === 'OUT' || outcome === 'DOUBLE_PLAY';

  // The smallest roll that's an out — only meaningful when the boundary is inside the bar.
  const roundedThreshold = Math.round(thresholdOut);
  const threshold = roundedThreshold >= 2 && roundedThreshold <= 20 ? roundedThreshold : null;

  return { boundaryPct, rollPct, isOut, threshold, roll: Math.max(1, Math.min(20, Math.round(roll))) };
});

// Measure the gauge so we can convert the marker px widths into a min gap %.
const gaugeEl = ref(null);
const gaugeWidth = ref(0);
let resizeObserver = null;
onMounted(() => {
  if (!gaugeEl.value) return;
  gaugeWidth.value = gaugeEl.value.offsetWidth;
  resizeObserver = new ResizeObserver(() => {
    gaugeWidth.value = gaugeEl.value?.offsetWidth || 0;
  });
  resizeObserver.observe(gaugeEl.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

// Where to draw the roll hexagon and the target bubble. If the roll is exactly
// the threshold, show only the hexagon. Otherwise show both; when they'd overlap,
// nudge them apart horizontally (fudging exact position) so both numbers stay legible.
const HEX_W = 23;
const BUBBLE_W = 16;
const markers = computed(() => {
  const g = gauge.value;
  if (!g) return null;

  // When the roll lands exactly on the threshold the "N+" badge would sit right under the
  // hexagon, so instead of a separate badge we render it concentric and peeking out behind
  // the hex (see `coincident`). Otherwise it's a distinct badge at the boundary.
  const hasThreshold = g.threshold != null;
  const coincident = hasThreshold && g.roll === g.threshold;
  const showBubble = hasThreshold && !coincident;
  let hexPct = g.rollPct;
  let bubblePct = g.boundaryPct;

  if (gaugeWidth.value > 0) {
    const w = gaugeWidth.value;
    const hexEdge = (HEX_W / 2 / w) * 100;
    const bubbleEdge = (BUBBLE_W / 2 / w) * 100;

    if (showBubble) {
      // If they'd overlap, separate them by the min gap (keeping the hexagon on its side).
      const minGapPct = ((HEX_W / 2 + BUBBLE_W / 2 + 3) / w) * 100;
      if (Math.abs(hexPct - bubblePct) < minGapPct) {
        const mid = (hexPct + bubblePct) / 2;
        const hexOnRight = g.roll > g.threshold;
        hexPct = mid + (hexOnRight ? minGapPct / 2 : -minGapPct / 2);
        bubblePct = mid + (hexOnRight ? -minGapPct / 2 : minGapPct / 2);
      }
      // Shift the pair as a unit so BOTH stay fully inside the bar (preserves the gap).
      const rightOver = Math.max(hexPct + hexEdge, bubblePct + bubbleEdge) - 100;
      if (rightOver > 0) { hexPct -= rightOver; bubblePct -= rightOver; }
      const leftOver = Math.min(hexPct - hexEdge, bubblePct - bubbleEdge);
      if (leftOver < 0) { hexPct -= leftOver; bubblePct -= leftOver; }
    } else {
      // Single hexagon: just keep it within the bar.
      hexPct = Math.max(hexEdge, Math.min(100 - hexEdge, hexPct));
    }
  }

  // For the coincident case the bubble rides directly under the (clamped) hexagon.
  return { showBubble, coincident, hexPct, bubblePct: coincident ? hexPct : bubblePct };
});

const isSingleRunner = computed(() => {
  if (!props.details) return true;
  return !props.details.attempts || props.details.attempts.length <= 1;
});

const outcomeText = computed(() => {
  if (!props.details) return '';
  // Just SAFE / OUT (no base) to keep the box narrow.
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
  if (!props.details) return {};
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

// Aligned-column layout: "Throw  {roll} +{defense}" / "vs.  {target}".
const rollLabel = computed(() => {
    if (rollDetails.value.throwToBase && !isSingleRunner.value) {
        const baseDisplay = rollDetails.value.throwToBase === 4 ? 'Home' : `${rollDetails.value.throwToBase}B`;
        return `Throw ${baseDisplay}`;
    }
    return 'Throw:';
});
const rollMath = computed(() => `${rollDetails.value.roll} +${rollDetails.value.defense}`);

const targetInfo = computed(() => {
    // This part handles advances/tag-ups from 'throwRollResult'
    if (rollDetails.value.baseSpeed !== undefined) {
        let result = `${rollDetails.value.baseSpeed}`;
        if (rollDetails.value.adjustments && Array.isArray(rollDetails.value.adjustments)) {
            rollDetails.value.adjustments.forEach(adj => {
                if (adj.value > 0) {
                    result += ` +${adj.value}`;
                } else if (adj.value < 0) {
                    result += ` ${adj.value}`;
                }
            });
        }
        return result;
    }

    // This is the fallback, which handles 'lastStealResult' (single steals)
    // and also the contested runner in 'throwRollResult' for double steals.
    let result = `${rollDetails.value.target}`;
    if (rollDetails.value.penalty && rollDetails.value.penalty > 0) {
        result += ` -${rollDetails.value.penalty}`;
    }
    return result;
});

</script>

<template>
  <div class="throw-roll-result" :class="{ 'shift-up': shiftUp }" :style="{ backgroundColor: teamColors.primary, borderColor: teamColors.secondary, color: textColor }">
    <div class="throw-info">
      <template v-if="rollDetails.summary">{{ rollInfo }} vs. {{ targetInfo }}</template>
      <div v-else class="throw-grid">
        <span class="throw-key">{{ rollLabel }}</span><span class="throw-val">{{ rollMath }}</span>
        <span class="throw-key">Target:</span><span class="throw-val">{{ targetInfo }}</span>
      </div>
    </div>
    <div class="outcome">{{ outcomeText }}</div>
    <div v-if="gauge" ref="gaugeEl" class="throw-gauge">
      <div
        class="throw-gauge-zone safe"
        :class="{ dim: gauge.isOut }"
        :style="{ width: gauge.boundaryPct + '%' }"
      ></div>
      <div
        class="throw-gauge-zone out"
        :class="{ dim: !gauge.isOut }"
        :style="{ left: gauge.boundaryPct + '%', width: (100 - gauge.boundaryPct) + '%' }"
      ></div>
      <div
        v-if="markers.showBubble || markers.coincident"
        class="throw-gauge-boundary"
        :class="{ coincident: markers.coincident }"
        :style="{ left: markers.bubblePct + '%' }"
      >{{ gauge.threshold }}+</div>
      <div class="throw-gauge-marker" :style="{ left: markers.hexPct + '%' }">
        <span class="throw-gauge-marker-inner">{{ gauge.roll }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.throw-roll-result {
  opacity: 0.95;
  position: absolute;
  /* Sits low enough that its top clears the bottom of the first-base runner card above it. */
  bottom: 28px;
  left: 70%;
  transform: translateX(-50%);
  padding: 0.45rem 0.8rem;
  border: 1px solid;
  border-radius: 0px;
  text-align: center;
  font-size: 1rem;
  z-index: 10;
  box-shadow: 0 0px 0px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
}

.throw-info {
  line-height: 1.2;
}
/* Two aligned columns (labels left, numbers left), centered as a block. */
.throw-grid {
  display: grid;
  grid-template-columns: auto auto;
  column-gap: 0.5rem;
  justify-content: center;
}
.throw-grid .throw-key {
  text-align: left;
}
.throw-grid .throw-val {
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.outcome {
  font-size: 1.5rem;
  font-weight: bold;
  margin-top: 0.25rem;
}

/* Nudged right of the center home runner and pushed down (so the taller box clears
   the first-base card above it) when a home-plate card shows. */
.throw-roll-result.shift-up {
  transform: translateX(-50%) translate(54px, 12px);
}

/* Roll gauge: 1 → 20 across the bottom of the box. Green = safe zone,
   red = out zone; the zone matching the outcome stays vivid while the other
   dims, and a white hexagon holding the roll marks where it landed. */
.throw-gauge {
  position: relative;
  height: 6px;
  margin-top: 9px;
  margin-bottom: 7px;
}
/* Badge at the green/red boundary: the target roll for an out ("9+"). The "+"
   and round (vs hexagon) shape distinguish it from the actual roll marker. */
.throw-gauge-boundary {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  min-width: 16px;
  height: 15px;
  padding: 0 4px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 999px;
  font-size: 0.5rem;
  font-weight: 700;
  line-height: 1;
  color: #1f2330;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}
/* Roll landed exactly on the target: the bubble sits concentric behind the hexagon (which
   paints over it) and is enlarged so its rounded ends peek past the hex's left/right points,
   signalling the roll matched the target exactly. Its number lives in the hexagon on top. */
.throw-gauge-boundary.coincident {
  min-width: 33px;
  height: 20px;
  padding: 0;
  background: #ffffff;
  color: transparent;
}
.throw-gauge-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  transition: opacity 0.3s ease;
}
.throw-gauge-zone.safe {
  left: 0;
  background: #3ec46d;
  border-radius: 3px 0 0 3px;
}
.throw-gauge-zone.out {
  background: #e4513e;
  border-radius: 0 3px 3px 0;
}
.throw-gauge-zone.dim {
  opacity: 0.25;
}
/* Roll marker: a white hexagon with a black outline. The outline is a slightly
   larger black hexagon behind the white one (a border would be clipped away). */
.throw-gauge-marker {
  position: absolute;
  top: 50%;
  width: 23px;
  height: 20px;
  transform: translate(-50%, -50%);
  background: #000000;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.45));
  transition: left 0.4s ease;
}
.throw-gauge-marker-inner {
  width: 21px;
  height: 18px;
  background: #ffffff;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.58rem;
  font-weight: 800;
  line-height: 1;
  color: #1f2330;
}
</style>
