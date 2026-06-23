<script setup>
import { ref, watch, onMounted, computed } from 'vue';
import { apiClient } from '@/services/api';
import { ensureCaptaincies, seasonCaptaincy } from '@/services/captaincy';

const props = defineProps({
    cardId: [Number, String],
    playerName: String
});

// All trophy images live on the backend (same source the rest of the app uses).
const apiBase = import.meta.env.VITE_API_URL || 'https://mlb-showdown-2001.onrender.com';
const TROPHY = {
    spaceship: `${apiBase}/images/golden_spaceship.png`,
    submarine: `${apiBase}/images/silver_submarine.png`,
    spoon: `${apiBase}/images/wooden_spoon.png`,
    mva: `${apiBase}/images/mva.png`,
    lvsc: `${apiBase}/images/lvsc.png`,
    tgaoot: `${apiBase}/images/tgaoot.png`
};
// Ordered so each diamond sits next to its related award.
const HONOR_DEFS = [
    { key: 'spaceship', title: 'Golden Spaceship' },
    { key: 'mva', title: 'MVA' },
    { key: 'submarine', title: 'Silver Submarine' },
    { key: 'tgaoot', title: 'TGAOOT' },
    { key: 'spoon', title: 'Wooden Spoon' },
    { key: 'lvsc', title: 'LVSC' }
];

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
onMounted(() => { fetchHistory(); ensureCaptaincies(); });

// Per-season captaincy ("C") for this card on the league card back.
const seasonCaptain = (season) => seasonCaptaincy(props.cardId, season);
const seasonCaptainStyle = (season) => {
    const c = seasonCaptain(season);
    // Match the card-front captain "C": secondary fill, primary felt-edge stroke.
    return { color: c.secondary, '--cap-stroke': c.primary };
};

const seasons = computed(() => data.value?.seasons || []);
const classic = computed(() => data.value?.classic || []);
const totals = computed(() => data.value?.totals || {});
const hasAny = computed(() => seasons.value.length > 0 || classic.value.length > 0);

const careerRecord = computed(() => {
    const t = totals.value;
    const w = t.wins || 0, l = t.losses || 0;
    if (w + l === 0) return null;
    const pct = (w / (w + l)).toFixed(3).replace(/^0\./, '.');
    return `${w}-${l} (${pct})`;
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

// Resolve a team logo URL (relative /images/... paths live on the backend).
function logoSrc(logo) {
    if (!logo) return '';
    return logo.startsWith('http') ? logo : `${apiBase}${logo}`;
}

// Honor icons for a season row (league or classic).
function honorsFor(obj) {
    return HONOR_DEFS.filter(h => obj[h.key]).map(h => ({ img: TROPHY[h.key], title: h.title }));
}

// Summary chips across the top — every honor the player has earned, with counts.
const summaryHonors = computed(() => {
    const t = totals.value;
    const map = { spaceship: t.spaceships, submarine: t.submarines, spoon: t.spoons, mva: t.mvas, lvsc: t.lvscs, tgaoot: t.tgaoots };
    return HONOR_DEFS.filter(h => map[h.key]).map(h => ({ img: TROPHY[h.key], n: map[h.key], title: h.title }));
});
</script>

<template>
    <div class="card-back">
        <div class="cb-header">
            <span class="cb-name">{{ playerName }}</span>
            <span class="cb-sub">League History</span>
            <span v-if="careerRecord" class="cb-record">Career {{ careerRecord }}</span>
        </div>

        <div v-if="loading" class="cb-state">Loading…</div>

        <template v-else-if="hasAny">
            <div v-if="summaryHonors.length" class="cb-summary">
                <span v-for="(h, i) in summaryHonors" :key="i" class="sum-honor" :title="h.title">
                    <img :src="h.img" :alt="h.title" /><span class="sum-n">×{{ h.n }}</span>
                </span>
            </div>

            <div class="cb-body">
                <table v-if="seasons.length" class="cb-table">
                    <thead>
                        <tr>
                            <th>Season</th><th>Tm</th><th>Pos</th>
                            <th class="num">Pts</th><th class="num">Rec</th><th>Honors</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(s, i) in seasons" :key="i">
                            <td>{{ abbrevSeason(s.season) }}</td>
                            <td :title="s.team"><img v-if="s.logo" :src="logoSrc(s.logo)" class="tm-logo" alt="" />{{ s.team_abbr || '—' }}</td>
                            <td>{{ s.position || '—' }}</td>
                            <td class="num">{{ s.points != null ? s.points : '' }}</td>
                            <td class="num">{{ s.wins != null ? `${s.wins}-${s.losses}` : '' }}</td>
                            <td class="honors">
                                <span v-if="seasonCaptain(s.season).captain" class="cb-cap" :style="seasonCaptainStyle(s.season)" title="Captain">C</span>
                                <img v-for="(h, i) in honorsFor(s)" :key="i" :src="h.img" class="t-icon" :title="h.title" />
                            </td>
                        </tr>
                    </tbody>
                </table>

                <div v-if="classic.length" class="cb-classic">
                    <div class="cb-classic-head">Classic</div>
                    <table class="cb-table">
                        <thead>
                            <tr><th>Season</th><th>Tm</th><th>Pos</th><th class="num">Rec</th><th>Honors</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="(c, i) in classic" :key="i">
                                <td>{{ abbrevSeason(c.season) }}</td>
                                <td :title="c.team"><img v-if="c.logo" :src="logoSrc(c.logo)" class="tm-logo" alt="" />{{ c.team_abbr || '—' }}</td>
                                <td>{{ c.position || '—' }}</td>
                                <td class="num">{{ c.wins != null ? `${c.wins}-${c.losses}` : '' }}</td>
                                <td class="honors">
                                    <img v-for="(h, i) in honorsFor(c)" :key="i" :src="h.img" class="t-icon" :title="h.title" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
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
.sum-n { font-size: 0.52rem; font-weight: 700; }

.cb-body { flex: 1; overflow-y: auto; margin-top: 2px; }
.cb-table { width: 100%; border-collapse: collapse; font-size: 0.52rem; }
.cb-table th, .cb-table td { padding: 1px 2px; text-align: left; white-space: nowrap; }
.cb-table thead th { position: sticky; top: 0; background: #ece1c4; color: #6f6038; font-size: 0.48rem; text-transform: uppercase; letter-spacing: 0.02em; }
.cb-table tbody tr:nth-child(even) { background: rgba(0, 0, 0, 0.03); }
.cb-table .num { text-align: right; }
.tm-logo { width: 16px; height: 12px; object-fit: contain; object-position: center; vertical-align: -2px; margin-right: 3px; flex: 0 0 auto; }

.cb-classic { margin-top: 6px; }
.cb-classic-head { font-size: 0.5rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #8a7a52; border-top: 1px solid #d8cca8; padding-top: 3px; margin-bottom: 1px; }

.honors { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; }
.t-icon { height: 12px; width: auto; }
.cb-cap { display: inline-flex; align-items: center; justify-content: center; font-family: 'Graduate', Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 0.85rem; line-height: 1; -webkit-text-stroke: 1.6px var(--cap-stroke); paint-order: stroke fill; flex: 0 0 auto; margin-right: 1px; }
</style>
