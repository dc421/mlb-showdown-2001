<script setup>
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { buildNameResolver } from '@/utils/newspaperNames';

// Newspaper-style cumulative box score for one team across a whole series. Takes an already-aggregated
// side ({ batting, pitching, totals }) from aggregateSeriesBoxScore — it does no folding itself.
const props = defineProps({
  side: { type: Object, required: true },   // { batting, pitching, totals }
  team: { type: Object, default: null },    // series team ({ city, name, logo_url })
  color: { type: String, default: '#1a1a1a' },
  cardMap: { type: Object, default: null }, // optional Map<cardId, card> so names open the card modal
});
const emit = defineEmits(['select-player']);

const authStore = useAuthStore();

const teamName = computed(() => {
  const t = props.team;
  if (!t) return 'Team';
  return t.city ? `${t.city} ${t.name}` : (t.name || t.abbreviation || 'Team');
});

// Deterministic names resolved against the full player pool (same rule as the in-game box score).
const resolver = computed(() => buildNameResolver(authStore.allPlayers));
const nameFor = (row) => resolver.value(row.cardId, row.name);

// Blank instead of 0 for occasional counting stats (2B/3B/HR/SB/CS, GS/S) — the line reads far cleaner.
const z = (n) => (n ? n : '');
// Combined win–loss record; blank when the pitcher earned no decision.
const wl = (p) => ((p.w || p.l) ? `${p.w}-${p.l}` : '');

const selectPlayer = (cardId) => {
  const c = props.cardMap && props.cardMap.get(cardId);
  if (c) emit('select-player', c);
};

const hasData = computed(() =>
  !!props.side && (props.side.batting.length > 0 || props.side.pitching.length > 0));
</script>

<template>
  <div class="np-box" v-if="hasData">
    <div class="np-headline">
      <span class="np-team" :style="{ color }">{{ teamName }}</span>
      <span class="np-runs">{{ side.totals.r }}</span>
    </div>

    <div class="np-scroll">
      <table class="np-table">
        <thead>
          <tr>
            <th class="np-name">Batting</th>
            <th>G</th><th>AB</th><th>R</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>RBI</th><th>BB</th><th>SO</th><th>SB</th><th>CS</th>
            <th class="np-rate">AVG</th><th class="np-rate">OBP</th><th class="np-rate">SLG</th><th class="np-rate">OPS</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in side.batting" :key="b.cardId">
            <td class="np-name"><span class="np-click" @click="selectPlayer(b.cardId)">{{ nameFor(b) }}</span></td>
            <td>{{ b.games }}</td><td>{{ b.ab }}</td><td>{{ b.r }}</td><td>{{ b.h }}</td>
            <td>{{ z(b.doubles) }}</td><td>{{ z(b.triples) }}</td><td>{{ z(b.hr) }}</td><td>{{ b.rbi }}</td><td>{{ b.bb }}</td><td>{{ b.so }}</td><td>{{ z(b.sb) }}</td><td>{{ z(b.cs) }}</td>
            <td class="np-rate">{{ b.avg }}</td><td class="np-rate">{{ b.obp }}</td><td class="np-rate">{{ b.slg }}</td><td class="np-rate np-ops">{{ b.ops }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="np-name">Totals</td>
            <td></td>
            <td>{{ side.totals.ab }}</td><td>{{ side.totals.r }}</td><td>{{ side.totals.h }}</td>
            <td>{{ z(side.totals.doubles) }}</td><td>{{ z(side.totals.triples) }}</td><td>{{ z(side.totals.hr) }}</td><td>{{ side.totals.rbi }}</td><td>{{ side.totals.bb }}</td><td>{{ side.totals.so }}</td><td>{{ z(side.totals.sb) }}</td><td>{{ z(side.totals.cs) }}</td>
            <td class="np-rate">{{ side.totals.avg }}</td><td class="np-rate">{{ side.totals.obp }}</td><td class="np-rate">{{ side.totals.slg }}</td><td class="np-rate np-ops">{{ side.totals.ops }}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="np-scroll">
      <table class="np-table np-pitching">
        <thead>
          <tr>
            <th class="np-name">Pitching</th>
            <th>G</th><th>GS</th><th>W-L</th><th>S</th><th>IP</th><th>H</th><th>ER</th><th>BB</th><th>SO</th>
            <th class="np-rate">ERA</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in side.pitching" :key="p.cardId">
            <td class="np-name"><span class="np-click" @click="selectPlayer(p.cardId)">{{ nameFor(p) }}</span></td>
            <td>{{ p.games }}</td><td>{{ z(p.gs) }}</td><td>{{ wl(p) }}</td><td>{{ z(p.s) }}</td>
            <td>{{ p.ip }}</td><td>{{ p.h }}</td><td>{{ p.er }}</td><td>{{ p.bb }}</td><td>{{ p.so }}</td>
            <td class="np-rate">{{ p.era }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="np-name">Totals</td>
            <td></td><td></td>
            <td>{{ wl(side.pitchingTotals) }}</td><td>{{ z(side.pitchingTotals.s) }}</td>
            <td>{{ side.pitchingTotals.ip }}</td><td>{{ side.pitchingTotals.h }}</td><td>{{ side.pitchingTotals.er }}</td>
            <td>{{ side.pitchingTotals.bb }}</td><td>{{ side.pitchingTotals.so }}</td>
            <td class="np-rate">{{ side.pitchingTotals.era }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.np-box {
  background: #f9f9f9;
  padding: 0.9rem 1rem;
  border-radius: 8px;
  width: 100%;
  color: #1a1a1a;
}

.np-headline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  font-family: Georgia, 'Times New Roman', serif;
  border-bottom: 2px solid #1a1a1a;
  padding-bottom: 0.3rem;
  margin-bottom: 0.4rem;
}
.np-team { font-size: 1.2rem; font-weight: 700; letter-spacing: 0.01em; }
.np-runs { font-size: 1.2rem; font-weight: 700; }

/* Keep wide tables from ever breaking the page layout on narrow screens. */
.np-scroll { overflow-x: auto; }

/* Size to content, not the full container: otherwise the greedy name column absorbs all the slack
   and strands the stats far out to the right. Content width keeps them snug against the names. */
.np-table {
  width: auto;
  border-collapse: collapse;
  font-family: 'Courier New', monospace;
  font-size: 0.8rem;
  line-height: 1.4;
}
.np-table th,
.np-table td {
  text-align: right;
  padding: 0.03rem 0.4rem;
  white-space: nowrap;
}
.np-table th {
  font-weight: normal;
  color: #666;
  border-bottom: 1px solid #cfcfcf;
}
.np-table .np-name {
  text-align: left;
  width: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: 0;
  padding-right: 1.5rem; /* the one deliberate gap between names and the first stat column */
}
.np-click { cursor: pointer; }
.np-click:hover { text-decoration: underline; }
.np-table thead .np-name {
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  color: #1a1a1a;
}
.np-table tfoot td {
  border-top: 1px solid #1a1a1a;
  font-weight: 700;
}
/* Rate stats (AVG/OBP/SLG/OPS, ERA) set apart in a muted tone; OPS reads as the summary figure. */
.np-rate { color: #555; }
.np-ops { color: #1a1a1a; font-weight: 700; }

.np-pitching { margin-top: 0.75rem; }
</style>
