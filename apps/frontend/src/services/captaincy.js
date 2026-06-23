// Global captaincy data, fetched once and shared so any PlayerCard can stamp its
// captain / core-squad / Face badges without each surface wiring it up.
import { reactive } from 'vue';
import { apiClient } from './api';

const state = reactive({ loaded: false, data: null });
let inflight = null;

export function captaincyState() { return state; }

export async function ensureCaptaincies() {
    if (state.loaded) return state.data;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const res = await apiClient('/api/captaincies');
            if (res.ok) { state.data = await res.json(); state.loaded = true; }
        } catch (e) {
            console.error('Failed to load captaincies:', e);
        } finally {
            inflight = null;
        }
        return state.data;
    })();
    return inflight;
}

const EMPTY = { faces: [], coreSquads: [], captain: null };

// Franchises whose Face logo reads better on a team-color disc, and which team color
// fills the disc ('primary' or 'secondary' — e.g. the Colossus logo is gray, so its
// disc uses the yellow secondary). Others show the bare logo.
const FACE_DISC = { Boston: 'primary', 'New York': 'secondary' };

// Badges for a card, each carrying its own franchise's colors so a player can show
// marks from MULTIPLE teams at once (e.g. Face of one club, core squad of another).
// teamId pins to a single franchise (team page); otherwise we include every team
// where the card is captain / Face / core squad. Captain is unique (current roster).
export function cardBadges(cardId, teamId = null) {
    const d = state.data;
    if (!d || cardId == null) return EMPTY;
    const cid = Number(cardId);
    const teamIds = teamId != null ? [String(teamId)] : Object.keys(d.teamsMeta || {});
    const faces = [];
    const coreSquads = [];
    let captain = null;
    for (const tid of teamIds) {
        const meta = (d.teamsMeta || {})[tid] || {};
        const primary = meta.primary || '#ffc107';
        const secondary = meta.secondary || '#000000';
        if (d.currentCaptains?.[tid] === cid && !captain) captain = { primary, secondary };
        if (d.faces?.[tid] === cid) {
            const discFill = FACE_DISC[meta.city]; // 'primary' | 'secondary' | undefined
            faces.push({
                logo: meta.logo || '',
                faceBg: !!discFill,
                faceBgColor: discFill === 'secondary' ? secondary : primary,
                faceBorderColor: discFill === 'secondary' ? primary : secondary
            });
        }
        if ((d.coreSquads?.[tid] || []).includes(cid)) coreSquads.push({ primary, secondary });
    }
    return { faces, coreSquads, captain };
}

// Was this card its team's captain in a given season? (card-back, per-season.)
export function seasonCaptaincy(cardId, season) {
    const d = state.data;
    if (!d || cardId == null || !season) return { captain: false, primary: '#ffc107', secondary: '#000000' };
    const cid = Number(cardId);
    for (const tid of Object.keys(d.captains || {})) {
        if (d.captains[tid][season] === cid) {
            const meta = (d.teamsMeta || {})[tid] || {};
            return { captain: true, primary: meta.primary || '#ffc107', secondary: meta.secondary || '#000000' };
        }
    }
    return { captain: false, primary: '#ffc107', secondary: '#000000' };
}
