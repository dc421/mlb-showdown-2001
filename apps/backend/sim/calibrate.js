/* eslint-disable no-console */
// Compare how managers actually behaved (sim/data/history.json, from fetch-history.js) with how the
// simulator's opponent policy behaves, one decision area at a time.
//
// Usage (from apps/backend):  node sim/calibrate.js [pitching] [--series 300] [--who opponents|boston]
//
// Both sides are reduced to the same per-plate-appearance records and summarized by the same code,
// so differences are behavior, not bookkeeping.
const fs = require('fs');
const path = require('path');
const { loadCards } = require('./cards');
const { loadTeam, leagueCities } = require('./teams');
const { opponentPolicy } = require('./managers');
const { makeRng, simulateSeries } = require('./engine');
const { matchupLW } = require('./rules');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const who = flag('who', 'opponents');
const nSeries = parseInt(flag('series', '300'), 10);
const BOSTON_USER = 4;

const pool = loadCards();

// ---------- Real games -> PA records ----------------------------------------------------------
// A plate appearance resolves on the turn its swing result (or intentional walk) first appears.
// Fatigue state is read from that turn's predecessor: pitcherStats in each turn is the app's own
// record (innings, runs charged, outs, series modifier), so nothing has to be re-derived.
function historyRecords() {
  const history = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'history.json'), 'utf8'));
  const records = [];
  for (const game of history) {
    const turns = game.turns;
    const userBySide = Object.fromEntries(game.participants.map((p) => [p.side, p.user]));
    // Older games key pitcherStats by card id, newer ones by "user_card".
    const statsOf = (ps, user, id) => (ps && (ps[`${user}_${id}`] || ps[String(id)])) || { innings_pitched: [], runs: 0, outs_recorded: 0, fatigue_modifier: 0 };
    const penaltyIf = (ps, user, id, inning) => {
      const card = pool.byId.get(id);
      if (!card || id < 0) return 0;
      const st = statsOf(ps, user, id);
      const innings = new Set([...(st.innings_pitched || []).filter((i) => i !== inning), inning]);
      return Math.max(0, innings.size - (card.ip + (st.fatigue_modifier || 0) - Math.floor((st.runs || 0) / 3)));
    };
    // Who was pinch-hit / pinch-run for: those pitchers' exits were forced, not chosen.
    // The app logs a pinch hitter for the pitcher as "substitutes <hitter> for <pitcher>. <hitter>
    // will now play P." (and only sometimes as "pinch hit for").
    const replacedByUser = new Set();
    for (const e of game.events) {
      if (e.type !== 'substitution') continue;
      const m = e.msg.match(/to pinch (?:hit|run) for (.+)\.$/) || e.msg.match(/substitutes (.+) for (.+)\. \1 will now play P\.$/);
      if (!m) continue;
      const out = m.length === 3 ? m[2] : m[1];
      if (m.length === 3 && pool.cards.some((c) => c.baseName === m[1] && c.isPitcher)) continue; // a pitcher replacing a pitcher
      replacedByUser.add(`${e.user}|${out}`);
    }
    const paIdx = [];
    for (let i = 1; i < turns.length; i++) {
      const t = turns[i]; const prev = turns[i - 1];
      if ((t.res && !prev.res) || (t.pa === 'intentional_walk' && prev.pa !== 'intentional_walk')) paIdx.push(i);
    }
    const last = {}; // defending side -> last pitcher id
    const used = { home: new Set(), away: new Set() };
    const relievers = Object.fromEntries(game.participants.map((p) => [p.side,
      p.roster.map((r) => pool.byId.get(r.card_id)).filter((c) => c && c.isPitcher && c.ip <= 3)]));
    const refHitter = { ob: pool.ref.hitterOB, chartLW: pool.ref.hitterLW, isPitcher: false };
    const starterOf = {};
    let prevHalf = null;
    paIdx.forEach((i, j) => {
      const t = turns[i]; const before = turns[i - 1];
      const defSide = t.top ? 'home' : 'away';
      const offSide = t.top ? 'away' : 'home';
      const defUser = userBySide[defSide];
      const id = t.pit;
      if (id == null) return;
      if (starterOf[defSide] === undefined) starterOf[defSide] = id;
      const halfKey = `${t.inn}|${t.top}`;
      const halfStart = halfKey !== prevHalf;
      prevHalf = halfKey;
      const scoreOf = (turn, side) => (side === 'home' ? turn.hs : turn.as) || 0;
      let info = null;
      if (halfStart && last[defSide] !== undefined) {
        const inc = last[defSide];
        const incCard = pool.byId.get(inc);
        const incStarter = inc === starterOf[defSide];
        const incPenalty = penaltyIf(before.ps, defUser, inc, t.inn);
        info = {
          incumbent: inc, incStarter, incPenalty,
          incLegal: !incStarter || (statsOf(before.ps, defUser, inc).outs_recorded || 0) >= 12 || incPenalty > 0,
          forced: id !== inc && !!incCard && replacedByUser.has(`${defUser}|${incCard.baseName}`),
        };
      }
      const after = turns[(paIdx[j + 1] || turns.length) - 1];
      let entry;
      if (last[defSide] !== undefined && id !== last[defSide]) {
        if (id < 0) entry = { replacement: true };
        else {
          const opts = relievers[defSide].filter((c) => !used[defSide].has(c.id) || c.id === id).map((c) => {
            const pen = penaltyIf(before.ps, defUser, c.id, t.inn);
            return { c, tired: pen > 0, q: matchupLW(refHitter, c, c.ctrl - pen) };
          });
          const me = opts.find((o) => o.c.id === id);
          if (me) entry = { rank: opts.filter((o) => o.q < me.q - 1e-9).length, available: opts.length, tired: me.tired, freshAvailable: opts.filter((o) => !o.tired).length };
        }
      }
      if (id > 0) used[defSide].add(id);
      records.push({
        game: `h${game.game_id}`, def: `h${game.game_id}:${defSide}`, defUser, isBoston: defUser === BOSTON_USER,
        inning: t.inn, top: t.top, pitcher: id, starter: id === starterOf[defSide], replacement: id < 0,
        penalty: penaltyIf(before.ps, defUser, id, t.inn),
        lead: scoreOf(before, defSide) - scoreOf(before, offSide), halfStart, forced: false, ...(info || {}),
        runsOnPA: scoreOf(after, offSide) - scoreOf(before, offSide), entry,
      });
      last[defSide] = id;
    });
  }
  return records;
}

// ---------- Simulated games -> PA records -----------------------------------------------------
function simRecords() {
  const cities = leagueCities().filter((c) => c !== 'Boston');
  const teams = cities.map((c) => loadTeam(c, pool));
  const trace = [];
  const rng = makeRng(1);
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      for (let s = 0; s < nSeries; s++) {
        simulateSeries({
          a: { team: teams[i], policy: opponentPolicy() }, b: { team: teams[j], policy: opponentPolicy() },
          aIsSeriesHome: s % 2 === 0, rng, ref: pool.ref, trace, key: `${i}-${j}-${s}`,
        });
      }
    }
  }
  return trace;
}

// ---------- Summaries -------------------------------------------------------------------------
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '—');
const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});

function pitchingSummary(recs) {
  const bySide = Object.values(groupBy(recs, (r) => r.def));
  const mean = (f) => bySide.reduce((s, x) => s + f(x), 0) / bySide.length;
  const starterInnings = (side) => new Set(side.filter((r) => r.starter).map((r) => `${r.inning}`)).size;
  const summary = {
    'side-games': bySide.length,
    'starter innings (mean)': mean(starterInnings).toFixed(2),
    'starter PAs pitched tired': pct(recs.filter((r) => r.starter && r.penalty > 0).length / recs.filter((r) => r.starter).length),
    'starter PAs at -2 or worse': pct(recs.filter((r) => r.starter && r.penalty >= 2).length / recs.filter((r) => r.starter).length),
    'runs allowed per game': mean((side) => side.filter((r) => r.runsOnPA !== undefined).reduce((s, r) => s + r.runsOnPA, 0)).toFixed(2),
    'relievers used per game': mean((side) => new Set(side.filter((r) => !r.starter).map((r) => r.pitcher)).size).toFixed(2),
    'reliever PAs pitched tired': pct(recs.filter((r) => !r.starter && r.penalty > 0).length / recs.filter((r) => !r.starter).length),
    'replacement-pitcher PAs': pct(recs.filter((r) => r.replacement).length / recs.length),
    'starter exits forced (hit for)': pct(recs.filter((r) => r.halfStart && r.forced && r.incStarter).length
      / recs.filter((r) => r.halfStart && r.incStarter && r.incumbent !== undefined && r.pitcher !== r.incumbent).length),
    'half-innings starting 5+ apart': pct(recs.filter((r) => r.halfStart && Math.abs(r.lead) >= 5).length / recs.filter((r) => r.halfStart).length),
    'tired-starter spots in blowouts': pct(recs.filter((r) => r.halfStart && r.incStarter && r.incLegal && r.incPenalty > 0 && Math.abs(r.lead) >= 5).length
      / recs.filter((r) => r.halfStart && r.incStarter && r.incLegal && r.incPenalty > 0).length),
    'mid-inning changes per game': mean((side) => side.filter((r, i) => i > 0 && !r.halfStart && r.pitcher !== side[i - 1].pitcher).length).toFixed(2),
  };
  // The core decision: at the start of a half-inning, with the incumbent removable and not hit for,
  // how often was he replaced — by role and by how tired he'd be if he stayed?
  const opps = recs.filter((r) => r.halfStart && r.incumbent !== undefined && r.incLegal && !r.forced);
  const table = {};
  for (const role of ['starter', 'reliever']) {
    for (const pen of [0, 1, 2, 3]) {
      const cell = opps.filter((r) => r.incStarter === (role === 'starter') && Math.min(r.incPenalty, 3) === pen);
      table[`${role}, ${pen === 3 ? '-3+' : `-${pen}`} if he stays`] = {
        n: cell.length, 'per game': (cell.length / bySide.length).toFixed(2), 'pulled': pct(cell.filter((r) => r.pitcher !== r.incumbent).length / cell.length),
      };
    }
  }
  return { summary, table };
}

function compare(real, sim, fn) {
  const a = fn(real); const b = fn(sim);
  const rows = {};
  for (const k of Object.keys(a.summary)) rows[k] = { real: a.summary[k], sim: b.summary[k] };
  console.table(rows);
  const t = {};
  for (const k of Object.keys(a.table)) {
    t[k] = { 'real n': a.table[k].n, 'real per game': a.table[k]['per game'], 'sim per game': b.table[k]['per game'], 'real pulled': a.table[k].pulled, 'sim pulled': b.table[k].pulled };
  }
  console.table(t);
}

module.exports = { historyRecords, simRecords };
if (require.main !== module) return;

const all = historyRecords();
const real = all.filter((r) => (who === 'boston' ? r.isBoston : !r.isBoston));
console.log(`Real: ${who} defending, ${new Set(real.map((r) => r.def)).size} side-games. Sim: opponent policy, ${nSeries} series per pairing of non-Boston teams.`);
const sim = simRecords();
console.log('\nPITCHING CHANGES');
compare(real, sim, pitchingSummary);
