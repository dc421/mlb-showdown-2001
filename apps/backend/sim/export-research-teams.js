/* eslint-disable no-console */
// Write the opposing teams' rosters in research.R's "Teams for Load Issues.csv" format, using the
// same rosters the simulator plays against (current roster if complete, else last season's).
//
// Usage (from apps/backend):  node sim/export-research-teams.js <out.csv> [--as Boston]
//
// Roles follow research.R: SP123 / SP4 by the opponent manager's rotation, RP1 / RP2 / RP345 by
// reliever quality, field positions and DH from the lineup the opponent fields with a DH, and B for
// everyone else. Player names use research.R's join keys: the plain name when unique, "Name (Tm)"
// when another card shares it, and the card's display name ("Jose Valentin (SS)", "Octavio Dotel
// (SP)") when even the team doesn't tell them apart.
const fs = require('fs');
const { loadCards } = require('./cards');
const { loadTeam, leagueCities } = require('./teams');
const { opponentPolicy } = require('./managers');
const { matchupLW } = require('./rules');

const args = process.argv.slice(2);
const out = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--as');
const asIdx = args.indexOf('--as');
const self = asIdx >= 0 ? args[asIdx + 1] : 'Boston';
if (!out) { console.error('Usage: node sim/export-research-teams.js <out.csv> [--as Boston]'); process.exit(1); }

const pool = loadCards();
const researchName = (card) => {
  const sameName = pool.cards.filter((c) => c.baseName === card.baseName);
  if (sameName.length === 1) return card.baseName;
  if (sameName.filter((c) => c.team === card.team).length > 1) return card.name;
  return `${card.baseName} (${card.team})`;
};

const rows = [];
for (const city of leagueCities().filter((c) => c.toLowerCase() !== self.toLowerCase())) {
  const team = loadTeam(city, pool);
  const policy = opponentPolicy();
  policy.rotation(team, pool.ref).filter((c) => c.id > 0)
    .forEach((c, i) => rows.push([city, c, i < 3 ? 'SP123' : 'SP4']));
  const refHitter = { ob: pool.ref.hitterOB, chartLW: pool.ref.hitterLW, isPitcher: false };
  [...team.relievers].sort((a, b) => matchupLW(refHitter, a, a.ctrl) - matchupLW(refHitter, b, b.ctrl))
    .forEach((c, i) => rows.push([city, c, i === 0 ? 'RP1' : i === 1 ? 'RP2' : 'RP345']));
  const lineup = policy.buildLineup(team, true, pool.ref).filter((s) => s.card.id > 0);
  for (const s of lineup) rows.push([city, s.card, s.pos]);
  const used = new Set(lineup.map((s) => s.card.id));
  for (const c of team.hitters) if (!used.has(c.id)) rows.push([city, c, 'B']);
  console.log(`${city}: ${team.source}, ${rows.filter((r) => r[0] === city).length} players`);
}
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const lines = ['"","Team","Player","Pos"', ...rows.map(([team, card, pos], i) => [q(i + 1), q(team), q(researchName(card)), q(pos)].join(','))];
fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`Wrote ${rows.length} rows to ${out}`);
