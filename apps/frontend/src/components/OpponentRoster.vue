<script setup>
import { computed } from 'vue';
import { sortRoster } from '@/utils/playerUtils';

const props = defineProps({
  roster: { type: Array, default: () => [] },
  title: { type: String, default: 'Opponent Roster' }
});

const emit = defineEmits(['view']);

// Mirror the dashboard's roster presentation: derive display fields, scale bench
// points, then sort by position so it reads the same way across the app.
const processedRoster = computed(() => {
  const roster = JSON.parse(JSON.stringify(props.roster || []));

  roster.forEach(p => {
    if (!p.displayName && p.display_name) p.displayName = p.display_name;
    if (!p.displayPosition) {
      if (p.control !== null) {
        p.displayPosition = Number(p.ip) > 3 ? 'SP' : 'RP';
      } else {
        const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings).join(',') : 'DH';
        p.displayPosition = positions.replace(/LFRF/g, 'LF/RF');
      }
    }

    if (p.assignment === 'BENCH') {
      p.assignment = 'B';
      if (p.points) p.points = Math.round(p.points / 5);
    }
  });

  return sortRoster(roster);
});

function positionLabel(player) {
  return player.assignment === 'PITCHING_STAFF'
    ? (player.displayPosition || player.position)
    : (player.assignment || player.displayPosition || player.position);
}

const totalPoints = computed(() =>
  processedRoster.value.reduce((sum, p) => sum + (Number(p.points) || 0), 0)
);
</script>

<template>
  <div class="opponent-roster">
    <h2>{{ title }}</h2>
    <p v-if="processedRoster.length === 0" class="empty-text">Opponent's roster isn't available yet.</p>
    <div v-else class="roster-table-container">
      <table class="roster-table">
        <thead>
          <tr>
            <th class="header-pos">Pos</th>
            <th class="header-player">Player</th>
            <th class="header-points">Points</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="player in processedRoster" :key="player.card_id" class="player-row" @click="emit('view', player)">
            <td class="pos-cell">{{ positionLabel(player) }}</td>
            <td class="name-cell">{{ player.displayName || player.name }}</td>
            <td class="points-cell">{{ player.points }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="2" class="total-label">Total</td>
            <td class="total-points">{{ totalPoints }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.opponent-roster h2 { margin-top: 0; }
.empty-text { font-style: italic; color: #888; }

.roster-table-container { overflow-x: auto; }
.roster-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.roster-table th {
  text-align: left;
  padding: 0.4rem;
  background: #e9ecef;
  color: #495057;
  font-weight: 600;
}
.header-points { text-align: right !important; }
.roster-table td { padding: 0.25rem 0.5rem; border-bottom: 1px solid #dee2e6; }
.player-row { cursor: pointer; transition: background-color 0.2s; }
.player-row:hover { background-color: #e2e6ea; }
.points-cell { font-weight: bold; color: #000; text-align: right; }
.total-row td {
  border-top: 2px solid #aaa;
  padding: 0.5rem 0.25rem;
  font-weight: bold;
  background-color: #f1f3f5;
}
.total-label { text-align: right; padding-right: 1rem; }
.total-points { text-align: right; }
</style>
