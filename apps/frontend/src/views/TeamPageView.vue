<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient } from '@/services/api';
import PlayerCard from '@/components/PlayerCard.vue';
import PlayerCardModal from '@/components/PlayerCardModal.vue';
import { formatNameShort } from '@/utils/playerUtils';
import { getLogoForTeam } from '@/utils/franchiseUtils';

const route = useRoute();
const teamId = ref(route.params.teamId);
const teamData = ref(null);
const loading = ref(true);
const selectedPlayer = ref(null);
const apiUrl = import.meta.env.VITE_API_URL || '';

// --- Captaincy / Core Squad / Face of the Franchise ---
const captaincy = computed(() => teamData.value?.captaincy || { captains: {}, currentCaptain: null, face: null, playerScores: { byCard: {}, byName: {} } });
const teamColors = computed(() => ({
    primary: teamData.value?.team?.primary_color || '#ffc107',
    secondary: teamData.value?.team?.secondary_color || '#000000'
}));
// Matches the card captain "C": secondary fill, primary felt-edge stroke.
const capBadgeStyle = computed(() => ({ color: teamColors.value.secondary, '--cap-stroke': teamColors.value.primary }));

const normalizePlayer = (s) => (s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const samePlayer = (player, ref) => {
    if (!player || !ref) return false;
    if (player.card_id != null && ref.card_id != null) return player.card_id === ref.card_id;
    return normalizePlayer(player.displayName || player.name) === normalizePlayer(ref.name);
};

// "C" beside a player's name in the matrices marks that season's captain.
const isSeasonCaptain = (player, captain) => samePlayer(player, captain);

// The Face's full player object (with card art), taken from roster history.
const facePlayer = computed(() => {
    const f = captaincy.value.face;
    if (!f) return null;
    for (const r of (teamData.value?.rosters || [])) {
        for (const p of r.players) if (samePlayer(p, f)) return p;
    }
    return null;
});

// --- DYNAMIC COLUMNS LOGIC ---

// Calculate max number of RPs and Bench players across all seasons (Regular AND Classic)
const maxCols = computed(() => {
    let maxRp = 2; // Minimum 2 RPs shown
    let maxBench = 1; // Minimum 1 Bench col

    const allRosters = [
        ...(teamData.value?.rosters || []),
        ...(teamData.value?.classicRosters || [])
    ];

    if (allRosters.length === 0) return { rp: maxRp, bench: maxBench };

    allRosters.forEach(r => {
        const { rpCount, benchCount } = getCountsForSeason(r.players);
        if (rpCount > maxRp) maxRp = rpCount;
        if (benchCount > maxBench) maxBench = benchCount;
    });

    return { rp: maxRp, bench: maxBench };
});

const getCountsForSeason = (rosterPlayers) => {
    let rpCount = 0;
    let benchCount = 0;
    rosterPlayers.forEach(p => {
        // Consistent pitcher check with organizeRosterForMatrix
        const isPitcher = (p.ip && Number(p.ip) > 0) || (p.control !== undefined && p.control !== null) || p.position === 'SP' || p.position === 'RP';
        const pos = p.assignment || p.position;

        if (isPitcher) {
            // Count as RP if position is RP OR if stats imply RP (ip <= 3) and not explicitly assigned SP
            if (p.position === 'RP' || (Number(p.ip) <= 3 && p.position !== 'SP')) {
                 rpCount++;
            }
        } else {
            if (pos === 'BENCH' || pos === 'B') {
                benchCount++;
            } else if (!['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].includes(pos)) {
                 benchCount++; // Fallback for weirder positions
            }
        }
    });
    return { rpCount, benchCount };
};

// Organize roster for matrix display
const organizeRosterForMatrix = (rosterPlayers) => {
    // Create map for batters: { C: player, 1B: player, ... }
    const batterMap = {
        'C': [], '1B': [], '2B': [], '3B': [], 'SS': [],
        'LF': [], 'CF': [], 'RF': [], 'DH': [], 'B': []
    };

    // Create map for pitchers: { SP: [], RP: [] }
    const pitcherMap = { 'SP': [], 'RP': [] };

    rosterPlayers.forEach(p => {
        // Check if pitcher - Correctly handle null control from backend
        const isPitcher = (p.ip && Number(p.ip) > 0) || (p.control !== undefined && p.control !== null) || p.position === 'SP' || p.position === 'RP';

        if (isPitcher) {
            const pos = (Number(p.ip) > 3 || p.position === 'SP') ? 'SP' : 'RP';
            pitcherMap[pos].push(p);
        } else {
            // Batter
            let pos = p.assignment || p.position;
            if (pos === 'BENCH') pos = 'B';
            if (!batterMap[pos]) batterMap['B'].push(p); // Fallback to bench
            else batterMap[pos].push(p);
        }
    });

    // We only take the top player for starting spots in matrix (if multiples exist for 1 position)
    const batterRow = {};
    ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].forEach(pos => {
        batterRow[pos] = batterMap[pos].length > 0 ? batterMap[pos][0] : null;
    });

    // Flatten Bench: Bench 1, Bench 2, ...
    const benches = batterMap['B'].sort((a,b) => (b.points || 0) - (a.points || 0));
    for (let i = 0; i < maxCols.value.bench; i++) {
        batterRow[`Bench${i+1}`] = benches[i] || null;
    }

    // For pitchers, we want SP1, SP2, SP3, SP4
    const sps = pitcherMap['SP'].sort((a,b) => (b.points || 0) - (a.points || 0));
    batterRow['SP1'] = sps[0] || null;

    const pitchersRow = {
        'SP1': sps[0] || null,
        'SP2': sps[1] || null,
        'SP3': sps[2] || null,
        'SP4': sps[3] || null
    };

    // Flatten RPs: RP1, RP2, ... RP_Max
    const rps = pitcherMap['RP'].sort((a,b) => (b.points || 0) - (a.points || 0));
    for (let i = 0; i < maxCols.value.rp; i++) {
        pitchersRow[`RP${i+1}`] = rps[i] || null;
    }

    return { batterRow, pitchersRow };
};

const processedHistory = computed(() => {
    if (!teamData.value?.rosters) return [];

    return teamData.value.rosters.map(r => {
        const { batterRow, pitchersRow } = organizeRosterForMatrix(r.players);

        // Find the regular-season entry (history now contains both regular + classic)
        const historyItem = teamData.value.history.find(h => h.season === r.season && !h.isClassic);
        const result = historyItem ? historyItem.result : '';

        return {
            season: r.season,
            batters: batterRow,
            pitchers: pitchersRow,
            result,
            captain: teamData.value.captaincy?.captains?.[r.season] || null,
            mvaName: extractAwardPlayerName(historyItem?.mva),
            lvscName: extractAwardPlayerName(historyItem?.lvsc),
            tgaootName: extractAwardPlayerName(historyItem?.tgaoot)
        };
    });
});

// Backend now returns a pre-sorted combined list with isClassic flag
const combinedHistory = computed(() => teamData.value?.history || []);

// Extract just the player name portion from award text like "Alex Rodriguez (TEX) (BOS), notes..."
const extractAwardPlayerName = (awardText) => {
    if (!awardText) return null;
    const match = awardText.match(/^([^(,]+)/);
    return match ? match[1].trim() : null;
};

const isAwardWinner = (player, awardName) => {
    if (!player || !awardName) return false;
    const name = (player.displayName || player.name || '').toLowerCase();
    return name.includes(awardName.toLowerCase());
};

// Season-result accolade classification (drives the small Result badge).
const isChampionResult = (result) => !!result && result.includes('Champion');
const isSpoonResult = (result) => !!result && result.includes('Wooden Spoon') && !result.includes('Participant');
const isSubmarineResult = (result) => !!result && result.includes('Silver Submarine') && !result.includes('Participant');

const processedClassicHistory = computed(() => {
    if (!teamData.value?.classicRosters) return [];

    return teamData.value.classicRosters.map(r => {
        const { batterRow, pitchersRow } = organizeRosterForMatrix(r.players);

        // Find season result for highlighting — match by classicName (roster key) or fall back to season
        const historyItem = teamData.value.classicHistory?.find(h =>
            (h.classicName && h.classicName === r.season) || h.season === r.season
        );
        const result = historyItem ? historyItem.result : '';

        return {
            season: r.season,
            batters: batterRow,
            pitchers: pitchersRow,
            result,
            mvaName: extractAwardPlayerName(historyItem?.mva),
            lvscName: extractAwardPlayerName(historyItem?.lvsc),
            tgaootName: extractAwardPlayerName(historyItem?.tgaoot)
        };
    });
});

// Core Squad comes from the backend (single source shared with the card "CS" badges).
// Look up each slot's full player object (with card art) from roster history so the
// footer cell can still open the card modal.
const cardLookup = computed(() => {
    const m = {};
    (teamData.value?.rosters || []).forEach(r => r.players.forEach(p => { if (p.card_id != null) m[p.card_id] = p; }));
    return m;
});
const coreSquadData = computed(() => teamData.value?.captaincy?.coreSquad || { batters: {}, pitchers: {}, members: [] });

const mostCommonPlayers = computed(() => {
    const mapSlots = (slots) => {
        const out = {};
        for (const key in slots) {
            const e = slots[key];
            out[key] = {
                name: formatNameShort(e.name, true),
                player: cardLookup.value[e.card_id] || { card_id: e.card_id, name: e.name, displayName: e.name }
            };
        }
        return out;
    };
    return { batters: mapSlots(coreSquadData.value.batters), pitchers: mapSlots(coreSquadData.value.pitchers) };
});

// The Core Squad slot held by the Face of the Franchise gets the logo + emphasis.
const isFaceCore = (group, slot) => {
    const map = group === 'batter' ? mostCommonPlayers.value.batters : mostCommonPlayers.value.pitchers;
    const entry = map[slot];
    return entry?.player ? samePlayer(entry.player, captaincy.value.face) : false;
};

const hoveredBatterCol = ref(null);
const hoveredPitcherCol = ref(null);

// Fetch team data on mount or when teamId changes
async function fetchTeamData() {
  loading.value = true;
  try {
    const response = await apiClient(`/api/teams/${teamId.value}/history`);
    if (response.ok) {
      teamData.value = await response.json();
    } else {
      console.error('Failed to fetch team data');
    }
  } catch (error) {
    console.error('Error fetching team data:', error);
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.teamId, (newId) => {
  teamId.value = newId;
  fetchTeamData();
});

onMounted(() => {
  fetchTeamData();
});

function openPlayerCard(player) {
    if (player) selectedPlayer.value = player;
}

function closePlayerCard() {
    selectedPlayer.value = null;
}

// Display Name Helper
const teamDisplayName = computed(() => {
  if (!teamData.value?.team) return '';
  const team = teamData.value.team;
  const format = team.display_format || '{city} {name}';
  return format.replace('{city}', team.city).replace('{name}', team.name);
});
</script>

<template>
  <div class="team-page-container" v-if="teamData">
    <!-- HEADER -->
    <header class="team-header" :style="{ backgroundColor: teamData.team.primary_color, color: teamData.team.secondary_color }">
      <img :src="teamData.team.logo_url" :alt="teamData.team.name" class="team-logo" />
      <div class="team-info">
        <h1>{{ teamDisplayName }}</h1>
        <p v-if="teamData.team.owner_first_name">Owner: {{ teamData.team.owner_first_name }} {{ teamData.team.owner_last_name }}</p>

        <div v-if="teamData.identityHistory && teamData.identityHistory.length > 0" class="identity-history">
             <span class="identity-label">Franchise History:</span>
             <ul class="identity-list">
                 <li v-for="(identity, idx) in teamData.identityHistory" :key="idx" class="identity-item">
                     <span>{{ identity.name }} ({{ identity.start === identity.end ? identity.start : `${identity.start}-${identity.end}` }})</span>
                     <img v-if="getLogoForTeam(identity.name)" :src="getLogoForTeam(identity.name)" class="identity-logo" />
                 </li>
             </ul>
        </div>
      </div>
      <div v-if="facePlayer" class="header-face" @click="openPlayerCard(facePlayer)" :title="`Face of the Franchise: ${facePlayer.displayName || facePlayer.name}`">
          <PlayerCard :player="facePlayer" />
          <span class="header-face-label">Face of the Franchise</span>
      </div>

      <div class="accolades">
          <div v-if="teamData.accolades.spaceships.length > 0" class="accolade-row">
            <div v-for="(accolade, index) in teamData.accolades.spaceships" :key="accolade.season_name + index" class="accolade-item desktop-only">
              <img :src="`${apiUrl}/images/golden_spaceship.png`" :title="accolade.season_name" class="accolade-icon" alt="Golden Spaceship" />
            </div>
            <div class="accolade-item mobile-only">
              <img :src="`${apiUrl}/images/golden_spaceship.png`" class="accolade-icon" alt="Golden Spaceship" />
              <span class="accolade-count">: {{ teamData.accolades.spaceships.length }}</span>
            </div>
          </div>

          <div v-if="teamData.accolades.spoons.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamData.accolades.spoons" :key="accolade.season_name + index" class="accolade-item desktop-only">
               <img :src="`${apiUrl}/images/wooden_spoon.png`" :title="accolade.season_name" class="accolade-icon" alt="Wooden Spoon" />
             </div>
             <div class="accolade-item mobile-only">
               <img :src="`${apiUrl}/images/wooden_spoon.png`" class="accolade-icon" alt="Wooden Spoon" />
               <span class="accolade-count">: {{ teamData.accolades.spoons.length }}</span>
             </div>
          </div>

          <div v-if="teamData.accolades.submarines && teamData.accolades.submarines.length > 0" class="accolade-row">
             <div v-for="(accolade, index) in teamData.accolades.submarines" :key="accolade.season_name + index" class="accolade-item desktop-only">
               <img :src="`${apiUrl}/images/silver_submarine.png`" :title="accolade.season_name" class="accolade-icon" alt="Silver Submarine" />
             </div>
             <div class="accolade-item mobile-only">
               <img :src="`${apiUrl}/images/silver_submarine.png`" class="accolade-icon" alt="Silver Submarine" />
               <span class="accolade-count">: {{ teamData.accolades.submarines.length }}</span>
             </div>
          </div>
      </div>
    </header>

    <main class="team-main">
        <!-- SEASON HISTORY TABLE -->
        <section class="section history-section">
            <h2>Season History</h2>
            <div class="table-scroll">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Season</th>
                            <th>Record</th>
                            <th>Win %</th>
                            <th>Result</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Row tinted with the dialed-down League finale palette for accolade
                             seasons; the small Result badge stays on top. -->
                        <tr v-for="season in combinedHistory" :key="season.season + (season.isClassic ? '-classic' : '')"
                            :class="{
                                'classic-row': season.isClassic,
                                'gold-bg': isChampionResult(season.result),
                                'silver-bg': isSubmarineResult(season.result),
                                'brown-bg': isSpoonResult(season.result)
                            }">
                            <td class="season-name">
                                <RouterLink :to="season.isClassic ? { path: `/teams/${teamId}/seasons/${encodeURIComponent(season.classicName || season.originalSeason || season.season)}`, query: { type: 'Classic' } } : `/teams/${teamId}/seasons/${season.season}`" class="season-link">
                                    {{ season.isClassic ? (season.classicName || season.season) : season.season }}<span v-if="season.isClassic" class="classic-badge">C</span>
                                </RouterLink>
                            </td>
                            <td>{{ season.wins }}-{{ season.losses }}</td>
                            <td>{{ season.winPct }}</td>
                            <td class="result-cell">
                                <span v-if="isChampionResult(season.result)" class="result-badge badge-champion">
                                    <img :src="`${apiUrl}/images/golden_spaceship.png`" class="badge-trophy" alt="" /> {{ season.result }}
                                </span>
                                <span v-else-if="isSpoonResult(season.result)" class="result-badge badge-spoon">
                                    <img :src="`${apiUrl}/images/wooden_spoon.png`" class="badge-trophy" alt="" /> {{ season.result }}
                                </span>
                                <span v-else-if="isSubmarineResult(season.result)" class="result-badge badge-submarine">
                                    <img :src="`${apiUrl}/images/silver_submarine.png`" class="badge-trophy" alt="" /> {{ season.result }}
                                </span>
                                <span v-else>{{ season.result }}</span>
                                <div v-if="season.mva" class="award-line mva-line">MVA: {{ season.mva }}</div>
                                <div v-if="season.lvsc" class="award-line lvsc-line">LVSC: {{ season.lvsc }}</div>
                                <div v-if="season.tgaoot" class="award-line tgaoot-line">TGOAAT: {{ season.tgaoot }}</div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- ROSTER MATRIX: BATTERS -->
        <section class="section rosters-section">
            <h2>Position Player History</h2>
            <div class="table-scroll">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th class="sticky-col">Season</th>
                            <th v-for="(pos, idx) in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']" :key="pos"
                                @mouseenter="hoveredBatterCol = idx" @mouseleave="hoveredBatterCol = null"
                                :class="{'col-hover': hoveredBatterCol === idx}">
                                {{ pos }}
                            </th>
                            <!-- Dynamic Bench Headers -->
                            <th v-for="i in maxCols.bench" :key="`bench-head-${i}`"
                                @mouseenter="hoveredBatterCol = 8 + i" @mouseleave="hoveredBatterCol = null"
                                :class="{'col-hover': hoveredBatterCol === 8 + i}">
                                B{{i > 1 ? i : ''}}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in processedHistory" :key="row.season" :class="{'gold-bg': row.result && row.result.includes('Champion'), 'silver-bg': row.result && row.result.includes('Silver Submarine') && !row.result.includes('Participant'), 'brown-bg': row.result && row.result.includes('Wooden Spoon') && !row.result.includes('Participant')}">
                            <td class="season-cell sticky-col">
                                <RouterLink :to="`/teams/${teamId}/seasons/${row.season}`" class="season-link">
                                    {{ row.season }}
                                </RouterLink>
                            </td>
                            <td v-for="(pos, idx) in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']" :key="pos"
                                @click="openPlayerCard(row.batters[pos])"
                                class="player-cell"
                                :class="{'filled': row.batters[pos], 'col-hover': hoveredBatterCol === idx, 'mva-winner': isAwardWinner(row.batters[pos], row.mvaName), 'lvsc-winner': isAwardWinner(row.batters[pos], row.lvscName), 'tgaoot-winner': isAwardWinner(row.batters[pos], row.tgaootName)}"
                                @mouseenter="hoveredBatterCol = idx" @mouseleave="hoveredBatterCol = null">
                                <span :title="row.batters[pos] ? `${row.batters[pos].displayName} (${row.batters[pos].points} pts)` : ''">
                                    {{ row.batters[pos] ? formatNameShort(row.batters[pos].displayName, true) : '-' }}<span v-if="isSeasonCaptain(row.batters[pos], row.captain)" class="cap-badge" :style="capBadgeStyle" title="Captain">C</span>
                                </span>
                            </td>
                            <!-- Dynamic Bench Cells -->
                            <td v-for="i in maxCols.bench" :key="`bench-${i}`"
                                @click="openPlayerCard(row.batters[`Bench${i}`])"
                                class="player-cell"
                                :class="{'filled': row.batters[`Bench${i}`], 'col-hover': hoveredBatterCol === 8 + i, 'mva-winner': isAwardWinner(row.batters[`Bench${i}`], row.mvaName), 'lvsc-winner': isAwardWinner(row.batters[`Bench${i}`], row.lvscName), 'tgaoot-winner': isAwardWinner(row.batters[`Bench${i}`], row.tgaootName)}"
                                @mouseenter="hoveredBatterCol = 8 + i" @mouseleave="hoveredBatterCol = null">
                                <span :title="row.batters[`Bench${i}`] ? `${row.batters[`Bench${i}`].displayName} (${row.batters[`Bench${i}`].points} pts)` : ''">
                                    {{ row.batters[`Bench${i}`] ? formatNameShort(row.batters[`Bench${i}`].displayName, true) : '-' }}<span v-if="isSeasonCaptain(row.batters[`Bench${i}`], row.captain)" class="cap-badge" :style="capBadgeStyle" title="Captain">C</span>
                                </span>
                            </td>
                        </tr>
                    </tbody>
                    <tfoot v-if="mostCommonPlayers.batters && Object.keys(mostCommonPlayers.batters).length > 0">
                        <tr class="summary-row">
                            <td class="sticky-col total-label core-squads">CORE SQUADS</td>
                            <td v-for="pos in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']" :key="pos"
                                class="summary-cell" :class="{'summary-clickable': mostCommonPlayers.batters[pos]}"
                                @click="mostCommonPlayers.batters[pos] && openPlayerCard(mostCommonPlayers.batters[pos].player)">
                                <template v-if="mostCommonPlayers.batters[pos]">
                                    <div class="common-name" :class="{'most-frequent-name': isFaceCore('batter', pos)}">
                                        <img v-if="isFaceCore('batter', pos)" :src="teamData.team.logo_url" :alt="teamData.team.name" class="core-logo" title="Face of the Franchise" />
                                        {{ mostCommonPlayers.batters[pos].name }}
                                    </div>
                                </template>
                                <span v-else>-</span>
                            </td>
                            <td v-for="i in maxCols.bench" :key="`bench-sum-${i}`"
                                class="summary-cell" :class="{'summary-clickable': mostCommonPlayers.batters[`Bench${i}`]}"
                                @click="mostCommonPlayers.batters[`Bench${i}`] && openPlayerCard(mostCommonPlayers.batters[`Bench${i}`].player)">
                                <template v-if="mostCommonPlayers.batters[`Bench${i}`]">
                                    <div class="common-name" :class="{'most-frequent-name': isFaceCore('batter', `Bench${i}`)}">
                                        <img v-if="isFaceCore('batter', `Bench${i}`)" :src="teamData.team.logo_url" :alt="teamData.team.name" class="core-logo" title="Face of the Franchise" />
                                        {{ mostCommonPlayers.batters[`Bench${i}`].name }}
                                    </div>
                                </template>
                                <span v-else>-</span>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>

        <!-- ROSTER MATRIX: PITCHERS -->
        <section class="section rosters-section">
            <h2>Pitching History</h2>
            <div class="table-scroll">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th class="sticky-col">Season</th>
                            <th v-for="(pos, idx) in ['SP1', 'SP2', 'SP3', 'SP4']" :key="pos"
                                @mouseenter="hoveredPitcherCol = idx" @mouseleave="hoveredPitcherCol = null"
                                :class="{'col-hover': hoveredPitcherCol === idx}">
                                {{ pos }}
                            </th>
                            <!-- Dynamic RP Headers -->
                            <th v-for="i in maxCols.rp" :key="`rp-head-${i}`"
                                @mouseenter="hoveredPitcherCol = 3 + i" @mouseleave="hoveredPitcherCol = null"
                                :class="{'col-hover': hoveredPitcherCol === 3 + i}">
                                RP{{i}}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in processedHistory" :key="row.season" :class="{'gold-bg': row.result && row.result.includes('Champion'), 'silver-bg': row.result && row.result.includes('Silver Submarine') && !row.result.includes('Participant'), 'brown-bg': row.result && row.result.includes('Wooden Spoon') && !row.result.includes('Participant')}">
                            <td class="season-cell sticky-col">
                                <RouterLink :to="`/teams/${teamId}/seasons/${row.season}`" class="season-link">
                                    {{ row.season }}
                                </RouterLink>
                            </td>
                            <td v-for="(pos, idx) in ['SP1', 'SP2', 'SP3', 'SP4']" :key="pos"
                                @click="openPlayerCard(row.pitchers[pos])"
                                class="player-cell"
                                :class="{'filled': row.pitchers[pos], 'col-hover': hoveredPitcherCol === idx, 'mva-winner': isAwardWinner(row.pitchers[pos], row.mvaName), 'lvsc-winner': isAwardWinner(row.pitchers[pos], row.lvscName), 'tgaoot-winner': isAwardWinner(row.pitchers[pos], row.tgaootName)}"
                                @mouseenter="hoveredPitcherCol = idx" @mouseleave="hoveredPitcherCol = null">
                                <span :title="row.pitchers[pos] ? `${row.pitchers[pos].displayName} (${row.pitchers[pos].points} pts)` : ''">
                                    {{ row.pitchers[pos] ? formatNameShort(row.pitchers[pos].displayName, true) : '-' }}<span v-if="isSeasonCaptain(row.pitchers[pos], row.captain)" class="cap-badge" :style="capBadgeStyle" title="Captain">C</span>
                                </span>
                            </td>
                             <!-- Dynamic RP Cells -->
                            <td v-for="i in maxCols.rp" :key="`rp-${i}`"
                                @click="openPlayerCard(row.pitchers[`RP${i}`])"
                                class="player-cell"
                                :class="{'filled': row.pitchers[`RP${i}`], 'col-hover': hoveredPitcherCol === 3 + i, 'mva-winner': isAwardWinner(row.pitchers[`RP${i}`], row.mvaName), 'lvsc-winner': isAwardWinner(row.pitchers[`RP${i}`], row.lvscName), 'tgaoot-winner': isAwardWinner(row.pitchers[`RP${i}`], row.tgaootName)}"
                                @mouseenter="hoveredPitcherCol = 3 + i" @mouseleave="hoveredPitcherCol = null">
                                <span :title="row.pitchers[`RP${i}`] ? `${row.pitchers[`RP${i}`].displayName} (${row.pitchers[`RP${i}`].points} pts)` : ''">
                                    {{ row.pitchers[`RP${i}`] ? formatNameShort(row.pitchers[`RP${i}`].displayName, true) : '-' }}<span v-if="isSeasonCaptain(row.pitchers[`RP${i}`], row.captain)" class="cap-badge" :style="capBadgeStyle" title="Captain">C</span>
                                </span>
                            </td>
                        </tr>
                    </tbody>
                    <tfoot v-if="mostCommonPlayers.pitchers && Object.keys(mostCommonPlayers.pitchers).length > 0">
                        <tr class="summary-row">
                            <td class="sticky-col total-label core-squads">CORE SQUADS</td>
                            <td v-for="pos in ['SP1', 'SP2', 'SP3', 'SP4']" :key="pos"
                                class="summary-cell" :class="{'summary-clickable': mostCommonPlayers.pitchers[pos]}"
                                @click="mostCommonPlayers.pitchers[pos] && openPlayerCard(mostCommonPlayers.pitchers[pos].player)">
                                <template v-if="mostCommonPlayers.pitchers[pos]">
                                    <div class="common-name" :class="{'most-frequent-name': isFaceCore('pitcher', pos)}">
                                        <img v-if="isFaceCore('pitcher', pos)" :src="teamData.team.logo_url" :alt="teamData.team.name" class="core-logo" title="Face of the Franchise" />
                                        {{ mostCommonPlayers.pitchers[pos].name }}
                                    </div>
                                </template>
                                <span v-else>-</span>
                            </td>
                            <td v-for="i in maxCols.rp" :key="`rp-sum-${i}`"
                                class="summary-cell" :class="{'summary-clickable': mostCommonPlayers.pitchers[`RP${i}`]}"
                                @click="mostCommonPlayers.pitchers[`RP${i}`] && openPlayerCard(mostCommonPlayers.pitchers[`RP${i}`].player)">
                                <template v-if="mostCommonPlayers.pitchers[`RP${i}`]">
                                    <div class="common-name" :class="{'most-frequent-name': isFaceCore('pitcher', `RP${i}`)}">
                                        <img v-if="isFaceCore('pitcher', `RP${i}`)" :src="teamData.team.logo_url" :alt="teamData.team.name" class="core-logo" title="Face of the Franchise" />
                                        {{ mostCommonPlayers.pitchers[`RP${i}`].name }}
                                    </div>
                                </template>
                                <span v-else>-</span>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>

        <!-- CLASSIC ROSTER MATRIX: BATTERS -->
        <section class="section rosters-section" v-if="processedClassicHistory.length > 0">
            <h2>Classic Position Player History</h2>
            <div class="table-scroll">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th class="sticky-col">Season</th>
                            <th v-for="(pos, idx) in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']" :key="pos"
                                @mouseenter="hoveredBatterCol = idx" @mouseleave="hoveredBatterCol = null"
                                :class="{'col-hover': hoveredBatterCol === idx}">
                                {{ pos }}
                            </th>
                            <!-- Dynamic Bench Headers -->
                            <th v-for="i in maxCols.bench" :key="`bench-head-${i}`"
                                @mouseenter="hoveredBatterCol = 8 + i" @mouseleave="hoveredBatterCol = null"
                                :class="{'col-hover': hoveredBatterCol === 8 + i}">
                                B{{i > 1 ? i : ''}}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in processedClassicHistory" :key="row.season" :class="{'gold-bg': row.result && row.result.includes('Champion'), 'brown-bg': row.result && row.result.includes('Wooden Spoon') && !row.result.includes('Participant')}">
                            <td class="season-cell sticky-col">
                                <RouterLink :to="{ path: `/teams/${teamId}/seasons/${row.season}`, query: { type: 'Classic' } }" class="season-link">
                                    {{ row.season }}
                                </RouterLink>
                            </td>
                            <td v-for="(pos, idx) in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']" :key="pos"
                                @click="openPlayerCard(row.batters[pos])"
                                class="player-cell"
                                :class="{'filled': row.batters[pos], 'col-hover': hoveredBatterCol === idx, 'mva-winner': isAwardWinner(row.batters[pos], row.mvaName), 'lvsc-winner': isAwardWinner(row.batters[pos], row.lvscName), 'tgaoot-winner': isAwardWinner(row.batters[pos], row.tgaootName)}"
                                @mouseenter="hoveredBatterCol = idx" @mouseleave="hoveredBatterCol = null">
                                <span :title="row.batters[pos] ? `${row.batters[pos].displayName} (${row.batters[pos].points} pts)` : ''">
                                    {{ row.batters[pos] ? formatNameShort(row.batters[pos].displayName, true) : '-' }}<span v-if="isSeasonCaptain(row.batters[pos], row.captain)" class="cap-badge" :style="capBadgeStyle" title="Captain">C</span>
                                </span>
                            </td>
                            <!-- Dynamic Bench Cells -->
                            <td v-for="i in maxCols.bench" :key="`bench-${i}`"
                                @click="openPlayerCard(row.batters[`Bench${i}`])"
                                class="player-cell"
                                :class="{'filled': row.batters[`Bench${i}`], 'col-hover': hoveredBatterCol === 8 + i, 'mva-winner': isAwardWinner(row.batters[`Bench${i}`], row.mvaName), 'lvsc-winner': isAwardWinner(row.batters[`Bench${i}`], row.lvscName), 'tgaoot-winner': isAwardWinner(row.batters[`Bench${i}`], row.tgaootName)}"
                                @mouseenter="hoveredBatterCol = 8 + i" @mouseleave="hoveredBatterCol = null">
                                <span :title="row.batters[`Bench${i}`] ? `${row.batters[`Bench${i}`].displayName} (${row.batters[`Bench${i}`].points} pts)` : ''">
                                    {{ row.batters[`Bench${i}`] ? formatNameShort(row.batters[`Bench${i}`].displayName, true) : '-' }}<span v-if="isSeasonCaptain(row.batters[`Bench${i}`], row.captain)" class="cap-badge" :style="capBadgeStyle" title="Captain">C</span>
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- CLASSIC ROSTER MATRIX: PITCHERS -->
        <section class="section rosters-section" v-if="processedClassicHistory.length > 0">
            <h2>Classic Pitching History</h2>
            <div class="table-scroll">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th class="sticky-col">Season</th>
                            <th v-for="(pos, idx) in ['SP1', 'SP2', 'SP3', 'SP4']" :key="pos"
                                @mouseenter="hoveredPitcherCol = idx" @mouseleave="hoveredPitcherCol = null"
                                :class="{'col-hover': hoveredPitcherCol === idx}">
                                {{ pos }}
                            </th>
                            <!-- Dynamic RP Headers -->
                            <th v-for="i in maxCols.rp" :key="`rp-head-${i}`"
                                @mouseenter="hoveredPitcherCol = 3 + i" @mouseleave="hoveredPitcherCol = null"
                                :class="{'col-hover': hoveredPitcherCol === 3 + i}">
                                RP{{i}}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in processedClassicHistory" :key="row.season" :class="{'gold-bg': row.result && row.result.includes('Champion'), 'brown-bg': row.result && row.result.includes('Wooden Spoon') && !row.result.includes('Participant')}">
                            <td class="season-cell sticky-col">
                                <RouterLink :to="{ path: `/teams/${teamId}/seasons/${row.season}`, query: { type: 'Classic' } }" class="season-link">
                                    {{ row.season }}
                                </RouterLink>
                            </td>
                            <td v-for="(pos, idx) in ['SP1', 'SP2', 'SP3', 'SP4']" :key="pos"
                                @click="openPlayerCard(row.pitchers[pos])"
                                class="player-cell"
                                :class="{'filled': row.pitchers[pos], 'col-hover': hoveredPitcherCol === idx, 'mva-winner': isAwardWinner(row.pitchers[pos], row.mvaName), 'lvsc-winner': isAwardWinner(row.pitchers[pos], row.lvscName), 'tgaoot-winner': isAwardWinner(row.pitchers[pos], row.tgaootName)}"
                                @mouseenter="hoveredPitcherCol = idx" @mouseleave="hoveredPitcherCol = null">
                                <span :title="row.pitchers[pos] ? `${row.pitchers[pos].displayName} (${row.pitchers[pos].points} pts)` : ''">
                                    {{ row.pitchers[pos] ? formatNameShort(row.pitchers[pos].displayName, true) : '-' }}<span v-if="isSeasonCaptain(row.pitchers[pos], row.captain)" class="cap-badge" :style="capBadgeStyle" title="Captain">C</span>
                                </span>
                            </td>
                             <!-- Dynamic RP Cells -->
                            <td v-for="i in maxCols.rp" :key="`rp-${i}`"
                                @click="openPlayerCard(row.pitchers[`RP${i}`])"
                                class="player-cell"
                                :class="{'filled': row.pitchers[`RP${i}`], 'col-hover': hoveredPitcherCol === 3 + i, 'mva-winner': isAwardWinner(row.pitchers[`RP${i}`], row.mvaName), 'lvsc-winner': isAwardWinner(row.pitchers[`RP${i}`], row.lvscName), 'tgaoot-winner': isAwardWinner(row.pitchers[`RP${i}`], row.tgaootName)}"
                                @mouseenter="hoveredPitcherCol = 3 + i" @mouseleave="hoveredPitcherCol = null">
                                <span :title="row.pitchers[`RP${i}`] ? `${row.pitchers[`RP${i}`].displayName} (${row.pitchers[`RP${i}`].points} pts)` : ''">
                                    {{ row.pitchers[`RP${i}`] ? formatNameShort(row.pitchers[`RP${i}`].displayName, true) : '-' }}<span v-if="isSeasonCaptain(row.pitchers[`RP${i}`], row.captain)" class="cap-badge" :style="capBadgeStyle" title="Captain">C</span>
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    </main>

    <!-- Player Card Modal -->
    <PlayerCardModal :player="selectedPlayer" @close="closePlayerCard" />
  </div>
  <div v-else-if="loading" class="loading">Loading team history...</div>
  <div v-else class="error">Team not found.</div>
</template>

<style scoped>
.team-page-container {
  max-width: 1600px;
  margin: 0 auto;
  padding-bottom: 4rem;
}
.team-header {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 2rem;
  border-radius: 8px;
  margin: 2rem 1rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  flex-wrap: wrap;
}
.team-logo {
  height: 100px;
  width: auto;
  max-width: 150px;
  border-radius: 8px;
  background-color: white;
  padding: 0.5rem;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}
.team-info h1 { margin: 0; font-size: 2.5rem; }
.team-info p { margin: 0; font-size: 1.2rem; opacity: 0.9; }

.accolades {
    margin-left: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-end;
}
.accolade-row { display: flex; gap: 0.25rem; }
.accolade-item { width: 40px; display: flex; justify-content: center; }
.accolade-item.mobile-only { width: auto; white-space: nowrap; }
.accolade-icon { height: 35px; width: auto; }
.accolade-count { font-size: 1.5rem; font-weight: bold; margin-left: 0.5rem; align-self: center; color: white;}

.team-main {
    padding: 0 1rem;
}

.section {
    margin-bottom: 3rem;
    background: #fff;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.section h2 {
    margin-top: 0;
    border-bottom: 2px solid #eee;
    padding-bottom: 0.5rem;
    margin-bottom: 1.5rem;
}

/* Scroll Wrapper for Tables */
.table-scroll {
    overflow-x: auto;
    position: relative;
}

/* Generic Table Styles */
table {
    width: 100%;
    border-collapse: collapse;
    min-width: 600px; /* Force scroll on small screens */
}
th {
    text-align: left;
    padding: 0.75rem;
    background: #f1f3f5;
    font-weight: bold;
    white-space: nowrap;
}
td {
    padding: 0.75rem;
    border-bottom: 1px solid #eee;
}

/* Sticky First Column for Season */
.sticky-col {
    position: sticky;
    left: 0;
    background-color: #f8f9fa; /* slightly darker to distinguish */
    z-index: 2;
    border-right: 2px solid #dee2e6;
    font-weight: bold;
}
thead th.sticky-col {
    background-color: #e9ecef;
    z-index: 3;
}

.season-link {
    color: #007bff;
    text-decoration: none;
}
.season-link:hover { text-decoration: underline; }

.result-cell { font-weight: 500; }

/* RESULT BADGE — contains the accolade color to a small pill (a mini League banner)
   instead of washing the whole row, so the table reads calmly. Uses the exact
   finale-card gradients/hues. */
.result-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 10px 2px 6px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.85rem;
    line-height: 1.45;
    white-space: nowrap;
}
.result-badge .badge-trophy {
    height: 15px;
    width: auto;
    flex: 0 0 auto;
}
.badge-champion {
    background-image: linear-gradient(135deg, #F0E68C 0%, #FFD700 100%);
    color: #4d3b00;
    border: 1px solid #DAA520;
}
.badge-spoon {
    background-image: linear-gradient(135deg, #6D4C41 0%, #4E342E 100%);
    color: #efebe9;
    border: 1px solid #3E2723;
}
.badge-submarine {
    background-image: linear-gradient(135deg, #E0E0E0 0%, #B8B8B8 100%);
    color: #37474f;
    border: 1px solid #9E9E9E;
}

/* MATRIX (roster) TABLE row highlights — quiet echoes of the League finale-card
   palette: same hues + diagonal gradient as the banners, dialed way down for a
   dense grid. (Old brown was an orange-rust #8C3E08 wash that turned muddy over white.) */
.gold-bg {
    background-image: linear-gradient(135deg, rgba(240, 230, 140, 0.40) 0%, rgba(255, 215, 0, 0.28) 100%) !important;
}
.silver-bg {
    background-image: linear-gradient(135deg, rgba(224, 224, 224, 0.50) 0%, rgba(176, 176, 176, 0.38) 100%) !important;
}
.brown-bg {
    background-image: linear-gradient(135deg, rgba(109, 76, 65, 0.16) 0%, rgba(78, 52, 46, 0.24) 100%) !important;
}

.col-hover {
    background-color: rgba(0, 0, 0, 0.05);
}

/* Matrix Table Specifics */
.matrix-table td {
    font-size: 0.7rem;
    vertical-align: top;
    padding: .2rem;
    min-width: 50px; /* Ensure columns are wide enough */
    white-space: nowrap; /* Prevent wrapping */
}
.player-cell {
    cursor: default;
    color: #999;
}
.player-cell.filled {
    color: #000;
    cursor: pointer;
    font-weight: 500;
}
.player-cell.filled:hover {
    background-color: #e2e6ea;
    color: #0056b3;
}

/* Removed old .bench-list styles since we are flattening */

/* Modal */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2000;
}
.modal-content {
    background: transparent;
    padding: 0;
    border-radius: 12px;
    position: relative;
    max-width: 90%;
    max-height: 90vh;
}
.close-btn {
    position: absolute;
    top: -40px;
    right: 0;
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
}

/* Responsive Toggles */
.mobile-only { display: none !important; }

@media (max-width: 768px) {
    .team-header {
        flex-direction: column;
        text-align: center;
        gap: 1rem;
    }
    .accolades {
        align-items: center;
        margin-left: 0;
        margin-top: 1rem;
    }
    .desktop-only { display: none !important; }
    .mobile-only { display: flex !important; }
}

/* Footer Summary Styles */
.summary-row td {
    background-color: #f8f9fa;
    border-top: 2px solid #dee2e6;
    font-size: 0.7rem;
    vertical-align: middle;
    height: 1.9rem;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
}
.summary-row .total-label {
    font-weight: bold;
    text-align: right;
    padding-right: 1rem;
    background-color: #e9ecef; /* Match sticky header style somewhat */
}
.core-squads {
    font-size: 0.7rem !important; /* Shrink to match matrix rows */
    text-transform: uppercase;
    vertical-align: middle !important;
}
.common-name {
    font-weight: 600;
    margin-bottom: 2px;
}
.summary-clickable {
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
}
.summary-clickable:hover {
    background-color: #e2e6ea;
}
.summary-clickable:hover .common-name {
    color: #0056b3;
}
.core-logo {
    height: 14px;
    width: auto;
    vertical-align: -2px;
    margin-right: 3px;
    object-fit: contain;
}
.most-frequent-name {
    text-transform: uppercase;
}

.classic-row td {
    color: #555;
    font-style: italic;
}

.award-line {
    font-size: 0.75rem;
    font-weight: normal;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 260px;
}
/* Award sub-lines kept neutral gray so the only color in a row is the Result badge */
.mva-line,
.lvsc-line,
.tgaoot-line { color: #6c757d; }

/* Captain "C" beside a player's name in the season-by-season matrices —
   the same collegiate letterman style as the card captain "C". */
.cap-badge {
    display: inline-block;
    margin-left: 3px;
    font-family: 'Graduate', Georgia, 'Times New Roman', serif;
    font-weight: 400;
    font-size: 1em;
    line-height: 1;
    -webkit-text-stroke: 1.3px var(--cap-stroke);
    paint-order: stroke fill;
    vertical-align: baseline;
}

/* Face of the Franchise: small card in the header, to the left of the trophies. */
.header-face {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
    width: 96px;
}
.header-face:hover { transform: translateY(-2px); }
.header-face-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.9;
    text-align: center;
    line-height: 1.1;
}

.mva-winner {
    background-color: rgba(255, 200, 0, 0.25) !important;
    outline: 1px solid rgba(200, 150, 0, 0.4);
}
.lvsc-winner {
    background-color: rgba(139, 69, 19, 0.15) !important;
    outline: 1px solid rgba(139, 69, 19, 0.35);
}
.tgaoot-winner {
    background-color: rgba(120, 120, 120, 0.15) !important;
    outline: 1px solid rgba(120, 120, 120, 0.35);
}

.classic-badge {
    display: inline-block;
    margin-left: 0.4rem;
    font-size: 0.65rem;
    font-style: normal;
    font-weight: bold;
    background: #6c757d;
    color: white;
    border-radius: 3px;
    padding: 0 3px;
    vertical-align: middle;
    line-height: 1.4;
}

.identity-history {
     margin-top: 0.5rem;
     font-size: 0.9rem;
     color: #555;
}
.identity-label { font-weight: bold; margin-right: 0.5rem; display: block; margin-bottom: 0.25rem;}
.identity-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column; /* CHANGED */
    gap: 0.5rem; /* Reduced gap */
}
.identity-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(255,255,255,0.5);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
}
.identity-logo { height: 24px; width: auto; object-fit: contain; }
</style>
