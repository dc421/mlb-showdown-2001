<script setup>
import PlayerCard from './PlayerCard.vue';
import PlayerLeagueCard from './PlayerLeagueCard.vue';

defineProps({ player: Object });
const emit = defineEmits(['close']);
</script>

<template>
    <div v-if="player" class="pcm-overlay" @click.self="emit('close')">
        <div class="pcm-pair" @click.stop>
            <button class="pcm-close" @click="emit('close')" aria-label="Close">×</button>
            <div class="pcm-col"><PlayerCard :player="player" /></div>
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
</style>
