<script setup>
import { computed } from 'vue';

const props = defineProps({
  player: {
    type: Object,
    required: true,
  },
  slotName: {
    type: String,
    default: null,
  },
  actionType: {
    type: String,
    default: 'none', // 'add', 'remove', 'none'
  },
  isUnavailable: {
    type: Boolean,
    default: false,
  },
  unavailabilityReason: {
    type: String,
    default: '',
  },
  isIllegal: {
    type: Boolean,
    default: false,
  }
});

const emit = defineEmits(['action', 'view-card']);

const isLongName = computed(() => {
  const nameLen = props.player.displayName ? props.player.displayName.length : 0;
  const posLen = props.player.displayPosition ? props.player.displayPosition.length : 0;
  // (Name + Position + 3 chars for " ()") > 20
  return (nameLen + posLen + 3) > 20;
});

function handleAction() {
    emit('action', props.player);
}
</script>

<template>
  <div
    class="player-row"
    :class="{ 'unavailable': isUnavailable, 'illegal-placement': isIllegal }"
  >
    <div class="player-left">
        <span v-if="slotName" class="slot-name">{{ slotName }}:</span>

        <div class="player-info">
            <span
                class="player-name"
                :class="{
                    'owned-player-text': player.isOwnedByOther,
                    'long-name': isLongName
                }"
            >
                {{ player.displayName }} ({{ player.displayPosition }})
            </span>

            <img
                v-if="player.isOwnedByOther"
                :src="player.owned_by_team_logo"
                class="owning-team-logo"
                :title="player.owned_by_team_name"
            />

            <span class="view-icon" @click.stop="emit('view-card', player)" title="View Card">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </span>
        </div>
    </div>

    <div class="player-actions">
        <span v-if="isUnavailable" class="owned-label">{{ unavailabilityReason || 'Unavailable' }}</span>
        <span v-else class="points-label">{{ player.points }} pts</span>

        <button
            v-if="!isUnavailable && actionType === 'add'"
            @click.stop="handleAction"
            class="action-btn add-btn"
            title="Add to Roster"
        >+</button>

        <button
            v-if="actionType === 'remove'"
            @click.stop="handleAction"
            class="action-btn remove-btn"
            title="Remove from Roster"
        >−</button>
    </div>
  </div>
</template>

<style scoped>
.player-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    cursor: grab;
    border-bottom: 1px solid #eee;
    background: white;
    min-height: 42px; /* Ensure consistency */
    box-sizing: border-box;
}

.player-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden; /* Prevent text overflow */
}

.slot-name {
    font-weight: bold;
    min-width: 30px; /* Align names if slots are short */
    font-size: 0.9em;
}

.player-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
}

.player-name {
    /* Default font size implied */
}

.long-name {
    font-size: 0.85em;
    letter-spacing: -0.5px;
}

.owned-player-text {
    color: #888;
}

.owning-team-logo {
    height: 20px;
    width: auto;
    vertical-align: middle;
}

.view-icon {
    cursor: pointer;
    color: #6c757d;
    display: flex;
    align-items: center;
}
.view-icon:hover {
    color: #007bff;
}

.player-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto; /* Push to right */
    padding-left: 0.5rem;
}

.points-label {
    white-space: nowrap;
}

.owned-label {
    font-size: 0.8em;
    color: #dc3545;
    font-weight: bold;
}

.action-btn {
    color: white;
    border: none;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    font-size: 16px;
    line-height: 22px; /* Center vertically */
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;
}

.add-btn {
    background: #28a745;
}

.remove-btn {
    background: #dc3545;
}

.unavailable {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: #eee;
}

.illegal-placement {
    background-color: #ffe6e6; /* Light red */
}

/* Hover effects for remove */
.player-row:hover .remove-btn {
    opacity: 1;
}
</style>
