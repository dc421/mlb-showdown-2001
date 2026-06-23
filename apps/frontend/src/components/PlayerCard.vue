<script setup>
import { computed, watch, onMounted } from 'vue';
import { ensureCaptaincies, cardBadges } from '@/services/captaincy';

const props = defineProps({
  player: Object,
  role: String,
  battingOrderPosition: Number,
  defensivePosition: String,
  pitchResult: Object,
  hasAdvantage: {
    type: Boolean,
    default: null
  },
  // NEW: A prop to accept the team's primary color
  primaryColor: {
    type: String,
    default: '#ffc107' // Default to gold if no color is provided
  },
  isControlledPlayer: {
    type: Boolean,
    default: false
  },
  // When false, hide the on-card overlays (e.g. the fatigue marker) to show the
  // unaltered card image. Defaults to true so existing usages are unchanged.
  showOverlays: {
    type: Boolean,
    default: true
  },
  // Optional franchise context for the captaincy badges. When set, badges resolve
  // for this exact team; otherwise they're inferred from the card's current marks.
  teamId: { type: [Number, String], default: null }
});

// Captaincy badges (captain "C", core squad "CS", Face logo), resolved from the
// shared captaincy store. Hidden when overlays are off (e.g. "view original card").
onMounted(ensureCaptaincies);
const badges = computed(() =>
  props.showOverlays && props.player ? cardBadges(props.player.card_id, props.teamId)
    : { faces: [], coreSquads: [], captain: null }
);

watch(() => props.player, (newPlayer, oldPlayer) => {
  const newName = newPlayer ? newPlayer.name : 'null';
  const oldName = oldPlayer ? oldPlayer.name : 'null';
  console.log(`--- 3. PlayerCard prop CHANGED from ${oldName} to ${newName} ---`);
});

const imageUrl = computed(() => {
  console.log("VITE_API_URL is:", import.meta.env.VITE_API_URL); // Check your browser console!
  if (!props.player?.image_url) return '';
  if (props.player.image_url.startsWith('http')) return props.player.image_url;

  // 1. Try the environment variable first
  const envUrl = import.meta.env.VITE_API_URL;
  
  // 2. Define your Render URL explicitly as a backup
  // (Replace this string with your actual Render URL if different)
  const hardcodedUrl = 'https://mlb-showdown-2001.onrender.com';

  const baseUrl = envUrl || hardcodedUrl;

  return `${baseUrl}${props.player.image_url}`;
});

function handleImageError(event) {
  // Use a local, relative path to the replacement image
  event.target.src = '/images/replacement.jpg';
}

const isReplacementPitcher = computed(() => {
  return props.player && (props.player.card_id === 'replacement_pitcher' || props.player.card_id === -2);
});

const isTired = computed(() => {
  return props.player && typeof props.player.effectiveControl === 'number' && props.player.effectiveControl < props.player.control;
});

const showFatigueIndicator = computed(() => {
  if (isReplacementPitcher.value) {
    return typeof props.player.effectiveControl === 'number';
  }
  return isTired.value;
});

const fatigueIndicatorText = computed(() => {
  return props.player.effectiveControl;
});

const fieldingDisplay = computed(() => {
    if (!props.player?.fielding_ratings) return '';
    return Object.entries(props.player.fielding_ratings)
        .map(([pos, val]) => `${pos.replace(/LFRF/g, 'LF/RF')} ${val >= 0 ? '+' : ''}${val}`)
        .join(', ');
});

function formatRange(range) {
  const parts = range.split('-');
  return parts[0] === parts[1] ? parts[0] : range;
}
</script>

<template>
  <!-- This is the main container for the player card -->
  <div 
    class="player-card-container" 
    :class="{
      advantage: hasAdvantage === true,
      disadvantage: hasAdvantage === false,
      'controlled-player': isControlledPlayer
    }"
    :style="{ '--advantage-color': primaryColor }"
    v-if="player">
    
    <img 
      :src="imageUrl"
      :alt="player.name" 
      class="card-image"
      @error="handleImageError"
    />
    <!-- Fatigue Indicator -->
    <div
      v-if="showOverlays && showFatigueIndicator"
      class="fatigue-indicator"
    >
      {{ fatigueIndicatorText }}
    </div>
    <!-- Captaincy overlay layer: a full-bleed, out-of-flow container so badges can size
         relative to the card (cqw) without affecting the card's own layout. -->
    <div class="card-overlays">
    <!-- Face of the Franchise: one franchise logo per club this card is the Face of
         (top-left), on a team-color disc for franchises whose mark reads better that way. -->
    <div v-if="badges.faces.length" class="face-stack">
      <div
        v-for="(f, i) in badges.faces"
        :key="'face' + i"
        class="face-emblem"
        :class="{ 'face-emblem--disc': f.faceBg }"
        :style="f.faceBg ? { backgroundColor: f.faceBgColor, borderColor: f.faceBorderColor } : {}"
        title="Face of the Franchise"
      >
        <img :src="f.logo" class="face-emblem-img" alt="Face of the Franchise" />
      </div>
    </div>
    <!-- Bottom-left cluster: a Core Squad "CS" per club, then the captain "C". -->
    <div v-if="badges.coreSquads.length || badges.captain" class="badge-cluster">
      <div
        v-for="(c, i) in badges.coreSquads"
        :key="'cs' + i"
        class="coresquad-badge"
        :style="{ backgroundColor: c.primary, color: c.secondary, borderColor: c.secondary }"
        title="Core Squad"
      >CS</div>
      <div
        v-if="badges.captain"
        class="captain-letter"
        :style="{ color: badges.captain.secondary, '--cap-stroke': badges.captain.primary }"
        title="Captain"
      >C</div>
    </div>
    </div>
  </div>
  <div v-else class="player-card-container placeholder">
    <p>Loading {{ role }}...</p>
  </div>
</template>

<style scoped>
.player-card-container {
  /* This allows the card to shrink with the screen */
  width: 100%;
  max-width: 200px; /* It won't grow larger than this */

  /* This automatically calculates the height to maintain the card's shape */
  aspect-ratio: 220 / 308;

  position: relative;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  overflow: hidden;
  background-color: #e9ecef;
  transition: all 0.3s ease-in-out;
  border: 1px solid transparent;
}
.placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  color: #6c757d;
}
.card-image {
  width: 100%;
  height: 100%;
  object-fit: contain; 
  display: block;
  filter: contrast(1.1) brightness(1.05);
  transition: filter 0.3s ease-in-out;
}

/* NEW: The border and glow now use the CSS variable. A one-shot "pop" fires the instant
   the card gains the advantage (the class is applied), then it rests on the steady glow. */
.advantage {
  border-color: var(--advantage-color);
  box-shadow: 0 0 20px var(--advantage-color);
  animation: advantage-pop 0.35s ease-out;
}
@keyframes advantage-pop {
  0% { transform: scale(1); box-shadow: 0 0 20px var(--advantage-color); }
  55% { transform: scale(1.06); box-shadow: 0 0 32px var(--advantage-color); }
  100% { transform: scale(1); box-shadow: 0 0 20px var(--advantage-color); }
}
@media (prefers-reduced-motion: reduce) {
  .advantage { animation: none; }
}

.disadvantage .card-image {
  filter: grayscale(100%) contrast(1.1) brightness(1.05);
}

.fatigue-indicator {
  position: absolute;
  top: 13.5%;
  right: 9%;
  transform: translate(50%, -50%);
  width: 14%;
  aspect-ratio: 1 / 1; /* Ensures the element is always a perfect circle */
  background-color: red;
  border: 1px solid white;
  border-radius: 50%;
  color: white;
  font-weight: bold;
  display: flex;
  justify-content: center;
  align-items: center;
  /*
    Fluid font size:
    - Minimum size: 0.75rem (12px)
    - Scales with 4% of the viewport width
    - Maximum size: 1.375rem (22px)
  */
  font-size: clamp(0.75rem, 4vw, 1.375rem);
  box-shadow: 0 0 5px rgba(0,0,0,0.7);
}

/* Out-of-flow overlay layer that fills the card. It carries the container context
   (so badges can use cqw) without contributing to the card's own sizing — keeping
   the card from collapsing in content-sized layouts (e.g. the game grid). */
.card-overlays {
  position: absolute;
  inset: 0;
  container-type: inline-size;
  pointer-events: none;
}

/* Face of the Franchise: one logo per club, in a top-left row. */
.face-stack {
  position: absolute;
  top: 4%;
  left: 4%;
  display: flex;
  gap: 3cqw;
  pointer-events: none;
}
.face-emblem {
  width: 30cqw;
  aspect-ratio: 1 / 1;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.face-emblem-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55));
}
/* Team-color disc variant (e.g. Boston, the Colossus). */
.face-emblem--disc {
  border: 2px solid;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}
.face-emblem--disc .face-emblem-img { width: 76%; height: 76%; filter: none; }

/* Bottom-left cluster: core-squad "CS" badges then the captain "C". */
.badge-cluster {
  position: absolute;
  bottom: 4%;
  left: 5%;
  display: flex;
  align-items: flex-end;
  gap: 2cqw;
  pointer-events: none;
}

/* Captain: collegiate "letterman jacket" letter. */
.captain-letter {
  width: 30cqw;
  aspect-ratio: 1 / 1;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Graduate', Georgia, 'Times New Roman', serif;
  font-weight: 400; /* Graduate is a single heavy weight */
  font-size: 24cqw;
  line-height: 1;
  -webkit-text-stroke: 5px var(--cap-stroke);
  paint-order: stroke fill; /* keep the felt-edge stroke behind the fill */
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.55);
}

/* Core Squad: small badge. */
.coresquad-badge {
  width: 12cqw;
  aspect-ratio: 1 / 1;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid;
  border-radius: 50%;
  font-weight: 800;
  font-size: 5.5cqw;
  line-height: 1;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
</style>