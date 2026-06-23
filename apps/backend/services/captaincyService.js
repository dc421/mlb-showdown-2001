// Loads the global data captaincy scoring needs and caches the computed result.
// The inputs (historical rosters, series results, card points) change rarely, so a
// short in-process TTL keeps team-page loads cheap without a manual invalidation hook.

const { pool } = require('../db');
const { computeCaptaincies } = require('../utils/captaincyUtils');

const TTL_MS = 5 * 60 * 1000;
let cache = null;
let cachedAt = 0;

async function loadAndCompute() {
  const [teamsRes, seriesRes, rostersRes, ppvRes] = await Promise.all([
    pool.query('SELECT * FROM teams'),
    pool.query(`SELECT season_name, round, winning_team_name, winning_team_id, mva, tgaoot, date FROM series_results`),
    pool.query(`SELECT season, team_name, player_name, card_id, position FROM historical_rosters`),
    pool.query(`SELECT ppv.card_id, ppv.points, ps.name
                FROM player_point_values ppv JOIN point_sets ps ON ps.point_set_id = ppv.point_set_id`),
  ]);

  // Canonical card points: prefer the 'Original Pts' set, else the max across sets.
  const cardPoints = {};
  const maxPoints = {};
  ppvRes.rows.forEach((r) => {
    if (r.points == null) return;
    if (r.points > (maxPoints[r.card_id] ?? -1)) maxPoints[r.card_id] = r.points;
    if (r.name === 'Original Pts') cardPoints[r.card_id] = r.points;
  });
  Object.keys(maxPoints).forEach((cid) => { if (cardPoints[cid] == null) cardPoints[cid] = maxPoints[cid]; });

  return computeCaptaincies({
    teams: teamsRes.rows,
    series: seriesRes.rows,
    rosters: rostersRes.rows,
    cardPoints,
  });
}

async function getCaptaincies({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;
  cache = await loadAndCompute();
  cachedAt = Date.now();
  return cache;
}

// Convenience slice for a single franchise (what the team page consumes).
async function getCaptaincyForTeam(teamId) {
  const all = await getCaptaincies();
  const id = parseInt(teamId, 10);
  return {
    captains: all.captains[id] || {},
    currentCaptain: all.currentCaptains[id] || null,
    face: all.faces[id] || null,
    coreSquad: all.coreSquads[id] || { batters: {}, pitchers: {}, members: [] },
    playerScores: all.playerScores[id] || { byCard: {}, byName: {} },
  };
}

module.exports = { getCaptaincies, getCaptaincyForTeam };
