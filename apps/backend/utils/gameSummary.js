// Server-side game-card summaries for the series page: the per-inning linescore and the pitcher
// decisions (W/L/S/BS). Both are derived from the stored per-plate-appearance `atBatLog` (and
// `pitcherStats` for innings pitched). The decision logic mirrors the frontend
// apps/frontend/src/utils/pitchingDecisions.js — keep the two in sync.

// Normalize a (possibly malformed "4_4_614") pitcher key to "ownerId_cardId".
function normalizeKey(key) {
  const parts = String(key).split('_');
  if (parts.length < 2) return String(key);
  return `${parts[0]}_${parts[parts.length - 1]}`;
}
function ownerId(key) { return String(key).split('_')[0]; }

// The card id embedded in a normalized pitcher key ("6_418" -> "418").
function cardIdOf(key) { return normalizeKey(key).split('_')[1]; }

// Per-inning runs + total R/H for each side, from the atBatLog. An inning a side never batted in
// (e.g. the home half of a game the home team already led) is null so the caller can render "X".
function computeLinescore(atBatLog) {
  if (!Array.isArray(atBatLog) || atBatLog.length === 0) return null;
  const runsBy = { away: [], home: [] };
  const battedBy = { away: [], home: [] };
  let awayHits = 0, homeHits = 0;
  for (const e of atBatLog) {
    const side = e.batterTeam === 'away' ? 'away' : 'home';
    const i = (e.inning || 1) - 1;
    runsBy[side][i] = (runsBy[side][i] || 0) + ((e.scoredRunnerIds || []).length);
    battedBy[side][i] = true;
    if (e.h) { if (side === 'away') awayHits++; else homeHits++; }
  }
  const innings = Math.max(runsBy.away.length, runsBy.home.length);
  const fill = (side) => {
    const res = [];
    for (let i = 0; i < innings; i++) res.push(battedBy[side][i] ? (runsBy[side][i] || 0) : null);
    return res;
  };
  const away = fill('away');
  const home = fill('home');
  const sum = (arr) => arr.reduce((a, v) => a + (v || 0), 0);
  return { innings, away, home, awayRuns: sum(away), homeRuns: sum(home), awayHits, homeHits };
}

// Home runs per batter -> { cardId: { count, side } } (batterId in the atBatLog is the plain card id;
// side is 'away'/'home', the team the batter hit for).
function computeHomeRuns(atBatLog) {
  const byBatter = {};
  if (!Array.isArray(atBatLog)) return byBatter;
  for (const e of atBatLog) {
    if (!e.hr) continue;
    if (!byBatter[e.batterId]) byBatter[e.batterId] = { count: 0, side: e.batterTeam === 'away' ? 'away' : 'home' };
    byBatter[e.batterId].count += (Number(e.hr) || 1);
  }
  return byBatter;
}

// Pitcher decisions -> { normalizedPitcherKey: ["W"|"L"|"S"|"BS", ...] }. `outsByKey` maps a
// normalized key to outs recorded (from pitcherStats.outs_recorded).
function computePitchingDecisions(atBatLog, teams, outsByKey = {}) {
  const out = {};
  if (!Array.isArray(atBatLog) || atBatLog.length === 0) return out;

  const awayUserId = teams && teams.away && teams.away.user_id;
  const sideOf = (key) => (String(ownerId(key)) === String(awayUserId) ? 'away' : 'home');
  const outsOf = (key) => outsByKey[normalizeKey(key)] || 0;

  const plays = [];
  let away = 0, home = 0;
  for (const e of atBatLog) {
    const runs = (e.scoredRunnerIds || []).length;
    if (e.batterTeam === 'away') away += runs; else home += runs;
    plays.push({ key: normalizeKey(e.pitcherKey), side: sideOf(e.pitcherKey), away, home, inning: e.inning || 0 });
  }
  const gameInnings = Math.max(...plays.map(p => p.inning), 0);
  if (away === home) return out; // no winner => no decisions

  const winner = home > away ? 'home' : 'away';
  const wScore = (p) => (winner === 'home' ? p.home : p.away);
  const lScore = (p) => (winner === 'home' ? p.away : p.home);
  const tag = (key, t) => { if (!key) return; const nk = normalizeKey(key); if (!out[nk]) out[nk] = []; if (!out[nk].includes(t)) out[nk].push(t); };
  const firstKeyForSide = (side) => { for (const p of plays) if (p.side === side) return p.key; return null; };

  let lastNonLead = -1;
  for (let i = 0; i < plays.length; i++) if (wScore(plays[i]) <= lScore(plays[i])) lastNonLead = i;
  const goAheadIdx = Math.min(lastNonLead + 1, plays.length - 1);
  tag(plays[goAheadIdx].key, 'L'); // loss: losing pitcher on the mound for the go-ahead run

  let winKey = null;
  for (let i = goAheadIdx; i >= 0; i--) { if (plays[i].side === winner) { winKey = plays[i].key; break; } }
  if (!winKey) winKey = firstKeyForSide(winner);
  const winnerStarter = firstKeyForSide(winner);
  if (winKey === winnerStarter && outsOf(winnerStarter) < 15 && gameInnings >= 6) {
    for (const p of plays) if (p.side === winner && p.key !== winnerStarter) { winKey = p.key; break; }
  }
  tag(winKey, 'W');

  const starterOf = (side) => (side === 'away' ? firstKeyForSide('away') : firstKeyForSide('home'));
  const seen = new Set();
  for (let idx = 0; idx < plays.length; idx++) {
    const p = plays[idx];
    if (seen.has(p.key) || p.key === starterOf(p.side)) continue;
    seen.add(p.key);
    const prev = plays[idx - 1] || { away: 0, home: 0 };
    const teamBefore = p.side === 'home' ? prev.home : prev.away;
    const oppBefore = p.side === 'home' ? prev.away : prev.home;
    const leadAtEntry = teamBefore - oppBefore;
    const stint = plays.filter(q => q.key === p.key);
    const teamScore = (q) => (p.side === 'home' ? q.home : q.away);
    const oppScore = (q) => (p.side === 'home' ? q.away : q.home);
    if (leadAtEntry >= 1 && leadAtEntry <= 3 && stint.some(q => teamScore(q) <= oppScore(q))) tag(p.key, 'BS');
    const isFinisher = p.key === plays[plays.length - 1].key && p.side === winner;
    if (isFinisher && !(out[p.key] || []).includes('W')) {
      const heldLead = stint.every(q => teamScore(q) > oppScore(q));
      const qualifies = (leadAtEntry >= 1 && leadAtEntry <= 3) || outsOf(p.key) >= 9;
      if (heldLead && qualifies) tag(p.key, 'S');
    }
  }
  return out;
}

module.exports = { computeLinescore, computePitchingDecisions, computeHomeRuns, normalizeKey, cardIdOf };
