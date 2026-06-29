<script setup>
import { ref, computed } from 'vue';
import { useGameStore } from '@/stores/game';
import Linescore from '@/components/Linescore.vue';

const gameStore = useGameStore();

const expanded = ref(false);
const showSplits = ref(false);

const boxScore = computed(() => gameStore.boxScore);

const sides = computed(() => {
  const bs = boxScore.value;
  if (!bs) return [];
  return [
    { key: 'away', abbr: gameStore.teams?.away?.abbreviation || 'AWAY', city: gameStore.teams?.away?.city || 'Away', data: bs.away },
    { key: 'home', abbr: gameStore.teams?.home?.abbreviation || 'HOME', city: gameStore.teams?.home?.city || 'Home', data: bs.home },
  ];
});

const hasData = computed(() =>
  !!boxScore.value && (boxScore.value.away.batting.length > 0 || boxScore.value.home.batting.length > 0));

// "h-ab" style split, or an em dash when the batter never saw that situation.
const split = (s) => (s && s.ab ? `${s.h}-${s.ab}` : '—');
const pitchSplit = (s) => (s && s.bf ? `${s.h}/${s.bf}` : '—');
</script>

<template>
  <div class="box-score" v-if="hasData">
    <button class="bs-header" @click="expanded = !expanded" :aria-expanded="expanded">
      <span class="bs-title">Box Score</span>
      <span class="bs-chevron" :class="{ open: expanded }">▾</span>
    </button>

    <transition name="bs-collapse">
      <div v-show="expanded" class="bs-body">
        <div class="bs-linescore">
          <Linescore />
        </div>

        <div class="bs-splits-toggle">
          <label>
            <input type="checkbox" v-model="showSplits" />
            Advantage splits
          </label>
        </div>

        <div class="bs-sides">
          <section v-for="side in sides" :key="side.key" class="bs-side">
            <h4 class="bs-side-title">{{ side.city }} Batting</h4>
            <table class="bs-table">
              <thead>
                <tr>
                  <th class="name-col">Batter</th>
                  <th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th><th>AVG</th>
                  <th v-if="showSplits" class="split-col" title="Hits-for-AB when the batter held the advantage">ADV</th>
                  <th v-if="showSplits" class="split-col" title="Hits-for-AB when the pitcher held the advantage">DIS</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="b in side.data.batting" :key="b.cardId">
                  <td class="name-col">
                    {{ b.shortName }}
                    <span v-if="b.hr" class="badge" title="Home runs">{{ b.hr > 1 ? `${b.hr} HR` : 'HR' }}</span>
                  </td>
                  <td>{{ b.ab }}</td><td>{{ b.r }}</td><td>{{ b.h }}</td><td>{{ b.rbi }}</td>
                  <td>{{ b.bb }}</td><td>{{ b.so }}</td><td>{{ b.avg }}</td>
                  <td v-if="showSplits" class="split-col">{{ split(b.adv) }}</td>
                  <td v-if="showSplits" class="split-col">{{ split(b.dis) }}</td>
                </tr>
                <tr v-if="side.data.batting.length === 0" class="empty-row">
                  <td :colspan="showSplits ? 10 : 8">No plate appearances yet.</td>
                </tr>
              </tbody>
              <tfoot v-if="side.data.batting.length">
                <tr>
                  <td class="name-col">Totals</td>
                  <td>{{ side.data.totals.ab }}</td><td>{{ side.data.totals.r }}</td>
                  <td>{{ side.data.totals.h }}</td><td>{{ side.data.totals.rbi }}</td>
                  <td>{{ side.data.totals.bb }}</td><td>{{ side.data.totals.so }}</td><td></td>
                  <td v-if="showSplits"></td><td v-if="showSplits"></td>
                </tr>
              </tfoot>
            </table>

            <h4 class="bs-side-title">{{ side.city }} Pitching</h4>
            <table class="bs-table">
              <thead>
                <tr>
                  <th class="name-col">Pitcher</th>
                  <th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>BF</th>
                  <th v-if="showSplits" class="split-col" title="Hits-allowed/PA when the pitcher held the advantage">ADV</th>
                  <th v-if="showSplits" class="split-col" title="Hits-allowed/PA when the batter held the advantage">DIS</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in side.data.pitching" :key="p.pitcherKey">
                  <td class="name-col">{{ p.shortName }}</td>
                  <td>{{ p.ip }}</td><td>{{ p.h }}</td><td>{{ p.r }}</td><td>{{ p.er }}</td>
                  <td>{{ p.bb }}</td><td>{{ p.so }}</td><td>{{ p.bf }}</td>
                  <td v-if="showSplits" class="split-col">{{ pitchSplit(p.adv) }}</td>
                  <td v-if="showSplits" class="split-col">{{ pitchSplit(p.dis) }}</td>
                </tr>
                <tr v-if="side.data.pitching.length === 0" class="empty-row">
                  <td :colspan="showSplits ? 10 : 8">—</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.box-score {
  width: 100%;
  margin: 0.75rem 0 0;
  background: #1e2430;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #f1f3f6;
  overflow: hidden;
}

.bs-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  background: transparent;
  border: none;
  color: #f1f3f6;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
}
.bs-header:hover { background: rgba(255, 255, 255, 0.04); }
.bs-chevron {
  transition: transform 0.2s ease;
  opacity: 0.7;
  font-size: 0.9rem;
}
.bs-chevron.open { transform: rotate(180deg); }

.bs-body {
  padding: 0 1rem 1rem;
}

.bs-linescore {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0 0.75rem;
}

.bs-splits-toggle {
  display: flex;
  justify-content: flex-end;
  font-size: 0.8rem;
  opacity: 0.75;
  margin-bottom: 0.4rem;
}
.bs-splits-toggle label { display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; }

.bs-sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
}

.bs-side-title {
  margin: 0.6rem 0 0.3rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  padding-bottom: 0.2rem;
}

.bs-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Courier New', monospace;
  font-size: 0.8rem;
}
.bs-table th,
.bs-table td {
  text-align: right;
  padding: 0.15rem 0.3rem;
  white-space: nowrap;
}
.bs-table th {
  font-weight: normal;
  color: rgba(255, 255, 255, 0.55);
}
.bs-table .name-col {
  text-align: left;
  width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bs-table tbody tr:nth-child(odd) { background: rgba(255, 255, 255, 0.03); }
.bs-table tfoot td {
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  font-weight: 600;
}
.bs-table .split-col { color: rgba(255, 255, 255, 0.5); }
.bs-table .empty-row td { text-align: center; color: rgba(255, 255, 255, 0.4); font-style: italic; }

.badge {
  display: inline-block;
  margin-left: 0.35rem;
  padding: 0 0.3rem;
  font-size: 0.65rem;
  font-family: sans-serif;
  border-radius: 4px;
  background: rgba(255, 196, 0, 0.18);
  color: #ffc107;
  vertical-align: middle;
}

/* Subtle expand/collapse */
.bs-collapse-enter-active,
.bs-collapse-leave-active {
  transition: opacity 0.2s ease;
}
.bs-collapse-enter-from,
.bs-collapse-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .bs-sides { grid-template-columns: 1fr; gap: 0.75rem; }
  .bs-table { font-size: 0.72rem; }
  .bs-table th, .bs-table td { padding: 0.12rem 0.2rem; }
}
</style>
