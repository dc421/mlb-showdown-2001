<script setup>
import { computed } from 'vue';

// League leaders board: batting + pitching categories, each a small ranked list. Rate categories
// (BA, OPS, ERA) carry a top list and a muted "trailers" bottom list; counting categories (HR, RBI,
// Wins, SV, SO) are top-only. All the ranking is done upstream by computeLeaders(); this is display.
const props = defineProps({
  leaders: { type: Object, required: true },     // computeLeaders() output
  teams: { type: Object, default: () => ({}) },  // { [user_id]: team } for logos
  cardMap: { type: Object, default: null },      // Map<card_id, card> so names open the modal
});
const emit = defineEmits(['select-player']);

const apiUrl = import.meta.env.VITE_API_URL || '';
const logoUrl = (userId) => {
  const url = props.teams?.[userId]?.logo_url;
  if (!url) return '';
  return url.startsWith('http') ? url : `${apiUrl}${url}`;
};
const teamAbbr = (userId) => props.teams?.[userId]?.abbreviation || '';

const nameFor = (e) => {
  const c = props.cardMap && props.cardMap.get(e.cardId);
  return (c && (c.displayName || c.display_name || c.name)) || e.name;
};
const selectPlayer = (e) => {
  const c = props.cardMap && props.cardMap.get(e.cardId);
  if (c) emit('select-player', c);
};

const battingCats = computed(() => {
  const b = props.leaders?.batting;
  return b ? [b.avg, b.hr, b.rbi, b.ops] : [];
});
const pitchingCats = computed(() => {
  const p = props.leaders?.pitching;
  return p ? [p.wins, p.era, p.so, p.sv] : [];
});
const hasData = computed(() => battingCats.value.some((c) => c?.top?.length) || pitchingCats.value.some((c) => c?.top?.length));
</script>

<template>
  <div v-if="hasData" class="leaders">
    <div class="leaders-head">
      <h3>League Leaders</h3>
      <span v-if="leaders.qualifiers" class="leaders-qual">
        rate stats: min {{ leaders.qualifiers.minPA }} PA · {{ leaders.qualifiers.minIp }} IP to qualify
      </span>
    </div>

    <div class="leaders-group-label">Batting</div>
    <div class="leaders-grid">
      <div v-for="cat in battingCats" :key="cat.label" class="lead-cat">
        <div class="lead-cat-title">{{ cat.label }}</div>
        <ol class="lead-list">
          <li v-for="(e, i) in cat.top" :key="e.cardId" class="lead-row">
            <span class="lead-rank">{{ i + 1 }}</span>
            <img v-if="logoUrl(e.teamUserId)" :src="logoUrl(e.teamUserId)" class="lead-logo" :alt="teamAbbr(e.teamUserId)" />
            <span class="lead-name" @click="selectPlayer(e)">{{ nameFor(e) }}</span>
            <span class="lead-val">{{ e.display }}</span>
          </li>
        </ol>
        <template v-if="cat.bottom && cat.bottom.length">
          <div class="lead-sep">Trailers</div>
          <ol class="lead-list lead-list-dim">
            <li v-for="e in cat.bottom" :key="e.cardId" class="lead-row">
              <img v-if="logoUrl(e.teamUserId)" :src="logoUrl(e.teamUserId)" class="lead-logo" :alt="teamAbbr(e.teamUserId)" />
              <span class="lead-name" @click="selectPlayer(e)">{{ nameFor(e) }}</span>
              <span class="lead-val">{{ e.display }}</span>
            </li>
          </ol>
        </template>
      </div>
    </div>

    <div class="leaders-group-label">Pitching</div>
    <div class="leaders-grid">
      <div v-for="cat in pitchingCats" :key="cat.label" class="lead-cat">
        <div class="lead-cat-title">{{ cat.label }}</div>
        <ol class="lead-list">
          <li v-for="(e, i) in cat.top" :key="e.cardId" class="lead-row">
            <span class="lead-rank">{{ i + 1 }}</span>
            <img v-if="logoUrl(e.teamUserId)" :src="logoUrl(e.teamUserId)" class="lead-logo" :alt="teamAbbr(e.teamUserId)" />
            <span class="lead-name" @click="selectPlayer(e)">{{ nameFor(e) }}</span>
            <span class="lead-val">{{ e.display }}</span>
          </li>
        </ol>
        <template v-if="cat.bottom && cat.bottom.length">
          <div class="lead-sep">Trailers</div>
          <ol class="lead-list lead-list-dim">
            <li v-for="e in cat.bottom" :key="e.cardId" class="lead-row">
              <img v-if="logoUrl(e.teamUserId)" :src="logoUrl(e.teamUserId)" class="lead-logo" :alt="teamAbbr(e.teamUserId)" />
              <span class="lead-name" @click="selectPlayer(e)">{{ nameFor(e) }}</span>
              <span class="lead-val">{{ e.display }}</span>
            </li>
          </ol>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.leaders {
  background: #fff;
  padding: 1rem 1.25rem 1.25rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  margin-bottom: 2rem;
}
.leaders-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  border-bottom: 2px solid #eee;
  padding-bottom: 0.5rem;
  margin-bottom: 0.75rem;
}
.leaders-head h3 { margin: 0; font-size: 1.2rem; }
.leaders-qual { font-size: 0.75rem; color: #999; }

.leaders-group-label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #888;
  margin: 0.75rem 0 0.5rem;
}
.leaders-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
}

.lead-cat {
  border: 1px solid #eaecef;
  border-radius: 6px;
  padding: 0.5rem 0.6rem 0.6rem;
  min-width: 0;
}
.lead-cat-title {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #495057;
  padding-bottom: 0.35rem;
  margin-bottom: 0.35rem;
  border-bottom: 1px solid #f0f1f3;
}
.lead-list { list-style: none; margin: 0; padding: 0; }
.lead-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  line-height: 1.6;
}
.lead-rank {
  flex: 0 0 0.9rem;
  color: #adb5bd;
  font-size: 0.72rem;
  font-weight: 700;
  text-align: right;
}
.lead-logo { width: 16px; height: 16px; object-fit: contain; flex-shrink: 0; }
.lead-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  color: #222;
}
.lead-name:hover { text-decoration: underline; }
.lead-val {
  flex-shrink: 0;
  font-weight: 700;
  color: #111;
  font-variant-numeric: tabular-nums;
}

/* Trailers block: same layout, muted, under a faint labeled divider. */
.lead-sep {
  margin: 0.45rem 0 0.25rem;
  padding-top: 0.35rem;
  border-top: 1px dashed #e6e8eb;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #c0392b99;
}
.lead-list-dim .lead-row { color: #999; }
.lead-list-dim .lead-name { color: #888; }
.lead-list-dim .lead-val { color: #888; font-weight: 600; }

@media (max-width: 900px) {
  .leaders-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .leaders-grid { grid-template-columns: 1fr; }
}
</style>
