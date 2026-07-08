// Computes pitcher decisions (Win / Loss / Save / Blown Save) for a completed game by replaying the
// per-plate-appearance atBatLog. This is a pragmatic implementation of the standard rules — good for
// the common cases, with a few documented simplifications:
//   - A run is charged to whoever was on the mound for that PA (inherited-runner nuance is ignored).
//   - Save "situations" use the lead-of-3-or-fewer and 3-innings rules; the "tying run on
//     deck/on base" rule is not evaluated (base state isn't in the atBatLog).
//   - The winning-pitcher starter rule (must go 5 IP) reassigns to the first winning reliever.
// Edge cases the official scorer would rule on by judgment may differ — those can be corrected by
// hand if needed.

// "6.2" IP display -> outs (20).
function ipToOuts(ip) {
  const [whole, frac] = String(ip ?? '0').split('.');
  return (parseInt(whole, 10) || 0) * 3 + (parseInt(frac, 10) || 0);
}

// Normalize a (possibly malformed "4_4_614") pitcher key to "ownerId_cardId", matching boxScore.js.
export function normalizeKey(key) {
  const parts = String(key).split('_');
  if (parts.length < 2) return String(key);
  return `${parts[0]}_${parts[parts.length - 1]}`;
}

function ownerId(key) {
  return String(key).split('_')[0];
}

/**
 * @param {Array} atBatLog   chronological per-PA log (needs batterTeam, pitcherKey, scoredRunnerIds)
 * @param {object} teams      { away: { user_id }, home: { user_id } }
 * @param {object} boxScore   { away:{pitching:[{pitcherKey,ip}]}, home:{...} } for IP lookups
 * @returns {Object<string,string[]>}  normalized pitcherKey -> tags, e.g. { "1_201": ["W"] }
 */
export function computePitchingDecisions(atBatLog, teams, boxScore) {
  const out = {};
  if (!Array.isArray(atBatLog) || atBatLog.length === 0) return out;

  const awayUserId = teams?.away?.user_id;
  const sideOf = (key) => (String(ownerId(key)) === String(awayUserId) ? 'away' : 'home');

  // Outs pitched per normalized key, from the box score pitching rows.
  const outsByKey = new Map();
  for (const s of ['away', 'home']) {
    for (const row of boxScore?.[s]?.pitching || []) outsByKey.set(normalizeKey(row.pitcherKey), ipToOuts(row.ip));
  }
  const outsOf = (key) => outsByKey.get(normalizeKey(key)) || 0;

  // Replay the log into a running score, tagging each PA with the pitcher on the mound (normalized).
  const plays = [];
  let away = 0;
  let home = 0;
  for (const e of atBatLog) {
    const runs = (e.scoredRunnerIds || []).length;
    if (e.batterTeam === 'away') away += runs;
    else home += runs;
    plays.push({ key: normalizeKey(e.pitcherKey), side: sideOf(e.pitcherKey), away, home, inning: e.inning || 0 });
  }
  const gameInnings = Math.max(...plays.map((p) => p.inning), 0);

  const finalAway = away;
  const finalHome = home;
  if (finalAway === finalHome) return out; // no winner => no decisions

  const winner = finalHome > finalAway ? 'home' : 'away';
  const wScore = (p) => (winner === 'home' ? p.home : p.away);
  const lScore = (p) => (winner === 'home' ? p.away : p.home);

  const tag = (key, t) => {
    if (!key) return;
    const nk = normalizeKey(key);
    if (!out[nk]) out[nk] = [];
    if (!out[nk].includes(t)) out[nk].push(t);
  };

  const firstKeyForSide = (side) => {
    for (const p of plays) if (p.side === side) return p.key;
    return null;
  };

  // Go-ahead PA: the winner leads after it and never trails-or-ties again. It's the PA right after
  // the last one at which the winner was tied or behind.
  let lastNonLead = -1;
  for (let i = 0; i < plays.length; i++) {
    if (wScore(plays[i]) <= lScore(plays[i])) lastNonLead = i;
  }
  const goAheadIdx = Math.min(lastNonLead + 1, plays.length - 1);
  const goAheadPlay = plays[goAheadIdx];

  // Loss: the losing team's pitcher on the mound for the go-ahead run.
  tag(goAheadPlay.key, 'L');

  // Win: the winning team's pitcher of record when the lead was taken for good.
  let winKey = null;
  for (let i = goAheadIdx; i >= 0; i--) {
    if (plays[i].side === winner) { winKey = plays[i].key; break; }
  }
  if (!winKey) winKey = firstKeyForSide(winner);

  // Starter must complete 5 innings in a game of 6+; otherwise the win goes to the first reliever.
  const winnerStarter = firstKeyForSide(winner);
  if (winKey === winnerStarter && outsOf(winnerStarter) < 15 && gameInnings >= 6) {
    for (const p of plays) {
      if (p.side === winner && p.key !== winnerStarter) { winKey = p.key; break; }
    }
  }
  tag(winKey, 'W');

  // Save / blown save: examine each reliever (any pitcher that isn't their side's starter).
  const awayStarter = firstKeyForSide('away');
  const homeStarter = firstKeyForSide('home');
  const starterOf = (side) => (side === 'away' ? awayStarter : homeStarter);

  const seen = new Set();
  for (let idx = 0; idx < plays.length; idx++) {
    const p = plays[idx];
    if (seen.has(p.key) || p.key === starterOf(p.side)) continue;
    seen.add(p.key);

    // Score the moment before this reliever's first PA.
    const prev = plays[idx - 1] || { away: 0, home: 0 };
    const teamBefore = p.side === 'home' ? prev.home : prev.away;
    const oppBefore = p.side === 'home' ? prev.away : prev.home;
    const leadAtEntry = teamBefore - oppBefore;

    // Their stint = the run of consecutive PAs they pitched.
    const stint = plays.filter((q) => q.key === p.key);
    const teamScore = (q) => (p.side === 'home' ? q.home : q.away);
    const oppScore = (q) => (p.side === 'home' ? q.away : q.home);
    const enteredInSaveSituation = leadAtEntry >= 1 && leadAtEntry <= 3;
    const lostLeadDuringStint = stint.some((q) => teamScore(q) <= oppScore(q));

    if (enteredInSaveSituation && lostLeadDuringStint) tag(p.key, 'BS');

    // Save: winning-side finisher, not the winner, entered with a save-worthy margin (lead 1-3 or
    // 3+ innings) and held the lead throughout.
    const isFinisher = p.key === plays[plays.length - 1].key && p.side === winner;
    if (isFinisher && !(out[p.key] || []).includes('W')) {
      const heldLead = stint.every((q) => teamScore(q) > oppScore(q));
      const qualifies = (leadAtEntry >= 1 && leadAtEntry <= 3) || outsOf(p.key) >= 9;
      if (heldLead && qualifies) tag(p.key, 'S');
    }
  }

  return out;
}
