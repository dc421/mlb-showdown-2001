// Win-probability endpoints. Mounted at /api, so these resolve to:
//   GET /api/games/:gameId/win-probability     — one game's WP curve + biggest-WPA plays
//   GET /api/series/:seriesId/win-probability   — compact curves for every completed game in a series
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const authenticateToken = require('../middleware/authenticateToken');
const { computeGameWinProbability } = require('../services/winProbability');

const TEAM_COLS = 'user_id, team_id, city, name, abbreviation, logo_url, primary_color, secondary_color';

function teamShape(t) {
  if (!t) return null;
  return {
    user_id: t.user_id,
    abbreviation: t.abbreviation,
    name: t.name,
    city: t.city,
    logo_url: t.logo_url,
    primary_color: t.primary_color,
    secondary_color: t.secondary_color,
  };
}

// Resolve home/away team rows for a game from its participants + home_team_user_id.
async function loadTeams(client, gameId) {
  const g = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
  if (g.rowCount === 0) return null;
  const homeUserId = g.rows[0].home_team_user_id;
  const parts = await client.query('SELECT user_id FROM game_participants WHERE game_id = $1', [gameId]);
  const userIds = parts.rows.map((r) => r.user_id);
  const awayUserId = userIds.find((u) => u !== homeUserId) ?? null;
  const teamsRes = await client.query(`SELECT ${TEAM_COLS} FROM teams WHERE user_id = ANY($1)`, [[...new Set(userIds)]]);
  const byUser = {};
  for (const t of teamsRes.rows) byUser[t.user_id] = t;
  return { home: teamShape(byUser[homeUserId]), away: teamShape(byUser[awayUserId]) };
}

router.get('/games/:gameId/win-probability', authenticateToken, async (req, res) => {
  const gameId = parseInt(req.params.gameId, 10);
  if (Number.isNaN(gameId)) return res.status(400).json({ message: 'Invalid game id.' });
  const client = await pool.connect();
  try {
    const teams = await loadTeams(client, gameId);
    if (!teams) return res.status(404).json({ message: 'Game not found.' });
    const states = await client.query(
      'SELECT turn_number, state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number', [gameId]);
    const events = await client.query(
      'SELECT turn_number, event_type, log_message FROM game_events WHERE game_id = $1 ORDER BY event_id', [gameId]);
    const wp = computeGameWinProbability(states.rows, { topN: 5, gameEvents: events.rows });
    if (!wp) return res.json({ game_id: gameId, teams, available: false });
    res.json({ game_id: gameId, teams, available: true, ...wp });
  } catch (err) {
    console.error('win-probability error (game', gameId, '):', err);
    res.status(500).json({ message: 'Server error computing win probability.' });
  } finally {
    client.release();
  }
});

router.get('/series/:seriesId/win-probability', authenticateToken, async (req, res) => {
  const seriesId = parseInt(req.params.seriesId, 10);
  if (Number.isNaN(seriesId)) return res.status(400).json({ message: 'Invalid series id.' });
  const client = await pool.connect();
  try {
    const gamesRes = await client.query(
      "SELECT game_id, game_in_series, home_team_user_id FROM games WHERE series_id = $1 AND status = 'completed' ORDER BY game_in_series, game_id",
      [seriesId]);
    if (gamesRes.rowCount === 0) return res.json({ series_id: seriesId, games: [] });

    // Team lookup across all participants in the series (one query).
    const gameIds = gamesRes.rows.map((r) => r.game_id);
    const partRes = await client.query('SELECT game_id, user_id FROM game_participants WHERE game_id = ANY($1)', [gameIds]);
    const usersByGame = {};
    const userSet = new Set();
    for (const r of partRes.rows) {
      (usersByGame[r.game_id] = usersByGame[r.game_id] || []).push(r.user_id);
      userSet.add(r.user_id);
    }
    const teamsRes = await client.query(`SELECT ${TEAM_COLS} FROM teams WHERE user_id = ANY($1)`, [[...userSet]]);
    const teamByUser = {};
    for (const t of teamsRes.rows) teamByUser[t.user_id] = t;

    const statesRes = await client.query(
      'SELECT game_id, state_data FROM game_states WHERE game_id = ANY($1) ORDER BY game_id, turn_number', [gameIds]);
    const statesByGame = {};
    for (const r of statesRes.rows) (statesByGame[r.game_id] = statesByGame[r.game_id] || []).push(r);

    const games = [];
    // Player WPA summed across every completed game in the series (for the series box score).
    const seriesPlayerWpa = { batters: {}, pitchers: {} };
    const accum = (dst, src) => {
      for (const k of Object.keys(src || {})) dst[k] = Math.round(((dst[k] || 0) + src[k]) * 1000) / 1000;
    };
    for (const g of gamesRes.rows) {
      const wp = computeGameWinProbability(statesByGame[g.game_id] || [], { topN: 3 });
      if (!wp) continue;
      const homeUserId = g.home_team_user_id;
      const awayUserId = (usersByGame[g.game_id] || []).find((u) => u !== homeUserId) ?? null;
      accum(seriesPlayerWpa.batters, wp.playerWpa.batters);
      accum(seriesPlayerWpa.pitchers, wp.playerWpa.pitchers);
      games.push({
        game_id: g.game_id,
        game_in_series: g.game_in_series,
        teams: { home: teamShape(teamByUser[homeUserId]), away: teamShape(teamByUser[awayUserId]) },
        // Compact curve for the series page: just the home WP series + summary + top plays.
        curve: wp.points.map((p) => p.homeWP),
        summary: wp.summary,
        topPlay: wp.plays[0] || null,
      });
    }
    res.json({ series_id: seriesId, games, playerWpa: seriesPlayerWpa });
  } catch (err) {
    console.error('series win-probability error (series', seriesId, '):', err);
    res.status(500).json({ message: 'Server error computing series win probability.' });
  } finally {
    client.release();
  }
});

module.exports = router;
