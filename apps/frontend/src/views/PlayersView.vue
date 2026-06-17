<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { apiClient } from '@/services/api';
import PlayerCardModal from '@/components/PlayerCardModal.vue';
import { getLastName } from '@/utils/playerUtils';

const authStore = useAuthStore();

const players = ref([]);
const loading = ref(true);
const selectedCard = ref(null);

// --- FILTER / SORT STATE ---
const searchQuery = ref('');
const playerType = ref('ALL');     // ALL | HITTERS | PITCHERS
const filterPosition = ref('ALL');
const filterTeam = ref('ALL');
const filterSet = ref('ALL');
const filterOwned = ref('ALL');    // ALL | OWNED | FREE
const selectedPointSetId = ref(null);

// Numeric stat range filters (empty string = unset).
const ptsMin = ref(''),  ptsMax = ref('');
const obMin = ref(''),   obMax = ref('');
const spdMin = ref(''),  spdMax = ref('');
const ctrlMin = ref(''), ctrlMax = ref('');
const ipMin = ref(''),   ipMax = ref('');

const sortKey = ref('points');
const sortDir = ref('desc');       // 'asc' | 'desc'

// The order chart outcomes are shown / the columns that are always present.
const CHART_OUTCOMES = ['PU', 'SO', 'GB', 'FB', 'BB', '1B', '1B+', '2B', '3B', 'HR'];

const HITTER_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'];
const PITCHER_POSITIONS = ['SP', 'RP'];

const SPEED_LETTER = { '20': 'A', '15': 'B', '10': 'C' };

// The app labels this point set as "Current Season" (see RosterBuilderView).
const CURRENT_SEASON_SET = '8/4/25 Season';

// --- HELPERS ---
function isPitcher(p) {
    return p.control !== null && p.control !== undefined;
}

function formatRange(range) {
    if (!range) return '';
    const parts = String(range).split('-');
    return parts[0] === parts[1] ? parts[0] : range;
}

// Total number of die-roll results an outcome covers, e.g. "5-14" -> 10, "13" -> 1,
// missing -> 0. Comma-joined ranges (rare) are summed.
function rangeCount(rangeStr) {
    if (!rangeStr) return 0;
    return String(rangeStr).split(',').reduce((sum, part) => {
        const [lo, hi] = part.split('-').map(n => parseInt(n, 10));
        if (Number.isNaN(lo)) return sum;
        const high = Number.isNaN(hi) ? lo : hi;
        return sum + (high - lo + 1);
    }, 0);
}

// Build { outcome: "13-16" } from chart_data { "13-16": "2B" }
function chartByOutcome(p) {
    const map = {};
    if (!p.chart_data) return map;
    for (const [range, outcome] of Object.entries(p.chart_data)) {
        map[outcome] = map[outcome] ? `${map[outcome]},${range}` : range;
    }
    return map;
}

function fieldingDisplay(p) {
    if (!p.fielding_ratings) return '';
    return Object.entries(p.fielding_ratings)
        .map(([pos, val]) => `${pos.replace(/LFRF/g, 'LF/RF')} ${val >= 0 ? '+' : ''}${val}`)
        .join(', ');
}

// Fielding rating at a single position (LF/RF share the "LFRF" key), or null.
function fieldingAt(p, pos) {
    if (!p.fielding_ratings) return null;
    const key = (pos === 'LF' || pos === 'RF') ? 'LFRF' : pos;
    const v = p.fielding_ratings[key];
    return v === undefined ? null : v;
}

// Value the Fielding column sorts on: the rating at the filtered position when one
// is chosen (so C+4 / 3B+3 sorts as 3 under a 3B filter), else the highest rating.
function fieldingSortValue(p) {
    if (filterPosition.value !== 'ALL') return fieldingAt(p, filterPosition.value);
    const vals = p.fielding_ratings ? Object.values(p.fielding_ratings) : [];
    return vals.length ? Math.max(...vals) : null;
}

// True if the card actually plays `pos`. displayPosition is a comma list of whole
// positions (e.g. "CF,LF/RF"), where the "LF/RF" token covers both LF and RF.
function playsPosition(p, pos) {
    return (p.displayPosition || '').split(',').some(token => {
        const t = token.trim();
        if (t === 'LF/RF') return pos === 'LF' || pos === 'RF';
        return t === pos;
    });
}

function speedDisplay(p) {
    if (isPitcher(p) || !p.speed) return '';
    const letter = SPEED_LETTER[String(p.speed)];
    return letter ? `${letter} (${p.speed})` : p.speed;
}

// League-team (fantasy owner) filter options, derived from the loaded cards.
const teamOptions = computed(() => {
    const map = new Map();
    players.value.forEach(p => {
        if (p.owned_by_team_id && !map.has(p.owned_by_team_id)) {
            map.set(p.owned_by_team_id, p.owned_by_team_city || p.owned_by_team_name || `Team ${p.owned_by_team_id}`);
        }
    });
    return [...map.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
});

// --- POSITION OPTIONS (depend on the active type) ---
const positionOptions = computed(() => {
    if (playerType.value === 'HITTERS') return HITTER_POSITIONS;
    if (playerType.value === 'PITCHERS') return PITCHER_POSITIONS;
    return [...HITTER_POSITIONS, ...PITCHER_POSITIONS];
});

// Point-set dropdown options, with the current-season set relabeled to match the
// rest of the app.
const pointSetOptions = computed(() =>
    authStore.pointSets.map(ps =>
        ps.name === CURRENT_SEASON_SET ? { ...ps, name: 'Current Season' } : ps
    )
);

// --- COLUMN VISIBILITY (driven by the type toggle) ---
const showHitterCols = computed(() => playerType.value !== 'PITCHERS');
const showPitcherCols = computed(() => playerType.value !== 'HITTERS');

// --- FILTER + SORT ---
const filteredPlayers = computed(() => {
    let list = players.value.filter(p => {
        // Type
        if (playerType.value === 'HITTERS' && isPitcher(p)) return false;
        if (playerType.value === 'PITCHERS' && !isPitcher(p)) return false;

        // Search
        if (searchQuery.value) {
            const q = searchQuery.value.toLowerCase();
            if (!(p.displayName || p.name || '').toLowerCase().includes(q)) return false;
        }

        // Position — match whole tokens of displayPosition (e.g. "CF,LF/RF"), so
        // filtering "C" doesn't also catch "CF".
        if (filterPosition.value !== 'ALL' && !playsPosition(p, filterPosition.value)) return false;

        // League team (fantasy owner)
        if (filterTeam.value !== 'ALL' && p.owned_by_team_id !== filterTeam.value) return false;

        // Set
        if (filterSet.value !== 'ALL' && p.set_name !== filterSet.value) return false;

        // Ownership
        if (filterOwned.value === 'OWNED' && !p.owned_by_team_id) return false;
        if (filterOwned.value === 'FREE' && p.owned_by_team_id) return false;

        // Numeric stat ranges (each gated to the type whose column is shown).
        if (!passesRange(num(p.points), ptsMin.value, ptsMax.value)) return false;
        if (showHitterCols.value) {
            if (!passesRange(hitterOB(p), obMin.value, obMax.value)) return false;
            if (!passesRange(speedNum(p), spdMin.value, spdMax.value)) return false;
        }
        if (showPitcherCols.value) {
            if (!passesRange(isPitcher(p) ? p.control : null, ctrlMin.value, ctrlMax.value)) return false;
            if (!passesRange(isPitcher(p) ? p.ip : null, ipMin.value, ipMax.value)) return false;
        }

        return true;
    });

    const dir = sortDir.value === 'asc' ? 1 : -1;
    list.sort((a, b) => {
        const cmp = compareBy(a, b, sortKey.value);
        if (cmp !== 0) return cmp * dir;
        // Stable tiebreak: last name ascending (independent of direction)
        return getLastName(a.displayName || a.name).localeCompare(getLastName(b.displayName || b.name));
    });
    return list;
});

function compareBy(a, b, key) {
    // Chart outcome columns sort by how many die-roll results land on that outcome
    // (e.g. GB "5-14" = 10 results), so the "highest" GB card has the widest GB
    // range and cards with no GB (0) sort to the bottom.
    if (CHART_OUTCOMES.includes(key)) {
        return rangeCount(chartByOutcome(a)[key]) - rangeCount(chartByOutcome(b)[key]);
    }
    // Each case returns a raw ascending comparison; the caller applies the
    // direction multiplier. (nullsLast handles its own direction so missing
    // values stay at the bottom either way.)
    switch (key) {
        case 'name': return getLastName(a.displayName || a.name).localeCompare(getLastName(b.displayName || b.name));
        case 'team': return (a.team || '').localeCompare(b.team || '');
        case 'pos': return (a.displayPosition || '').localeCompare(b.displayPosition || '');
        case 'set': return (a.set_name || '').localeCompare(b.set_name || '');
        case 'points': return num(a.points) - num(b.points);
        case 'on_base': return nullsLast(hitterOB(a), hitterOB(b));
        case 'speed': return nullsLast(speedNum(a), speedNum(b));
        case 'control': return nullsLast(isPitcher(a) ? a.control : null, isPitcher(b) ? b.control : null);
        case 'ip': return nullsLast(isPitcher(a) ? a.ip : null, isPitcher(b) ? b.ip : null);
        case 'fielding': return nullsLast(fieldingSortValue(a), fieldingSortValue(b));
        default: return 0;
    }
}

function nullsLast(a, b) {
    const aNull = a === null || a === undefined || Number.isNaN(a);
    const bNull = b === null || b === undefined || Number.isNaN(b);
    if (aNull && bNull) return 0;
    // Missing values always sink to the bottom regardless of sort direction.
    if (aNull) return sortDir.value === 'asc' ? Infinity : -Infinity;
    if (bNull) return sortDir.value === 'asc' ? -Infinity : Infinity;
    return a - b;
}

function num(v) { return Number(v) || 0; }
function hitterOB(p) { return isPitcher(p) ? null : p.on_base; }
function speedNum(p) { return isPitcher(p) ? null : Number(p.speed); }

// Min/max range test; an unset bound is ignored, and a missing value fails any
// active bound (so e.g. an OB filter excludes pitchers).
function passesRange(value, min, max) {
    const hasMin = min !== '' && min != null;
    const hasMax = max !== '' && max != null;
    if (!hasMin && !hasMax) return true;
    if (value == null || Number.isNaN(value)) return false;
    if (hasMin && value < Number(min)) return false;
    if (hasMax && value > Number(max)) return false;
    return true;
}

function setSort(key) {
    if (sortKey.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey.value = key;
        // Text columns default to A→Z; numeric/stat columns default to high→low.
        sortDir.value = ['name', 'team', 'pos', 'set'].includes(key) ? 'asc' : 'desc';
    }
}

function sortArrow(key) {
    if (sortKey.value !== key) return '';
    return sortDir.value === 'asc' ? ' ▲' : ' ▼';
}

// --- DATA ---
async function fetchPlayers() {
    if (!selectedPointSetId.value) return;
    loading.value = true;
    try {
        const res = await apiClient(`/api/cards/player?point_set_id=${selectedPointSetId.value}`);
        if (res.ok) {
            players.value = await res.json();
        }
    } catch (e) {
        console.error('Error fetching players:', e);
    } finally {
        loading.value = false;
    }
}

// Reset the position filter when the type changes so a stale (incompatible) value
// doesn't hide every row.
watch(playerType, () => { filterPosition.value = 'ALL'; });
watch(selectedPointSetId, fetchPlayers);

onMounted(async () => {
    await authStore.fetchPointSets();
    // Default to the current-season point set regardless of draft state; fall back
    // to the store's default, then the first available set.
    const currentSeason = authStore.pointSets.find(ps => ps.name === CURRENT_SEASON_SET);
    selectedPointSetId.value = currentSeason?.point_set_id
        ?? authStore.selectedPointSetId
        ?? authStore.pointSets[0]?.point_set_id
        ?? null;
    await fetchPlayers();
});
</script>

<template>
    <!-- Card modal: printed card + league-history breakdown -->
    <PlayerCardModal :player="selectedCard" @close="selectedCard = null" />

    <div class="players-container">
        <div class="players-header">
            <h2>Players</h2>
            <select v-if="pointSetOptions.length" v-model="selectedPointSetId" class="point-set-select">
                <option v-for="ps in pointSetOptions" :key="ps.point_set_id" :value="ps.point_set_id">
                    {{ ps.name }}
                </option>
            </select>
        </div>

        <!-- FILTER BAR -->
        <div class="filters">
            <div class="type-toggle">
                <button :class="{ active: playerType === 'ALL' }" @click="playerType = 'ALL'">All</button>
                <button :class="{ active: playerType === 'HITTERS' }" @click="playerType = 'HITTERS'">Hitters</button>
                <button :class="{ active: playerType === 'PITCHERS' }" @click="playerType = 'PITCHERS'">Pitchers</button>
            </div>

            <input v-model="searchQuery" placeholder="Search name..." class="search-input" />

            <select v-model="filterPosition" class="filter-select">
                <option value="ALL">All Pos</option>
                <option v-for="pos in positionOptions" :key="pos" :value="pos">{{ pos }}</option>
            </select>

            <select v-model="filterTeam" class="filter-select">
                <option value="ALL">All Teams</option>
                <option v-for="t in teamOptions" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>

            <select v-model="filterSet" class="filter-select">
                <option value="ALL">All Sets</option>
                <option value="Base">Base</option>
                <option value="PR">PR</option>
            </select>

            <select v-model="filterOwned" class="filter-select">
                <option value="ALL">All</option>
                <option value="OWNED">Rostered</option>
                <option value="FREE">Free Agents</option>
            </select>
        </div>

        <!-- Numeric stat range filters -->
        <div class="stat-filters">
            <span class="stat-filter">
                <label>Pts</label>
                <input type="number" v-model="ptsMin" placeholder="min" class="stat-input" />
                <span class="dash">–</span>
                <input type="number" v-model="ptsMax" placeholder="max" class="stat-input" />
            </span>
            <span v-if="showHitterCols" class="stat-filter">
                <label>OB</label>
                <input type="number" v-model="obMin" placeholder="min" class="stat-input" />
                <span class="dash">–</span>
                <input type="number" v-model="obMax" placeholder="max" class="stat-input" />
            </span>
            <span v-if="showHitterCols" class="stat-filter">
                <label>Spd</label>
                <input type="number" v-model="spdMin" placeholder="min" class="stat-input" />
                <span class="dash">–</span>
                <input type="number" v-model="spdMax" placeholder="max" class="stat-input" />
            </span>
            <span v-if="showPitcherCols" class="stat-filter">
                <label>Ctrl</label>
                <input type="number" v-model="ctrlMin" placeholder="min" class="stat-input" />
                <span class="dash">–</span>
                <input type="number" v-model="ctrlMax" placeholder="max" class="stat-input" />
            </span>
            <span v-if="showPitcherCols" class="stat-filter">
                <label>IP</label>
                <input type="number" v-model="ipMin" placeholder="min" class="stat-input" />
                <span class="dash">–</span>
                <input type="number" v-model="ipMax" placeholder="max" class="stat-input" />
            </span>
        </div>

        <div v-if="loading" class="loading">Loading players...</div>

        <template v-else>
            <div class="results-count">{{ filteredPlayers.length }} players</div>

            <div class="table-scroll">
                <table class="players-table">
                    <thead>
                        <tr>
                            <th class="col-owner">Team</th>
                            <th class="col-name sortable" @click="setSort('name')">Name{{ sortArrow('name') }}</th>
                            <th class="sortable" @click="setSort('pos')">Pos{{ sortArrow('pos') }}</th>
                            <th class="num sortable" @click="setSort('points')">Pts{{ sortArrow('points') }}</th>

                            <th v-if="showHitterCols" class="num sortable" @click="setSort('on_base')">OB{{ sortArrow('on_base') }}</th>
                            <th v-if="showHitterCols" class="num sortable" @click="setSort('speed')">Spd{{ sortArrow('speed') }}</th>

                            <th v-if="showPitcherCols" class="num sortable" @click="setSort('control')">Ctrl{{ sortArrow('control') }}</th>
                            <th v-if="showPitcherCols" class="num sortable" @click="setSort('ip')">IP{{ sortArrow('ip') }}</th>

                            <th v-for="o in CHART_OUTCOMES" :key="o" class="num chart-col sortable" @click="setSort(o)">{{ o }}{{ sortArrow(o) }}</th>

                            <th v-if="showHitterCols" class="col-field sortable" @click="setSort('fielding')">Fielding{{ sortArrow('fielding') }}</th>
                            <th class="sortable" @click="setSort('set')">Set{{ sortArrow('set') }}</th>
                            <th class="sortable" @click="setSort('team')">Tm{{ sortArrow('team') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="p in filteredPlayers" :key="p.card_id">
                            <td class="col-owner">
                                <img v-if="p.owned_by_team_logo" :src="p.owned_by_team_logo"
                                     :title="p.owned_by_team_city || p.owned_by_team_name" class="owner-logo" />
                            </td>
                            <td class="col-name">
                                <span class="clickable-name" @click="selectedCard = p">{{ p.displayName || p.name }}</span>
                            </td>
                            <td>{{ p.displayPosition }}</td>
                            <td class="num">{{ p.points }}</td>

                            <td v-if="showHitterCols" class="num">{{ isPitcher(p) ? '—' : p.on_base }}</td>
                            <td v-if="showHitterCols" class="num">{{ speedDisplay(p) || '—' }}</td>

                            <td v-if="showPitcherCols" class="num">{{ isPitcher(p) ? p.control : '—' }}</td>
                            <td v-if="showPitcherCols" class="num">{{ isPitcher(p) ? p.ip : '—' }}</td>

                            <td v-for="o in CHART_OUTCOMES" :key="o" class="num chart-col">
                                {{ formatRange(chartByOutcome(p)[o]) || '' }}
                            </td>

                            <td v-if="showHitterCols" class="col-field">{{ fieldingDisplay(p) }}</td>
                            <td>{{ p.set_name }}</td>
                            <td>{{ p.team }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <p v-if="!filteredPlayers.length" class="no-results">No players match these filters.</p>
        </template>
    </div>
</template>

<style scoped>
.players-container { max-width: 1400px; margin: 0 auto; padding: 1rem; }
.players-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; gap: 1rem; flex-wrap: wrap; }
.players-header h2 { margin: 0; }
.point-set-select { padding: 0.4rem; font-size: 0.9rem; }

.filters { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
.search-input { padding: 0.45rem 0.6rem; min-width: 180px; flex-grow: 1; max-width: 280px; box-sizing: border-box; }
.filter-select { padding: 0.45rem; }

.stat-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1.25rem; margin-bottom: 1rem; }
.stat-filter { display: flex; align-items: center; gap: 0.3rem; }
.stat-filter label { font-size: 0.85rem; font-weight: 600; color: #495057; }
.stat-input { width: 52px; padding: 0.35rem; box-sizing: border-box; }
.stat-filter .dash { color: #adb5bd; }

.type-toggle { display: inline-flex; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; }
.type-toggle button { background: #fff; border: none; padding: 0.45rem 0.9rem; cursor: pointer; font-weight: 600; color: #495057; border-right: 1px solid #e0e0e0; }
.type-toggle button:last-child { border-right: none; }
.type-toggle button.active { background: #007bff; color: #fff; }

.results-count { color: #6c757d; font-size: 0.85rem; margin-bottom: 0.5rem; }

.table-scroll { overflow-x: auto; border: 1px solid #ddd; border-radius: 6px; }
.players-table { border-collapse: collapse; font-size: 0.85rem; white-space: nowrap; width: 100%; }
.players-table th, .players-table td { padding: 0.35rem 0.55rem; border-bottom: 1px solid #eee; text-align: left; }
.players-table thead th { position: sticky; top: 0; background: #f2f2f2; z-index: 1; }
.players-table th.num, .players-table td.num { text-align: center; }
.players-table tbody tr:hover { background: #f0f8ff; }

.sortable { cursor: pointer; user-select: none; }
.sortable:hover { background: #e7e7e7; }

.chart-col { min-width: 38px; color: #444; }
.col-name { min-width: 150px; }
.col-field { color: #555; white-space: nowrap; }
.col-owner { text-align: center; }
.owner-logo { width: 22px; height: 22px; object-fit: contain; vertical-align: middle; }

.clickable-name { cursor: pointer; font-weight: 600; }
.clickable-name:hover { color: #007bff; text-decoration: underline; }

.loading, .no-results { padding: 2rem; text-align: center; color: #6c757d; }

.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 1000; padding: 1rem; box-sizing: border-box; }
.card-modal { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; justify-content: center; max-height: 92vh; overflow-y: auto; }
</style>
