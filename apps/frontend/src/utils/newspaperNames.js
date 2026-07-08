// Deterministic box-score / scorecard name resolution.
//
// A player's rendered name is chosen against the ENTIRE player pool (not just whoever is in the
// current game), so a given card always renders the same way everywhere. The rule:
//   - Show just the last name when no one ELSE with a different first name shares it.
//   - Otherwise add the shortest first-name prefix (F. / Fi.) that tells this player apart from the
//     OTHER first names sharing the last name.
//   - The parenthetical (from display_name, e.g. "Ellis Burks (SFG)") is ALWAYS appended and is what
//     distinguishes two cards of the SAME person; it never affects the initial. So "Rodriguez (TEX)"
//     becomes "A. Rodriguez (TEX)" when an Ivan Rodriguez exists, while the two Ellis Burks cards
//     stay "Burks (SFG)" / "Burks (CLE)".
//   - Anything that still collides falls back to the two-letter form until dictated in
//     playerNameOverrides.js. findAmbiguousNames() surfaces those.

import { NAME_OVERRIDES } from './playerNameOverrides';

// Players whose FIRST name is more than one word, so the "first token is the first name" heuristic
// would wrongly absorb part of it into the last name. (Two-word last names like "Vander Wal" and
// "Jr." suffixes are handled correctly by the default rules.)
const MULTIWORD_FIRST = {
  'Chan Ho Park': { first: 'Chan Ho', last: 'Park' },
};

// Split a full (possibly parenthetical) name into { first, last, paren }, mirroring the last-name
// rules used elsewhere (skip a middle initial, keep multi-word last names / suffixes).
export function parseName(fullName) {
  const name = fullName || '';
  const parenMatch = name.match(/\s(\([^)]+\))$/);
  const paren = parenMatch ? parenMatch[1] : '';
  const clean = name.replace(/\s\([^)]+\)$/, '').trim();
  if (MULTIWORD_FIRST[clean]) return { ...MULTIWORD_FIRST[clean], paren };
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0] || '';
  const middleInitial = /^[A-Z]\.?$/;
  let last;
  if (parts.length >= 3 && middleInitial.test(parts[1])) last = parts.slice(2).join(' ');
  else if (parts.length >= 2) last = parts.slice(1).join(' ');
  else last = clean;
  return { first, last, paren };
}

const fullNameOf = (p) => p.display_name || p.displayName || p.name || '';

function parts(fullName) {
  const { first, last, paren } = parseName(fullName);
  return { first, last, suffix: paren ? ` ${paren}` : '' };
}

// last name -> Set of distinct first names in the pool (parenthetical ignored), plus a per-card cache.
function indexPool(allPlayers) {
  const firsts = new Map();
  const byCard = new Map();
  for (const p of allPlayers || []) {
    if (p.card_id == null) continue;
    const pr = parts(fullNameOf(p));
    byCard.set(p.card_id, pr);
    if (!firsts.has(pr.last)) firsts.set(pr.last, new Set());
    firsts.get(pr.last).add(pr.first);
  }
  return { firsts, byCard };
}

// The name part (no parenthetical): the last name alone, or the shortest first-name prefix needed to
// tell this player apart from OTHER first names sharing the last name.
function baseName(pr, firsts) {
  const group = firsts.get(pr.last) || new Set([pr.first]);
  const others = [...group].filter((f) => f !== pr.first);
  if (others.length === 0) return pr.last; // unique last name, or only same-first-name cards
  const initial = pr.first.slice(0, 1);
  if (!others.some((f) => f.slice(0, 1) === initial)) return `${initial}. ${pr.last}`;
  const two = pr.first.slice(0, 2);
  if (!others.some((f) => f.slice(0, 2) === two)) return `${two}. ${pr.last}`;
  return `${two}. ${pr.last}`; // first names collide even at two letters -> needs an override
}

/**
 * Build a resolver over the full player pool. Returns resolve(cardId, fallbackFullName).
 * @param {Array} allPlayers  cards, each with card_id and display_name/name
 */
export function buildNameResolver(allPlayers) {
  const { firsts, byCard } = indexPool(allPlayers);
  return function resolve(cardId, fallbackFullName) {
    if (cardId != null && NAME_OVERRIDES[cardId]) return NAME_OVERRIDES[cardId];
    const pr = byCard.get(cardId) || parts(fallbackFullName || '');
    return `${baseName(pr, firsts)}${pr.suffix}`;
  };
}

/**
 * Players whose fully-resolved name still collides with another card (skips ones already
 * overridden). Returns [{ cardId, fullName, rendered, collidesWith: [...] }].
 */
export function findAmbiguousNames(allPlayers) {
  const { firsts, byCard } = indexPool(allPlayers);
  const display = new Map();
  for (const p of allPlayers || []) {
    if (p.card_id == null) continue;
    const pr = byCard.get(p.card_id);
    display.set(p.card_id, `${baseName(pr, firsts)}${pr.suffix}`);
  }
  const groups = new Map();
  for (const [cardId, d] of display) {
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(cardId);
  }
  const idToName = new Map((allPlayers || []).map((p) => [p.card_id, fullNameOf(p)]));
  const out = [];
  for (const p of allPlayers || []) {
    if (p.card_id == null || NAME_OVERRIDES[p.card_id]) continue;
    const grp = groups.get(display.get(p.card_id));
    if (!grp || grp.length < 2) continue;
    out.push({
      cardId: p.card_id, fullName: fullNameOf(p), rendered: display.get(p.card_id),
      collidesWith: grp.filter((id) => id !== p.card_id).map((id) => ({ cardId: id, fullName: idToName.get(id) })),
    });
  }
  return out;
}
