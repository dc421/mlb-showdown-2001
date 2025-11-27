<script setup>
import { computed, watch } from 'vue';

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
  }
});

watch(() => props.player, (newPlayer, oldPlayer) => {
  const newName = newPlayer ? newPlayer.name : 'null';
  const oldName = oldPlayer ? oldPlayer.name : 'null';
  console.log(`--- 3. PlayerCard prop CHANGED from ${oldName} to ${newName} ---`);
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
      :src="player.image_url" 
      :alt="player.name" 
      class="card-image"
      @error="handleImageError"
    />
    <!-- Fatigue Indicator -->
    <div
      v-if="showFatigueIndicator"
      class="fatigue-indicator"
    >
      {{ fatigueIndicatorText }}
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

/* NEW: The border and glow now use the CSS variable */
.advantage {
  border-color: var(--advantage-color);
  box-shadow: 0 0 20px var(--advantage-color);
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
</style>