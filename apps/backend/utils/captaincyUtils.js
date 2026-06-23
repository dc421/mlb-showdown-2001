// Captaincy / Face-of-the-Franchise / Core-Squad scoring.
//
// A player's value to a franchise F is a weighted score:
//   base = (ringsT - ringsO/2)*5 + (seasonsT - seasonsO/2) + (mvaT - mvaO/2)*2 + subsT + tgaootsT
// where *T = earned while on F, *O = earned while on any other franchise. Other-team
// negatives are halved. Silver Submarines / TGAOOTs are team-only.
//
//   captainScore = base + 2 * (ongoing consecutive seasons with F)
//
// Faces and Core Squads rank by `base` (all-time). Captains (per team-season) rank by
// `captainScore` using only history PRIOR to that season. Ties are broken:
//   - during a franchise's pre-established (debut) era: forward-résumé (advance the
//     cutoff one season at a time, recompute, until a unique leader emerges);
//   - after the franchise's first uniquely-determined captain: by highest card points,
//     then alphabetically.
//
// All franchise identity (historical names / relocations) goes through findTeamForRecord
// so this matches the rest of the app exactly.

const { findTeamForRecord } = require('./standingsUtils');

const RING_W = 5;
const MVA_W = 2;
const OTHER_DIV = 2;      // other-team negatives are halved
const CONSEC_MULT = 2;    // consecutive seasons count double for captains

const normName = (n) =>
  (n || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

function computeCaptaincies({ teams, series, rosters, cardPoints = {} }) {
  // ---- franchise mapping (cached) ----
  const fCache = {};
  const F = (name, id) => {
    const k = `${name || ''}|${id || ''}`;
    if (fCache[k] !== undefined) return fCache[k];
    const t = findTeamForRecord(name, id, teams);
    const phantom = (t.name || '').includes('Phantoms');
    return (fCache[k] = phantom || !t.team_id ? null : t.team_id);
  };

  // ---- chronological season order from series dates ----
  const seasonDate = {};
  series.forEach((r) => {
    if (!r.date) return;
    const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
    if (!seasonDate[r.season_name] || d < seasonDate[r.season_name]) seasonDate[r.season_name] = d;
  });

  // ---- champions / awards per season ----
  const champ = {}, mvaBy = {}, subBy = {}, tgBy = {};
  series.forEach((r) => {
    if (r.round === 'Golden Spaceship') {
      champ[r.season_name] = F(r.winning_team_name, r.winning_team_id);
      if (r.mva) mvaBy[r.season_name] = r.mva;
    }
    if (r.round === 'Silver Submarine') subBy[r.season_name] = F(r.winning_team_name, r.winning_team_id);
    if (r.tgaoot) tgBy[r.season_name] = r.tgaoot;
  });

  // ---- roster index ----
  const pidOf = (r) => (r.card_id != null ? 'c' + r.card_id : 'n:' + normName(r.player_name));
  const cardIdOf = (pid) => (pid.startsWith('c') ? parseInt(pid.slice(1), 10) : null);
  const ms = {};   // pid -> { season -> Set(franchiseId) }
  const nm = {};   // pid -> display name (shortest seen)
  rosters.forEach((r) => {
    const fid = F(r.team_name, null);
    if (!fid) return;
    const pid = pidOf(r);
    (ms[pid] = ms[pid] || {});
    (ms[pid][r.season] = ms[pid][r.season] || new Set()).add(fid);
    if (!nm[pid] || (r.player_name || '').length < nm[pid].length) nm[pid] = r.player_name;
  });

  const seasons = [...new Set(rosters.map((r) => r.season))].sort((a, b) =>
    (seasonDate[a] || '9999') < (seasonDate[b] || '9999') ? -1 : 1
  );
  const idx = {};
  seasons.forEach((s, i) => (idx[s] = i));

  const isMva = (pid, s) =>
    champ[s] != null && mvaBy[s] && ms[pid] && ms[pid][s] && ms[pid][s].has(champ[s]) &&
    normName(mvaBy[s]) === normName(nm[pid]);
  const isTg = (pid, s) => tgBy[s] && normName(tgBy[s]) === normName(nm[pid]);

  const points = (pid) => {
    const cid = cardIdOf(pid);
    return cid != null && cardPoints[cid] != null ? cardPoints[cid] : -1;
  };

  // ---- score a player wrt franchise, using seasons before `cutoff` ----
  function score(pid, fid, cutoff, withConsec) {
    const m = ms[pid] || {};
    let rT = 0, rO = 0, sT = 0, sO = 0, mT = 0, mO = 0, subT = 0, tgT = 0;
    seasons.forEach((s, i) => {
      if (i >= cutoff) return;
      const fs = m[s];
      if (!fs) return;
      const onF = fs.has(fid);
      const onO = [...fs].some((x) => x !== fid);
      if (onF) sT++;
      if (onO) sO++;
      if (champ[s] === fid && onF) rT++;
      if (champ[s] != null && champ[s] !== fid && fs.has(champ[s])) rO++;
      if (isMva(pid, s)) { if (champ[s] === fid) mT++; else mO++; }
      if (subBy[s] === fid && onF) subT++;
      if (isTg(pid, s) && onF) tgT++;
    });
    let c = 0;
    if (withConsec) {
      for (let i = cutoff - 1; i >= 0; i--) {
        const fs = m[seasons[i]];
        if (fs && fs.has(fid)) c++; else break;
      }
    }
    const v = (rT - rO / OTHER_DIV) * RING_W + (sT - sO / OTHER_DIV) + (mT - mO / OTHER_DIV) * MVA_W +
      subT + tgT + (withConsec ? CONSEC_MULT * c : 0);
    return { v, rT, rO, sT, sO, mT, mO, c };
  }

  const out = (pid) => ({ card_id: cardIdOf(pid), name: nm[pid] });

  // ---- captain for franchise `fid` at season index `si` ----
  function captain(fid, si, established) {
    let roster = [...new Set(
      rosters.filter((r) => r.season === seasons[si] && F(r.team_name, null) === fid).map(pidOf)
    )].map((pid) => ({ pid, s: score(pid, fid, si, true) }));
    if (!roster.length) return null;

    const max = Math.max(...roster.map((o) => o.s.v));
    let top = roster.filter((o) => Math.abs(o.s.v - max) < 1e-9);
    if (top.length === 1) return { ...out(top[0].pid), score: max, unique: true, how: 'score' };

    // pre-established debut tie: forward-résumé
    if (!established) {
      for (let cut = si + 1; cut <= seasons.length; cut++) {
        top.forEach((o) => (o.f = score(o.pid, fid, cut, true)));
        const m2 = Math.max(...top.map((o) => o.f.v));
        const nt = top.filter((o) => Math.abs(o.f.v - m2) < 1e-9);
        if (nt.length === 1) return { ...out(nt[0].pid), score: max, unique: false, how: 'forward' };
        top = nt;
      }
    }
    // post-establishment (or unresolved) tie: highest card points, then alphabetical
    top.sort((a, b) => points(b.pid) - points(a.pid) || (nm[a.pid] || '').localeCompare(nm[b.pid] || ''));
    return { ...out(top[0].pid), score: max, unique: false, how: 'cardPoints' };
  }

  // ---- per-team-season captains (with establishment tracking) ----
  const captains = {};        // teamId -> { season -> {card_id,name,...} }
  const currentCaptains = {}; // teamId -> {card_id,name,season}
  teams.forEach((t) => { captains[t.team_id] = {}; });
  const established = {};
  seasons.forEach((s, si) => {
    const fids = [...new Set(
      rosters.filter((r) => r.season === s).map((r) => F(r.team_name, null)).filter(Boolean)
    )];
    fids.forEach((fid) => {
      const c = captain(fid, si, established[fid]);
      if (!c) return;
      if (c.unique) established[fid] = true;
      captains[fid][s] = c;
      currentCaptains[fid] = { ...c, season: s };
    });
  });

  // ---- Face of the Franchise + per-player base scores (for Core Squad) ----
  const faces = {};       // teamId -> {card_id,name,score}
  const playerScores = {}; // teamId -> { byCard:{}, byName:{} } base score per player
  teams.forEach((t) => {
    const fid = t.team_id;
    const pool = new Set();
    seasons.forEach((s) =>
      rosters.filter((r) => r.season === s && F(r.team_name, null) === fid).forEach((r) => pool.add(pidOf(r)))
    );
    const byCard = {}, byName = {};
    let best = null;
    pool.forEach((pid) => {
      const v = score(pid, fid, seasons.length, false).v;
      const cid = cardIdOf(pid);
      if (cid != null) byCard[cid] = v;
      byName[normName(nm[pid])] = v;
      if (!best || v > best.v || (v === best.v && points(pid) > points(best.pid))) best = { pid, v };
    });
    playerScores[fid] = { byCard, byName };
    if (best) faces[fid] = { ...out(best.pid), score: best.v };
  });

  // ---- Core Squad ----
  // Mirrors the team-page roster matrix exactly: each season's roster is slotted
  // (C/1B/…/DH, Bench by points, SP1-4 + RP by points); per slot we tally who filled
  // it, keep slots filled in >=50% of seasons, rank candidates by base score (then
  // appearances), and resolve a player claiming multiple slots by regret-minimization.
  const BATTER_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  const baseOf = (pid, fid) => score(pid, fid, seasons.length, false).v;

  // Slot a franchise's roster for one season into matrix positions (pids).
  function slotSeason(fid, season) {
    const batter = { C: [], '1B': [], '2B': [], '3B': [], SS: [], LF: [], CF: [], RF: [], DH: [], B: [] };
    const sp = [], rp = [];
    rosters.filter((r) => r.season === season && F(r.team_name, null) === fid).forEach((r) => {
      const pid = pidOf(r);
      const pos = (r.position || '').toUpperCase();
      if (pos === 'SP') sp.push(pid);
      else if (pos === 'RP') rp.push(pid);
      else if (batter[pos]) batter[pos].push(pid);
      else batter.B.push(pid); // BENCH / B / anything unexpected
    });
    const byPts = (a, b) => points(b) - points(a);
    BATTER_POS.forEach((pos) => batter[pos].sort(byPts));
    batter.B.sort(byPts); sp.sort(byPts); rp.sort(byPts);
    return { batter, bench: batter.B, sp, rp };
  }

  function coreSquadFor(fid) {
    const fSeasons = seasons.filter((s) => rosters.some((r) => r.season === s && F(r.team_name, null) === fid));
    const total = fSeasons.length;
    if (!total) return { batters: {}, pitchers: {}, members: [] };
    const slotted = fSeasons.map((s) => slotSeason(fid, s));
    let maxBench = 1, maxRp = 2;
    slotted.forEach((o) => { maxBench = Math.max(maxBench, o.bench.length); maxRp = Math.max(maxRp, o.rp.length); });

    const batterKeys = [...BATTER_POS];
    for (let i = 1; i <= maxBench; i++) batterKeys.push('Bench' + i);
    const pitcherKeys = ['SP1', 'SP2', 'SP3', 'SP4'];
    for (let i = 1; i <= maxRp; i++) pitcherKeys.push('RP' + i);

    const batterRows = slotted.map((o) => {
      const row = {};
      BATTER_POS.forEach((pos) => { row[pos] = o.batter[pos][0] || null; });
      for (let i = 0; i < maxBench; i++) row['Bench' + (i + 1)] = o.bench[i] || null;
      return row;
    });
    const pitcherRows = slotted.map((o) => {
      const row = { SP1: o.sp[0] || null, SP2: o.sp[1] || null, SP3: o.sp[2] || null, SP4: o.sp[3] || null };
      for (let i = 0; i < maxRp; i++) row['RP' + (i + 1)] = o.rp[i] || null;
      return row;
    });

    const select = (rows, keys) => {
      const stats = {};
      keys.forEach((k) => (stats[k] = {}));
      rows.forEach((row) => keys.forEach((k) => { const pid = row[k]; if (pid) stats[k][pid] = (stats[k][pid] || 0) + 1; }));
      const valid = {};
      keys.forEach((slot) => {
        let filled = 0; const cands = [];
        for (const pid in stats[slot]) { const c = stats[slot][pid]; filled += c; cands.push({ pid, count: baseOf(pid, fid), slotCount: c }); }
        if (filled / total >= 0.5) { cands.sort((a, b) => b.count - a.count || b.slotCount - a.slotCount); valid[slot] = cands; }
      });
      const vk = Object.keys(valid);
      const ptr = {}; vk.forEach((k) => (ptr[k] = 0));
      let conflict = true, iter = 0;
      while (conflict && iter < 100) {
        iter++; conflict = false;
        const assign = {};
        vk.forEach((slot) => { const i = ptr[slot], c = valid[slot]; if (i < c.length) (assign[c[i].pid] = assign[c[i].pid] || []).push(slot); });
        for (const pid in assign) {
          const slots = assign[pid];
          if (slots.length > 1) {
            conflict = true;
            const regrets = slots.map((slot) => { const i = ptr[slot], c = valid[slot]; const cur = c[i].count; const nxt = i + 1 < c.length ? c[i + 1].count : -Infinity; return { slot, regret: cur - nxt }; });
            regrets.sort((a, b) => b.regret - a.regret);
            const keep = regrets[0].slot;
            slots.forEach((slot) => { if (slot !== keep) ptr[slot]++; });
          }
        }
      }
      const picks = {};
      vk.forEach((slot) => { const i = ptr[slot], c = valid[slot]; if (i < c.length) picks[slot] = out(c[i].pid); });
      return picks;
    };

    const batters = select(batterRows, batterKeys);
    const pitchers = select(pitcherRows, pitcherKeys);
    const members = new Set();
    [batters, pitchers].forEach((g) => Object.values(g).forEach((e) => { if (e.card_id != null) members.add(e.card_id); }));
    return { batters, pitchers, members: [...members] };
  }

  const coreSquads = {}; // teamId -> { batters, pitchers, members }
  teams.forEach((t) => { coreSquads[t.team_id] = coreSquadFor(t.team_id); });

  return { captains, currentCaptains, faces, playerScores, coreSquads, seasons };
}

module.exports = { computeCaptaincies, normName };
