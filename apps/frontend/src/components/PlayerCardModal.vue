<script setup>
import { ref, watch } from 'vue';
import PlayerCard from './PlayerCard.vue';
import PlayerLeagueCard from './PlayerLeagueCard.vue';

const props = defineProps({
  player: Object,
  // Optional franchise context so captaincy badges resolve for the right team.
  teamId: { type: [Number, String], default: null }
});
const emit = defineEmits(['close']);

// Lets the viewer flip the front card between the card with its in-game overlays
// (fatigue, etc.) and the unaltered original card art.
const showOriginal = ref(false);

// Always default a freshly opened card to the overlay view; don't carry over the
// toggle state from the previously viewed card.
watch(() => props.player?.card_id, () => { showOriginal.value = false; });
</script>

<template>
    <div v-if="player" class="pcm-overlay" @click.self="emit('close')">
        <div class="pcm-pair" @click.stop>
            <button class="pcm-toggle" @click="showOriginal = !showOriginal">
                {{ showOriginal ? 'Show overlays' : 'View original card' }}
            </button>
            <button class="pcm-close" @click="emit('close')" aria-label="Close">×</button>
            <div class="pcm-col"><PlayerCard :player="player" :show-overlays="!showOriginal" :team-id="teamId" /></div>
            <div class="pcm-col"><PlayerLeagueCard :card-id="player.card_id" :player-name="player.displayName || player.name" /></div>
        </div>
    </div>
</template>

<style scoped>
.pcm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2000;
    padding: 1rem;
    box-sizing: border-box;
}
.pcm-pair {
    position: relative;
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    justify-content: center;
    flex-wrap: wrap;
    max-height: 92vh;
}
/* Fixed-width columns keep the two cards side by side (back to the right of the
   front); they wrap to stacked only when the viewport is too narrow for both. */
.pcm-col { flex: 0 0 auto; width: 200px; }
.pcm-close {
    position: absolute;
    top: -34px;
    right: 0;
    background: none;
    border: none;
    color: #fff;
    font-size: 2rem;
    line-height: 1;
    cursor: pointer;
    padding: 0;
}
.pcm-close:hover { opacity: 0.8; }
.pcm-toggle {
    position: absolute;
    top: -34px;
    left: 0;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 6px;
    color: #fff;
    font-size: 0.8rem;
    line-height: 1;
    padding: 0.4rem 0.7rem;
    cursor: pointer;
    transition: background 0.15s ease;
}
.pcm-toggle:hover { background: rgba(255, 255, 255, 0.22); }
</style>
