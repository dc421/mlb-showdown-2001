<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { apiClient } from '@/services/api';

// Dev-only master inspector for every series + game and how each ties (or fails to tie) to a
// league season / Classic. Read-only; powered by GET /api/dev/series-overview.

const data = ref(null);
const loading = ref(true);
const error = ref(null);

const search = ref('');
const categoryFilter = ref('all');
const problemsOnly = ref(false);
const expanded = ref(new Set());

async function fetchOverview() {
  loading.value = true;
  error.value = null;
  try {
    const res = await apiClient('/api/dev/series-overview');
    if (!res.ok) throw new Error(`Failed to load (${res.status}).`);
    data.value = await res.json();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
onMounted(fetchOverview);

const CATEGORY_LABELS = {
  league: 'League',
  classic_played: 'Classic (played)',
  classic_shadow: 'Classic (bracket)',
  classic_other: 'Classic (other)',
  stray: 'Stray',
};

const categories = computed(() => {
  const c = data.value?.summary?.by_category || {};
  return Object.keys(c);
});

// The reliable matchup: use the series home/away teams when both are set, otherwise fall back to the
// actual game participants (stray/abandoned series often never set series_away_user_id → "TBD").
function matchup(s) {
  if (s.home_team && s.away_team) return { home: s.home_team, away: s.away_team, derived: false };
  const pt = s.participant_teams || [];
  const home = s.home_team || pt[0] || null;
  const away = (s.away_team) || pt.find(t => t !== home) || null;
  return { home, away, derived: !(s.home_team && s.away_team) && pt.length > 0 };
}

const filteredSeries = computed(() => {
  if (!data.value) return [];
  const q = search.value.trim().toLowerCase();
  return data.value.series.filter(s => {
    if (categoryFilter.value !== 'all' && s.category !== categoryFilter.value) return false;
    if (problemsOnly.value && !(s.flags.phantom_trailing || s.flags.stray || s.flags.empty_shell)) return false;
    if (!q) return true;
    const hay = [
      s.id, s.series_type, s.status, s.category, s.home_team, s.away_team,
      ...(s.participant_teams || []),
      s.season_name, s.round, s.sr_style, s.classic_name,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }).map(s => ({ ...s, _m: matchup(s) }));
});

function toggle(id) {
  const set = new Set(expanded.value);
  set.has(id) ? set.delete(id) : set.add(id);
  expanded.value = set;
}

function gameRoute(g) {
  if (g.status === 'pending') return `/game/${g.game_id}/setup`;
  if (g.status === 'lineups') return `/game/${g.game_id}/lineup`;
  return `/game/${g.game_id}`;
}

function linkLabel(s) {
  const parts = [];
  if (s.season_name) parts.push(s.season_name);
  if (s.round) parts.push(s.round);
  if (s.classic_name && !s.season_name) parts.push(s.classic_name);
  return parts.join(' · ') || '—';
}

const activeFlags = (s) => Object.entries(s.flags).filter(([, v]) => v).map(([k]) => k);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '';
</script>

<template>
  <div class="dev-wrap">
    <div class="dev-head">
      <div>
        <h1>Series &amp; Games Inspector <span class="tag-dev">DEV</span></h1>
        <p class="sub">Read-only view of every series and game and how each ties to a league season / Classic.</p>
      </div>
      <button class="btn" @click="fetchOverview" :disabled="loading">↻ Refresh</button>
    </div>

    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state error">{{ error }}</p>

    <template v-else-if="data">
      <!-- Summary -->
      <div class="cards">
        <div class="card"><div class="num">{{ data.summary.series_count }}</div><div class="lbl">series</div></div>
        <div class="card"><div class="num">{{ data.summary.orphan_game_count }}</div><div class="lbl">orphan games</div></div>
        <div class="card" :class="{ warn: data.summary.stray_count > 0 }"><div class="num">{{ data.summary.stray_count }}</div><div class="lbl">stray</div></div>
        <div class="card" :class="{ bad: data.summary.phantom_trailing_count > 0 }"><div class="num">{{ data.summary.phantom_trailing_count }}</div><div class="lbl">phantom trailing</div></div>
        <div class="card wide">
          <div class="cat-line" v-for="(n, cat) in data.summary.by_category" :key="cat">
            <span class="badge" :class="cat">{{ CATEGORY_LABELS[cat] || cat }}</span> {{ n }}
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="filters">
        <input v-model="search" class="input" placeholder="Search id, team, season, round…" />
        <select v-model="categoryFilter" class="input">
          <option value="all">All categories</option>
          <option v-for="c in categories" :key="c" :value="c">{{ CATEGORY_LABELS[c] || c }}</option>
        </select>
        <label class="chk"><input type="checkbox" v-model="problemsOnly" /> problems only</label>
        <span class="count">{{ filteredSeries.length }} shown</span>
      </div>

      <!-- Series table -->
      <div class="table">
        <div class="row head">
          <div class="c-id">#</div>
          <div class="c-cat">Category</div>
          <div class="c-teams">Matchup</div>
          <div class="c-wl">W–L</div>
          <div class="c-link">Season / Round</div>
          <div class="c-games">Games</div>
          <div class="c-ev">Events</div>
          <div class="c-flags">Flags</div>
        </div>

        <template v-for="s in filteredSeries" :key="s.id">
          <div class="row" :class="{ open: expanded.has(s.id) }" @click="toggle(s.id)">
            <div class="c-id">
              <span class="caret">{{ expanded.has(s.id) ? '▾' : '▸' }}</span>{{ s.id }}
              <div class="type">{{ s.series_type }}</div>
            </div>
            <div class="c-cat"><span class="badge" :class="s.category">{{ CATEGORY_LABELS[s.category] || s.category }}</span></div>
            <div class="c-teams">
              <span>{{ s._m.home || '—' }}</span>
              <span class="vs">vs</span>
              <span :class="{ tbd: !s._m.away }">{{ s._m.away || 'TBD' }}</span>
              <span v-if="s._m.derived" class="derived" title="derived from game participants (series away-user not set)">◦</span>
            </div>
            <div class="c-wl">{{ s.home_wins }}–{{ s.away_wins }}<div class="ss" :class="s.status">{{ s.status }}</div></div>
            <div class="c-link">
              <template v-if="s.series_result_id">
                {{ linkLabel(s) }}
                <div class="src">sr#{{ s.series_result_id }} · {{ s.sr_status }}<template v-if="s.result_source"> · {{ s.result_source }}</template></div>
              </template>
              <span v-else-if="s.classic_id" class="muted">{{ s.classic_name }} (id {{ s.classic_id }})</span>
              <span v-else class="muted">— not linked —</span>
            </div>
            <div class="c-games">{{ s.games_completed }}/{{ s.games_total }}<span v-if="s.games_nonfinal" class="nf"> · {{ s.games_nonfinal }} open</span></div>
            <div class="c-ev">{{ s.events_total }}</div>
            <div class="c-flags">
              <span v-for="f in activeFlags(s)" :key="f" class="flag" :class="f">{{ f.replace('_',' ') }}</span>
            </div>
          </div>

          <!-- Expanded: games + links -->
          <div v-if="expanded.has(s.id)" class="detail" @click.stop>
            <div class="detail-actions">
              <RouterLink v-if="s.series_result_id" :to="`/series/${s.id}`" class="mini">Series page →</RouterLink>
              <span class="meta">created {{ fmtDate(s.created_at) }}</span>
            </div>
            <div v-if="s.games.length === 0" class="no-games">No games (shell series).</div>
            <table v-else class="games">
              <thead><tr><th>G#</th><th>game_id</th><th>status</th><th>events</th><th>winner side</th><th>completed</th><th></th></tr></thead>
              <tbody>
                <tr v-for="g in s.games" :key="g.game_id">
                  <td>{{ g.game_in_series ?? '—' }}</td>
                  <td>{{ g.game_id }}</td>
                  <td><span class="ss" :class="g.status">{{ g.status }}</span></td>
                  <td>{{ g.events }}</td>
                  <td>{{ g.winning_side || '—' }}</td>
                  <td>{{ fmtDate(g.completed_at) }}</td>
                  <td class="links">
                    <RouterLink :to="gameRoute(g)" class="mini">open</RouterLink>
                    <RouterLink :to="`/dev-tool/${g.game_id}`" class="mini">debug</RouterLink>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>

      <!-- Orphan games -->
      <div v-if="data.orphanGames.length" class="orphans">
        <h2>Orphan games <span class="muted">(no series)</span></h2>
        <table class="games">
          <thead><tr><th>game_id</th><th>status</th><th>events</th><th>winner side</th><th>created</th><th></th></tr></thead>
          <tbody>
            <tr v-for="g in data.orphanGames" :key="g.game_id">
              <td>{{ g.game_id }}</td>
              <td><span class="ss" :class="g.status">{{ g.status }}</span></td>
              <td>{{ g.events }}</td>
              <td>{{ g.winning_side || '—' }}</td>
              <td>{{ fmtDate(g.created_at) }}</td>
              <td class="links">
                <RouterLink :to="gameRoute(g)" class="mini">open</RouterLink>
                <RouterLink :to="`/dev-tool/${g.game_id}`" class="mini">debug</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dev-wrap { max-width: 1150px; margin: 0 auto; padding: 1.5rem 1rem 4rem; color: #222; }
.dev-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
h1 { font-size: 1.5rem; margin: 0; }
.tag-dev { font-size: 0.6rem; background: #6741d9; color: #fff; padding: 2px 6px; border-radius: 4px; vertical-align: middle; letter-spacing: 0.05em; }
.sub { color: #777; margin: 0.25rem 0 0; font-size: 0.85rem; }
.btn { background: #007bff; color: #fff; border: none; border-radius: 6px; padding: 0.5rem 0.9rem; cursor: pointer; font-size: 0.85rem; }
.btn:disabled { opacity: 0.5; cursor: default; }
.state { text-align: center; color: #666; padding: 2rem; }
.state.error { color: #dc3545; }

.cards { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 1.25rem 0; }
.card { background: #f7f7f9; border: 1px solid #e6e6ea; border-radius: 10px; padding: 0.75rem 1rem; min-width: 90px; }
.card .num { font-size: 1.6rem; font-weight: 700; }
.card .lbl { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.03em; }
.card.warn { background: #fff8e6; border-color: #f0d98a; }
.card.bad { background: #fdecec; border-color: #f2b8b8; }
.card.wide { min-width: 180px; }
.cat-line { font-size: 0.8rem; margin: 2px 0; display: flex; align-items: center; gap: 0.4rem; }

.filters { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.75rem; }
.input { padding: 0.45rem 0.6rem; border: 1px solid #d5d5db; border-radius: 6px; font-size: 0.85rem; }
.input[placeholder] { min-width: 240px; }
.chk { font-size: 0.85rem; color: #555; display: flex; align-items: center; gap: 0.3rem; }
.count { font-size: 0.8rem; color: #999; margin-left: auto; }

.table { border: 1px solid #e6e6ea; border-radius: 10px; overflow: hidden; }
.row { display: grid; grid-template-columns: 60px 130px 1fr 70px 190px 100px 64px 150px; gap: 0.5rem; align-items: center;
  padding: 0.55rem 0.75rem; border-top: 1px solid #eee; font-size: 0.83rem; cursor: pointer; }
.row.head { background: #fafafb; border-top: none; font-weight: 600; color: #888; font-size: 0.72rem;
  text-transform: uppercase; letter-spacing: 0.03em; cursor: default; }
.row:hover:not(.head) { background: #fbfbfd; }
.row.open { background: #f4f1fb; }
.caret { display: inline-block; width: 1em; color: #999; }
.type { font-size: 0.7rem; color: #999; margin-top: 2px; }
.c-teams { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
.vs { color: #bbb; font-size: 0.75rem; }
.tbd { color: #bbb; font-style: italic; }
.derived { color: #b58; font-weight: 700; cursor: help; }
.c-wl { font-weight: 600; }
.ss { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.02em; color: #999; margin-top: 2px; }
.ss.completed { color: #28a745; }
.ss.in_progress { color: #e08a00; }
.ss.pending, .ss.lineups { color: #c0392b; }
.src { font-size: 0.7rem; color: #aaa; margin-top: 2px; }
.nf { color: #e08a00; }
.muted { color: #aaa; }

.badge { font-size: 0.68rem; padding: 2px 7px; border-radius: 10px; font-weight: 600; white-space: nowrap; }
.badge.league { background: #e3f0ff; color: #1663c7; }
.badge.classic_played { background: #e7f7ec; color: #1d8a44; }
.badge.classic_shadow { background: #f0ecfb; color: #6741d9; }
.badge.classic_other { background: #f0ecfb; color: #6741d9; }
.badge.stray { background: #fdecec; color: #c0392b; }

.flag { font-size: 0.62rem; padding: 1px 5px; border-radius: 4px; margin-right: 3px; background: #eee; color: #777; }
.flag.stray { background: #fdecec; color: #c0392b; }
.flag.phantom_trailing { background: #ffe1e1; color: #a11; font-weight: 700; }
.flag.played { background: #e7f7ec; color: #1d8a44; }
.flag.empty_shell { background: #fff3d6; color: #a6791b; }

.detail { padding: 0.5rem 1rem 0.9rem 2rem; background: #f7f5fc; border-top: 1px solid #eee; font-size: 0.82rem; }
.detail-actions { display: flex; gap: 1rem; align-items: center; margin-bottom: 0.4rem; }
.meta { color: #aaa; font-size: 0.75rem; }
.no-games { color: #999; font-style: italic; }
.games { width: 100%; border-collapse: collapse; }
.games th { text-align: left; color: #999; font-weight: 600; font-size: 0.7rem; text-transform: uppercase; padding: 0.25rem 0.5rem; }
.games td { padding: 0.3rem 0.5rem; border-top: 1px solid #ececec; }
.links { display: flex; gap: 0.6rem; }
.mini { color: #007bff; text-decoration: none; font-size: 0.78rem; }
.mini:hover { text-decoration: underline; }

.orphans { margin-top: 1.75rem; }
.orphans h2 { font-size: 1.05rem; }

@media (max-width: 820px) {
  .row { grid-template-columns: 46px 1fr 84px; }
  .row .c-teams, .row .c-link, .row .c-games, .row .c-ev, .row .c-flags { display: none; }
  .row.head { display: none; }
}
</style>
