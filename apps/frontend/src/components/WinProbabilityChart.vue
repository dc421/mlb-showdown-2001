<script setup>
import { computed, ref } from 'vue';

// A win-probability graph: the classic diverging area around a 50% baseline. The region between the
// home-win-probability curve and the 50% line is shaded toward whichever team is favored — home color
// above 50%, away color below — so "who's winning" reads at a glance. A single neutral curve line
// rides on top; a crosshair tooltip narrates each play. Identity is never color-alone: a legend and
// the shaded direction are backed by the y-axis team labels.
const props = defineProps({
  // [{ i, inning, isTop, half, outs, home, away, homeWP (0..1), play }]
  points: { type: Array, required: true },
  homeTeam: { type: Object, default: () => ({}) },
  awayTeam: { type: Object, default: () => ({}) },
  compact: { type: Boolean, default: false }, // sparkline mode: fills + baseline only
  // Highlighted plays (the game's biggest): [{ i (point index), image, name, homeUp }].
  annotations: { type: Array, default: () => [] },
});

// Fixed viewBox; CSS scales width to 100%. Height differs for compact sparklines.
const VB_W = 800;
const VB_H = computed(() => (props.compact ? 90 : 300));
const PAD = computed(() =>
  props.compact
    ? { t: 4, r: 4, b: 4, l: 4 }
    : { t: 14, r: 14, b: 26, l: 40 });

const plot = computed(() => {
  const p = PAD.value;
  return { x0: p.l, x1: VB_W - p.r, y0: p.t, y1: VB_H.value - p.b, w: VB_W - p.l - p.r, h: VB_H.value - p.t - p.b };
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const normHex = (c, fallback) => {
  if (typeof c !== 'string') return fallback;
  const h = c.trim();
  return /^#?[0-9a-fA-F]{6}$/.test(h) ? (h[0] === '#' ? h : `#${h}`) : fallback;
};
const homeColor = computed(() => normHex(props.homeTeam?.primary_color, '#1f6fb2'));
const awayColorRaw = computed(() => normHex(props.awayTeam?.primary_color, '#c0392b'));
// If both teams share a primary color, nudge the away fill so the split still reads.
const awayColor = computed(() => (awayColorRaw.value.toLowerCase() === homeColor.value.toLowerCase() ? '#c0392b' : awayColorRaw.value));

const n = computed(() => props.points.length);
const xAt = (i) => {
  const pl = plot.value;
  return n.value <= 1 ? pl.x0 : pl.x0 + (i / (n.value - 1)) * pl.w;
};
const yAt = (wp) => {
  const pl = plot.value;
  return pl.y0 + clamp01(wp) * pl.h; // wp=1 (home certain) at the BOTTOM; away certain at the top
};
const yBase = computed(() => yAt(0.5));

// Curve as an SVG polyline path.
const curvePath = computed(() => {
  if (!n.value) return '';
  let d = `M ${xAt(0).toFixed(2)} ${yAt(props.points[0].homeWP).toFixed(2)}`;
  for (let i = 1; i < n.value; i++) d += ` L ${xAt(i).toFixed(2)} ${yAt(props.points[i].homeWP).toFixed(2)}`;
  return d;
});

// Single area polygon between the curve and the baseline; clipping halves it into home/away regions.
const areaPath = computed(() => {
  if (!n.value) return '';
  let d = `M ${xAt(0).toFixed(2)} ${yAt(props.points[0].homeWP).toFixed(2)}`;
  for (let i = 1; i < n.value; i++) d += ` L ${xAt(i).toFixed(2)} ${yAt(props.points[i].homeWP).toFixed(2)}`;
  d += ` L ${xAt(n.value - 1).toFixed(2)} ${yBase.value.toFixed(2)} L ${xAt(0).toFixed(2)} ${yBase.value.toFixed(2)} Z`;
  return d;
});

// Inning spans → centered inning numbers along the bottom.
const innings = computed(() => {
  const out = [];
  if (!n.value) return out;
  let start = 0;
  let cur = props.points[0].inning;
  for (let i = 1; i <= n.value; i++) {
    if (i === n.value || props.points[i].inning !== cur) {
      out.push({ inning: cur, startX: xAt(start), endX: xAt(i - 1), midX: (xAt(start) + xAt(i - 1)) / 2 });
      if (i < n.value) { cur = props.points[i].inning; start = i; }
    }
  }
  return out;
});

// A vertical gridline at every half-inning switch (top↔bottom of an inning).
const halfBoundaries = computed(() => {
  const out = [];
  if (!n.value) return out;
  for (let i = 1; i < n.value; i++) {
    const p = props.points[i];
    const prev = props.points[i - 1];
    if (p.inning !== prev.inning || p.isTop !== prev.isTop) out.push(xAt(i));
  }
  return out;
});

// Layout for highlighted-play annotations: a team-coloured dot on the curve plus a small batter card
// floating in the emptier region (opposite the fill), joined by a connector. Cards are spread apart
// horizontally so clustered plays don't overlap. All in viewBox units (the SVG scales uniformly).
const CARD_W = 40;
const CARD_H = 56;
// Push cards into the empty band (the far edge from the fill) so they never overlap the WP line: when
// home is favored the curve rides low, so cards go to the TOP edge; when away is favored, the BOTTOM.
// A connector links each card back to its dot on the curve.
const annoLayout = computed(() => {
  if (props.compact || !n.value) return [];
  const pl = plot.value;
  const raw = [];
  for (const a of props.annotations) {
    const pt = props.points[a.i];
    if (!pt) continue;
    raw.push({
      image: a.image, name: a.name,
      color: a.homeUp ? homeColor.value : awayColor.value,
      dotX: xAt(a.i), dotY: yAt(pt.homeWP),
      topBand: pt.homeWP >= 0.5, cardX: xAt(a.i),
    });
  }
  // Spread cards horizontally within a band so clustered plays don't collide; keep them in the plot.
  const spread = (arr) => {
    arr.sort((p, q) => p.dotX - q.dotX);
    const gap = CARD_W + 8;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].cardX - arr[i - 1].cardX < gap) arr[i].cardX = arr[i - 1].cardX + gap;
    }
    const overflow = arr.length ? arr[arr.length - 1].cardX + CARD_W / 2 - pl.x1 : 0;
    if (overflow > 0) for (const it of arr) it.cardX -= overflow;
    for (const it of arr) it.cardX = Math.max(pl.x0 + CARD_W / 2, Math.min(pl.x1 - CARD_W / 2, it.cardX));
  };
  const top = raw.filter((r) => r.topBand);
  const bot = raw.filter((r) => !r.topBand);
  spread(top);
  spread(bot);
  for (const it of top) { it.cardTop = pl.y0 + 2; it.nearY = it.cardTop + CARD_H; }
  for (const it of bot) { it.cardTop = pl.y1 - CARD_H - 2; it.nearY = it.cardTop; }
  return [...top, ...bot];
});

const uid = Math.random().toString(36).slice(2, 8);

// ---- hover ----
const hoverIndex = ref(null);
const svgRef = ref(null);
function onMove(evt) {
  if (props.compact || !n.value) return;
  const svg = svgRef.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const vbX = ((evt.clientX - rect.left) / rect.width) * VB_W;
  const pl = plot.value;
  const frac = (vbX - pl.x0) / pl.w;
  let idx = Math.round(frac * (n.value - 1));
  idx = Math.max(0, Math.min(n.value - 1, idx));
  hoverIndex.value = idx;
}
function onLeave() { hoverIndex.value = null; }

const hover = computed(() => (hoverIndex.value == null ? null : props.points[hoverIndex.value]));
// The previous point's after-state IS this at-bat's start situation (base/out/score the batter faced).
const hoverStart = computed(() => (hoverIndex.value == null || hoverIndex.value < 1 ? null : props.points[hoverIndex.value - 1]));
const hoverX = computed(() => (hoverIndex.value == null ? 0 : xAt(hoverIndex.value)));
const hoverY = computed(() => (hover.value ? yAt(hover.value.homeWP) : 0));
// Keep the tooltip inside the plot and off the line: anchor its left/centre/right edge by where the
// point sits horizontally, and place it on the opposite vertical half from the hovered point so it
// never covers the curve at the spot being inspected.
const tipStyle = computed(() => {
  const pct = (hoverX.value / VB_W) * 100;
  const tx = pct < 20 ? '0%' : pct > 80 ? '-100%' : '-50%';
  const style = { left: `${pct}%`, transform: `translateX(${tx})` };
  if (hover.value && hover.value.homeWP < 0.5) { style.top = 'auto'; style.bottom = '8px'; }
  else { style.top = '8px'; style.bottom = 'auto'; }
  return style;
});
const homeAbbr = computed(() => props.homeTeam?.abbreviation || 'HOME');
const awayAbbr = computed(() => props.awayTeam?.abbreviation || 'AWAY');
const pct = (wp) => `${Math.round(clamp01(wp) * 100)}%`;
// Whichever team the hovered point favors, phrased from that team's side.
const hoverFavored = computed(() => {
  if (!hover.value) return null;
  const wp = hover.value.homeWP;
  if (wp >= 0.5) return { abbr: homeAbbr.value, pct: pct(wp) };
  return { abbr: awayAbbr.value, pct: pct(1 - wp) };
});
const outsLabel = (o) => `${o} out${o === 1 ? '' : 's'}`;
function runnersLabel(base) {
  const on = [];
  if (base & 1) on.push('1st');
  if (base & 2) on.push('2nd');
  if (base & 4) on.push('3rd');
  if (!on.length) return 'bases empty';
  if (on.length === 3) return 'bases loaded';
  if (on.length === 1) return `runner on ${on[0]}`;
  return `runners on ${on.join(' & ')}`;
}
// The WPA of the hovered play, phrased for the batting team.
const hoverWpa = computed(() => {
  const h = hover.value;
  if (!h || h.wpa == null || !h.battingTeam) return null;
  const abbr = h.battingTeam === 'home' ? homeAbbr.value : awayAbbr.value;
  const v = Math.round(h.wpa * 100);
  return { abbr, text: `${v > 0 ? '+' : ''}${v}%`, positive: v >= 0 };
});
</script>

<template>
  <div class="wp-chart" :class="{ compact }">
    <div v-if="!compact" class="wp-legend">
      <span class="wp-chip"><span class="sw" :style="{ background: awayColor }"></span>{{ awayTeam?.abbreviation || 'Away' }}</span>
      <span class="wp-chip"><span class="sw" :style="{ background: homeColor }"></span>{{ homeTeam?.abbreviation || 'Home' }}</span>
    </div>

    <div class="wp-svg-wrap">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${VB_W} ${VB_H}`"
        class="wp-svg"
        preserveAspectRatio="none"
        @mousemove="onMove"
        @mouseleave="onLeave"
      >
        <defs>
          <!-- home is favored below the baseline (home lives at the bottom), away above it -->
          <clipPath :id="`wp-home-${uid}`"><rect :x="plot.x0" :y="yBase" :width="plot.w" :height="Math.max(0, plot.y1 - yBase)" /></clipPath>
          <clipPath :id="`wp-away-${uid}`"><rect :x="plot.x0" :y="plot.y0" :width="plot.w" :height="Math.max(0, yBase - plot.y0)" /></clipPath>
        </defs>

        <!-- half-inning gridlines -->
        <template v-if="!compact">
          <line v-for="(x, k) in halfBoundaries" :key="`h${k}`" :x1="x" :y1="plot.y0" :x2="x" :y2="plot.y1" class="wp-grid" />
        </template>

        <!-- diverging fills -->
        <path :d="areaPath" :fill="homeColor" :clip-path="`url(#wp-home-${uid})`" class="wp-fill" />
        <path :d="areaPath" :fill="awayColor" :clip-path="`url(#wp-away-${uid})`" class="wp-fill" />

        <!-- 0% / 100% edges + 50% baseline -->
        <template v-if="!compact">
          <line :x1="plot.x0" :y1="plot.y0" :x2="plot.x1" :y2="plot.y0" class="wp-edge" />
          <line :x1="plot.x0" :y1="plot.y1" :x2="plot.x1" :y2="plot.y1" class="wp-edge" />
        </template>
        <line :x1="plot.x0" :y1="yBase" :x2="plot.x1" :y2="yBase" class="wp-base" />

        <!-- curve -->
        <path :d="curvePath" class="wp-line" fill="none" />

        <!-- highlighted plays: connector + batter card + team-coloured dot on the curve -->
        <g v-for="(a, k) in annoLayout" :key="`anno${k}`">
          <line :x1="a.dotX" :y1="a.dotY" :x2="a.cardX" :y2="a.nearY" class="wp-anno-line" :stroke="a.color" />
          <rect :x="a.cardX - CARD_W / 2" :y="a.cardTop" :width="CARD_W" :height="CARD_H" rx="3" class="wp-anno-frame" :stroke="a.color" />
          <image v-if="a.image" :href="a.image" :x="a.cardX - CARD_W / 2 + 2" :y="a.cardTop + 2" :width="CARD_W - 4" :height="CARD_H - 4" preserveAspectRatio="xMidYMid slice" />
          <circle :cx="a.dotX" :cy="a.dotY" r="4.5" class="wp-anno-dot" :fill="a.color" />
        </g>

        <!-- hover crosshair -->
        <template v-if="hover && !compact">
          <line :x1="hoverX" :y1="plot.y0" :x2="hoverX" :y2="plot.y1" class="wp-cross" />
          <circle :cx="hoverX" :cy="hoverY" r="4" class="wp-dot" :style="{ fill: hover.homeWP >= 0.5 ? homeColor : awayColor }" />
        </template>
      </svg>

      <!-- y-axis: away certain at top (0% home), toss-up at 50%, home certain at bottom (100% home) -->
      <template v-if="!compact">
        <span class="wp-ylab wp-ytop">{{ awayAbbr }} 100%</span>
        <span class="wp-ylab wp-ymid">50%</span>
        <span class="wp-ylab wp-ybot">{{ homeAbbr }} 100%</span>
      </template>

      <!-- inning numbers -->
      <div v-if="!compact" class="wp-innings">
        <span v-for="(ing, k) in innings" :key="`i${k}`" class="wp-inn" :style="{ left: `${(ing.midX / VB_W) * 100}%` }">{{ ing.inning }}</span>
      </div>

      <!-- tooltip -->
      <div v-if="hover && !compact" class="wp-tip" :style="tipStyle">
        <div class="wp-tip-head">
          <template v-if="hoverStart">{{ hoverStart.half }} · {{ outsLabel(hoverStart.outs) }} · {{ runnersLabel(hoverStart.base) }}</template>
          <template v-else>{{ hover.half }} · start of game</template>
        </div>
        <div v-if="hoverStart" class="wp-tip-score">{{ awayAbbr }} {{ hoverStart.away }}–{{ hoverStart.home }} {{ homeAbbr }}</div>
        <div v-if="hover.log" class="wp-tip-play">{{ hover.log }}</div>
        <div class="wp-tip-fav">
          <strong>{{ hoverFavored.abbr }}</strong> {{ hoverFavored.pct }} to win
          <span v-if="hoverWpa" class="wp-tip-wpa" :class="hoverWpa.positive ? 'pos' : 'neg'">{{ hoverWpa.abbr }} {{ hoverWpa.text }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-chart { width: 100%; font-family: sans-serif; }
.wp-legend {
  display: flex; align-items: center; justify-content: center; gap: 0.9rem;
  font-size: 0.72rem; color: #666; margin-bottom: 0.4rem; flex-wrap: wrap;
}
.wp-chip { display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; color: #333; letter-spacing: 0.02em; }
.wp-chip .sw { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }

.wp-svg-wrap { position: relative; width: 100%; }
.wp-svg { width: 100%; display: block; }
.compact .wp-svg { border-radius: 6px; }

.wp-fill { opacity: 0.82; }
.wp-line { stroke: #2b2b2b; stroke-width: 1.5; vector-effect: non-scaling-stroke; opacity: 0.85; }
.wp-base { stroke: #888; stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.wp-edge { stroke: #333; opacity: 0.28; stroke-width: 1; vector-effect: non-scaling-stroke; }
.wp-grid { stroke: #000; opacity: 0.06; stroke-width: 1; vector-effect: non-scaling-stroke; }
.wp-cross { stroke: #333; opacity: 0.5; stroke-width: 1; vector-effect: non-scaling-stroke; }
.wp-dot { stroke: #fff; stroke-width: 1.5; }

/* Highlighted-play annotations */
.wp-anno-line { stroke-width: 1.5; opacity: 0.6; vector-effect: non-scaling-stroke; }
.wp-anno-frame { fill: #fff; stroke-width: 2; vector-effect: non-scaling-stroke; }
.wp-anno-dot { stroke: #fff; stroke-width: 1.5; vector-effect: non-scaling-stroke; }

.wp-ylab { position: absolute; left: 0; font-size: 0.6rem; color: #999; font-weight: 700; letter-spacing: 0.02em; }
.wp-ytop { top: 8px; }
.wp-ymid { top: 50%; transform: translateY(-50%); color: #bbb; }
.wp-ybot { bottom: 28px; }

.wp-innings { position: relative; height: 0; }
.wp-inn { position: absolute; top: -20px; transform: translateX(-50%); font-size: 0.62rem; color: #aaa; font-weight: 600; }

.wp-tip {
  position: absolute; top: 6px; transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.97); border: 1px solid #e2e2e2; border-radius: 7px;
  padding: 0.45rem 0.6rem; font-size: 0.72rem; color: #333; pointer-events: none;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.12); width: 230px;
}
.wp-tip-head { font-weight: 700; color: #222; }
.wp-tip-score { color: #888; margin-top: 0.05rem; }
.wp-tip-fav { color: #444; margin-top: 0.25rem; }
.wp-tip-play { color: #555; margin-top: 0.25rem; line-height: 1.35; }
.wp-tip-wpa { font-weight: 800; margin-left: 0.35rem; white-space: nowrap; }
.wp-tip-wpa.pos { color: #1e874b; }
.wp-tip-wpa.neg { color: #b03535; }
</style>
