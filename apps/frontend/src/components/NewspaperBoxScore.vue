<script setup>
import { computed } from 'vue';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';
import { buildNameResolver } from '@/utils/newspaperNames';
import { computePitchingDecisions, normalizeKey } from '@/utils/pitchingDecisions';

// Newspaper-style per-team box score shown in place of a lineup panel once a game is final.
// Reads the already-built, reveal-gated gameStore.boxScore so the batting/pitching lines match
// the linescore and game log exactly.
const props = defineProps({
  teamKey: { type: String, required: true }, // 'home' | 'away'
});
const emit = defineEmits(['select-player']);

const gameStore = useGameStore();
const authStore = useAuthStore();

const side = computed(() => gameStore.boxScore?.[props.teamKey] || null);
const team = computed(() => gameStore.teams?.[props.teamKey] || null);

const teamName = computed(() => team.value?.name || team.value?.city || 'Team');
const teamColor = computed(() => team.value?.primary_color || '#1a1a1a');

const runs = computed(() => {
  const ds = gameStore.displayGameState;
  if (ds && (props.teamKey === 'home' ? ds.homeScore : ds.awayScore) != null) {
    return props.teamKey === 'home' ? ds.homeScore : ds.awayScore;
  }
  return side.value?.totals?.r ?? 0;
});

// Full player cards (for the card modal + position lookups), pooled across both teams.
const cardMap = computed(() => {
  const m = new Map();
  const add = (c) => { if (c?.card_id != null && !m.has(c.card_id)) m.set(c.card_id, c); };
  for (const s of ['home', 'away']) {
    (gameStore.rosters?.[s] || []).forEach(add);
    const lu = gameStore.lineups?.[s];
    (lu?.battingOrder || []).forEach((spot) => add(spot?.player));
    add(lu?.startingPitcher);
  }
  return m;
});
const selectPlayer = (cardId) => {
  const c = cardMap.value.get(cardId);
  if (c) emit('select-player', c);
};

// Deterministic "Last / F. Last / Fi. Last (paren)" names, resolved against the full player pool
// so a card always renders the same way (see newspaperNames.js).
const resolver = computed(() => buildNameResolver(authStore.allPlayers));
const nameFor = (row) => resolver.value(row.cardId, row.name);

// --- Batting order + substitutes ---------------------------------------------------------------
// Every plate appearance advances the order by one, so the k-th PA a team takes sits in slot
// (k % 9). Reconstructing from the log lets us list substitutes in their real lineup spot (indented
// under the starter they replaced) instead of in first-appearance order.
const currentPos = (cardId) => {
  for (const spot of gameStore.lineups?.[props.teamKey]?.battingOrder || []) {
    if (spot?.player?.card_id === cardId && spot.position) return spot.position.toLowerCase();
  }
  return '';
};
// Entry role (ph / pr / fielding position) for players brought in mid-game, parsed from the
// substitution log — the reliable source for subs who were later removed themselves.
const roleByCard = computed(() => {
  const m = new Map();
  const nameToCard = new Map();
  for (const [id, c] of cardMap.value) {
    if (c?.name) nameToCard.set(c.name, id);
    if (c?.displayName) nameToCard.set(c.displayName, id);
  }
  for (const e of gameStore.gameEvents || []) {
    if (e.event_type !== 'substitution' || typeof e.log_message !== 'string') continue;
    const set = (re, roleFn) => {
      const mt = e.log_message.match(re);
      if (mt) { const id = nameToCard.get(mt[1].trim()); if (id != null) m.set(id, roleFn(mt)); return true; }
      return false;
    };
    if (set(/brings in (.+?) to pinch hit for/i, () => 'ph')) continue;
    if (set(/brings in (.+?) to pinch run for/i, () => 'pr')) continue;
    if (set(/brings in (.+?) to relieve/i, () => 'p')) continue;
    set(/substitutes (.+?) for .+? will now play (\w+)/i, (mt) => mt[2].toLowerCase());
  }
  return m;
});
const cardPos = (cardId) => {
  const c = cardMap.value.get(cardId);
  if (!c) return '';
  if (c.control != null) return 'p';
  return (c.displayPosition || '').toLowerCase();
};
// Position label priority: the logged entry role wins (a pinch hitter who batted in the pitcher's
// slot otherwise inherits a stale 'P' from the lineup), then the current lineup slot, then the
// player's own card position (covers starters who were removed from the game). A non-pitcher can
// never legitimately be 'p', so fall that back to 'ph'.
const posFor = (cardId) => {
  const card = cardMap.value.get(cardId);
  const isPitcher = !!card && card.control != null;
  let pos = roleByCard.value.get(cardId) || currentPos(cardId) || cardPos(cardId);
  if (!isPitcher && pos === 'p') pos = 'ph';
  return pos;
};

const orderedBatting = computed(() => {
  const rows = side.value?.batting || [];
  const byId = new Map(rows.map((r) => [r.cardId, r]));
  const teamPAs = (gameStore.gameState?.atBatLog || [])
    .filter((e) => e.batterTeam === props.teamKey && e.batterId != null);
  if (teamPAs.length === 0) return rows.map((row) => ({ row, starter: true }));

  const slots = Array.from({ length: 9 }, () => []);
  teamPAs.forEach((e, k) => {
    const occ = slots[k % 9];
    if (!occ.includes(e.batterId)) occ.push(e.batterId);
  });

  const ordered = [];
  const used = new Set();
  for (const occ of slots) {
    occ.forEach((cardId, i) => {
      const row = byId.get(cardId);
      if (row && !used.has(cardId)) { ordered.push({ row, starter: i === 0 }); used.add(cardId); }
    });
  }
  // Anything the reconstruction didn't place (e.g. a pinch runner who only stole) is appended.
  for (const row of rows) if (!used.has(row.cardId)) { ordered.push({ row, starter: false }); used.add(row.cardId); }
  return ordered;
});

// Pitcher decisions (W / L / S / BS), computed from the chronological atBatLog.
const decisions = computed(() =>
  computePitchingDecisions(gameStore.gameState?.atBatLog, gameStore.teams, gameStore.boxScore));
const decisionFor = (pitcherKey) => (decisions.value[normalizeKey(pitcherKey)] || []).join(', ');

// Below-the-line notes (2B / 3B / HR / SB / CS), each "Name" or "Name N" when a batter had more
// than one, built straight from the batting rows we already have.
const notes = computed(() => {
  const s = side.value;
  if (!s) return [];
  const collect = (key) => {
    const names = [];
    for (const b of s.batting) {
      const n = b[key];
      if (n > 0) names.push(n > 1 ? `${nameFor(b)} ${n}` : nameFor(b));
    }
    return names;
  };
  const out = [];
  for (const [label, key] of [['2B', 'doubles'], ['3B', 'triples'], ['HR', 'hr'], ['SB', 'sb'], ['CS', 'cs']]) {
    const names = collect(key);
    if (names.length) out.push({ label, names });
  }
  return out;
});

const hasData = computed(() =>
  !!side.value && (side.value.batting.length > 0 || side.value.pitching.length > 0));
</script>

<template>
  <div class="np-box" v-if="hasData">
    <div class="np-headline">
      <span class="np-team" :style="{ color: teamColor }">{{ teamName }}</span>
      <span class="np-runs">{{ runs }}</span>
    </div>

    <table class="np-table">
      <thead>
        <tr>
          <th class="np-name">Batting</th>
          <th>AB</th><th>R</th><th>H</th><th>BI</th><th>BB</th><th>SO</th><th class="np-avg">AVG</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="{ row: b, starter } in orderedBatting" :key="b.cardId" :class="{ 'np-sub': !starter }">
          <td class="np-name"><span class="np-click" @click="selectPlayer(b.cardId)">{{ nameFor(b) }}</span><span v-if="posFor(b.cardId)" class="np-pos">{{ posFor(b.cardId) }}</span></td>
          <td>{{ b.ab }}</td><td>{{ b.r }}</td><td>{{ b.h }}</td><td>{{ b.rbi }}</td>
          <td>{{ b.bb }}</td><td>{{ b.so }}</td><td class="np-avg">{{ b.avg }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td class="np-name">Totals</td>
          <td>{{ side.totals.ab }}</td><td>{{ side.totals.r }}</td><td>{{ side.totals.h }}</td>
          <td>{{ side.totals.rbi }}</td><td>{{ side.totals.bb }}</td><td>{{ side.totals.so }}</td><td class="np-avg"></td>
        </tr>
      </tfoot>
    </table>

    <p v-if="notes.length" class="np-notes">
      <span v-for="note in notes" :key="note.label" class="np-note"><strong>{{ note.label }}:</strong> {{ note.names.join(', ') }}. </span>
    </p>

    <table class="np-table np-pitching">
      <thead>
        <tr>
          <th class="np-name">Pitching</th>
          <th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in side.pitching" :key="p.pitcherKey">
          <td class="np-name"><span class="np-click" @click="selectPlayer(p.cardId)">{{ nameFor(p) }}</span><span v-if="decisionFor(p.pitcherKey)" class="np-decision"> ({{ decisionFor(p.pitcherKey) }})</span></td>
          <td>{{ p.ip }}</td><td>{{ p.h }}</td><td>{{ p.r }}</td><td>{{ p.er }}</td>
          <td>{{ p.bb }}</td><td>{{ p.so }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* Matches the .lineup-panel footprint so it drops straight into the info-container flex row. */
.np-box {
  background: #f9f9f9;
  padding: 0.85rem 0.9rem;
  border-radius: 8px;
  flex: 1;
  min-width: 280px;
  max-width: 350px;
  color: #1a1a1a;
}

/* Serif masthead: team name + run total, closed off with a heavy newspaper rule. */
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
.np-team {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.np-runs {
  font-size: 1.15rem;
  font-weight: 700;
}

.np-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Courier New', monospace;
  font-size: 0.78rem;
  line-height: 1.35;
}
.np-table th,
.np-table td {
  text-align: right;
  padding: 0.02rem 0.28rem;
  white-space: nowrap;
}
.np-table th {
  font-weight: normal;
  color: #666;
  border-bottom: 1px solid #cfcfcf;
}
.np-table .np-name {
  text-align: left;
  width: 99%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.np-pos {
  margin-left: 0.4em;
  color: #888;
  text-transform: lowercase;
}
/* Pinch hitters/runners are indented and set apart, the way a clipping tucks subs under the order. */
.np-sub .np-name { padding-left: 1.1em; font-style: italic; }
/* Clickable player name opens the card modal, matching the lineup panels. */
.np-click { cursor: pointer; }
.np-click:hover { text-decoration: underline; }
.np-decision { font-weight: 700; color: #1a1a1a; }
.np-table thead .np-name {
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  color: #1a1a1a;
}
.np-table tfoot td {
  border-top: 1px solid #1a1a1a;
  font-weight: 700;
}
.np-avg { color: #555; }

/* Below-the-line notes, set in italic serif like real agate type. */
.np-notes {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 0.72rem;
  line-height: 1.4;
  color: #333;
  margin: 0.45rem 0;
  padding: 0.35rem 0;
  border-top: 1px solid #cfcfcf;
  border-bottom: 1px solid #cfcfcf;
}
.np-note strong { font-weight: 700; }

.np-pitching { margin-top: 0.45rem; }
.np-pitching:first-of-type { margin-top: 0; }

@media (max-width: 992px) {
  .np-box { max-width: 350px; width: 100%; }
}
</style>
