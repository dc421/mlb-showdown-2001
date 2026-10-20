// Turn a roster (who is on the team and in what role) into the team shape the engine plays with:
//   { name, fielders: { C, 1B, ... }, dh, bench, restricted, hitters, starters, relievers }
//
// A roster can come from the league-roster snapshot (by city) or from a CSV with Player and Pos
// columns (plus an optional Team column, as in research.R's team file). Pos is a field position, DH,
// B / BENCH, anything starting with SP or RP, or PITCHING_STAFF (split into SP / RP by IP).
const fs = require('fs');
const path = require('path');
const { FIELD_POSITIONS } = require('./policy');

function buildTeam(name, entries) {
  const team = { name, fielders: {}, dh: null, bench: [], restricted: new Set(), hitters: [], starters: [], relievers: [] };
  for (const { card, role } of entries) {
    const r = String(role || '').toUpperCase();
    if (card.isPitcher) {
      const isStarter = r.startsWith('SP') || (!r.startsWith('RP') && card.ip > 3);
      (isStarter ? team.starters : team.relievers).push(card);
      continue;
    }
    team.hitters.push(card);
    if (FIELD_POSITIONS.includes(r) && !team.fielders[r]) team.fielders[r] = card;
    else if (r === 'DH' && !team.dh) team.dh = card;
    else {
      team.bench.push(card);
      if (r === 'B' || r === 'BENCH') team.restricted.add(card.id); // backups can't field before the 7th
    }
  }
  return team;
}

// Find a card by the name a human would write: the display name ("Brad Ausmus (HOU)") or the plain
// name, narrowed by team / set when those are given (research.R identifies cards that way).
function resolveCard(cards, playerName, { tm, set } = {}) {
  const want = playerName.trim().toLowerCase();
  const same = (a, b) => !b || String(a || '').toLowerCase() === b.trim().toLowerCase();
  const narrow = (list) => list.filter((c) => same(c.team, tm) && same(c.set, set));
  const byDisplay = narrow(cards.filter((c) => c.name.toLowerCase() === want));
  if (byDisplay.length === 1) return byDisplay[0];
  const byBase = narrow(cards.filter((c) => (c.baseName || '').toLowerCase() === want));
  if (byBase.length === 1) return byBase[0];
  const options = [...byDisplay, ...byBase].map((c) => c.name).join(', ');
  throw new Error(options ? `"${playerName}" is ambiguous: ${options}` : `No card named "${playerName}"`);
}

function parseCsv(text) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const cells = []; let cur = ''; let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  });
  const header = rows.shift().map((h) => h.toLowerCase());
  return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])));
}

function teamFromCsv(file, teamName, cards) {
  let rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (rows.length && !('player' in rows[0] && 'pos' in rows[0])) throw new Error(`${file} needs Player and Pos columns`);
  if (teamName) rows = rows.filter((r) => (r.team || '').toLowerCase() === teamName.toLowerCase());
  else if (new Set(rows.map((r) => r.team)).size > 1) {
    throw new Error(`${file} holds several teams — pick one with "${file}:<Team>"`);
  }
  if (rows.length === 0) throw new Error(`No roster rows for ${teamName || file}`);
  const name = teamName || rows[0].team || path.basename(file, path.extname(file));
  return buildTeam(name, rows.map((r) => ({ card: resolveCard(cards, r.player, r), role: r.pos })));
}

const ROSTER_SIZE = 20;

// A league team by city: its current roster if that is complete (20 cards), otherwise the whole
// roster it finished the previous season with — a half-drafted roster is never mixed with old cards.
function teamFromLeague(city, byId, dir = path.join(__dirname, 'data')) {
  const read = (name) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`${file} not found — run: node sim/fetch-data.js`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const all = read('league-rosters.json');
  const forCity = (rows) => rows.filter((r) => r.team.toLowerCase() === city.toLowerCase());
  let rows = forCity(all);
  if (rows.length === 0) {
    throw new Error(`No league roster for "${city}". Available: ${[...new Set(all.map((r) => r.team))].join(', ')}`);
  }
  let source = 'current roster';
  if (rows.length !== ROSTER_SIZE) {
    const previous = forCity(read('previous-rosters.json'));
    if (previous.length === 0) throw new Error(`${city}'s current roster has ${rows.length} cards and no previous season is on file`);
    source = `${previous[0].season} roster (current roster has only ${rows.length} of ${ROSTER_SIZE})`;
    rows = previous;
  }
  const team = buildTeam(rows[0].team, rows.map((r) => ({ card: byId.get(r.card_id), role: r.assignment })));
  team.source = source;
  return team;
}

// spec: a league city ("Boston"), a CSV path, or "path.csv:Team Name".
function loadTeam(spec, { cards, byId }) {
  const m = spec.match(/^(.*\.csv)(?::(.+))?$/i);
  return m ? teamFromCsv(m[1], m[2], cards) : teamFromLeague(spec, byId);
}

// Things about a roster the engine will silently paper over with replacement players.
function rosterWarnings(team) {
  const w = [];
  const missing = FIELD_POSITIONS.filter((p) => !team.fielders[p]);
  if (missing.length) w.push(`no ${missing.join(', ')} (replacement hitter plays there)`);
  if (team.starters.length !== 4) w.push(`${team.starters.length} starters (need 4; best 4 used, gaps filled by the replacement pitcher)`);
  const size = team.hitters.length + team.starters.length + team.relievers.length;
  if (size !== 20) w.push(`${size} players (a full roster is 20)`);
  return w;
}

function leagueCities(dir = path.join(__dirname, 'data')) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'league-rosters.json'), 'utf8'));
  return [...new Set(rows.map((r) => r.team))];
}

module.exports = { loadTeam, buildTeam, rosterWarnings, leagueCities };
