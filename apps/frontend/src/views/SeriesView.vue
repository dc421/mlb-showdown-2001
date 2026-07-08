<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { apiClient } from '@/services/api';

const route = useRoute();
const series = ref(null);
const loading = ref(true);
const error = ref(null);

async function fetchSeries() {
  loading.value = true;
  error.value = null;
  try {
    const res = await apiClient(`/api/series/${route.params.id}`);
    if (!res.ok) throw new Error(res.status === 404 ? 'Series not found.' : 'Failed to load series.');
    series.value = await res.json();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchSeries);
watch(() => route.params.id, fetchSeries);

const teamLabel = (t) => t ? (t.city ? `${t.city} ${t.name}` : t.name) : 'TBD';

const isFinal = computed(() => series.value?.status === 'completed');

const seriesWinner = computed(() => {
  const s = series.value;
  if (!s || !isFinal.value) return null;
  if (s.home_wins > s.away_wins) return 'home';
  if (s.away_wins > s.home_wins) return 'away';
  return null;
});

const subtitle = computed(() => {
  const s = series.value;
  if (!s) return '';
  const parts = [];
  if (s.season_name) parts.push(s.season_name);
  if (s.round) parts.push(s.round);
  return parts.join(' · ');
});

function gameRoute(g) {
  if (g.status === 'pending') return `/game/${g.game_id}/setup`;
  if (g.status === 'lineups') return `/game/${g.game_id}/lineup`;
  return `/game/${g.game_id}`;
}

function gameLine(g) {
  const a = g.away, h = g.home;
  if (g.status === 'completed' && a.score != null) {
    return `${a.abbreviation} ${a.score}  @  ${h.abbreviation} ${h.score}`;
  }
  if (g.status === 'in_progress') {
    return `${a.abbreviation} ${a.score ?? 0}  @  ${h.abbreviation} ${h.score ?? 0}`;
  }
  return `${a.abbreviation}  @  ${h.abbreviation}`;
}

function gameStatusText(g) {
  if (g.status === 'completed') return 'Final';
  if (g.status === 'in_progress') return `In Progress${g.inning ? ` (${g.inning})` : ''}`;
  if (g.status === 'lineups') return 'Setting lineups';
  return 'Not started';
}

// The prominent score headline: winner-first for a final, otherwise away, home.
function scoreHeadline(g) {
  const a = g.away, h = g.home;
  if (a.score == null || h.score == null) return null;
  if (g.status === 'completed' && g.winner) {
    const w = g.winner === 'home' ? h : a;
    const l = g.winner === 'home' ? a : h;
    return `${w.abbreviation} ${w.score}, ${l.abbreviation} ${l.score}`;
  }
  return `${a.abbreviation} ${a.score}, ${h.abbreviation} ${h.score}`;
}

function winnerLogo(g) {
  if (g.winner === 'home') return g.home?.logo_url || null;
  if (g.winner === 'away') return g.away?.logo_url || null;
  return null;
}

// One team's decisions + home runs, as tagged lines (for its column of the scorecard).
function teamSummary(g, side) {
  const lines = [];
  for (const d of g.decisions || []) if (d.side === side) lines.push({ tag: d.tag, text: d.name || '—' });
  const hitters = (g.home_runs || []).filter(h => h.side === side);
  if (hitters.length) {
    lines.push({ tag: 'HR', text: hitters.map(h => (h.count > 1 ? `${h.name} ${h.count}` : h.name)).join(', ') });
  }
  return lines;
}
function hasTeamSummary(g) {
  return teamSummary(g, 'away').length > 0 || teamSummary(g, 'home').length > 0;
}

// Winner on the left, loser on the right (falls back to away/home before a game is decided).
function sides(g) {
  if (g.winner === 'home') return { left: 'home', right: 'away' };
  if (g.winner === 'away') return { left: 'away', right: 'home' };
  return { left: 'away', right: 'home' };
}
function teamOf(g, side) {
  return side === 'home' ? g.home : g.away;
}
</script>

<template>
  <div class="series-page">
    <RouterLink to="/dashboard" class="back-link">← Dashboard</RouterLink>

    <p v-if="loading" class="state-msg">Loading series…</p>
    <p v-else-if="error" class="state-msg error">{{ error }}</p>

    <template v-else-if="series">
      <header class="series-header">
        <div class="team-block" :class="{ winner: seriesWinner === 'home' }">
          <img v-if="series.home_team?.logo_url" :src="series.home_team.logo_url" class="team-logo" :alt="series.home_team.name" />
          <span class="team-name">{{ teamLabel(series.home_team) }}</span>
        </div>
        <div class="score-block">
          <div class="series-score">{{ series.home_wins }}<span class="dash">–</span>{{ series.away_wins }}</div>
          <div class="series-status" :class="{ final: isFinal }">{{ isFinal ? 'Final' : 'In Progress' }}</div>
        </div>
        <div class="team-block" :class="{ winner: seriesWinner === 'away' }">
          <img v-if="series.away_team?.logo_url" :src="series.away_team.logo_url" class="team-logo" :alt="series.away_team.name" />
          <span class="team-name">{{ teamLabel(series.away_team) }}</span>
        </div>
      </header>
      <p v-if="subtitle" class="series-subtitle">{{ subtitle }}</p>

      <ul class="games-list">
        <li v-for="g in series.games" :key="g.game_id" class="game-row">
          <RouterLink :to="gameRoute(g)" class="game-link">
            <div class="game-head">
              <span class="game-num">Game {{ g.game_in_series }}</span>
              <span class="game-status" :class="{ live: g.status === 'in_progress' }">{{ gameStatusText(g) }}</span>
            </div>
            <div v-if="scoreHeadline(g) || g.linescore" class="score-row">
              <div v-if="scoreHeadline(g)" class="final-headline">{{ scoreHeadline(g) }}</div>
              <table v-if="g.linescore" class="mini-linescore">
                <thead>
                  <tr>
                    <th class="ls-team"></th>
                    <th v-for="i in g.linescore.innings" :key="i">{{ i }}</th>
                    <th class="ls-rh">R</th>
                  </tr>
                </thead>
                <tbody>
                  <tr :class="{ winrow: g.winner === 'away' }">
                    <td class="ls-team">{{ g.away.abbreviation }}</td>
                    <td v-for="(r, i) in g.linescore.away" :key="i">{{ r === null ? 'X' : r }}</td>
                    <td class="ls-rh">{{ g.linescore.awayRuns }}</td>
                  </tr>
                  <tr :class="{ winrow: g.winner === 'home' }">
                    <td class="ls-team">{{ g.home.abbreviation }}</td>
                    <td v-for="(r, i) in g.linescore.home" :key="i">{{ r === null ? 'X' : r }}</td>
                    <td class="ls-rh">{{ g.linescore.homeRuns }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <template v-else>
              <div class="game-line">{{ gameLine(g) }}</div>
              <div v-if="g.probable_pitchers && (g.probable_pitchers.away || g.probable_pitchers.home)" class="probable">
                <span class="dtag">SP</span> {{ g.probable_pitchers.away || 'TBD' }} vs. {{ g.probable_pitchers.home || 'TBD' }}
              </div>
            </template>
            <div v-if="hasTeamSummary(g)" class="team-summary">
              <div class="ts-col ts-left">
                <div class="ts-team">
                  <img v-if="teamOf(g, sides(g).left).logo_url" :src="teamOf(g, sides(g).left).logo_url" class="ts-logo" alt="" />{{ teamOf(g, sides(g).left).abbreviation }}
                </div>
                <div v-for="(l, i) in teamSummary(g, sides(g).left)" :key="i" class="ts-line"><span class="dtag">{{ l.tag }}</span> {{ l.text }}</div>
              </div>
              <div class="ts-col ts-right">
                <div class="ts-team">
                  <img v-if="teamOf(g, sides(g).right).logo_url" :src="teamOf(g, sides(g).right).logo_url" class="ts-logo" alt="" />{{ teamOf(g, sides(g).right).abbreviation }}
                </div>
                <div v-for="(l, i) in teamSummary(g, sides(g).right)" :key="i" class="ts-line"><span class="dtag">{{ l.tag }}</span> {{ l.text }}</div>
              </div>
            </div>
          </RouterLink>
        </li>
        <li v-if="series.games.length === 0" class="empty">No games in this series yet.</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.series-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.back-link {
  display: inline-block;
  margin-bottom: 1.5rem;
  color: #007bff;
  text-decoration: none;
  font-size: 0.95rem;
}
.back-link:hover { text-decoration: underline; }
.state-msg { text-align: center; color: #666; padding: 2rem; }
.state-msg.error { color: #dc3545; }

.series-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 1.5rem;
  background: #f9f9f9;
  border-radius: 10px;
  padding: 1.5rem;
}
.team-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}
.team-block.winner .team-name { font-weight: 800; }
.team-logo {
  height: 64px;
  width: 64px;
  object-fit: contain;
  background: #fff;
  border-radius: 8px;
  padding: 4px;
}
.team-name { font-weight: 600; color: #333; }
.score-block { text-align: center; }
.series-score {
  font-size: 2.4rem;
  font-weight: 800;
  color: #222;
  font-variant-numeric: tabular-nums;
}
.series-score .dash { margin: 0 0.35rem; color: #aaa; }
.series-status {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
}
.series-status.final { color: #28a745; font-weight: 700; }
.series-subtitle {
  text-align: center;
  color: #777;
  margin: 0.75rem 0 1.5rem;
  font-size: 0.95rem;
}

.games-list { list-style: none; padding: 0; margin: 0; }
.game-row { margin-bottom: 0.5rem; }
.game-link {
  display: block;
  padding: 0.7rem 1.1rem 0.85rem;
  background: #fff;
  border: 1px solid #e2e2e2;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.game-link:hover { background: #f4f8ff; border-color: #cdddf5; }
.game-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.4rem;
}
.game-num { font-weight: 700; color: #555; }
.score-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 0.5rem;
}
.final-headline {
  font-size: 1.65rem;
  font-weight: 800;
  color: #1a1a1a;
  letter-spacing: 0.01em;
  flex-shrink: 0;
}
.score-row .mini-linescore { margin-left: auto; }
.game-line {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.05rem;
  color: #333;
}
.game-line.done { font-weight: 700; }
.game-status {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #999;
}
.game-status.live { color: #28a745; font-weight: 700; }

.mini-linescore {
  border-collapse: collapse;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
}
.mini-linescore th {
  font-weight: 500;
  color: #aaa;
  padding: 0 0.35rem;
  text-align: center;
  font-size: 0.78rem;
}
.mini-linescore td {
  padding: 0.05rem 0.35rem;
  text-align: center;
  color: #444;
}
.mini-linescore .ls-team {
  text-align: left;
  font-weight: 700;
  color: #333;
  padding-right: 0.6rem;
}
.mini-linescore .ls-rh {
  font-weight: 700;
  color: #222;
  border-left: 1px solid #e0e0e0;
}
.mini-linescore th.ls-rh { color: #888; }
.mini-linescore .winrow td { color: #111; }
.mini-linescore .winrow .ls-team { color: #000; }

.probable {
  margin-top: 0.35rem;
  font-size: 0.9rem;
  color: #555;
}
.dtag {
  font-weight: 800;
  color: #333;
  margin-right: 0.15rem;
}

/* Per-team columns: away on the left, home on the right */
.team-summary {
  margin-top: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.85rem;
  color: #555;
}
.ts-col { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1 1 0; }
.ts-team {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-weight: 800;
  color: #333;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 0.1rem;
}
.ts-logo { height: 16px; width: 16px; object-fit: contain; }
.ts-line { line-height: 1.35; }
.empty { color: #888; text-align: center; padding: 1.5rem; }
</style>
