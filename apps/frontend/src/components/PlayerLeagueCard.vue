<script setup>
import { ref, watch, onMounted, computed } from 'vue';
import { apiClient } from '@/services/api';

const props = defineProps({
    cardId: [Number, String],
    playerName: String
});

// Trophy images live on the backend (same source the rest of the app uses).
const apiBase = import.meta.env.VITE_API_URL || 'https://mlb-showdown-2001.onrender.com';
const TROPHY = {
    spaceship: `${apiBase}/images/golden_spaceship.png`,
    submarine: `${apiBase}/images/silver_submarine.png`,
    spoon: `${apiBase}/images/wooden_spoon.png`
};
// The name-based awards use emoji "trophies".
const EMOJI = { mva: '🧑‍🚀', lvsc: '🧑‍🍳', tgaoot: '⚓' };

const loading = ref(true);
const data = ref(null);

async function fetchHistory() {
    if (props.cardId == null) return;
    loading.value = true;
    data.value = null;
    try {
        const res = await apiClient(`/api/players/${props.cardId}/league-history`);
        if (res.ok) data.value = await res.json();
    } catch (e) {
        console.error('Error fetching league history:', e);
    } finally {
        loading.value = false;
    }
}

watch(() => props.cardId, fetchHistory);
onMounted(fetchHistory);

const seasons = computed(() => data.value?.seasons || []);
const totals = computed(() => data.value?.totals || {});
const hasHistory = computed(() => seasons.value.length > 0);

const careerRecord = computed(() => {
    const t = totals.value;
    return (t.wins || 0) + (t.losses || 0) > 0 ? `${t.wins}-${t.losses}` : null;
});

// Compact season label: "Early July 2020" -> "E Jul '20", "Fall 2025" -> "Fall '25".
const MONTHS = {
    january: 'Jan', february: 'Feb', march: 'Mar', april: 'Apr', may: 'May', june: 'Jun',
    july: 'Jul', august: 'Aug', september: 'Sep', october: 'Oct', november: 'Nov', december: 'Dec'
};
const WORDS = { fall: 'Fall', spring: 'Spr', summer: 'Sum', winter: 'Win', early: 'E', mid: 'M', late: 'L' };
function abbrevSeason(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    const year = parts[parts.length - 1];
    const body = parts.slice(0, -1).map(w => {
        const lw = w.toLowerCase();
        return MONTHS[lw] || WORDS[lw] || w;
    }).join(' ');
    return `${body} '${year.slice(-2)}`;
}

// Summary chips across the top — only honors the player actually has.
const summaryHonors = computed(() => {
    const t = totals.value;
    const out = [];
    if (t.spaceships) out.push({ img: TROPHY.spaceship, n: t.spaceships, title: 'Golden Spaceship' });
    if (t.submarines) out.push({ img: TROPHY.submarine, n: t.submarines, title: 'Silver Submarine' });
    if (t.spoons) out.push({ img: TROPHY.spoon, n: t.spoons, title: 'Wooden Spoon' });
    if (t.mvas) out.push({ emoji: EMOJI.mva, n: t.mvas, title: 'MVA' });
    if (t.lvscs) out.push({ emoji: EMOJI.lvsc, n: t.lvscs, title: 'LVSC' });
    if (t.tgaoots) out.push({ emoji: EMOJI.tgaoot, n: t.tgaoots, title: 'TGAOOT' });
    return out;
});

// Per-season honor icons.
function honors(s) {
    const out = [];
    if (s.spaceship) out.push({ img: TROPHY.spaceship, title: 'Golden Spaceship' });
    if (s.submarine) out.push({ img: TROPHY.submarine, title: 'Silver Submarine' });
    if (s.spoon) out.push({ img: TROPHY.spoon, title: 'Wooden Spoon' });
    if (s.mva) out.push({ emoji: EMOJI.mva, title: 'MVA' });
    if (s.lvsc) out.push({ emoji: EMOJI.lvsc, title: 'LVSC' });
    if (s.tgaoot) out.push({ emoji: EMOJI.tgaoot, title: 'TGAOOT' });
    return out;
}
</script>

<template>
    <div class="card-back">
        <div class="cb-header">
            <span class="cb-name">{{ playerName }}</span>
            <span class="cb-sub">League History</span>
            <span v-if="careerRecord" class="cb-record">Career {{ careerRecord }}</span>
        </div>

        <div v-if="loading" class="cb-state">Loading…</div>

        <template v-else-if="hasHistory">
            <div v-if="summaryHonors.length" class="cb-summary">
                <span v-for="(h, i) in summaryHonors" :key="i" class="sum-honor" :title="h.title">
                    <img v-if="h.img" :src="h.img" :alt="h.title" />
                    <span v-else class="sum-emoji">{{ h.emoji }}</span>
                    <span class="sum-n">×{{ h.n }}</span>
                </span>
            </div>

            <div class="cb-body">
                <table class="cb-table">
                    <thead>
                        <tr>
                            <th>Season</th>
                            <th>Tm</th>
                            <th>Pos</th>
                            <th class="num">Pts</th>
                            <th class="num">Rec</th>
                            <th>Honors</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="s in seasons" :key="s.season">
                            <td>{{ abbrevSeason(s.season) }}</td>
                            <td :title="s.team">{{ s.team_abbr || '—' }}</td>
                            <td>{{ s.position || '—' }}</td>
                            <td class="num">{{ s.points != null ? s.points : '' }}</td>
                            <td class="num">{{ s.wins != null ? `${s.wins}-${s.losses}` : '' }}</td>
                            <td class="honors">
                                <template v-for="(h, i) in honors(s)" :key="i">
                                    <img v-if="h.img" :src="h.img" class="t-icon" :title="h.title" />
                                    <span v-else class="e-icon" :title="h.title">{{ h.emoji }}</span>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>

        <div v-else class="cb-state">No league history yet.</div>
    </div>
</template>

<style scoped>
.card-back {
    width: 100%;
    max-width: 200px;
    aspect-ratio: 220 / 308;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: #f4ecd8;
    border: 1px solid #cbbf9f;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    padding: 7px 8px;
    overflow: hidden;
    color: #2c2417;
}

.cb-header { text-align: center; line-height: 1.15; padding-bottom: 4px; border-bottom: 1px solid #d8cca8; }
.cb-name { display: block; font-weight: 800; font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-sub { display: block; font-size: 0.52rem; letter-spacing: 0.08em; text-transform: uppercase; color: #8a7a52; }
.cb-record { display: block; font-size: 0.56rem; font-weight: 700; color: #5a4f33; margin-top: 1px; }

.cb-state { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 0.62rem; color: #8a7a52; text-align: center; }

.cb-summary { display: flex; flex-wrap: wrap; gap: 3px 5px; align-items: center; padding: 4px 0; }
.sum-honor { display: inline-flex; align-items: center; gap: 1px; }
.sum-honor img { height: 15px; width: auto; }
.sum-emoji { font-size: 0.8rem; line-height: 1; }
.sum-n { font-size: 0.52rem; font-weight: 700; }

.cb-body { flex: 1; overflow-y: auto; margin-top: 2px; }
.cb-table { width: 100%; border-collapse: collapse; font-size: 0.52rem; }
.cb-table th, .cb-table td { padding: 1px 2px; text-align: left; white-space: nowrap; }
.cb-table thead th { position: sticky; top: 0; background: #ece1c4; color: #6f6038; font-size: 0.48rem; text-transform: uppercase; letter-spacing: 0.02em; }
.cb-table tbody tr:nth-child(even) { background: rgba(0, 0, 0, 0.03); }
.cb-table .num { text-align: right; }

.honors { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; }
.t-icon { height: 12px; width: auto; }
.e-icon { font-size: 0.72rem; line-height: 1; }
</style>
