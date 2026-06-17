<script setup>
import { computed } from 'vue';

// A brief home-run celebration: a full-screen dim that darkens everything (including the
// diamond field) while the parent keeps the runner cards and the HR result box lit above
// it, the ball launching over the wall, and a screenful of firework bursts in the batting
// team's colors.
const props = defineProps({
  active: { type: Boolean, default: false },
  // Ball over the wall — home runs only (skipped for non-HR walk-off hits).
  showBall: { type: Boolean, default: true },
  // Fireworks — home-team hitter only.
  showFireworks: { type: Boolean, default: true },
  // Optional big banner slammed across the screen (e.g. "DING DANG DONGER!" for Detroit).
  bannerText: { type: String, default: '' },
  // Batting team colors — drive the firework hues.
  teamColors: {
    type: Object,
    default: () => ({ primary: '#1f6feb', secondary: '#ffffff' }),
  },
});

// Banner split into words so each can zoom in one at a time (DING → DANG → DONGER).
const bannerWords = computed(() => props.bannerText.split(/\s+/).filter(Boolean));
// Banner in the batting team's colors: fill with primary, outline with secondary.
const bannerStyle = computed(() => ({
  color: props.teamColors?.primary || '#fff',
  WebkitTextStroke: `2.5px ${props.teamColors?.secondary || 'rgba(0, 0, 0, 0.7)'}`,
}));

const SPARKS_PER_BURST = 26;

// Build one burst's rays: evenly spaced with a little angle/length jitter so the burst
// edge is organic rather than a perfect circle.
function buildSparks(radius, color) {
  const sparks = [];
  for (let i = 0; i < SPARKS_PER_BURST; i++) {
    const angle = (360 / SPARKS_PER_BURST) * i + (Math.random() * 8 - 4);
    const len = Math.round(radius * (0.78 + Math.random() * 0.22));
    sparks.push({ angle, len, color });
  }
  return sparks;
}

// Many bursts spread across the upper ~two-thirds of the viewport, staggered in time,
// varying in size (radius), alternating the team's primary/secondary colors.
const fireworks = computed(() => {
  const p = props.teamColors.primary;
  const s = props.teamColors.secondary;
  const specs = [
    { top: '18%', left: '15%', radius: 150, delay: 0, color: p },
    { top: '11%', left: '38%', radius: 190, delay: 200, color: s },
    { top: '23%', left: '62%', radius: 165, delay: 110, color: p },
    { top: '14%', left: '85%', radius: 175, delay: 320, color: s },
    { top: '43%', left: '23%', radius: 140, delay: 460, color: s },
    { top: '47%', left: '77%', radius: 155, delay: 380, color: p },
    { top: '30%', left: '50%', radius: 210, delay: 640, color: s },
    { top: '57%', left: '12%', radius: 125, delay: 780, color: p },
    { top: '59%', left: '88%', radius: 130, delay: 720, color: s },
    { top: '26%', left: '7%', radius: 120, delay: 960, color: s },
    { top: '20%', left: '93%', radius: 120, delay: 1040, color: p },
    { top: '37%', left: '40%', radius: 180, delay: 1220, color: p },
    { top: '50%', left: '59%', radius: 160, delay: 1360, color: s },
    { top: '13%', left: '55%', radius: 160, delay: 1560, color: p },
  ];
  return specs.map((fw, id) => ({ id, ...fw, sparks: buildSparks(fw.radius, fw.color) }));
});
</script>

<template>
  <div v-if="active" class="hr-celebration" aria-hidden="true">
    <!-- Full-screen dim. The parent lifts the runner cards + HR box above this. -->
    <div class="hr-dim"></div>

    <!-- Ball launched from home plate, arcing up and out over the wall. Each nested element
         owns one motion (X / Y / scale+spin) so every easing curve stays continuous. -->
    <div v-if="showBall" class="hr-ball-x">
      <div class="hr-ball-y">
        <div class="hr-ball-scale">⚾</div>
      </div>
    </div>

    <!-- Team-colored firework bursts across the whole screen. -->
    <div
      v-for="fw in (showFireworks ? fireworks : [])"
      :key="fw.id"
      class="hr-firework"
      :style="{ top: fw.top, left: fw.left, '--delay': fw.delay + 'ms' }"
    >
      <span
        v-for="(spark, i) in fw.sparks"
        :key="i"
        class="hr-spark"
        :style="{ '--angle': spark.angle + 'deg', '--len': spark.len + 'px', '--spark-color': spark.color }"
      ></span>
    </div>

    <!-- Big banner: each word zooms in one at a time, then all hold and fade together. -->
    <div v-if="bannerWords.length" class="hr-banner" :style="bannerStyle">
      <span
        v-for="(word, i) in bannerWords"
        :key="i"
        class="hr-banner-word"
        :style="{ animationDelay: (i * 0.4) + 's' }"
      >{{ word }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Wrapper is anchored to the diamond (for the ball), but has no z-index of its own so the
   dim/ball/fireworks z-indexes resolve against the page, not a trapped local context. */
.hr-celebration {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* --- Full-screen dim ------------------------------------------------------ */
.hr-dim {
  position: fixed;
  inset: 0;
  background: rgba(6, 9, 18, 0.85);
  z-index: 50;
  opacity: 0;
  animation: hr-dim 2.9s ease forwards;
}
@keyframes hr-dim {
  0% { opacity: 0; }
  10% { opacity: 1; }
  86% { opacity: 1; }
  100% { opacity: 0; }
}

/* --- Ball over the wall ---------------------------------------------------- */
/* Nested elements so the path is a real arc: X translates linearly, Y eases up. */
.hr-ball-x {
  position: absolute;
  left: 50%;
  top: 74%;
  z-index: 60;
  animation: hr-ball-x 1.8s linear forwards;
}
/* Vertical rise: one smooth ease-out, no intermediate keyframe (so the velocity never
   resets mid-flight, which is what read as a bounce). */
.hr-ball-y {
  animation: hr-ball-y 1.8s cubic-bezier(0.2, 0.55, 0.45, 1) forwards;
}
/* The glyph: grows (accelerating, so it's biggest as it leaves the park) and spins. */
.hr-ball-scale {
  font-size: 30px;
  line-height: 1;
  margin: -15px 0 0 -15px;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.5));
  animation: hr-ball-scale 1.8s ease-in forwards;
}
@keyframes hr-ball-x {
  0% { transform: translateX(0); opacity: 0; }
  6% { opacity: 1; }
  100% { transform: translateX(105px); opacity: 1; }
}
@keyframes hr-ball-y {
  0% { transform: translateY(0); }
  100% { transform: translateY(-255px); }
}
@keyframes hr-ball-scale {
  0% { transform: rotate(0deg) scale(0.6); opacity: 1; }
  82% { opacity: 1; }
  100% { transform: rotate(380deg) scale(2.6); opacity: 0; }
}

/* --- Fireworks ------------------------------------------------------------- */
/* The whole burst drifts gently downward as it fades — a willow/gravity droop. */
.hr-firework {
  position: fixed;
  width: 0;
  height: 0;
  z-index: 70;
  transform: translate(-50%, -50%);
  animation: hr-fw-gravity 1.2s ease-in var(--delay, 0ms) forwards;
}
@keyframes hr-fw-gravity {
  0% { transform: translate(-50%, -50%) translateY(0); }
  100% { transform: translate(-50%, -50%) translateY(26px); }
}

/* Bright core flash at the moment of the burst. */
.hr-firework::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 30px;
  height: 30px;
  margin: -15px 0 0 -15px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0%, rgba(255, 255, 255, 0.6) 35%, rgba(255, 255, 255, 0) 70%);
  mix-blend-mode: screen;
  opacity: 0;
  animation: hr-flash 0.55s ease-out var(--delay, 0ms) forwards;
}

/* Each spark is a ray that shoots out from the burst center: bright glowing tip with a
   trailing tail back toward the center. It grows out (scaleY) then fades. */
.hr-spark {
  position: absolute;
  top: 0;
  left: -1.5px;
  width: 3px;
  height: var(--len, 120px);
  transform-origin: top center;
  transform: rotate(var(--angle, 0deg)) scaleY(0);
  border-radius: 3px;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0) 0%,
    var(--spark-color, #fff) 45%,
    #ffffff 100%
  );
  filter: drop-shadow(0 0 5px var(--spark-color, #fff));
  mix-blend-mode: screen;
  opacity: 0;
  animation: hr-ray 1.2s cubic-bezier(0.1, 0.7, 0.3, 1) var(--delay, 0ms) forwards;
}
@keyframes hr-flash {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; transform: scale(1.1); }
  100% { opacity: 0; transform: scale(2); }
}
@keyframes hr-ray {
  0% { opacity: 0; transform: rotate(var(--angle)) scaleY(0); }
  8% { opacity: 1; }
  50% { opacity: 1; transform: rotate(var(--angle)) scaleY(1); }
  100% { opacity: 0; transform: rotate(var(--angle)) scaleY(1.12); }
}

/* --- Banner --------------------------------------------------------------- */
/* The container holds the words on one line and fades the whole group out at the end;
   each word zooms in on its own (staggered) delay and then holds. */
.hr-banner {
  position: fixed;
  top: 34%;
  left: 0;
  right: 0;
  z-index: 80;
  padding: 0 1rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.1em 0.4em;
  text-align: center;
  font-family: 'Arial Black', 'Helvetica Neue', sans-serif;
  font-weight: 900;
  font-size: clamp(2.25rem, 8.5vw, 6.5rem);
  line-height: 1.02;
  letter-spacing: 2px;
  color: #fff;
  text-shadow: 0 0 22px rgba(0, 0, 0, 0.85), 0 5px 0 rgba(0, 0, 0, 0.45);
  -webkit-text-stroke: 2px rgba(0, 0, 0, 0.7);
  pointer-events: none;
  animation: hr-banner-fade 2.9s ease forwards;
}
.hr-banner-word {
  display: inline-block;
  opacity: 0;
  transform: scale(2.6);
  animation: hr-word-zoom 0.5s cubic-bezier(0.2, 1.3, 0.35, 1) both;
}
@keyframes hr-banner-fade {
  0% { opacity: 1; }
  82% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes hr-word-zoom {
  0% { opacity: 0; transform: scale(2.6); }
  65% { opacity: 1; transform: scale(0.92); }
  100% { opacity: 1; transform: scale(1); }
}

/* Respect reduced-motion: keep the dim, drop the launch/burst motion. */
@media (prefers-reduced-motion: reduce) {
  .hr-banner { animation: none; }
  .hr-banner-word { animation: none; opacity: 1; transform: none; }
  .hr-ball-x,
  .hr-ball-y,
  .hr-ball-scale,
  .hr-spark,
  .hr-firework,
  .hr-firework::before {
    animation: none;
  }
  .hr-ball-x,
  .hr-spark,
  .hr-firework::before {
    opacity: 0;
  }
}
</style>
