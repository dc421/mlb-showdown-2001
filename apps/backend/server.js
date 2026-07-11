// server.js - DEFINITIVE FINAL VERSION
const path = require('path');
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authenticateToken = require('./middleware/authenticateToken');
const { applyOutcome, resolveThrow, calculateStealResult, appendScoreToLog,
  recordOutsForPitcher, recordBatterFaced, checkGameOverOrInningChange, recordRunForPitcher,
  recordStealAttempt, toRunnerCard } = require('./gameLogic');
const { pool } = require('./db');
const { startDraftMonitor } = require('./jobs/draftMonitor');
const { startPhantomMonitor } = require('./jobs/phantomMonitor');
const { verifyConnection } = require('./services/emailService');
const { checkTeamHasPlayed } = require('./services/seasonRolloverService');
const { matchesFranchise, getMappedIds, getFranchiseAliases } = require('./utils/franchiseUtils');
const { mapSeasonToPointSet } = require('./utils/seasonUtils');
const { resolveSeriesResultUpdate, seriesTypeForRound } = require('./utils/seriesUtils');
const { schedulePlayoffsIfClinched } = require('./services/playoffSchedulingService');
const { computeLinescore, computePitchingDecisions, computeHomeRuns, normalizeKey, cardIdOf } = require('./utils/gameSummary');

function commitTransientPlayerIds(state) {
    for (const teamKey of ['homeTeam', 'awayTeam']) {
        if (state[teamKey].transient_used_player_ids && state[teamKey].transient_used_player_ids.length > 0) {
            if (!state[teamKey].used_player_ids) state[teamKey].used_player_ids = [];
            state[teamKey].used_player_ids.push(...state[teamKey].transient_used_player_ids);
            state[teamKey].transient_used_player_ids = [];
        }
        if (state[teamKey].transient_subbed_in_player_ids) {
            state[teamKey].transient_subbed_in_player_ids = [];
        }
        if (state[teamKey].transient_lineup_slots) {
            state[teamKey].transient_lineup_slots = {};
        }
    }
}

const BACKEND_URL = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001';

const REPLACEMENT_HITTER_CARD = {
    card_id: -1, name: 'Replacement Hitter', display_name: 'Replacement Hitter', on_base: -10, speed: 15,
    points: 0,
    fielding_ratings: { 'C': 0, '1B': 0, '2B': 0, 'SS': 0, '3B': 0, 'LF': 0, 'CF': 0, 'RF': 0 },
    chart_data: { '1-2': 'SO', '3-20': 'GB' },
    control: null,
    image_url: `https://mlbshowdown2001.netlify.app/images/replacement.jpg`
};
const REPLACEMENT_PITCHER_CARD = {
    card_id: -2, name: 'Replacement Pitcher', display_name: 'Replacement Pitcher', control: -1, ip: 1, speed: 10,
    points: 0,
    chart_data: { '1-3': 'PU', '4-9': 'SO', '10-13': 'GB', '14-16': 'FB', '17-17': 'BB', '18-19': '1B', '20-20': '2B' },
    fielding_ratings: {},
    image_url: `https://mlbshowdown2001.netlify.app/images/replacement_pitcher.jpg`
};

const app = express();
const server = http.createServer(app);

const allowedOrigins = [process.env.FRONTEND_URL, "http://localhost:5173"];
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
    return callback(new Error(msg), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
};
app.use(cors(corsOptions));
const io = module.exports.io = new Server(server, {
  cors: corsOptions
});
const PORT = process.env.PORT || 3001;

// Database connection moved to db.js
module.exports.pool = pool;
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'card_images')));
//app.use('/team_logos', express.static(path.join(__dirname, 'team_logos')));


// in server.js
// in server.js
async function getActivePlayers(gameId, currentState) {
    try {
        const participantsResult = await pool.query(`
            SELECT p.*, u.team_id
            FROM game_participants p
            JOIN users u ON p.user_id = u.user_id
            WHERE p.game_id = $1
        `, [gameId]);
        const game = await pool.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);

        // Use Number() comparison to avoid type mismatch (string vs int) bugs
        const homeParticipant = participantsResult.rows.find(p => Number(p.user_id) === Number(game.rows[0].home_team_user_id));
        const awayParticipant = participantsResult.rows.find(p => Number(p.user_id) !== Number(game.rows[0].home_team_user_id));

        const offensiveParticipant = currentState.isTopInning ? awayParticipant : homeParticipant;
        const defensiveParticipant = currentState.isTopInning ? homeParticipant : awayParticipant;
        
        if (!offensiveParticipant?.lineup || !defensiveParticipant?.lineup) {
          return { batter: null, pitcher: null, offensiveTeam: {}, defensiveTeam: {} };
        }
        
        const offensiveTeamState = currentState.isTopInning ? currentState.awayTeam : currentState.homeTeam;
        
        const batterInfo = offensiveParticipant.lineup.battingOrder[offensiveTeamState.battingOrderPosition];
        let batter;
        if (batterInfo.card_id === -1) {
            batter = REPLACEMENT_HITTER_CARD;
        } else if (batterInfo.card_id === -2) {
            batter = REPLACEMENT_PITCHER_CARD;
        } else {
            const batterQuery = await pool.query('SELECT * FROM cards_player WHERE card_id = $1', [batterInfo.card_id]);
            batter = batterQuery.rows[0];
        }

        // This function relies on the `currentHomePitcher` and `currentAwayPitcher` fields
        // in the game state being correctly initialized at the start of the game and
        // updated during substitutions. The bug where the away pitcher was incorrect
        // was caused by faulty initialization logic in the `/lineup` endpoint.
        const pitcher = currentState.isTopInning ? currentState.currentHomePitcher : currentState.currentAwayPitcher;

        return {
            batter: batter,
            pitcher: pitcher,
            offensiveTeam: offensiveParticipant,
            defensiveTeam: defensiveParticipant,
        };
    } catch (error) {
        // THIS LOG WILL SHOW US THE HIDDEN ERROR
        console.error('--- CRITICAL ERROR inside getActivePlayers ---', error);
        throw error; // Re-throw the error to be caught by the main endpoint
    }
}

async function getOutfieldDefense(defensiveParticipant) {
    if (!defensiveParticipant?.lineup?.battingOrder) return 0;
    const lineup = defensiveParticipant.lineup.battingOrder;
    const outfielders = lineup.filter(spot => ['LF', 'CF', 'RF'].includes(spot.position));
    if (outfielders.length === 0) return 0;

    const outfielderCardIds = outfielders.map(spot => spot.card_id);
    const cardsResult = await pool.query('SELECT card_id, fielding_ratings FROM cards_player WHERE card_id = ANY($1::int[])', [outfielderCardIds]);
    const cardsById = cardsResult.rows.reduce((acc, card) => {
        acc[card.card_id] = card;
        return acc;
    }, {});

    let totalDefense = 0;
    outfielders.forEach(spot => {
        const card = cardsById[spot.card_id];
        if (card && card.fielding_ratings) {
            // Check for specific position rating first (e.g., 'LF')
            if (card.fielding_ratings[spot.position] !== undefined) {
                totalDefense += card.fielding_ratings[spot.position];
            }
            // If it's a corner OF spot and no specific rating, check for 'LFRF'
            else if ((spot.position === 'LF' || spot.position === 'RF') && card.fielding_ratings['LFRF'] !== undefined) {
                totalDefense += card.fielding_ratings['LFRF'];
            }
        }
    });
    return totalDefense;
}

async function getCatcherArm(defensiveParticipant) {
    if (!defensiveParticipant?.lineup?.battingOrder) return 0;
    const lineup = defensiveParticipant.lineup.battingOrder;
    const catcher = lineup.find(spot => spot.position === 'C');
    if (!catcher) return 0;

    const cardResult = await pool.query('SELECT fielding_ratings FROM cards_player WHERE card_id = $1', [catcher.card_id]);
    if (cardResult.rows.length === 0 || !cardResult.rows[0].fielding_ratings) return 0;

    return cardResult.rows[0].fielding_ratings['C'] || 0;
}

async function getInfieldDefense(defensiveParticipant) {
    if (!defensiveParticipant?.lineup?.battingOrder) return 0;
    const lineup = defensiveParticipant.lineup.battingOrder;
    const infielders = lineup.filter(spot => ['1B', '2B', 'SS', '3B'].includes(spot.position));
    if (infielders.length === 0) return 0;

    const infielderCardIds = infielders.map(spot => spot.card_id);
    const cardsResult = await pool.query('SELECT card_id, fielding_ratings FROM cards_player WHERE card_id = ANY($1::int[])', [infielderCardIds]);
    const cardsById = cardsResult.rows.reduce((acc, card) => {
        acc[card.card_id] = card;
        return acc;
    }, {});

    let totalDefense = 0;
    infielders.forEach(spot => {
        const card = cardsById[spot.card_id];
        if (card && card.fielding_ratings) {
            if (spot.position === '1B') {
                if (card.fielding_ratings['1B'] !== undefined) {
                    totalDefense += card.fielding_ratings['1B'];
                } else {
                    // Player is out of position at 1B.
                    // Check if they are a DH (no ratings, or only a DH rating).
                    const isDH = Object.keys(card.fielding_ratings).length === 0 ||
                               (Object.keys(card.fielding_ratings).length === 1 && card.fielding_ratings.hasOwnProperty('DH'));
                    if (isDH) {
                        totalDefense -= 2; // -2 for a DH at 1B
                    } else {
                        totalDefense -= 1; // -1 for any other non-1B player
                    }
                }
            } else {
                // For 2B, 3B, SS, they must have the rating to be placed there.
                if (card.fielding_ratings[spot.position] !== undefined) {
                    totalDefense += card.fielding_ratings[spot.position];
                }
            }
        }
    });
    return totalDefense;
}

// If a team's roster is unchanged since their previous game, suggest the most
// recent lineup they used under the current DH rule (pitcher slot left empty).
// This is what pre-populates the first game of a new series, where there is no
// earlier game in the same series to copy from.
async function getCrossSeriesSuggestedLineup(gameId, userId, useDh, dbClient) {
    // The DH rule must be known to match a prior lineup of the same rule set.
    if (useDh === null || useDh === undefined) return null;

    // Current roster card set.
    const rosterResult = await dbClient.query(
        `SELECT rc.card_id
         FROM game_participants gp
         JOIN roster_cards rc ON rc.roster_id = gp.roster_id
         WHERE gp.game_id = $1 AND gp.user_id = $2`,
        [gameId, userId]
    );
    if (rosterResult.rows.length === 0) return null;
    const currentCardIds = new Set(rosterResult.rows.map(r => Number(r.card_id)));

    // The team's previous game (the most recent one they actually played), along
    // with the roster snapshot captured when that game started.
    const prevGameResult = await dbClient.query(
        `SELECT gr.roster_data
         FROM game_participants gp
         JOIN games g ON g.game_id = gp.game_id
         JOIN game_rosters gr ON gr.game_id = gp.game_id AND gr.user_id = gp.user_id
         WHERE gp.user_id = $1 AND g.game_id <> $2
         ORDER BY g.completed_at DESC NULLS LAST, g.game_id DESC
         LIMIT 1`,
        [userId, gameId]
    );
    if (prevGameResult.rows.length === 0) return null;

    // Only proceed if the roster is unchanged since that previous game.
    const previousCardIds = new Set((prevGameResult.rows[0].roster_data || []).map(c => Number(c.card_id)));
    if (previousCardIds.size !== currentCardIds.size) return null;
    for (const id of currentCardIds) {
        if (!previousCardIds.has(id)) return null;
    }

    // Most recent prior lineup that used the current DH rule.
    const lineupResult = await dbClient.query(
        `SELECT COALESCE(gp.starting_lineup, gp.lineup) AS lineup
         FROM game_participants gp
         JOIN games g ON g.game_id = gp.game_id
         WHERE gp.user_id = $1 AND g.game_id <> $2 AND g.use_dh = $3
           AND COALESCE(gp.starting_lineup, gp.lineup) IS NOT NULL
         ORDER BY g.completed_at DESC NULLS LAST, g.game_id DESC
         LIMIT 1`,
        [userId, gameId, useDh]
    );
    if (lineupResult.rows.length === 0) return null;

    const battingOrder = lineupResult.rows[0].lineup?.battingOrder;
    if (!Array.isArray(battingOrder) || battingOrder.length !== 9) return null;

    // Safety: every non-pitcher slot must still be on the current roster.
    for (const spot of battingOrder) {
        if (spot.position === 'P') continue;
        if (!currentCardIds.has(Number(spot.card_id))) return null;
    }

    // Blank out the pitcher's slot so the user picks their own starter.
    return battingOrder.map(spot =>
        spot.position === 'P' ? { ...spot, card_id: 'PITCHER_PLACEHOLDER' } : spot
    );
}

async function getSuggestedLineup(gameId, userId, dbClient) {
    try {
        // 1. Get current game details
        const gameResult = await dbClient.query('SELECT series_id, game_in_series, use_dh FROM games WHERE game_id = $1', [gameId]);
        if (gameResult.rows.length === 0) return null;
        const { series_id, game_in_series, use_dh } = gameResult.rows[0];

        // 2. WITHIN THE CURRENT SERIES: for games 2+ of a series, reuse a lineup
        //    from earlier in the same series. Game 1 (and anything without an
        //    in-series match) falls through to the cross-series suggestion below.
        if (series_id && game_in_series > 1) {
            // 3. Find previous game in series with SAME DH rule
            const sameRuleQuery = `
                SELECT COALESCE(gp.starting_lineup, gp.lineup) as lineup
                FROM game_participants gp
                JOIN games g ON gp.game_id = g.game_id
                WHERE g.series_id = $1
                  AND gp.user_id = $2
                  AND g.game_in_series < $3
                  AND g.use_dh = $4
                  AND COALESCE(gp.starting_lineup, gp.lineup) IS NOT NULL
                ORDER BY g.game_in_series DESC
                LIMIT 1
            `;
            const sameRuleResult = await dbClient.query(sameRuleQuery, [series_id, userId, game_in_series, use_dh]);

            if (sameRuleResult.rows.length > 0) {
                const battingOrder = sameRuleResult.rows[0].lineup.battingOrder;
                // Ensure the pitcher spot is a placeholder, so we don't default to the previous game's pitcher
                return battingOrder.map(spot => {
                    if (spot.position === 'P') {
                        return { ...spot, card_id: 'PITCHER_PLACEHOLDER' };
                    }
                    return spot;
                });
            }

            // 4. If no same-rule game, find the most recent game regardless of rule
            const anyGameQuery = `
                SELECT COALESCE(gp.starting_lineup, gp.lineup) as lineup, g.use_dh as prev_use_dh
                FROM game_participants gp
                JOIN games g ON gp.game_id = g.game_id
                WHERE g.series_id = $1
                  AND gp.user_id = $2
                  AND g.game_in_series < $3
                  AND COALESCE(gp.starting_lineup, gp.lineup) IS NOT NULL
                ORDER BY g.game_in_series DESC
                LIMIT 1
            `;
            const anyGameResult = await dbClient.query(anyGameQuery, [series_id, userId, game_in_series]);

            if (anyGameResult.rows.length > 0) {
                const { lineup, prev_use_dh } = anyGameResult.rows[0];
                let battingOrder = lineup.battingOrder;

                // 5. Adapt the lineup
                if (prev_use_dh && !use_dh) {
                    // Previous: DH (YES) -> Current: DH (NO)
                    // Need to remove 'DH' from current position and add 'P' at the bottom (9th spot)
                    const newOrder = battingOrder.filter(spot => spot.position !== 'DH');
                    newOrder.push({ position: 'P', card_id: 'PITCHER_PLACEHOLDER' });
                    return newOrder;
                } else if (!prev_use_dh && use_dh) {
                    // Previous: DH (NO) -> Current: DH (YES)
                    // Need to replace 'P' with 'DH' (placeholder for DH)

                    // Check if the team has a designated DH on their roster
                    let dhCardId = 'DH_PLACEHOLDER';
                    const dhQuery = `
                        SELECT rc.card_id
                        FROM roster_cards rc
                        JOIN game_participants gp ON gp.roster_id = rc.roster_id
                        WHERE gp.game_id = $1 AND gp.user_id = $2 AND rc.assignment = 'DH'
                        LIMIT 1
                    `;
                    const dhResult = await dbClient.query(dhQuery, [gameId, userId]);
                    if (dhResult.rows.length > 0) {
                        dhCardId = dhResult.rows[0].card_id;
                    }

                    return battingOrder.map(spot => {
                        if (spot.position === 'P') {
                             return { ...spot, position: 'DH', card_id: dhCardId };
                        }
                        return spot;
                    });
                }
                return battingOrder;
            }
        }

        // 6. CROSS-SERIES FALLBACK (e.g. the first game of a new series): if the
        //    team's roster is unchanged since their previous game, pre-populate
        //    with their most recently-used lineup of the current DH rule.
        return await getCrossSeriesSuggestedLineup(gameId, userId, use_dh, dbClient);
    } catch (error) {
        console.error('Error fetching suggested lineup:', error);
    }
    return null;
}

// --- HELPER FUNCTIONS ---

async function hydrateRosterAssignments(dbClient, roster, rosterId) {
    if (!roster || roster.length === 0 || !roster.some(c => c.assignment === undefined)) {
        return roster;
    }
    try {
        const rosterCardsResult = await dbClient.query(`
            SELECT card_id, assignment
            FROM roster_cards
            WHERE roster_id = $1
        `, [rosterId]);

        const assignmentMap = {};
        rosterCardsResult.rows.forEach(r => {
            assignmentMap[r.card_id] = r.assignment;
        });

        return roster.map(c => {
            if (c.assignment === undefined) {
                return { ...c, assignment: assignmentMap[c.card_id] };
            }
            return c;
        });
    } catch (err) {
        console.error(`[hydrateRosterAssignments] Error recovering assignments:`, err);
        return roster;
    }
}

function finalizeEvent(state, initialEvent, scorers, scoreKey) {
    let message = initialEvent;
    if (scorers && scorers.length > 0) {
        // Filter out any potential undefined/null scorers before mapping
        const validScorers = scorers.filter(s => s);
        if (validScorers.length > 0) {
            const scoreEvents = validScorers.map(s => `${s} scores!`).join(' ');
            message = `${message} ${scoreEvents}`;
        }
    }
    return message;
}

function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Builds the structured roll data attached to a game_event so the game log can
// display the pitch (P), swing (S) and throw (T) rolls in team colors.
// `isTopInning` is the inning context of the play: top => away bats (offense),
// home pitches/fields (defense). Returns null when there are no numeric rolls.
function buildRollData({ pitch = null, swing = null, throwRoll = null, isTopInning }) {
    const num = (v) => (typeof v === 'number' && !Number.isNaN(v) && v > 0 ? v : null);
    const p = num(pitch);
    const s = num(swing);
    const t = num(throwRoll);
    if (p === null && s === null && t === null) return null;
    const data = {
        offenseSide: isTopInning ? 'away' : 'home',
        defenseSide: isTopInning ? 'home' : 'away',
    };
    if (p !== null) data.pitch = p;
    if (s !== null) data.swing = s;
    if (t !== null) data.throw = t;
    return data;
}

// For events whose at-bat was deferred to a baserunning decision (a hit that
// triggered an advance/tag-up/throw): the pitch & swing rolls live on
// currentAtBat from the original swing, and the throw roll (if any) on
// throwRollResult. Pulls all three so the consolidated log line shows P/S/T.
function buildAtBatRollData(state, isTopInning) {
    return buildRollData({
        pitch: state.currentAtBat?.pitchRollResult?.roll,
        swing: state.currentAtBat?.swingRollResult?.roll,
        throwRoll: state.throwRollResult?.roll,
        isTopInning,
    });
}


const getSpeedValue = (runner) => {
  // Pitchers always have C/10 speed
  if (runner.control !== null && typeof runner.control !== 'undefined') {
    return 10;
  }
  const speed = runner.speed;
  if (speed === 'A') return 20;
  if (speed === 'B') return 15;
  if (speed === 'C') return 10;
  return speed; // Assume it's already a number if not A/B/C
};

function getEffectiveControl(pitcher, pitcherStats, inning, ownerUserId = null, projectCurrentInning = true) {
    if (!pitcher || typeof pitcher.control !== 'number') return null;
    if (pitcher.card_id < 0) return pitcher.control; // Replacement pitchers are exempt from fatigue
    if (!pitcherStats) return pitcher.control;

    const pitcherId = ownerUserId ? `${ownerUserId}_${pitcher.card_id}` : pitcher.card_id;
    const stats = pitcherStats[pitcherId] || { runs: 0, innings_pitched: [], fatigue_modifier: 0 };
    const inningsPitched = stats.innings_pitched || [];

    // For the pitcher currently on the mound we project the current inning so his
    // debuff shows the instant he takes it (an inning banks on his first pitch anyway).
    // Resting pitchers pass projectCurrentInning=false so they only reflect innings
    // actually thrown — keeping their indicator in sync with the card and with the
    // next-game fatigue carryover (which counts banked innings, never projected ones).
    let potentialInningsPitched = [...inningsPitched];
    if (projectCurrentInning && !potentialInningsPitched.includes(inning)) {
        potentialInningsPitched.push(inning);
    }
    const inningsPitchedCount = potentialInningsPitched.length;

    let controlPenalty = 0;
    const modifiedIp = pitcher.ip + (stats.fatigue_modifier || 0);
    const fatigueThreshold = modifiedIp - Math.floor((stats.runs || 0) / 3);

    if (inningsPitchedCount > fatigueThreshold) {
        controlPenalty = inningsPitchedCount - fatigueThreshold;
    }

    return pitcher.control - controlPenalty;
}

// --- NEW HELPER: Updates a pitcher's stats for the start of an at-bat ---
function updatePitcherFatigueForNewInning(state, pitcher) {
    if (!pitcher || pitcher.card_id < 0) return state; // Return original state if no pitcher
    if (!state.pitcherStats) {
        state.pitcherStats = {};
    }
    const ownerId = state.isTopInning ? state.homeTeam.userId : state.awayTeam.userId;
    const pitcherId = `${ownerId}_${pitcher.card_id}`;

    let stats = state.pitcherStats[pitcherId] || { runs: 0, innings_pitched: [], fatigue_modifier: 0, batters_faced: 0 };
    if (!stats.innings_pitched) {
        stats.innings_pitched = [];
    }
    if (stats.batters_faced === undefined) {
        stats.batters_faced = 0;
    }

    // Track unique innings pitched by directly modifying the state
    if (!stats.innings_pitched.includes(state.inning)) {
        stats.innings_pitched.push(state.inning);
    }
    state.pitcherStats[pitcherId] = stats;
    return state;
}

function processPlayers(playersToProcess) {
    playersToProcess.forEach(p => {
        if (!p) return;
        // displayName is now pre-calculated and stored in the database as display_name
        p.displayName = p.display_name;
        if (p.control !== null) {
            p.displayPosition = Number(p.ip) > 3 ? 'SP' : 'RP';
        } else {
            const positions = p.fielding_ratings ? Object.keys(p.fielding_ratings).join(',') : 'DH';
            p.displayPosition = positions.replace(/LFRF/g, 'LF/RF');
        }
    });
    return playersToProcess;
};

// Resolve the point set that should actually be used to value a roster.
// League points roll over by season: during an active draft (or before the latest
// season's historical rosters exist) we value at "Upcoming Season"; once a season is
// complete we value at that season's point set. Classic rosters (and calls without a
// point set) use the requested set unchanged. This mirrors the logic /api/my-roster
// uses so the dashboard, lineup page, and opponent-scouting views all agree.
async function resolveEffectivePointSetId(pointSetId, rosterType) {
    if (rosterType !== 'league' || !pointSetId) return pointSetId;

    const [draftRes, latestSeasonRes] = await Promise.all([
        pool.query('SELECT 1 FROM draft_state WHERE is_active = true LIMIT 1'),
        pool.query('SELECT season_name FROM series_results ORDER BY date DESC LIMIT 1')
    ]);
    const isDraftActive = draftRes.rows.length > 0;
    const latestSeason = latestSeasonRes.rows[0]?.season_name;

    const upcomingPointSetId = async () => {
        const upcomingRes = await pool.query("SELECT point_set_id FROM point_sets WHERE name = 'Upcoming Season'");
        return upcomingRes.rows.length > 0 ? upcomingRes.rows[0].point_set_id : pointSetId;
    };

    if (isDraftActive) {
        // Live draft: roster is being built against next season's points.
        return await upcomingPointSetId();
    }
    if (latestSeason) {
        const histCheck = await pool.query('SELECT 1 FROM historical_rosters WHERE season = $1 LIMIT 1', [latestSeason]);
        if (histCheck.rows.length === 0) {
            // Pre-rollover: the latest season has no historical rosters yet.
            return await upcomingPointSetId();
        }
        // Completed season: resolve the point set the same way the league page does.
        const psName = mapSeasonToPointSet(latestSeason);
        const psRes = await pool.query('SELECT point_set_id FROM point_sets WHERE name = $1', [psName]);
        if (psRes.rows.length > 0) return psRes.rows[0].point_set_id;
    }
    return pointSetId;
}

async function validateLineup(participant, newState, gameId, client) {
    const lineup = participant.lineup.battingOrder;
    const teamKey = participant.home_or_away === 'home' ? 'homeTeam' : 'awayTeam';

    // --- THIS IS THE FIX ---
    // Always fetch the authoritative roster for the participant being validated,
    // ignoring any roster data that might be in the newState blob. This prevents
    // cross-validation errors where one team's lineup is checked against the other's roster.
    let roster = [];
    try {
        const rosterResult = await client.query(
            'SELECT roster_data FROM game_rosters WHERE game_id = $1 AND user_id = $2',
            [gameId, participant.user_id]
        );
        if (rosterResult.rows.length > 0) {
            roster = rosterResult.rows[0].roster_data;
        } else {
            // Fallback for older games or edge cases where snapshot might be missing
            console.warn(`[validateLineup] Roster snapshot not found in game_rosters for user ${participant.user_id}. Falling back to roster_cards.`);
            if (participant.roster_id) {
                 const rosterCardsResult = await client.query(`
                    SELECT cp.*, rc.assignment
                    FROM cards_player cp
                    JOIN roster_cards rc ON cp.card_id = rc.card_id
                    WHERE rc.roster_id = $1
                `, [participant.roster_id]);
                roster = rosterCardsResult.rows;
            }
        }
    } catch (err) {
        console.error(`[validateLineup] Critical error fetching roster for user ${participant.user_id}:`, err);
        // If we can't get a roster, we can't validate. We'll proceed with an empty roster,
        // which will correctly cause validation to fail below.
    }
    // --- END FIX ---


    // --- ASSIGNMENT RECOVERY LOGIC (For old snapshots) ---
    if (participant.roster_id) {
        roster = await hydrateRosterAssignments(client, roster, participant.roster_id);
    }

    if (!roster || roster.length === 0) {
        console.warn(`[validateLineup] Roster could not be found for ${teamKey}. Validation will fail.`);
        newState.awaiting_lineup_change = true; // Set to invalid state
        return newState;
    }

    const cardsById = roster.reduce((acc, card) => {
        acc[card.card_id] = card;
        return acc;
    }, {});

    let isLineupValid = true;
    let validationError = null;

    for (const playerInLineup of lineup) {
        if (playerInLineup.card_id < 0) continue; // Skip replacement players

        const card = cardsById[playerInLineup.card_id];
        if (!card) {
            isLineupValid = false;
            const rosterIds = Object.keys(cardsById).join(', ');
            validationError = `Card ${playerInLineup.card_id} not found in roster [${rosterIds}].`;
            break;
        }

        const position = playerInLineup.position;
        if (position === 'DH') continue;

        let isPlayerEligible = false;
        if (card.fielding_ratings && card.fielding_ratings[position] !== undefined) {
            isPlayerEligible = true;
        } else if (position === '1B' && card.control === null) {
            isPlayerEligible = true;
        } else if (position === 'P' && card.control !== null) {
            isPlayerEligible = true;
        } else if ((position === 'LF' || position === 'RF') && card.fielding_ratings && card.fielding_ratings['LFRF'] !== undefined) {
            isPlayerEligible = true;
        }

        if (!isPlayerEligible) {
            isLineupValid = false;
            validationError = `Player ${card.name} (${card.card_id}) is ineligible for position ${position}. Ratings: ${JSON.stringify(card.fielding_ratings)}`;
            break;
        }
    }

    // --- THIS IS THE FIX ---
    // The validation must check the designated pitcher for the team whose lineup is being validated,
    // not the active pitcher on the mound, who belongs to the opposing team.
    const pitcher = participant.home_or_away === 'home'
        ? newState.currentHomePitcher
        : newState.currentAwayPitcher;

    if (isLineupValid && (!pitcher || pitcher.control === null)) {
        isLineupValid = false;
        validationError = `Invalid pitcher for ${teamKey}. Pitcher: ${pitcher ? pitcher.name : 'None'}`;
    }

    if (isLineupValid && newState.inning < 7) {
        for (const playerInLineup of lineup) {
            const card = cardsById[playerInLineup.card_id];
            // The new rule: A player with 'BENCH' assignment cannot be in a defensive position.
            if (card && card.assignment === 'BENCH' && playerInLineup.position !== 'DH') {
                isLineupValid = false;
                validationError = `Player ${card.name} is assigned to BENCH but playing ${playerInLineup.position} before 7th inning.`;
                break;
            }
        }
    }

    // --- START PRODUCTION DEBUGGING ---
    console.log(`[validateLineup] Running validation for ${teamKey}...`);
    console.log(`[validateLineup] Result: ${isLineupValid ? 'VALID' : 'INVALID'}`);
    if (!isLineupValid) {
        console.log(`[validateLineup] Reason for invalidation: ${validationError}`);
    }
    console.log(`[validateLineup] Setting awaiting_lineup_change to: ${!isLineupValid}`);
    // --- END PRODUCTION DEBUGGING ---

    if (!isLineupValid) {
        console.log(`[validateLineup] Lineup INVALID for ${teamKey}: ${validationError}`);
    }

    newState.awaiting_lineup_change = !isLineupValid;
    return newState;
}


async function initializePitcherFatigue(gameId, client) {
    const gameResult = await client.query('SELECT series_id, game_in_series FROM games WHERE game_id = $1', [gameId]);
    const { series_id, game_in_series } = gameResult.rows[0];

    if (!series_id || game_in_series < 2) {
        return {}; // Not a series or game 1, no fatigue to carry over.
    }

    const finalPitcherStats = {};

    // 1. Fetch all previous games in the series in chronological order
    const prevGamesResult = await client.query(
        'SELECT game_id, game_in_series FROM games WHERE series_id = $1 AND game_in_series < $2 ORDER BY game_in_series ASC',
        [series_id, game_in_series]
    );
    const prevGames = prevGamesResult.rows;

    // 2. Fetch all pitchers on the rosters (IP <= 3) to track their fatigue state
    const participants = await client.query('SELECT user_id, roster_id FROM game_participants WHERE game_id = $1', [gameId]);
    const allRelievers = [];

    for (const participant of participants.rows) {
        const rosterCardsResult = await client.query(
            `SELECT cp.card_id, cp.ip FROM cards_player cp JOIN roster_cards rc ON cp.card_id = rc.card_id WHERE rc.roster_id = $1 AND cp.ip IS NOT NULL AND cp.ip <= 3`,
            [participant.roster_id]
        );
        const relievers = rosterCardsResult.rows.map(r => ({ ...r, owner_user_id: participant.user_id }));
        allRelievers.push(...relievers);
    }

    // 3. Initialize tracking map: { user_id_card_id: cumulativeFatigue }
    const pitcherFatigueScore = {};
    allRelievers.forEach(r => {
        pitcherFatigueScore[`${r.owner_user_id}_${r.card_id}`] = 0;
    });

    // 4. Iterate through history
    for (const prevGame of prevGames) {
        // Get the final state of the previous game
        const stateResult = await client.query('SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [prevGame.game_id]);
        const finalState = stateResult.rows.length > 0 ? stateResult.rows[0].state_data : null;

        if (!finalState) continue;

        const stats = finalState.pitcherStats || {};

        // FIX: Build a card_id -> owner_user_id map for this previous game
        // so the plain card_id fallback only applies to the correct team.
        const cardOwnerInPrevGame = {};
        const prevParticipants = await client.query(
            'SELECT user_id, roster_id FROM game_participants WHERE game_id = $1',
            [prevGame.game_id]
        );
        for (const pp of prevParticipants.rows) {
            const cardsResult = await client.query(
                'SELECT card_id FROM roster_cards WHERE roster_id = $1',
                [pp.roster_id]
            );
            cardsResult.rows.forEach(c => {
                if (!cardOwnerInPrevGame[c.card_id]) {
                    cardOwnerInPrevGame[c.card_id] = [];
                }
                cardOwnerInPrevGame[c.card_id].push(pp.user_id);
            });
        }

        // Process game event for each reliever
        allRelievers.forEach(reliever => {
            const pKey = `${reliever.owner_user_id}_${reliever.card_id}`;

            // FIX: Try composite key first. If not found, only fall back to plain
            // card_id if this reliever's owner actually had the card in that game.
            let pStats = stats[pKey];
            if (!pStats) {
                const ownedByThisUser = cardOwnerInPrevGame[reliever.card_id]?.includes(reliever.owner_user_id);
                if (ownedByThisUser) {
                    pStats = stats[reliever.card_id];
                }
            }

            // Did they pitch?
            const pitchedInnings = (pStats && pStats.innings_pitched) ? pStats.innings_pitched.length : 0;
            const facedBatters = (pStats && pStats.batters_faced > 0);
            const runs = (pStats && pStats.runs) || 0;
            const pitchedWhileTired = (pStats && pStats.pitchedWhileTired) || false;

            if (pitchedInnings > 0 || facedBatters) {
                const runPenalty = pitchedWhileTired ? Math.floor(runs / 3) : 0;
                const fatigueToAdd = Math.max(pitchedInnings, (facedBatters ? 1 : 0)) + runPenalty;
                pitcherFatigueScore[pKey] = (pitcherFatigueScore[pKey] || 0) + fatigueToAdd;
            } else {
                // Did not pitch -> Recovery
                pitcherFatigueScore[pKey] = Math.max(0, (pitcherFatigueScore[pKey] || 0) - 1);
            }
        });

        // Process Travel Day (After Game 2 and After Game 5)
        if (prevGame.game_in_series === 2 || prevGame.game_in_series === 5) {
            allRelievers.forEach(reliever => {
                const pKey = `${reliever.owner_user_id}_${reliever.card_id}`;
                pitcherFatigueScore[pKey] = Math.max(0, (pitcherFatigueScore[pKey] || 0) - 1);
            });
        }
    }

    // 5. Calculate Final Modifiers for Current Game
    allRelievers.forEach(reliever => {
        const pKey = `${reliever.owner_user_id}_${reliever.card_id}`;
        const score = pitcherFatigueScore[pKey] || 0;
        const allowedBuffer = Math.max(0, reliever.ip - 1);

        const penalty = Math.max(0, score - allowedBuffer);
        const isBufferUsed = (score > 0 && penalty === 0);

        if (penalty > 0 || isBufferUsed) {
            finalPitcherStats[pKey] = {
                runs: 0,
                innings_pitched: [],
                fatigue_modifier: -penalty,
                isBufferUsed: isBufferUsed
            };

            // FIX: Removed the backward-compat alias that wrote to plain card_id.
            // All downstream code (getEffectiveControl, processRosterFatigue) already
            // checks composite key first via the ownerUserId fallback pattern, so
            // the plain key is no longer needed and was causing cross-team contamination.
        }
    });

    return finalPitcherStats;
}

async function createInningChangeEvent(gameId, finalState, userId, turnNumber, client) {
    const participants = await client.query('SELECT * from game_participants WHERE game_id = $1', [gameId]);
    const game = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
    const home_team_user_id = game.rows[0].home_team_user_id;

    const homeParticipant = participants.rows.find(p => p.user_id === home_team_user_id);
    const awayParticipant = participants.rows.find(p => p.user_id !== home_team_user_id);

    // This logic is now based on the new isTopInning value after the state has flipped
    const defensiveParticipant = finalState.isTopInning ? homeParticipant : awayParticipant;
    const offensiveParticipant = finalState.isTopInning ? awayParticipant : homeParticipant;

    const pitcher = finalState.isTopInning ? finalState.currentHomePitcher : finalState.currentAwayPitcher;

    if (pitcher && pitcher.card_id !== 0) { // Allow replacement pitchers (ID -2) but require a pitcher
        processPlayers([pitcher]);

        const offensiveTeamResult = await client.query('SELECT logo_url FROM teams WHERE user_id = $1', [offensiveParticipant.user_id]);
        const defensiveTeamResult = await client.query('SELECT abbreviation FROM teams WHERE user_id = $1', [defensiveParticipant.user_id]);
        const offensiveTeamLogo = offensiveTeamResult.rows[0].logo_url;
        const defensiveTeamAbbr = defensiveTeamResult.rows[0].abbreviation;

        const inningChangeEvent = `
          <div class="inning-change-message">
              <img src="${offensiveTeamLogo}" class="team-logo-small" alt="Team Logo">
              <b>${finalState.isTopInning ? 'Top' : 'Bottom'} ${getOrdinal(finalState.inning)}</b>
          </div>
          <div class="pitcher-announcement">${defensiveTeamAbbr} Pitcher: ${pitcher.displayName}</div>
        `;
        await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, turnNumber, 'system', inningChangeEvent]);
    }
}

// --- HELPER: Advances the game state to the next half-inning ---
function advanceToNextHalfInning(state) {
    const newState = JSON.parse(JSON.stringify(state)); // Deep copy to avoid mutation
    newState.isTopInning = !newState.isTopInning;
    if (newState.isTopInning) {
        newState.inning++;
    }
    newState.outs = 0;
    newState.bases = { first: null, second: null, third: null };
    newState.isBetweenHalfInningsAway = false;
    newState.isBetweenHalfInningsHome = false;
    return newState;
}

// --- HELPER: Handles series logic after a game completes ---
async function handleSeriesProgression(gameId, client, finalState) {
    // 1. Get all game and series info in one query for efficiency and clarity.
    const gameAndSeriesResult = await client.query(`
        SELECT
            g.series_id,
            g.home_team_user_id as game_home_user_id,
            g.game_in_series,
            s.series_home_user_id,
            s.series_away_user_id,
            s.home_wins,
            s.away_wins,
            s.series_type,
            s.series_result_id
        FROM games g
        JOIN series s ON g.series_id = s.id
        WHERE g.game_id = $1
    `, [gameId]);

    if (gameAndSeriesResult.rows.length === 0) {
        return; // Not a series game.
    }

    const seriesInfo = gameAndSeriesResult.rows[0];
    const { series_id, game_home_user_id, game_in_series, series_type, series_result_id } = seriesInfo;
    let { series_home_user_id } = seriesInfo;
    let { series_away_user_id, home_wins, away_wins } = seriesInfo; // mutable wins/away user

    const participantsResult = await client.query('SELECT user_id, roster_id, league_designation FROM game_participants WHERE game_id = $1', [gameId]);
    // FIX: Use game_home_user_id (the actual home team from Game 1 setup), not series_home_user_id (the creator)
    const gameAwayParticipant = participantsResult.rows.find(p => p.user_id !== game_home_user_id);
    const gameAwayUserId = gameAwayParticipant.user_id;

    // 2. Update series home/away users if it's the first game and not set yet.
    // FIX: Align series_home_user_id with whoever was actually home in Game 1,
    // since the creator may have lost the setup roll and been away.
    if (!series_away_user_id) {
        if (series_home_user_id !== game_home_user_id) {
            await client.query('UPDATE series SET series_home_user_id = $1 WHERE id = $2', [game_home_user_id, series_id]);
            series_home_user_id = game_home_user_id;
        }
        await client.query('UPDATE series SET series_away_user_id = $1 WHERE id = $2', [gameAwayUserId, series_id]);
        series_away_user_id = gameAwayUserId; // Update local copy
    }

    // 3. Recompute the series score from every completed game rather than blind-incrementing. This is
    // idempotent: replaying/re-completing a game (e.g. a dev snapshot restore) can't double-count, and
    // a tally that drifted self-heals. The current game's final game_state may not be persisted yet, so
    // use finalState for it and each other completed game's latest state.
    const completedGamesRes = await client.query(`
        SELECT g.game_id, g.home_team_user_id,
               (SELECT gs.state_data->>'winningTeam' FROM game_states gs
                 WHERE gs.game_id = g.game_id ORDER BY gs.turn_number DESC LIMIT 1) AS winning_side
        FROM games g WHERE g.series_id = $1 AND g.status = 'completed'`, [series_id]);
    home_wins = 0;
    away_wins = 0;
    for (const g of completedGamesRes.rows) {
        const side = Number(g.game_id) === Number(gameId) ? finalState.winningTeam : g.winning_side;
        if (side !== 'home' && side !== 'away') continue;
        // A series has two participants, so the away user of any game is whichever isn't its home user.
        const gameAwayUser = g.home_team_user_id === series_home_user_id ? series_away_user_id : series_home_user_id;
        const winnerId = side === 'home' ? g.home_team_user_id : gameAwayUser;
        if (winnerId === series_home_user_id) home_wins++;
        else if (winnerId === series_away_user_id) away_wins++;
    }
    await client.query('UPDATE series SET home_wins = $1, away_wins = $2 WHERE id = $3', [home_wins, away_wins, series_id]);

    // 4. Check if the series is over
    let isSeriesOver = false;
    if (['playoff', 'golden_spaceship', 'wooden_spoon', 'classic'].includes(series_type) && (home_wins >= 4 || away_wins >= 4)) {
        isSeriesOver = true;
    }
    if (series_type === 'regular_season' && game_in_series >= 7) {
        isSeriesOver = true;
    }

    // 4b. Auto-populate standings: write this series' running tally back onto the scheduled
    // series_results row it fulfills. Partial after every game ('in_progress'); finalized and
    // normalized (winner in the winning_* slot) when the series ends. Only linked series (launched
    // from the schedule) have a series_result_id — ad-hoc/exhibition series skip this.
    let scheduledSeasonName = null;
    if (series_result_id) {
        const scheduledRes = await client.query(
            `SELECT season_name, winning_team_id, winning_team_name, losing_team_id, losing_team_name
             FROM series_results WHERE id = $1`,
            [series_result_id]
        );
        if (scheduledRes.rows.length > 0) {
            scheduledSeasonName = scheduledRes.rows[0].season_name;
            const teamRows = await client.query(
                'SELECT user_id, team_id FROM teams WHERE user_id = ANY($1)',
                [[series_home_user_id, series_away_user_id]]
            );
            const homeTeam = teamRows.rows.find(t => t.user_id === series_home_user_id);
            const awayTeam = teamRows.rows.find(t => t.user_id === series_away_user_id);

            const update = resolveSeriesResultUpdate(scheduledRes.rows[0], {
                homeTeamId: homeTeam ? homeTeam.team_id : null,
                awayTeamId: awayTeam ? awayTeam.team_id : null,
                homeGames: home_wins,
                awayGames: away_wins,
                isOver: isSeriesOver,
            });

            await client.query(
                `UPDATE series_results SET
                    status = $1, result_source = $2,
                    winning_team_id = $3, winning_team_name = $4, winning_score = $5,
                    losing_team_id = $6, losing_team_name = $7, losing_score = $8
                 WHERE id = $9`,
                [
                    update.status, update.result_source,
                    update.winning_team_id, update.winning_team_name, update.winning_score,
                    update.losing_team_id, update.losing_team_name, update.losing_score,
                    series_result_id,
                ]
            );
        }
    }

    // 4c. This game's freshly-written standings may have clinched the playoff field (possibly mid-series,
    // e.g. game 6 of 7 locking every seed). Create the Golden Spaceship / Wooden Spoon series now
    // (idempotent, best-effort) so the dashboard's early-stop action lights up and the playoff matchups
    // appear without waiting for a League page load. Only regular-season league games can clinch.
    if (series_type === 'regular_season' && scheduledSeasonName) {
        // Cheap pre-check: skip the clinch computation (Monte Carlo) entirely once the field is scheduled.
        const alreadyScheduled = await client.query(
            `SELECT 1 FROM series_results WHERE season_name = $1 AND round IN ('Golden Spaceship','Wooden Spoon') LIMIT 1`,
            [scheduledSeasonName]
        );
        if (alreadyScheduled.rows.length === 0) {
            const created = await schedulePlayoffsIfClinched(client, scheduledSeasonName);
            if (created) io.emit('games-updated');
        }
    }

    if (isSeriesOver) {
        await client.query(`UPDATE series SET status = 'completed' WHERE id = $1`, [series_id]);
        // Drop any leftover unplayed next-game shell so a finished series can't leave a phantom
        // "extra unplayed game at the end". Only empty shells (no events) are removed; a
        // partially-played game keeps its log (and is hidden by the dashboard completion guard).
        await client.query(
            `DELETE FROM games g
              WHERE g.series_id = $1 AND g.status <> 'completed'
                AND NOT EXISTS (SELECT 1 FROM game_events e WHERE e.game_id = g.game_id)`,
            [series_id]
        );
        io.emit('games-updated'); // Notify clients the series is done
        return;
    }

    // 5. If not over, create the next game in the series
    const nextGameNumber = game_in_series + 1;

    // Don't create a duplicate if the next game already exists (e.g. this completion was replayed).
    const existingNext = await client.query(
        'SELECT game_id FROM games WHERE series_id = $1 AND game_in_series = $2 ORDER BY game_id LIMIT 1',
        [series_id, nextGameNumber]
    );
    if (existingNext.rows.length > 0) {
        io.emit('games-updated');
        io.to(gameId.toString()).emit('series-next-game-ready', {
            nextGameId: existingNext.rows[0].game_id, home_wins, away_wins,
        });
        return;
    }

    const nextHomeUserId = [3, 4, 5].includes(nextGameNumber) ? series_away_user_id : series_home_user_id;
    const nextAwayUserId = nextHomeUserId === series_home_user_id ? series_away_user_id : series_home_user_id;

    const lastGameSettings = await client.query('SELECT use_dh FROM games WHERE game_id = $1', [gameId]);
    let useDhForNextGame = lastGameSettings.rows[0].use_dh;

    // Series logic:
    // Game 3: Series Away team becomes Home. Allow them to choose DH rule.
    // Game 6: Series Home team becomes Home again. Revert to their original DH rule (from Game 1).
    let nextStatus = 'lineups';
    if (nextGameNumber === 3) {
        nextStatus = 'pending';
    } else if (nextGameNumber === 6) {
        const game1Settings = await client.query('SELECT use_dh FROM games WHERE series_id = $1 AND game_in_series = 1', [series_id]);
        if (game1Settings.rows.length > 0) {
            useDhForNextGame = game1Settings.rows[0].use_dh;
        }
    }

    const newGameResult = await client.query(
        `INSERT INTO games (status, series_id, game_in_series, home_team_user_id, use_dh) VALUES ($1, $2, $3, $4, $5) RETURNING game_id`,
        [nextStatus, series_id, nextGameNumber, nextHomeUserId, useDhForNextGame]
    );
    const newGameId = newGameResult.rows[0].game_id;

    const homePlayerInfo = participantsResult.rows.find(p => p.user_id === nextHomeUserId);
    const awayPlayerInfo = participantsResult.rows.find(p => p.user_id === nextAwayUserId);

    await client.query(
        `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation) VALUES ($1, $2, $3, 'home', $4)`,
        [newGameId, nextHomeUserId, homePlayerInfo.roster_id, homePlayerInfo.league_designation]
    );
    await client.query(
        `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation) VALUES ($1, $2, $3, 'away', $4)`,
        [newGameId, nextAwayUserId, awayPlayerInfo.roster_id, awayPlayerInfo.league_designation]
    );

    io.emit('games-updated'); // Notify all clients to refresh their dashboards

    io.to(gameId.toString()).emit('series-next-game-ready', {
        nextGameId: newGameId,
        home_wins: home_wins,
        away_wins: away_wins
    });
}


// --- API Routes ---

app.use('/api/dev', require('./routes/dev'));
app.use('/api/draft', require('./routes/draft'));
app.use('/api/league', require('./routes/league'));
app.use('/api/classic', require('./routes/classic'));
app.use('/api/teams', require('./routes/teams'));

// Global captaincy data for client-side card badges: per-team-season captains,
// current captains, Faces, and Core Squad members, plus team colors/logos.
app.get('/api/captaincies', authenticateToken, async (req, res) => {
    try {
        const { getCaptaincies } = require('./services/captaincyService');
        const data = await getCaptaincies();
        const teamsMeta = {};
        (await pool.query('SELECT team_id, primary_color, secondary_color, logo_url, city, name FROM teams')).rows
            .forEach(t => { teamsMeta[t.team_id] = { primary: t.primary_color, secondary: t.secondary_color, logo: t.logo_url, city: t.city, name: t.name }; });
        const captains = {};
        Object.entries(data.captains).forEach(([tid, byS]) => {
            captains[tid] = {};
            Object.entries(byS).forEach(([s, c]) => { captains[tid][s] = c.card_id; });
        });
        const currentCaptains = {};
        Object.entries(data.currentCaptains).forEach(([tid, c]) => { currentCaptains[tid] = c.card_id; });
        const faces = {};
        Object.entries(data.faces).forEach(([tid, c]) => { faces[tid] = c.card_id; });
        const coreSquads = {};
        Object.entries(data.coreSquads).forEach(([tid, cs]) => { coreSquads[tid] = cs.members; });
        res.json({ teamsMeta, captains, currentCaptains, faces, coreSquads });
    } catch (e) {
        console.error('Error fetching captaincies:', e);
        res.status(500).json({ message: 'Server error fetching captaincies.' });
    }
});

// USER REGISTRATION (Updated for Teams)
app.post('/api/register', async (req, res) => {
  const { email, password, owner_first_name, owner_last_name, team_id } = req.body;
  if (!email || !password || !owner_first_name || !owner_last_name || !team_id) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if team is already claimed
    const teamCheck = await client.query('SELECT user_id FROM teams WHERE team_id = $1', [team_id]);
    if (teamCheck.rows[0].user_id !== null) {
      return res.status(409).json({ message: 'This team has already been claimed.' });
    }

    // Create the new user
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUserResult = await client.query(
      'INSERT INTO users (email, hashed_password, owner_first_name, owner_last_name, team_id) VALUES ($1, $2, $3, $4, $5) RETURNING user_id',
      [email, hashedPassword, owner_first_name, owner_last_name, team_id]
    );
    const userId = newUserResult.rows[0].user_id;

    // Claim the team by assigning the new user's ID to it
    await client.query('UPDATE teams SET user_id = $1 WHERE team_id = $2', [userId, team_id]);
    
    await client.query('COMMIT');
    res.status(201).json({ message: 'User registered and team claimed successfully!' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Registration error:', error);
    res.status(500).json({ message: 'An error occurred on the server.' });
  } finally {
    client.release();
  }
});

// USER LOGIN (Updated to include team data)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        
        const user = userResult.rows[0];
        const isMatch = await bcrypt.compare(password, user.hashed_password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        
        // Fetch the user's team info
        const teamResult = await pool.query('SELECT * FROM teams WHERE team_id = $1', [user.team_id]);
        
        // Create a token that includes all necessary user and team data
        const payload = { 
            userId: user.user_id, 
            email: user.email,
            owner: `${user.owner_first_name} ${user.owner_last_name}`,
            team: teamResult.rows[0] // Embed the full team object
        };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
        
        res.json({ message: 'Logged in successfully!', token: token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'An error occurred on the server.' });
    }
});

// --- ROSTER ENDPOINTS (Now supports types) ---
// in server.js
app.get('/api/my-roster', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { type, point_set_id } = req.query;
    const rosterType = type || 'league'; // Default to 'league'

    try {
        let queryText = 'SELECT roster_id, user_id, roster_type, classic_id FROM rosters WHERE user_id = $1 AND roster_type = $2';
        let queryParams = [userId, rosterType];

        if (rosterType === 'classic') {
            const activeClassicRes = await pool.query(`SELECT id FROM classics WHERE is_active = true LIMIT 1`);
            if (activeClassicRes.rows.length > 0) {
                const classicId = activeClassicRes.rows[0].id;
                queryText += ' AND classic_id = $3';
                queryParams.push(classicId);
            } else {
                 // No active classic? Return null immediately as "My Roster" implies active context.
                 return res.json(null);
            }
        }

        const rosterResult = await pool.query(queryText, queryParams);
        if (rosterResult.rows.length === 0) {
            return res.json(null);
        }

        const roster = rosterResult.rows[0];
        let cardsResult;

        // For league rosters, value against the current season's point set (see
        // resolveEffectivePointSetId) so the dashboard matches the league page.
        const effectivePointSetId = await resolveEffectivePointSetId(point_set_id, rosterType);

        if (effectivePointSetId) {
            cardsResult = await pool.query(
                `SELECT cp.*, rc.is_starter, rc.assignment, ppv.points
                 FROM cards_player cp
                 JOIN roster_cards rc ON cp.card_id = rc.card_id
                 LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $2
                 WHERE rc.roster_id = $1`,
                [roster.roster_id, effectivePointSetId]
            );
        } else {
            cardsResult = await pool.query(
                `SELECT cp.*, rc.is_starter, rc.assignment
                 FROM cards_player cp
                 JOIN roster_cards rc ON cp.card_id = rc.card_id
                 WHERE rc.roster_id = $1`,
                [roster.roster_id]
            );
        }
        
        const processedCards = processPlayers(cardsResult.rows);
        res.json({ ...roster, cards: processedCards });

    } catch (error) {
        console.error('Error fetching user roster:', error);
        res.status(500).json({ message: 'Server error while fetching roster.' });
    }
});

// CREATE or UPDATE a user's roster (Upsert)
app.post('/api/my-roster', authenticateToken, async (req, res) => {
    const { cards, type } = req.body;
    const userId = req.user.userId;
    const rosterType = type || 'league';

    if (!cards || cards.length !== 20) {
        return res.status(400).json({ message: 'A valid roster requires a name and 20 cards.' });
    }

    if (rosterType === 'league') {
        try {
            const seasonRes = await pool.query('SELECT season_name FROM series_results ORDER BY date DESC LIMIT 1');
            if (seasonRes.rows.length > 0) {
                const seasonName = seasonRes.rows[0].season_name;
                // Check if this season is finished (has a champion)
                const finishedRes = await pool.query("SELECT 1 FROM series_results WHERE season_name = $1 AND round = 'Golden Spaceship'", [seasonName]);
                const isFinished = finishedRes.rows.length > 0;

                if (!isFinished) {
                    const hasPlayed = await checkTeamHasPlayed(pool, userId, seasonName);
                    if (hasPlayed) {
                        return res.status(403).json({ message: "Roster is locked because your team has already played a game this season." });
                    }
                }
            }
        } catch (e) {
            console.error("Error checking roster lock status:", e);
            // Proceed cautiously or fail? Failsafe to allow save if check errors?
            // Better to log and allow, or block? Assuming allow for now to prevent lockout on DB error.
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let classicId = null;
        if (rosterType === 'classic') {
             const activeClassicRes = await client.query(`SELECT id FROM classics WHERE is_active = true LIMIT 1`);
             if (activeClassicRes.rows.length === 0) {
                 await client.query('ROLLBACK');
                 return res.status(400).json({ message: 'No active Classic found to submit a roster for.' });
             }
             classicId = activeClassicRes.rows[0].id;
        }
        
        // Revised lookup for existing roster
        let existingRosterQuery = 'SELECT roster_id FROM rosters WHERE user_id = $1 AND roster_type = $2';
        let existingRosterParams = [userId, rosterType];

        if (rosterType === 'classic') {
            existingRosterQuery += ' AND classic_id = $3';
            existingRosterParams.push(classicId);
        }

        const existingRoster = await client.query(existingRosterQuery, existingRosterParams);
        let rosterId;
        let oldCards = [];

        if (existingRoster.rows.length > 0) {
            rosterId = existingRoster.rows[0].roster_id;
            // Fetch old cards for diffing
            const oldCardsRes = await client.query('SELECT card_id FROM roster_cards WHERE roster_id = $1', [rosterId]);
            oldCards = oldCardsRes.rows.map(c => c.card_id);
            await client.query('DELETE FROM roster_cards WHERE roster_id = $1', [rosterId]);
        } else {
            // New Roster Insertion
            if (rosterType === 'classic') {
                const newRoster = await client.query(
                    'INSERT INTO rosters (user_id, roster_type, classic_id) VALUES ($1, $2, $3) RETURNING roster_id',
                    [userId, rosterType, classicId]
                );
                rosterId = newRoster.rows[0].roster_id;
            } else {
                const newRoster = await client.query(
                    'INSERT INTO rosters (user_id, roster_type) VALUES ($1, $2) RETURNING roster_id',
                    [userId, rosterType]
                );
                rosterId = newRoster.rows[0].roster_id;
            }
        }

        // Insert the new set of cards with their specific assignments
        for (const card of cards) {
            await client.query(
                'INSERT INTO roster_cards (roster_id, card_id, is_starter, assignment) VALUES ($1, $2, $3, $4)',
                [rosterId, card.card_id, card.is_starter, card.assignment]
            );
        }

        // --- DRAFT HISTORY LOGGING (If Active Draft Turn) ---
        const draftStateRes = await client.query('SELECT * FROM draft_state WHERE is_active = true LIMIT 1');
        if (draftStateRes.rows.length > 0) {
            const state = draftStateRes.rows[0];
            const teamRes = await client.query('SELECT team_id FROM teams WHERE user_id = $1', [userId]);

            if (teamRes.rows.length > 0 && teamRes.rows[0].team_id === state.active_team_id) {
                // It is this user's turn. Log the changes.
                const newCardIds = cards.map(c => c.card_id);
                const added = newCardIds.filter(id => !oldCards.includes(id));
                const dropped = oldCards.filter(id => !newCardIds.includes(id));

                const roundName = state.current_round === 4 ? "Add/Drop 1" : (state.current_round === 5 ? "Add/Drop 2" : `Round ${state.current_round}`);

                for (const id of added) {
                    await client.query(
                        `INSERT INTO draft_history (season_name, round, team_id, card_id, action, pick_number)
                         VALUES ($1, $2, $3, $4, 'ADDED', $5)`,
                        [state.season_name, roundName, state.active_team_id, id, state.current_pick_number]
                    );
                }
                for (const id of dropped) {
                    await client.query(
                        `INSERT INTO draft_history (season_name, round, team_id, card_id, action, pick_number)
                         VALUES ($1, $2, $3, $4, 'DROPPED', $5)`,
                        [state.season_name, roundName, state.active_team_id, id, state.current_pick_number]
                    );
                }
                io.emit('draft-updated');
            }
        } else {
            // Not a draft turn. Check if we need to send a roster update email (League only).
            // We need to compare oldCards vs new cards (from request).
            // oldCards is array of IDs. 'cards' is array of objects {card_id, ...}.
            if (rosterType === 'league' && oldCards.length > 0) {
                const newCardIds = cards.map(c => c.card_id);

                // Identify added and dropped IDs
                const addedIds = newCardIds.filter(id => !oldCards.includes(id));
                const droppedIds = oldCards.filter(id => !newCardIds.includes(id));

                if (addedIds.length > 0 || droppedIds.length > 0) {
                    // Fetch player names for email
                    const allIds = [...addedIds, ...droppedIds];
                    const playerNamesRes = await client.query('SELECT card_id, name, display_name FROM cards_player WHERE card_id = ANY($1::int[])', [allIds]);
                    const playerMap = {};
                    playerNamesRes.rows.forEach(p => playerMap[p.card_id] = p.display_name || p.name);

                    const addedNames = addedIds.map(id => playerMap[id]);
                    const droppedNames = droppedIds.map(id => playerMap[id]);

                    // Get Team Name
                    const teamRes = await client.query('SELECT city, name FROM teams WHERE user_id = $1', [userId]);
                    let teamName = "Unknown Team";
                    if (teamRes.rows.length > 0) {
                        const t = teamRes.rows[0];
                        teamName = `${t.city} ${t.name}`;
                    }

                    const { sendRosterUpdateEmail } = require('./services/emailService');
                    // Fire and forget
                    try {
                        sendRosterUpdateEmail(teamName, addedNames, droppedNames, client);
                    } catch(err) {
                        console.error("Error sending roster update email:", err);
                    }
                }
            }
        }
        // ----------------------------------------------------

        // --- NEW: Classic Roster Email Notification ---
        // Only send if this is a 'classic' roster and the previous version of the roster (oldCards) was NOT complete (was < 20 cards).
        // oldCards is an array of IDs fetched earlier in this route.
        if (rosterType === 'classic' && oldCards.length < 20) {
             const allOwnersRes = await client.query('SELECT user_id, email, owner_first_name, owner_last_name FROM users WHERE team_id IS NOT NULL');
             const allOwners = allOwnersRes.rows.map(u => ({
                 user_id: u.user_id,
                 email: u.email,
                 owner_name: `${u.owner_first_name} ${u.owner_last_name}`.trim()
             }));

             // Check for valid rosters (20 cards)
             const validRostersRes = await client.query(`
                SELECT r.user_id
                FROM rosters r
                JOIN roster_cards rc ON r.roster_id = rc.roster_id
                WHERE r.roster_type = 'classic'
                GROUP BY r.user_id
                HAVING COUNT(rc.card_id) = 20
             `);
             const validUserIds = validRostersRes.rows.map(r => r.user_id);

             const currentUser = allOwners.find(u => u.user_id === userId);
             const missingUsers = allOwners.filter(u => !validUserIds.includes(u.user_id));

             const { sendClassicRosterSubmissionEmail } = require('./services/emailService');

             // Fire and forget (but handle error logging)
             // We await here to ensure the client is still valid for fetching emails
             try {
                await sendClassicRosterSubmissionEmail(currentUser, missingUsers, client);
             } catch (err) {
                 console.error("Error sending classic roster email:", err);
             }
        }
        
        await client.query('COMMIT');
        res.status(201).json({ message: 'Roster saved successfully!' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Roster save error:', error);
        res.status(500).json({ message: 'An error occurred on the server.' });
    } finally {
        client.release();
    }
});

// POST /api/games/:gameId/lineup (This is where the bug was)
// in server.js
app.post('/api/games/:gameId/lineup', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.userId;
  const { battingOrder, startingPitcher } = req.body;

  if (!battingOrder || battingOrder.length !== 9 || !startingPitcher) {
    return res.status(400).json({ message: 'A valid lineup is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- NEW: Enforce Pitching Rotation ---
    const { mandatoryPitcherId, unavailablePitcherIds } = await getPitcherAvailability(gameId, userId, client);
    if (unavailablePitcherIds.includes(Number(startingPitcher))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'This pitcher is unavailable because they pitched in a recent game in this series.' });
    }
    if (mandatoryPitcherId && Number(mandatoryPitcherId) !== Number(startingPitcher)) {
        await client.query('ROLLBACK'); // Release the transaction
        const requiredPitcherResult = await client.query('SELECT name FROM cards_player WHERE card_id = $1', [mandatoryPitcherId]);
        const pitcherName = requiredPitcherResult.rows[0]?.name || 'the correct pitcher';
        return res.status(400).json({ message: `Rotation is set. You must use ${pitcherName} as your starting pitcher for this game.` });
    }
    
    await client.query(
      `UPDATE game_participants SET lineup = $1::jsonb, starting_lineup = $1::jsonb WHERE game_id = $2 AND user_id = $3`,
      [JSON.stringify({ battingOrder, startingPitcher }), gameId, userId]
    );

    const allParticipants = await client.query(`
      SELECT p.user_id, p.roster_id, p.lineup, u.team_id
      FROM game_participants p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.game_id = $1
    `, [gameId]);
    
    if (allParticipants.rows.length === 2 && allParticipants.rows.every(p => p.lineup !== null)) {
      const game = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
      const homePlayerId = game.rows[0].home_team_user_id;

      const homeParticipant = allParticipants.rows.find(p => Number(p.user_id) === Number(homePlayerId));
      const awayParticipant = allParticipants.rows.find(p => Number(p.user_id) !== Number(homePlayerId));

      // --- NEW: Snapshot the rosters for this game ---
      const homeRosterCardsResult = await client.query(`
          SELECT cp.*, rc.assignment
          FROM cards_player cp
          JOIN roster_cards rc ON cp.card_id = rc.card_id
          WHERE rc.roster_id = $1
      `, [homeParticipant.roster_id]);
      const homeRosterData = homeRosterCardsResult.rows;
      await client.query(`INSERT INTO game_rosters (game_id, user_id, roster_data) VALUES ($1, $2, $3)`, [gameId, homeParticipant.user_id, JSON.stringify(homeRosterData)]);

      const awayRosterCardsResult = await client.query(`
          SELECT cp.*, rc.assignment
          FROM cards_player cp
          JOIN roster_cards rc ON cp.card_id = rc.card_id
          WHERE rc.roster_id = $1
      `, [awayParticipant.roster_id]);
      const awayRosterData = awayRosterCardsResult.rows;
      await client.query(`INSERT INTO game_rosters (game_id, user_id, roster_data) VALUES ($1, $2, $3)`, [gameId, awayParticipant.user_id, JSON.stringify(awayRosterData)]);
      // --- END NEW ---
      
      await client.query(
        `UPDATE games SET status = 'in_progress', current_turn_user_id = $1 WHERE game_id = $2`,
        [homePlayerId, gameId]
      );

      const firstBatterCardId = awayParticipant.lineup.battingOrder[0].card_id;
      const homeStartingPitcherId = homeParticipant.lineup.startingPitcher;
      const awayStartingPitcherId = awayParticipant.lineup.startingPitcher;

      let batter;
      if (firstBatterCardId === -1) batter = REPLACEMENT_HITTER_CARD;
      else if (firstBatterCardId === -2) batter = REPLACEMENT_PITCHER_CARD;
      else {
          const batterResult = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [firstBatterCardId]);
          batter = batterResult.rows[0];
      }

      let homePitcher;
      if (homeStartingPitcherId === -1) homePitcher = REPLACEMENT_HITTER_CARD;
      else if (homeStartingPitcherId === -2) homePitcher = REPLACEMENT_PITCHER_CARD;
      else {
          const homePitcherResult = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [homeStartingPitcherId]);
          homePitcher = homePitcherResult.rows[0];
      }

      let awayPitcher;
      if (awayStartingPitcherId === -1) awayPitcher = REPLACEMENT_HITTER_CARD;
      else if (awayStartingPitcherId === -2) awayPitcher = REPLACEMENT_PITCHER_CARD;
      else {
          const awayPitcherResult = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [awayStartingPitcherId]);
          awayPitcher = awayPitcherResult.rows[0];
      }

      const initialGameState = {
        inning: 1, isTopInning: true, awayScore: 0, homeScore: 0, outs: 0,
        bases: { first: null, second: null, third: null },
        pitcherStats: await initializePitcherFatigue(gameId, client),
        atBatLog: [],
        isBetweenHalfInningsAway: false,
        isBetweenHalfInningsHome: false,
        awayTeam: { userId: awayParticipant.user_id, team_id: awayParticipant.team_id, rosterId: awayParticipant.roster_id, battingOrderPosition: 0, used_player_ids: [], roster: awayRosterData },
        homeTeam: { userId: homeParticipant.user_id, team_id: homeParticipant.team_id, rosterId: homeParticipant.roster_id, battingOrderPosition: -1, used_player_ids: [], roster: homeRosterData },
        homeDefensiveRatings: {
            catcherArm: await getCatcherArm(homeParticipant),
            infieldDefense: await getInfieldDefense(homeParticipant),
            outfieldDefense: await getOutfieldDefense(homeParticipant),
        },
        awayDefensiveRatings: {
            catcherArm: await getCatcherArm(awayParticipant),
            infieldDefense: await getInfieldDefense(awayParticipant),
            outfieldDefense: await getOutfieldDefense(awayParticipant),
        },
        currentAwayPitcher: awayPitcher,
        currentHomePitcher: homePitcher,
        awayPlayerReadyForNext: false,
        homePlayerReadyForNext: false,
        lastCompletedAtBat: null,
        currentAtBat: {
            batter: batter,
            pitcher: homePitcher,
            pitcherAction: null,
            batterAction: null,
            pitchRollResult: null,
            swingRollResult: null,
            basesBeforePlay: { first: null, second: null, third: null },
            outsBeforePlay: 0
        }
      };

      await client.query(`INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)`, [gameId, 1, initialGameState]);
      
      processPlayers([homePitcher]);

      const awayTeam = await client.query('SELECT * FROM teams WHERE user_id = $1', [awayParticipant.user_id]);
      const homeTeam = await client.query('SELECT * FROM teams WHERE user_id = $1', [homeParticipant.user_id]);
      const awayTeamLogo = awayTeam.rows[0].logo_url;
      const homeTeamAbbr = homeTeam.rows[0].abbreviation;

      const inningChangeEvent = `
        <div class="inning-change-message">
            <img src="${awayTeamLogo}" class="team-logo-small" alt="Team Logo">
            <b>Top 1st</b>
        </div>
        <div class="pitcher-announcement">${homeTeamAbbr} Pitcher: ${homePitcher.displayName}</div>
      `;
      // --- ADD THIS LOG ---
    console.log(`🔫 SERVER: Creating initial event for game ${gameId}:`, inningChangeEvent);

    await client.query(
        `INSERT INTO game_events (game_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4)`,
        [gameId, 1, 'system', inningChangeEvent]
      );

    }

    await client.query('COMMIT');

    if (allParticipants.rows.length === 2 && allParticipants.rows.every(p => p.lineup !== null)) {
      console.log(`--- BACKEND: Emitting 'game-starting' to room ${gameId} ---`);
      io.to(gameId).emit('game-starting');
    } else {
      io.to(gameId).emit('lineup-submitted');
    }

    res.status(200).json({ message: 'Lineup saved successfully.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error setting lineup:', error);
    res.status(500).json({ message: 'Server error while setting lineup.' });
  } finally {
    client.release();
  }
});

// server.js

// GET ALL AVAILABLE TEAMS FOR REGISTRATION
app.get('/api/available-teams', async (req, res) => {
  try {
    const availableTeamsQuery = await pool.query("SELECT team_id, city, name, display_format FROM teams WHERE user_id IS NULL");
    const availableTeams = availableTeamsQuery.rows.map(team => {
        const format = team.display_format || '{city} {name}';
        team.full_display_name = format.replace('{city}', team.city).replace('{name}', team.name);
        return team;
    });
    res.json(availableTeams);
  } catch (error) {
    console.error('Error fetching available teams:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

// This function no longer needs to be async or take the client, as all data is passed in.
function validatePitcherSubstitution(gameState, playerOutCard, playerOutId, startingPitcherId, isOffensiveSub) {
    // Rule only applies to pitchers
    if (playerOutCard.control === null) {
        return { isValid: true };
    }

    const ownerId = isOffensiveSub ?
        (gameState.isTopInning ? gameState.awayTeam.userId : gameState.homeTeam.userId) :
        (gameState.isTopInning ? gameState.homeTeam.userId : gameState.awayTeam.userId);

    const compositeKey = `${ownerId}_${playerOutId}`;
    const pitcherStats = gameState.pitcherStats ? gameState.pitcherStats[compositeKey] : null;

    if (playerOutId == startingPitcherId) {
        const outsRecorded = pitcherStats ? (pitcherStats.outs_recorded || 0) : 0;
        if (outsRecorded < 12) {
            // Check 1: Is the pitcher tired RIGHT NOW? (Primarily for defensive subs)
            const effectiveControl = getEffectiveControl(playerOutCard, gameState.pitcherStats, gameState.inning, ownerId);
            if (effectiveControl < playerOutCard.control) {
                return { isValid: true }; // Pitcher is tired, can be subbed out.
            }

            // Check 2: If it's an offensive sub, will the pitcher be tired for their NEXT defensive inning?
            if (isOffensiveSub) {
                // If the offensive team is the away team (top of inning), their next defensive inning is the bottom of the current inning.
                // If the offensive team is the home team (bottom of inning), their next defensive inning is the top of the next inning.
                const nextDefensiveInning = !gameState.isTopInning ? gameState.inning + 1 : gameState.inning;
                const projectedEffectiveControl = getEffectiveControl(playerOutCard, gameState.pitcherStats, nextDefensiveInning, ownerId);
                if (projectedEffectiveControl < playerOutCard.control) {
                    return { isValid: true }; // Pitcher WILL BE tired, can be pinch-hit/run for.
                }
            }

            return { isValid: false, message: `Starting pitcher must record at least 12 outs before being substituted. Outs recorded: ${outsRecorded}` };
        }
    }

    return { isValid: true };
}

app.post('/api/games/:gameId/substitute', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { playerInId, playerOutId, position, lineupIndex } = req.body;
  const userId = req.user.userId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    const currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    const initialStateResult = await client.query('SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number ASC LIMIT 1', [gameId]);
    const initialState = initialStateResult.rows[0].state_data;

    let newState = JSON.parse(JSON.stringify(currentState));

    // --- START REVISED TEAM IDENTIFICATION LOGIC ---
    const allParticipantsResult = await client.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
    const allParticipants = allParticipantsResult.rows;

    const gameInfo = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
    const homeUserId = gameInfo.rows[0].home_team_user_id;

    const homeParticipant = allParticipants.find(p => p.user_id === homeUserId);
    const awayParticipant = allParticipants.find(p => p.user_id !== homeUserId);

    let participant = allParticipants.find(p => p.user_id === userId);
    if (!participant) {
        return res.status(403).json({ message: 'Requesting user not found in this game.' });
    }
    let teamKey = participant.home_or_away === 'home' ? 'homeTeam' : 'awayTeam';

    const offensiveTeamKey = newState.isTopInning ? 'awayTeam' : 'homeTeam';
    const isOffensiveSub = teamKey === offensiveTeamKey;
    // --- END REVISED TEAM IDENTIFICATION LOGIC ---

    const playerInIdInt = parseInt(playerInId, 10);

    let playerOutCard;
    if (parseInt(playerOutId, 10) === -1) {
        playerOutCard = REPLACEMENT_HITTER_CARD;
    } else if (parseInt(playerOutId, 10) === -2) {
        playerOutCard = REPLACEMENT_PITCHER_CARD;
    } else {
        const playerOutResult = await pool.query('SELECT * FROM cards_player WHERE card_id = $1', [playerOutId]);
        playerOutCard = playerOutResult.rows[0];
    }

    // Determine the team's ORIGINAL starting pitcher from the persistent participant
    // record. We must NOT derive this from the earliest available game_state: dev-tool
    // snapshot restores prune early turns, so the earliest surviving state can be
    // mid-game, making a reliever look like the "starter" and wrongly triggering the
    // 12-out rule. participant.lineup.startingPitcher is never overwritten by
    // substitutions, so it is the authoritative source.
    let startingPitcherId = participant.lineup?.startingPitcher;
    if (startingPitcherId === undefined || startingPitcherId === null) {
        // Legacy/corrupted-game fallback: earliest game state, then replacement pitcher.
        const fallbackStarter = teamKey === 'homeTeam' ? initialState.currentHomePitcher : initialState.currentAwayPitcher;
        startingPitcherId = fallbackStarter ? fallbackStarter.card_id : REPLACEMENT_PITCHER_CARD.card_id;
    }

    const pitcherValidationResult = validatePitcherSubstitution(newState, playerOutCard, playerOutId, startingPitcherId, isOffensiveSub);
    if (!pitcherValidationResult.isValid) {
        return res.status(400).json({ message: pitcherValidationResult.message });
    }

    const teamUsedPlayerIds = newState[teamKey].used_player_ids || [];
    if (playerInIdInt > 0 && teamUsedPlayerIds.includes(playerInIdInt)) {
        return res.status(400).json({ message: 'This player has already been in the game and cannot re-enter.' });
    }

    // Idempotency guard: if the outgoing player has already been removed (committed or
    // transiently), this is a duplicate/stale substitution request — e.g. a double-click
    // during a slow response. Don't apply the substitution a second time.
    const outgoingPlayerId = parseInt(playerOutId, 10);
    const teamTransientUsed = newState[teamKey].transient_used_player_ids || [];
    if (outgoingPlayerId > 0 && (teamUsedPlayerIds.includes(outgoingPlayerId) || teamTransientUsed.includes(outgoingPlayerId))) {
        await client.query('ROLLBACK');
        console.log(`Idempotency guard: /substitute duplicate blocked for game ${gameId} (player ${outgoingPlayerId} already removed)`);
        const gameData = await getAndProcessGameData(gameId, client);
        return res.status(200).json(gameData);
    }

    // If the player is being subbed back in and they are in the transient list, we remove them from the transient list
    if (newState[teamKey].transient_used_player_ids && newState[teamKey].transient_used_player_ids.includes(playerInIdInt)) {
        // Enforce that transiently removed players can only be subbed back into their original slot
        const expectedSlot = newState[teamKey].transient_lineup_slots?.[playerInIdInt];
        const currentSlotKey = lineupIndex >= 0 ? lineupIndex.toString() : 'pitcher';

        if (expectedSlot !== undefined && expectedSlot !== currentSlotKey) {
            let slotName = expectedSlot === 'pitcher' ? "the pitcher's spot" : `lineup spot ${parseInt(expectedSlot) + 1}`;
            return res.status(400).json({ message: `This player was removed from ${slotName} and can only be placed back into that spot.` });
        }

        newState[teamKey].transient_used_player_ids = newState[teamKey].transient_used_player_ids.filter(id => id !== playerInIdInt);

        if (newState[teamKey].transient_lineup_slots) {
            delete newState[teamKey].transient_lineup_slots[playerInIdInt];
        }
    } else {
        if (!newState[teamKey].transient_subbed_in_player_ids) {
            newState[teamKey].transient_subbed_in_player_ids = [];
        }
        if (playerInIdInt > 0 && !newState[teamKey].transient_subbed_in_player_ids.includes(playerInIdInt)) {
            newState[teamKey].transient_subbed_in_player_ids.push(playerInIdInt);
        }
    }


    let logMessage = '';
    let playerInCard;

    if (playerInId === 'replacement_hitter') {
        playerInCard = REPLACEMENT_HITTER_CARD;
    } else if (playerInId === 'replacement_pitcher') {
        playerInCard = REPLACEMENT_PITCHER_CARD;
    } else {
        const playerInResult = await pool.query('SELECT * FROM cards_player WHERE card_id = $1', [playerInId]);
        playerInCard = playerInResult.rows[0];
    }

    // Get the correct user ID for the team being substituted
    const teamUserId = newState[teamKey].userId;
    // Get the team's city for a more descriptive log message
    const teamResult = await client.query('SELECT city FROM teams WHERE user_id = $1', [teamUserId]);
    const teamName = teamResult.rows[0]?.city || (teamKey === 'homeTeam' ? 'Home' : 'Away');

    let wasPinchRunner = false;
    let wasPinchHitter = false;
    let wasReliefPitcher = false;

    // 1. Update bases (for pinch runners)
    // Helper to transfer pitcherOfRecordId
    const transferProps = (oldRunner, newRunner) => {
        if (oldRunner && oldRunner.pitcherOfRecordId) {
            newRunner.pitcherOfRecordId = oldRunner.pitcherOfRecordId;
        }
    };

    if (newState.bases.first && newState.bases.first.card_id === playerOutId) {
        transferProps(newState.bases.first, playerInCard);
        newState.bases.first = playerInCard;
        if (newState.currentAtBat.basesBeforePlay.first?.card_id === playerOutId) {
            transferProps(newState.currentAtBat.basesBeforePlay.first, playerInCard);
            newState.currentAtBat.basesBeforePlay.first = playerInCard;
        }
        wasPinchRunner = true;
    }
    if (newState.bases.second && newState.bases.second.card_id === playerOutId) {
        transferProps(newState.bases.second, playerInCard);
        newState.bases.second = playerInCard;
        if (newState.currentAtBat.basesBeforePlay.second?.card_id === playerOutId) {
            transferProps(newState.currentAtBat.basesBeforePlay.second, playerInCard);
            newState.currentAtBat.basesBeforePlay.second = playerInCard;
        }
        wasPinchRunner = true;
    }
    if (newState.bases.third && newState.bases.third.card_id === playerOutId) {
        transferProps(newState.bases.third, playerInCard);
        newState.bases.third = playerInCard;
        if (newState.currentAtBat.basesBeforePlay.third?.card_id === playerOutId) {
            transferProps(newState.currentAtBat.basesBeforePlay.third, playerInCard);
            newState.currentAtBat.basesBeforePlay.third = playerInCard;
        }
        wasPinchRunner = true;
    }

    // 2. Update currentAtBat (for pinch hitters and relief pitchers)
    const isSubForBatter = newState.currentAtBat.batter.card_id === playerOutId;
    const isSubForPitcherOnMound = newState.currentAtBat.pitcher && newState.currentAtBat.pitcher.card_id === playerOutId;

    // --- RELIEVER FATIGUE FIX ---
    // If a pitcher is being removed (whether offensive or defensive sub), check if they faced any batters in the current inning.
    if (playerOutCard.control !== null) {
        try {
            const startOfInningStateResult = await client.query(
                `SELECT state_data FROM game_states
                 WHERE game_id = $1
                 AND state_data->>'inning' = $2
                 AND state_data->>'isTopInning' = $3
                 ORDER BY turn_number ASC LIMIT 1`,
                [gameId, newState.inning.toString(), newState.isTopInning.toString()]
            );

            if (startOfInningStateResult.rows.length > 0) {
                const startState = startOfInningStateResult.rows[0].state_data;
                const pitcherOwnerId = newState.isTopInning ? newState.homeTeam.userId : newState.awayTeam.userId;
                const pitcherId = `${pitcherOwnerId}_${playerOutCard.card_id}`;

                const startBattersFaced = (startState.pitcherStats && startState.pitcherStats[pitcherId])
                    ? (startState.pitcherStats[pitcherId].batters_faced || 0)
                    : 0;

                const currentBattersFaced = (newState.pitcherStats && newState.pitcherStats[pitcherId])
                    ? (newState.pitcherStats[pitcherId].batters_faced || 0)
                    : 0;

                // If batters faced count hasn't changed since the start of the inning,
                // remove the current inning from their innings_pitched stats.
                if (currentBattersFaced === startBattersFaced) {
                    if (newState.pitcherStats && newState.pitcherStats[pitcherId] && newState.pitcherStats[pitcherId].innings_pitched) {
                        newState.pitcherStats[pitcherId].innings_pitched = newState.pitcherStats[pitcherId].innings_pitched.filter(i => i !== newState.inning);
                    }
                }
            } else {
                // If we can't find the start of the inning (e.g. game just started),
                // and batters_faced is 0, we can safely remove the inning.
                 const pitcherOwnerId = newState.isTopInning ? newState.homeTeam.userId : newState.awayTeam.userId;
                 const pitcherId = `${pitcherOwnerId}_${playerOutCard.card_id}`;
                 const currentBattersFaced = (newState.pitcherStats && newState.pitcherStats[pitcherId])
                    ? (newState.pitcherStats[pitcherId].batters_faced || 0)
                    : 0;
                 if (currentBattersFaced === 0) {
                     if (newState.pitcherStats && newState.pitcherStats[pitcherId] && newState.pitcherStats[pitcherId].innings_pitched) {
                        newState.pitcherStats[pitcherId].innings_pitched = newState.pitcherStats[pitcherId].innings_pitched.filter(i => i !== newState.inning);
                    }
                 }
            }
        } catch (err) {
            console.error('Error checking pitcher fatigue removal:', err);
        }
    }
    // --- END FIX ---

    // --- REVISED SUBSTITUTION LOGIC ---
    // This logic differentiates between offensive and defensive substitutions to prevent
    // corrupting the `currentAtBat` object.
    if (isOffensiveSub) {
        // Offensive substitutions (pinch hitter/runner) should NEVER change the active pitcher on the mound.
        if (isSubForBatter) {
            wasPinchHitter = true;
            newState.currentAtBat.batter = playerInCard;


            // --- FIX: Recalculate advantage if pitcher has already rolled ---
            if (newState.currentAtBat.pitcherAction === 'pitch' && newState.currentAtBat.pitchRollResult) {
                 const { roll } = newState.currentAtBat.pitchRollResult;
                 const pitcher = newState.currentAtBat.pitcher;
                 // Get effective control for the CURRENT inning/at-bat state
                 const pitcherOwnerId = newState.isTopInning ? newState.homeTeam.userId : newState.awayTeam.userId;
                 const effectiveControl = getEffectiveControl(pitcher, newState.pitcherStats, newState.inning, pitcherOwnerId);
                 
                 // If the batter is a pitcher (has a 'control' rating), they can never have the advantage.
                 const newAdvantage = playerInCard.control !== null
                    ? 'pitcher'
                    : (roll + effectiveControl) > playerInCard.on_base ? 'pitcher' : 'batter';

                 newState.currentAtBat.pitchRollResult.advantage = newAdvantage;
            }
        }
        
        // Pinch runner logic is handled by updating the `bases` object, which was done above.

        // The critical check: If the player being replaced was a pitcher (either as batter or runner),
        // the substituting team will need a new pitcher for their NEXT defensive inning.
        // If the NEW player is a pitcher, they become the new designated pitcher.
        // Otherwise (e.g. pinch hitter), we nullify the slot.
        if (playerOutCard.control !== null) {
            const newPitcher = playerInCard.control !== null ? playerInCard : null;
            if (teamKey === 'homeTeam') {
                newState.currentHomePitcher = newPitcher;
            } else {
                newState.currentAwayPitcher = newPitcher;
            }
        }
    } else {
        // Defensive substitutions can change the active pitcher on the mound.
        const wasAwaitingLineupChange = newState.awaiting_lineup_change;
        if (wasAwaitingLineupChange) {
            if (playerInCard.control !== null) { // A valid pitcher is being subbed in.
                newState.awaiting_lineup_change = false;
                wasReliefPitcher = true;
                newState.currentAtBat.pitcher = playerInCard;
            }
        } else if (isSubForPitcherOnMound) {
            // This is a standard mid-inning pitching change.
            newState.currentAtBat.pitcher = playerInCard;
            wasReliefPitcher = true;
        }

        // For any defensive sub involving a pitcher, update the team's designated pitcher.
        if (wasReliefPitcher) {
             if (teamKey === 'homeTeam') {
                newState.currentHomePitcher = playerInCard;
            } else {
                newState.currentAwayPitcher = playerInCard;
            }
        }

        // --- THIS IS THE FIX ---
        // If we just resolved the awaiting state, NOW we can create the event because the new pitcher is in place.
        if (wasAwaitingLineupChange && !newState.awaiting_lineup_change) {
            const inningString = `<b>${newState.isTopInning ? 'Top' : 'Bottom'} ${getOrdinal(newState.inning)}</b>`;
            const existingEventResult = await client.query(
                `SELECT 1 FROM game_events WHERE game_id = $1 AND event_type = 'system' AND log_message LIKE $2`,
                [gameId, `%${inningString}%`]
            );

            if (existingEventResult.rows.length === 0) {
                await createInningChangeEvent(gameId, newState, userId, currentTurn + 1, client);
            }
        }
    }

    // 3. Update the persistent lineup in game_participants
    // FIX: We do NOT update the startingPitcher in the persistent record.
    // It must remain the original starter for series fatigue rules.
    /*
    if (participant.lineup.startingPitcher === playerOutId) {
        participant.lineup.startingPitcher = playerInCard.card_id;
    }
    */
    const lineup = participant.lineup.battingOrder;

    // REVISED SUBSTITUTION LOGIC (Fix for Replacement Hitter Bug)
    // If we have a valid lineup index, we use that to identify the spot.
    // Otherwise, we fall back to searching by playerOutId (which fails if duplicates exist).
    let spotIndex = -1;
    // Ensure playerOutId is a number for comparison
    const playerOutIdNum = Number(playerOutId);

    if (typeof lineupIndex === 'number' && lineupIndex >= 0 && lineupIndex < lineup.length) {
        // Safety check: Ensure the player at this index is actually the one we expect to remove.
        if (Number(lineup[lineupIndex].card_id) === playerOutIdNum) {
            spotIndex = lineupIndex;
        } else {
            console.warn(`[substitute] Lineup index mismatch. Expected card_id ${playerOutId} at index ${lineupIndex}, found ${lineup[lineupIndex].card_id}. Falling back to findIndex.`);
            spotIndex = lineup.findIndex(spot => Number(spot.card_id) === playerOutIdNum);
        }
    } else {
        // This is the path taken when substituting via the Pitching line (lineupIndex is -1)
        spotIndex = lineup.findIndex(spot => Number(spot.card_id) === playerOutIdNum);
    }

    // Fetch DH rule to handle position overrides
    const gameConfigResult = await client.query('SELECT use_dh FROM games WHERE game_id = $1', [gameId]);
    const useDh = gameConfigResult.rows[0]?.use_dh;

    if (spotIndex === -1) {
        // Fallback: In No-DH games, if the pitcher was previously PH/PR'd for,
        // their ID is gone from the lineup, but we need to put the new pitcher
        // into the "Pitcher's Spot".

        if (useDh === false) { // Explicit check for false (No-DH)
            // 1. Try to find a spot strictly labeled 'P' (maybe a double switch moved it?)
            spotIndex = lineup.findIndex(spot => spot.position === 'P');

            if (spotIndex === -1) {
                 // 2. Look for 'PH' or 'PR' spots. These are the likely candidates for the pitcher's spot.
                 const candidateIndices = lineup
                    .map((spot, index) => ({ ...spot, index }))
                    .filter(spot => ['PH', 'PR'].includes(spot.position))
                    .map(s => s.index);

                 if (candidateIndices.length === 1) {
                     spotIndex = candidateIndices[0];
                 } else if (candidateIndices.includes(8)) {
                     spotIndex = 8;
                 } else if (candidateIndices.length > 0) {
                     spotIndex = candidateIndices[0];
                 }
            }
        }
    }

    if (spotIndex > -1) {
        lineup[spotIndex].card_id = playerInCard.card_id;
        // If a pinch hitter just came in for the pitcher, mark their position as 'PH'.
        // The pitcher is now null in the currentAtBat.
        if (wasPinchHitter && newState.currentAtBat.pitcher === null) {
            lineup[spotIndex].position = 'PH';
        }
        // Only update the defensive position for other substitutions,
        // not for a pinch-runner who hasn't taken the field yet.
        else if (!wasPinchRunner || wasPinchHitter) {
            let newPosition = position;
            // In No-DH games, if a pitcher is brought in defensively (not as a pinch hitter),
            // and they are replacing a PH/PR/P, force their position to 'P'.
            // This handles cases where the previous P was pinch-hit for (slot became PH),
            // and now a new P is entering.
            if (!isOffensiveSub && useDh === false && playerInCard.control !== null && ['PH', 'PR', 'P'].includes(position)) {
                newPosition = 'P';
            }
            lineup[spotIndex].position = newPosition;
        }
    }

    // 4. Determine the correct log message based on the actions taken
    if (wasPinchHitter && newState.currentAtBat.pitcher === null) {
        logMessage = `${teamName} brings in ${playerInCard.name} to pinch hit for ${playerOutCard.name}.`;
    } else if (wasPinchRunner) {
        logMessage = `${teamName} brings in ${playerInCard.name} to pinch run for ${playerOutCard.name}.`;
    } else if (wasReliefPitcher) {
        logMessage = `${teamName} brings in ${playerInCard.name} to relieve ${playerOutCard.name}.`;
    } else {
        logMessage = `${teamName} substitutes ${playerInCard.name} for ${playerOutCard.name}. ${playerInCard.name} will now play ${position}.`;
    }

    const playerOutIdInt = parseInt(playerOutId, 10);
    if (playerOutIdInt > 0) { // Don't add replacement players to the used list
        if (newState[teamKey].transient_subbed_in_player_ids && newState[teamKey].transient_subbed_in_player_ids.includes(playerOutIdInt)) {
            // The player was subbed in during this transient state, so they haven't actually played.
            // Just remove them from the subbed in list, and don't add to used list.
            newState[teamKey].transient_subbed_in_player_ids = newState[teamKey].transient_subbed_in_player_ids.filter(id => id !== playerOutIdInt);
        } else {
            if (!newState[teamKey].transient_used_player_ids) {
                newState[teamKey].transient_used_player_ids = [];
            }
            if (!newState[teamKey].transient_used_player_ids.includes(playerOutIdInt) && !(newState[teamKey].used_player_ids && newState[teamKey].used_player_ids.includes(playerOutIdInt))) {
                newState[teamKey].transient_used_player_ids.push(playerOutIdInt);

                // Record the slot they were removed from
                if (!newState[teamKey].transient_lineup_slots) {
                    newState[teamKey].transient_lineup_slots = {};
                }
                const removedSlotKey = lineupIndex >= 0 ? lineupIndex.toString() : 'pitcher';
                newState[teamKey].transient_lineup_slots[playerOutIdInt] = removedSlotKey;
            }
        }
    }

    await client.query('UPDATE game_participants SET lineup = $1::jsonb WHERE game_id = $2 AND user_id = $3', [JSON.stringify(participant.lineup), gameId, userId]);
    // --- NEW: Recalculate defensive ratings for the team that made the sub ---
    const ratingsKey = teamKey === 'homeTeam' ? 'homeDefensiveRatings' : 'awayDefensiveRatings';
    newState[ratingsKey] = {
      catcherArm: await getCatcherArm(participant),
      infieldDefense: await getInfieldDefense(participant),
      outfieldDefense: await getOutfieldDefense(participant),
    };

    // --- START PRODUCTION DEBUGGING ---
    console.log('[substitute] Calling validateLineup...');
    // --- END PRODUCTION DEBUGGING ---
    newState = await validateLineup(participant, newState, gameId, client);

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
    await client.query('INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)', [gameId, userId, currentTurn + 1, 'substitution', logMessage]);
    
    await client.query('COMMIT');
    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.status(200).json({ message: 'Substitution successful.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error making substitution for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error during substitution.' });
  } finally {
    client.release();
  }
});

// SWAP DEFENSIVE POSITIONS
app.post('/api/games/:gameId/swap-positions', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { playerAId, playerBId } = req.body;
  const userId = req.user.userId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);

    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    const currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    let newState = JSON.parse(JSON.stringify(currentState));

    // Get the participant making the request
    const participantResult = await client.query(
      'SELECT * FROM game_participants WHERE game_id = $1 AND user_id = $2',
      [gameId, userId]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({ message: 'Participant not found for this game.' });
    }

    let participant = participantResult.rows[0];
    let lineup = participant.lineup;

    // Find the players in the batting order
    const playerAIndex = lineup.battingOrder.findIndex(p => p.card_id === playerAId);
    const playerBIndex = lineup.battingOrder.findIndex(p => p.card_id === playerBId);

    if (playerAIndex === -1 || playerBIndex === -1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'One or both players not found in the lineup.' });
    }

    const positionA = lineup.battingOrder[playerAIndex].position;
    const positionB = lineup.battingOrder[playerBIndex].position;


    // Swap their defensive positions
    lineup.battingOrder[playerAIndex].position = positionB;
    lineup.battingOrder[playerBIndex].position = positionA;

    // Update the lineup in the database
    await client.query(
      'UPDATE game_participants SET lineup = $1::jsonb WHERE game_id = $2 AND user_id = $3',
      [JSON.stringify(lineup), gameId, userId]
    );

    // Recalculate defensive ratings for the team that made the swap
    const gameInfo = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
    const isHomeTeam = userId === gameInfo.rows[0].home_team_user_id;
    const ratingsKey = isHomeTeam ? 'homeDefensiveRatings' : 'awayDefensiveRatings';

    newState[ratingsKey] = {
      catcherArm: await getCatcherArm(participant),
      infieldDefense: await getInfieldDefense(participant),
      outfieldDefense: await getOutfieldDefense(participant),
    };

    newState = await validateLineup(participant, newState, gameId, client);

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
    await client.query('COMMIT');

    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.status(200).json({ message: 'Player positions swapped successfully.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error swapping positions for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error during position swap.' });
  } finally {
    client.release();
  }
});

// SET DEFENSIVE STRATEGY (e.g., Infield In)
app.post('/api/games/:gameId/set-defense', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { infieldIn } = req.body; // Expecting { infieldIn: true } or { infieldIn: false }
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    // Create a new state with the updated defensive setting
    const newState = { ...currentState };
    newState.currentAtBat.infieldIn = infieldIn;
    
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
    await client.query('COMMIT');
    
    // Notify the room that the game state has changed
    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.status(200).json({ message: 'Defensive strategy updated.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error setting defense:', error);
    res.status(500).json({ message: 'Server error while setting defense.' });
  } finally {
    client.release();
  }
});

// GET A SPECIFIC ROSTER AND ITS CARDS (Protected Route)
app.get('/api/rosters/:rosterId', authenticateToken, async (req, res) => {
    const { rosterId } = req.params;
    const { point_set_id } = req.query; // <-- New: Get point_set_id from query

    if (!point_set_id) {
        return res.status(400).json({ message: 'A point_set_id is required.' });
    }

    try {
        // Value league rosters against the current season's point set (matching the
        // dashboard) rather than the raw requested set, which could be a stale season.
        const rosterMetaResult = await pool.query('SELECT roster_type FROM rosters WHERE roster_id = $1', [rosterId]);
        const effectivePointSetId = await resolveEffectivePointSetId(point_set_id, rosterMetaResult.rows[0]?.roster_type);

        const rosterCardsQuery = `
            SELECT
                cp.*,
                rc.is_starter,
                rc.assignment,
                ppv.points
            FROM cards_player cp
            JOIN roster_cards rc ON cp.card_id = rc.card_id
            LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $2
            WHERE rc.roster_id = $1
        `;
        const rosterCardsResult = await pool.query(rosterCardsQuery, [rosterId, effectivePointSetId]);

        // This is the fix: Process the players before sending them back.
        const processedCards = processPlayers(rosterCardsResult.rows);

        res.json(processedCards);

    } catch (error) {
        console.error(`Error fetching roster ${rosterId}:`, error);
        res.status(500).json({ message: 'Server error fetching roster details.' });
    }
});

// GET ALL PENDING GAMES (Updated)
// in server.js
// in server.js
app.get('/api/games/open', authenticateToken, async (req, res) => {
  try {
    const openGamesQuery = await pool.query(
      `SELECT
         g.game_id,
         t.city,
         t.name,
         t.display_format,
         u.user_id as host_user_id,
         COALESCE(s.series_type, 'exhibition') as series_type
       FROM games g 
       LEFT JOIN series s ON g.series_id = s.id
       JOIN game_participants gp ON g.game_id = gp.game_id
       JOIN users u ON gp.user_id = u.user_id
       JOIN teams t ON u.team_id = t.team_id
       WHERE g.status = 'pending' AND 
       (SELECT COUNT(*) FROM game_participants WHERE game_id = g.game_id) = 1`
    );
    const openGames = openGamesQuery.rows.map(game => {
        const format = game.display_format || '{city} {name}';
        game.full_display_name = format.replace('{city}', game.city).replace('{name}', game.name);
        return game;
    });
    res.json(openGames);
  } catch (error) {
    console.error('Error fetching open games:', error);
    res.status(500).json({ message: 'Server error while fetching open games.' });
  }
});

// Every series the current user's team is matched up in, across all league seasons and Classics,
// grouped so the dashboard can present the live season/Classic distinctly from older ones. Each entry
// carries its lifecycle (scheduled -> in_progress -> completed) and, when launched in-app, the linked
// live series + its current unfinished game. System-generated phantom/auto rows are excluded.
app.get('/api/series/mine', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const meRes = await pool.query('SELECT team_id FROM users WHERE user_id = $1', [userId]);
    const myTeamId = meRes.rows[0] && meRes.rows[0].team_id;
    if (!myTeamId) return res.json({ groups: [], myTeamId: null, currentSeason: null, seeds_clinched: false });

    // Current live LEAGUE season = the most recent non-Classic one (matches routes/league.js). Classic
    // rows carry the prior league season's name but can be dated later, so they must be excluded here.
    const seasonRes = await pool.query(
      `SELECT season_name FROM series_results
       WHERE season_name IS NOT NULL AND style IS DISTINCT FROM 'Classic'
       ORDER BY date DESC LIMIT 1`
    );
    const currentSeason = seasonRes.rows[0] ? seasonRes.rows[0].season_name : null;

    // "Seeds clinched" for the live season = the Golden Spaceship / Wooden Spoon series exist (created
    // by schedulePlayoffsIfClinched once the field locks). Enables the optional early-stop action.
    let seedsClinched = false;
    if (currentSeason) {
      const clinchRes = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM series_results
           WHERE season_name = $1 AND round IN ('Golden Spaceship', 'Wooden Spoon')) AS clinched`,
        [currentSeason]
      );
      seedsClinched = clinchRes.rows[0].clinched;
    }

    const activeClassicRes = await pool.query('SELECT id FROM classics WHERE is_active = true ORDER BY id LIMIT 1');
    const activeClassicId = activeClassicRes.rows[0] ? activeClassicRes.rows[0].id : null;

    // The dashboard is about IN-APP play, so we only surface a row if it was actually played in-app
    // (has a linked series) OR it's still actionable in the live season / active Classic (a scheduled
    // or in-progress matchup to Play/Continue). Purely offline-entered results are left to the League
    // and team pages. live_series_id ties a row to the in-app series that produced/plays it.
    const rows = (await pool.query(
      `SELECT sr.id, sr.round, sr.style, sr.season_name, sr.status, sr.result_source, sr.classic_id,
              sr.winning_team_id, sr.winning_team_name, sr.losing_team_id, sr.losing_team_name,
              sr.winning_score, sr.losing_score, sr.date,
              (SELECT s.id FROM series s WHERE s.series_result_id = sr.id ORDER BY s.id DESC LIMIT 1) AS live_series_id
       FROM series_results sr
       WHERE (sr.winning_team_id = $1 OR sr.losing_team_id = $1)
         AND sr.result_source IS DISTINCT FROM 'auto'
         AND (
           EXISTS (SELECT 1 FROM series s WHERE s.series_result_id = sr.id)
           OR (sr.status <> 'completed' AND (
                (sr.style IS DISTINCT FROM 'Classic' AND sr.season_name = $2)
                OR sr.classic_id = $3
           ))
         )
       ORDER BY sr.date DESC, sr.id DESC`,
      [myTeamId, currentSeason, activeClassicId]
    )).rows;

    // Batch lookups: teams, classic names, linked live series + their current unfinished game.
    const teamIds = [...new Set(rows.flatMap(r => [r.winning_team_id, r.losing_team_id]).filter(Boolean))];
    const teamById = {};
    if (teamIds.length) {
      (await pool.query('SELECT team_id, city, name, logo_url FROM teams WHERE team_id = ANY($1)', [teamIds]))
        .rows.forEach(t => { teamById[t.team_id] = t; });
    }
    const classicIds = [...new Set(rows.map(r => r.classic_id).filter(Boolean))];
    const classicById = {};
    if (classicIds.length) {
      (await pool.query('SELECT id, name, is_active FROM classics WHERE id = ANY($1)', [classicIds]))
        .rows.forEach(c => { classicById[c.id] = c; });
    }
    const liveIds = [...new Set(rows.map(r => r.live_series_id).filter(Boolean))];
    const liveById = {};
    const activeGameBySeries = {};
    if (liveIds.length) {
      (await pool.query(
        `SELECT id, home_wins, away_wins, status, series_home_user_id, series_away_user_id
         FROM series WHERE id = ANY($1)`, [liveIds]
      )).rows.forEach(s => { liveById[s.id] = s; });
      (await pool.query(
        `SELECT DISTINCT ON (series_id) series_id, game_id, status, game_in_series
         FROM games WHERE series_id = ANY($1) AND status <> 'completed'
         ORDER BY series_id, game_in_series DESC`, [liveIds]
      )).rows.forEach(g => { activeGameBySeries[g.series_id] = g; });
    }

    const groupsMap = new Map();
    const groupFor = (r) => {
      if (r.style === 'Classic' && r.classic_id) {
        const key = `classic:${r.classic_id}`;
        if (!groupsMap.has(key)) {
          const c = classicById[r.classic_id];
          groupsMap.set(key, { key, type: 'classic', label: c ? c.name : 'Classic', season_name: r.season_name, is_live: !!(c && c.is_active), seeds_clinched: false, series: [], _latest: r.date });
        }
        return groupsMap.get(key);
      }
      const key = `league:${r.season_name}`;
      if (!groupsMap.has(key)) {
        const isLive = r.season_name === currentSeason;
        groupsMap.set(key, { key, type: 'league', label: r.season_name || 'League', season_name: r.season_name, is_live: isLive, seeds_clinched: isLive ? seedsClinched : false, series: [], _latest: r.date });
      }
      return groupsMap.get(key);
    };

    for (const r of rows) {
      const iAmWinningSlot = r.winning_team_id === myTeamId;
      const oppTeamId = iAmWinningSlot ? r.losing_team_id : r.winning_team_id;
      const ot = teamById[oppTeamId];
      const opponent = ot
        ? { team_id: oppTeamId, city: ot.city, name: ot.name, logo_url: ot.logo_url }
        : { team_id: oppTeamId, name: iAmWinningSlot ? r.losing_team_name : r.winning_team_name, city: null, logo_url: null };

      let live = null;
      if (r.live_series_id && liveById[r.live_series_id]) {
        const s = liveById[r.live_series_id];
        const iAmHome = Number(s.series_home_user_id) === Number(userId);
        const iAmParticipant = iAmHome || Number(s.series_away_user_id) === Number(userId);
        const g = activeGameBySeries[s.id];
        // A finalized series must never surface a "Continue" game: if the result or the live series
        // is already completed, a leftover unplayed/next game would otherwise show as a phantom
        // action ("extra unplayed game at the end"). Guard on completion regardless of stray games.
        const seriesDone = r.status === 'completed' || s.status === 'completed';
        live = {
          series_id: s.id,
          series_status: s.status,
          my_wins: iAmHome ? s.home_wins : s.away_wins,
          opp_wins: iAmHome ? s.away_wins : s.home_wins,
          i_am_participant: iAmParticipant,
          active_game: (g && !seriesDone) ? { game_id: g.game_id, status: g.status, game_in_series: g.game_in_series } : null,
        };
      }

      const group = groupFor(r);
      if (new Date(r.date) > new Date(group._latest)) group._latest = r.date;
      group.series.push({
        series_result_id: r.id,
        round: r.round,
        result_status: r.status,
        result_source: r.result_source,
        opponent,
        my_score: iAmWinningSlot ? r.winning_score : r.losing_score,
        opp_score: iAmWinningSlot ? r.losing_score : r.winning_score,
        live,
      });
    }

    // Live groups first (league before classic), then the rest most-recent first.
    const groups = [...groupsMap.values()].sort((a, b) => {
      if (a.is_live !== b.is_live) return a.is_live ? -1 : 1;
      if (a.is_live && b.is_live && a.type !== b.type) return a.type === 'league' ? -1 : 1;
      return new Date(b._latest) - new Date(a._latest);
    });
    groups.forEach(g => { delete g._latest; });

    res.json({ groups, myTeamId, currentSeason, seeds_clinched: seedsClinched });
  } catch (error) {
    console.error('Error fetching my series:', error);
    res.status(500).json({ message: 'Server error while fetching series.' });
  }
});

// Stop a regular-season series early once the playoff seeds have clinched (optional). An in-progress
// series is finalized at its current partial score; a never-launched one is recorded 0-0 "not
// required". Guarded by the clinch condition and by the requester belonging to the matchup.
app.post('/api/series/stop', authenticateToken, async (req, res) => {
  const { series_result_id } = req.body;
  const userId = req.user.userId;
  if (!series_result_id) return res.status(400).json({ message: 'series_result_id is required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const srRes = await client.query(
      `SELECT id, season_name, round, status, winning_team_id, winning_team_name, losing_team_id, losing_team_name
       FROM series_results WHERE id = $1 FOR UPDATE`,
      [series_result_id]
    );
    if (srRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Series not found.' }); }
    const sr = srRes.rows[0];
    if (sr.status === 'completed') { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Series is already completed.' }); }
    // Early-stop is a regular-season concept (skip games that no longer matter). Never let it touch a
    // playoff series — recording a Spaceship/Spoon/etc. as 0-0 "not required" would wipe the matchup.
    const PLAYOFF_ROUNDS = ['Golden Spaceship', 'Wooden Spoon', 'Silver Submarine', 'Semifinal', 'Semi-Final', 'Play-In', 'Final'];
    if (PLAYOFF_ROUNDS.includes(sr.round)) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Only regular-season series can be stopped early.' }); }

    const clinch = await client.query(
      `SELECT EXISTS(SELECT 1 FROM series_results WHERE season_name = $1 AND round IN ('Golden Spaceship','Wooden Spoon')) AS clinched`,
      [sr.season_name]
    );
    if (!clinch.rows[0].clinched) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'A series can only be stopped early once the playoff seeds have clinched.' }); }

    const teamRes = await client.query('SELECT team_id FROM users WHERE user_id = $1', [userId]);
    const myTeamId = teamRes.rows[0] && teamRes.rows[0].team_id;
    if (myTeamId !== sr.winning_team_id && myTeamId !== sr.losing_team_id) {
      await client.query('ROLLBACK'); return res.status(403).json({ message: 'Your team is not part of this series.' });
    }

    const liveRes = await client.query(
      `SELECT id, home_wins, away_wins, series_home_user_id, series_away_user_id, status
       FROM series WHERE series_result_id = $1 ORDER BY id DESC LIMIT 1`,
      [series_result_id]
    );

    if (liveRes.rows.length > 0 && liveRes.rows[0].status !== 'completed') {
      // Finalize the in-app series at its current score.
      const s = liveRes.rows[0];
      const teamRows = await client.query('SELECT user_id, team_id FROM teams WHERE user_id = ANY($1)', [[s.series_home_user_id, s.series_away_user_id]]);
      const homeTeam = teamRows.rows.find(t => t.user_id === s.series_home_user_id);
      const awayTeam = teamRows.rows.find(t => t.user_id === s.series_away_user_id);
      const update = resolveSeriesResultUpdate(sr, {
        homeTeamId: homeTeam ? homeTeam.team_id : null,
        awayTeamId: awayTeam ? awayTeam.team_id : null,
        homeGames: s.home_wins, awayGames: s.away_wins, isOver: true,
      });
      await client.query(
        `UPDATE series_results SET status=$1, result_source=$2, winning_team_id=$3, winning_team_name=$4, winning_score=$5, losing_team_id=$6, losing_team_name=$7, losing_score=$8 WHERE id=$9`,
        [update.status, update.result_source, update.winning_team_id, update.winning_team_name, update.winning_score, update.losing_team_id, update.losing_team_name, update.losing_score, series_result_id]
      );
      await client.query(`UPDATE series SET status='completed' WHERE id = $1`, [s.id]);
      // Stopping early skips the remaining games — drop any leftover unplayed shells so the
      // finalized series can't leave a phantom "Continue" game (empty shells only; a partially
      // played game keeps its log and is hidden by the dashboard completion guard).
      await client.query(
        `DELETE FROM games g
          WHERE g.series_id = $1 AND g.status <> 'completed'
            AND NOT EXISTS (SELECT 1 FROM game_events e WHERE e.game_id = g.game_id)`,
        [s.id]
      );
    } else {
      // Never launched: record a 0-0 "not required" row (contributes nothing to the standings).
      await client.query(
        `UPDATE series_results SET status='completed', result_source='auto', winning_score=0, losing_score=0,
         notes='Not required — playoff seeds clinched' WHERE id = $1`,
        [series_result_id]
      );
    }

    await client.query('COMMIT');
    io.emit('games-updated');
    res.json({ message: 'Series stopped.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error stopping series:', error);
    res.status(500).json({ message: 'Server error stopping series.' });
  } finally {
    client.release();
  }
});

// Detail for one in-app series (by live series id): the two teams, the series score/status, its place
// in the schedule (season/round), and every game with its final score + a link target. Powers the
// series page. 404s for a series that doesn't exist.
app.get('/api/series/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const sRes = await pool.query(
      `SELECT s.id, s.series_type, s.status, s.home_wins, s.away_wins,
              s.series_home_user_id, s.series_away_user_id, s.series_result_id,
              sr.season_name, sr.round, sr.status AS result_status, sr.result_source,
              sr.winning_team_id AS sr_winning_team_id, sr.losing_team_id AS sr_losing_team_id,
              sr.winning_score AS sr_winning_score, sr.losing_score AS sr_losing_score
       FROM series s
       LEFT JOIN series_results sr ON s.series_result_id = sr.id
       WHERE s.id = $1`,
      [id]
    );
    if (sRes.rows.length === 0) return res.status(404).json({ message: 'Series not found.' });
    const s = sRes.rows[0];

    // The two teams in the series, resolved from participants across its games (robust even before
    // series_away_user_id is set on the row). Keyed by user_id.
    const teamRows = await pool.query(
      `SELECT DISTINCT u.user_id, t.team_id, t.city, t.name, t.abbreviation, t.logo_url
       FROM game_participants gp
       JOIN games g ON gp.game_id = g.game_id
       JOIN users u ON gp.user_id = u.user_id
       JOIN teams t ON u.team_id = t.team_id
       WHERE g.series_id = $1`,
      [id]
    );
    const teamByUser = {};
    teamRows.rows.forEach(r => { teamByUser[r.user_id] = r; });
    const teamFor = (uid) => (uid != null && teamByUser[uid]) ? teamByUser[uid] : null;

    // Series-level home/away (falls back to the two participants if the away user isn't set yet).
    let homeUser = s.series_home_user_id;
    let awayUser = s.series_away_user_id;
    const allUsers = teamRows.rows.map(r => r.user_id);
    if (homeUser == null && allUsers.length) homeUser = allUsers[0];
    if (awayUser == null) awayUser = allUsers.find(u => u !== homeUser) ?? null;

    const gamesRes = await pool.query(
      `SELECT game_id, game_in_series, status, home_team_user_id, completed_at, created_at
       FROM games WHERE series_id = $1 ORDER BY game_in_series ASC`,
      [id]
    );

    const games = [];
    const nameCardIds = new Set();
    for (const g of gamesRes.rows) {
      const gHomeUser = g.home_team_user_id;
      const gAwayUser = allUsers.find(u => u !== gHomeUser) ?? (gHomeUser === homeUser ? awayUser : homeUser);

      let homeScore = null, awayScore = null, inning = null, linescore = null, decisionsRaw = null, hrRaw = null;
      if (g.status === 'in_progress' || g.status === 'completed') {
        const st = await pool.query(
          'SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1',
          [g.game_id]
        );
        if (st.rows.length) {
          const d = st.rows[0].state_data || {};
          homeScore = d.homeScore ?? null;
          awayScore = d.awayScore ?? null;
          inning = d.inning ?? null;
          linescore = computeLinescore(d.atBatLog);
          hrRaw = computeHomeRuns(d.atBatLog);
          Object.keys(hrRaw).forEach(cid => { const n = parseInt(cid); if (n) nameCardIds.add(n); });
          // Innings pitched (outs) per pitcher, for the W-must-go-5 / save-3-innings rules.
          const outsByKey = {};
          for (const [k, v] of Object.entries(d.pitcherStats || {})) {
            outsByKey[normalizeKey(k)] = (v && v.outs_recorded != null) ? v.outs_recorded : ((v && v.innings_pitched) ? v.innings_pitched.length * 3 : 0);
          }
          if (g.status === 'completed') {
            decisionsRaw = computePitchingDecisions(d.atBatLog || [], { away: { user_id: gAwayUser }, home: { user_id: gHomeUser } }, outsByKey);
            Object.keys(decisionsRaw).forEach(k => { const cid = parseInt(cardIdOf(k)); if (cid) nameCardIds.add(cid); });
          }
        }
      }
      // Not-yet-played game: if the players have set their lineups, surface the starting-pitcher matchup.
      let probableSP = null;
      if (g.status === 'pending' || g.status === 'lineups') {
        const parts = (await pool.query('SELECT user_id, lineup FROM game_participants WHERE game_id = $1', [g.game_id])).rows;
        const sp = { away: null, home: null };
        const leftover = [];
        for (const pr of parts) {
          const cid = pr.lineup && pr.lineup.startingPitcher ? parseInt(pr.lineup.startingPitcher) : null;
          if (!cid) continue;
          if (pr.user_id === gAwayUser) sp.away = cid;
          else if (pr.user_id === gHomeUser) sp.home = cid;
          else leftover.push(cid);
          nameCardIds.add(cid);
        }
        for (const cid of leftover) { if (!sp.away) sp.away = cid; else if (!sp.home) sp.home = cid; }
        if (sp.away || sp.home) probableSP = sp;
      }

      let winner = null;
      if (g.status === 'completed' && homeScore != null && awayScore != null) {
        winner = homeScore > awayScore ? 'home' : (awayScore > homeScore ? 'away' : null);
      }

      const homeTeam = teamFor(gHomeUser);
      const awayTeam = teamFor(gAwayUser);
      games.push({
        game_id: g.game_id,
        game_in_series: g.game_in_series,
        status: g.status,
        inning,
        home: homeTeam ? { team_id: homeTeam.team_id, abbreviation: homeTeam.abbreviation, city: homeTeam.city, name: homeTeam.name, logo_url: homeTeam.logo_url, score: homeScore } : { abbreviation: 'HOME', score: homeScore },
        away: awayTeam ? { team_id: awayTeam.team_id, abbreviation: awayTeam.abbreviation, city: awayTeam.city, name: awayTeam.name, logo_url: awayTeam.logo_url, score: awayScore } : { abbreviation: 'AWAY', score: awayScore },
        winner,
        linescore,
        _decisionsRaw: decisionsRaw,
        _hrRaw: hrRaw,
        _awayUser: gAwayUser,
        _probableSP: probableSP,
        completed_at: g.completed_at,
      });
    }

    // Resolve pitcher-decision and home-run batter names in one query, then attach per game an ordered
    // decisions list (W/L/S — blown saves omitted) and a home-runs list.
    const nameByCard = {};
    if (nameCardIds.size) {
      (await pool.query('SELECT card_id, display_name, name FROM cards_player WHERE card_id = ANY($1)', [[...nameCardIds]]))
        .rows.forEach(c => { nameByCard[c.card_id] = c.display_name || c.name; });
    }
    const TAG_ORDER = ['W', 'L', 'S'];
    for (const game of games) {
      const raw = game._decisionsRaw;
      const hr = game._hrRaw;
      const awayU = game._awayUser;
      delete game._decisionsRaw;
      delete game._hrRaw;
      delete game._awayUser;

      const list = [];
      if (raw) {
        for (const [key, tags] of Object.entries(raw)) {
          const name = nameByCard[parseInt(cardIdOf(key))] || null;
          const side = String(key.split('_')[0]) === String(awayU) ? 'away' : 'home';
          for (const t of tags) if (t !== 'BS') list.push({ tag: t, name, side });
        }
        list.sort((a, b) => TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag));
      }
      game.decisions = list;

      game.home_runs = hr
        ? Object.entries(hr)
            .map(([cid, info]) => ({
              name: nameByCard[parseInt(cid)] || null,
              count: info.count,
              side: info.side,
              team: info.side === 'away' ? game.away.abbreviation : game.home.abbreviation,
            }))
            .sort((a, b) => b.count - a.count || (a.name || '').localeCompare(b.name || ''))
        : [];

      const psp = game._probableSP;
      delete game._probableSP;
      game.probable_pitchers = psp
        ? { away: psp.away ? (nameByCard[psp.away] || null) : null, home: psp.home ? (nameByCard[psp.home] || null) : null }
        : null;
    }

    const fmtTeam = (uid) => {
      const t = teamFor(uid);
      return t ? { user_id: uid, team_id: t.team_id, city: t.city, name: t.name, abbreviation: t.abbreviation, logo_url: t.logo_url } : null;
    };

    // Header score: once the linked result is completed it is the source of truth. The raw in-app
    // s.home_wins/s.away_wins tally can be wrong for messy/partial series (e.g. games where the home
    // team didn't alternate), so map the official winner/loser scores onto this series' home/away
    // teams by team_id. Fall back to the in-app tally when there's no completed result (or no id match).
    let headerHomeWins = s.home_wins;
    let headerAwayWins = s.away_wins;
    if (s.result_status === 'completed' && s.sr_winning_score != null && s.sr_losing_score != null) {
      const homeTeamId = teamFor(homeUser)?.team_id;
      if (homeTeamId === s.sr_winning_team_id) {
        headerHomeWins = s.sr_winning_score; headerAwayWins = s.sr_losing_score;
      } else if (homeTeamId === s.sr_losing_team_id) {
        headerHomeWins = s.sr_losing_score; headerAwayWins = s.sr_winning_score;
      }
    }

    res.json({
      series_id: s.id,
      series_type: s.series_type,
      status: s.status,
      home_wins: headerHomeWins,
      away_wins: headerAwayWins,
      season_name: s.season_name,
      round: s.round,
      result_status: s.result_status,
      result_source: s.result_source,
      home_team: fmtTeam(homeUser),
      away_team: fmtTeam(awayUser),
      games,
    });
  } catch (error) {
    console.error('Error fetching series detail:', error);
    res.status(500).json({ message: 'Server error fetching series detail.' });
  }
});

// in server.js
// in server.js
app.get('/api/games', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    // Filter out games that are hidden for this user
    const gamesResult = await pool.query(
      `SELECT g.game_id, g.status, g.current_turn_user_id, g.home_team_user_id, g.game_in_series, g.created_at, g.completed_at, g.series_id
       FROM games g JOIN game_participants gp ON g.game_id = gp.game_id 
       WHERE gp.user_id = $1 AND (gp.is_hidden IS FALSE OR gp.is_hidden IS NULL)
       ORDER BY g.created_at DESC`,
      [userId]
    );

    const processedGames = [];
    for (const game of gamesResult.rows) {
        const participantsResult = await pool.query(
            `SELECT u.user_id, t.city, t.name, t.abbreviation, t.display_format, gp.home_or_away
             FROM game_participants gp 
             JOIN users u ON gp.user_id = u.user_id 
             JOIN teams t ON u.team_id = t.team_id 
             WHERE gp.game_id = $1`,
            [game.game_id]
        );

        let opponent = null;
        let home_team_abbr = 'HOME';
        let away_team_abbr = 'AWAY';
        
        const homeUserId = Number(game.home_team_user_id);

        for (const p of participantsResult.rows) {
            if (p.home_or_away === 'home') {
                home_team_abbr = p.abbreviation;
            } else if (p.home_or_away === 'away') {
                away_team_abbr = p.abbreviation;
            } else {
                 if (Number(p.user_id) === homeUserId) {
                    home_team_abbr = p.abbreviation;
                } else {
                    away_team_abbr = p.abbreviation;
                }
            }

            if (Number(p.user_id) !== userId) {
                const format = p.display_format || '{city} {name}';
                opponent = { ...p, full_display_name: format.replace('{city}', p.city).replace('{name}', p.name) };
            }
        }

        let gameState = null;
        if (game.status === 'in_progress' || game.status === 'completed') {
            const stateResult = await pool.query(
                'SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1',
                [game.game_id]
            );
            if (stateResult.rows.length > 0) {
                gameState = stateResult.rows[0].state_data;
            }
        }

        let series = null;
        let series_type = 'exhibition';
        if (game.series_id) {
            const seriesResult = await pool.query('SELECT * FROM series WHERE id = $1', [game.series_id]);
            if (seriesResult.rows.length > 0) {
                series = seriesResult.rows[0];
                series_type = series.series_type;
            }
        }

        const isUserTurn = Number(game.current_turn_user_id) === userId;
        let status_text = game.status.replace('_', ' ');
        if (game.status === 'in_progress' && isUserTurn) {
            status_text = 'Your Turn!';
        } else if (game.status === 'pending') {
            status_text = 'Waiting for opponent';
        } else if (game.status === 'lineups') {
            status_text = 'Set your lineup';
        }


        processedGames.push({ ...game, opponent, gameState, series, series_type, home_team_abbr, away_team_abbr, status_text });
    }

    res.json(processedGames);
  } catch (error) {
    console.error('Error fetching user games:', error);
    res.status(500).json({ message: 'Server error while fetching games.' });
  }
});

// GET ALL POINT SETS
app.get('/api/point-sets', authenticateToken, async (req, res) => {
  try {
    // created_at is a bulk-insert timestamp for most sets, so sort by the season the
    // set actually represents (newest first). "M/D Season" names need the year, which
    // we recover from seasonUtils' seasonMap.
    const { seasonMap } = require('./utils/seasonUtils');
    const SEASON_MONTH = { Winter: 0, Spring: 1, Summer: 4, Fall: 7 };
    const pointSetDate = (name) => {
      if (name === 'Original Pts') return new Date(2000, 0, 1).getTime();
      if (name === 'Upcoming Season') return new Date(2999, 0, 1).getTime();
      let m = name.match(/^(Winter|Spring|Summer|Fall)\s+(\d{4})$/);
      if (m) return new Date(+m[2], SEASON_MONTH[m[1]], 1).getTime();
      m = name.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}) Season$/);
      if (m) return new Date(2000 + +m[3], +m[1] - 1, +m[2]).getTime();
      m = name.match(/^(\d{1,2})\/(\d{1,2}) Season$/);
      if (m) {
        const key = Object.keys(seasonMap).find(k => { const [mm, dd] = k.split('/').map(Number); return mm === +m[1] && dd === +m[2]; });
        if (key) { const [mm, dd, yy] = key.split('/').map(Number); return new Date(2000 + yy, mm - 1, dd).getTime(); }
      }
      return 0;
    };
    const pointSetsResult = await pool.query('SELECT * FROM point_sets');
    const rows = pointSetsResult.rows.sort((a, b) => pointSetDate(b.name) - pointSetDate(a.name));
    res.json(rows);
  } catch (error) {
    console.error('Error fetching point sets:', error);
    res.status(500).json({ message: 'Server error while fetching point sets.' });
  }
});

// GET ALL PLAYER CARDS (now with points from a specific set)
app.get('/api/cards/player', authenticateToken, async (req, res) => {
    const { point_set_id } = req.query;

    if (!point_set_id) {
        return res.status(400).json({ message: 'A point_set_id is required.' });
    }

    try {
        const query = `
            SELECT DISTINCT ON (cp.card_id)
                cp.*,
                ppv.points,
                t.team_id as owned_by_team_id,
                t.logo_url as owned_by_team_logo,
                t.name as owned_by_team_name
            FROM cards_player cp
            LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $1
            LEFT JOIN roster_cards rc ON cp.card_id = rc.card_id
            LEFT JOIN rosters r ON rc.roster_id = r.roster_id AND r.roster_type = 'league'
            LEFT JOIN users u ON r.user_id = u.user_id
            LEFT JOIN teams t ON u.team_id = t.team_id
            ORDER BY cp.display_name;
        `;
        // Note: DISTINCT ON requires ORDER BY to start with the DISTINCT columns.
        // We modify ORDER BY to ensure valid SQL.
        const distinctQuery = `
            SELECT DISTINCT ON (cp.display_name, cp.card_id)
                cp.*,
                ppv.points,
                t.team_id as owned_by_team_id,
                t.logo_url as owned_by_team_logo,
                t.name as owned_by_team_name,
                t.city as owned_by_team_city
            FROM cards_player cp
            LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $1
            LEFT JOIN roster_cards rc ON cp.card_id = rc.card_id
            LEFT JOIN rosters r ON rc.roster_id = r.roster_id AND r.roster_type = 'league'
            LEFT JOIN users u ON r.user_id = u.user_id
            LEFT JOIN teams t ON u.team_id = t.team_id
            ORDER BY cp.display_name, cp.card_id, t.team_id;
        `;

        const allCardsResult = await pool.query(distinctQuery, [point_set_id]);
        const processedCards = processPlayers(allCardsResult.rows);
        res.json(processedCards);
    } catch (error) {
        console.error('Error fetching player cards with points:', error);
        res.status(500).json({ message: 'Server error fetching player cards.' });
    }
});

// GET A PLAYER'S LEAGUE HISTORY (season-by-season usage + honors)
app.get('/api/players/:cardId/league-history', authenticateToken, async (req, res) => {
    const cardId = parseInt(req.params.cardId, 10);
    if (!Number.isInteger(cardId)) {
        return res.status(400).json({ message: 'Invalid card id.' });
    }

    // Normalize a name for fuzzy award matching: lowercase, drop any "(TEAM)"
    // suffixes, collapse whitespace.
    const normName = (n) => (n || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    try {
        const cardRes = await pool.query(
            'SELECT card_id, name, display_name FROM cards_player WHERE card_id = $1',
            [cardId]
        );
        if (cardRes.rows.length === 0) {
            return res.status(404).json({ message: 'Card not found.' });
        }
        const cardKey = normName(cardRes.rows[0].name);

        const [historyRes, seriesRes, teamsRes] = await Promise.all([
            pool.query('SELECT season, team_name, position FROM historical_rosters WHERE card_id = $1', [cardId]),
            pool.query(`SELECT season_name, round, style, winning_team_id, losing_team_id,
                               winning_team_name, losing_team_name, winning_score, losing_score,
                               mva, lvsc, tgaoot, date
                        FROM series_results`),
            pool.query('SELECT * FROM teams')
        ]);
        const currentTeams = teamsRes.rows;
        const series = seriesRes.rows;
        const { findTeamForRecord } = require('./utils/standingsUtils');

        const LEAGUE_DIAMONDS = ['Golden Spaceship', 'Wooden Spoon'];
        const isPhantom = (n) => (n || '').includes('Phantoms');

        // Resolve any historical team name to its current franchise identity (handles
        // renames/aliases like San Diego→Boston, Fargo/NY South→Los Angeles), cached.
        const fCache = {};
        const fInfo = (name, id) => {
            const ck = `${name || ''}|${id || ''}`;
            if (fCache[ck]) return fCache[ck];
            const t = findTeamForRecord(name, id, currentTeams);
            return (fCache[ck] = { key: t.team_id ? `ID-${t.team_id}` : `NAME-${(t.name || '').trim()}`, name: t.name });
        };

        // Per-season, per-franchise W-L + era name, kept separately for league play and
        // the Classic (a parallel competition); plus which franchise took each diamond.
        const leagueFr = {};
        const classicFr = {};
        const seasonDiamond = {};   // league: { spaceship, spoon }
        const classicDiamond = {};  // { submarine }
        const seasonDate = {};
        const frEnsure = (store, season, key) => {
            if (!store[season]) store[season] = {};
            if (!store[season][key]) store[season][key] = { wins: 0, losses: 0, eraName: null };
            return store[season][key];
        };
        series.forEach(r => {
            if (r.date && (!seasonDate[r.season_name] || new Date(r.date) < new Date(seasonDate[r.season_name]))) {
                seasonDate[r.season_name] = r.date;
            }
            const isClassic = r.style === 'Classic';
            const store = isClassic ? classicFr : leagueFr;
            const w = fInfo(r.winning_team_name, r.winning_team_id);
            const l = fInfo(r.losing_team_name, r.losing_team_id);
            // Era name — prefer the plain Regular Season name for league play.
            if (!isPhantom(w.name)) {
                const fr = frEnsure(store, r.season_name, w.key);
                if (r.round === 'Regular Season' || !fr.eraName) fr.eraName = r.winning_team_name;
            }
            if (!isPhantom(l.name)) {
                const fr = frEnsure(store, r.season_name, l.key);
                if (r.round === 'Regular Season' || !fr.eraName) fr.eraName = r.losing_team_name;
            }
            // W-L over every completed series, including Golden Spaceship / Wooden Spoon
            // (league) and the Silver Submarine (Classic). Phantom-loss games (a forfeit
            // recorded vs "Phantoms") are excluded entirely — they don't count toward a
            // player's record on the card back.
            if (r.winning_score != null && !isPhantom(w.name) && !isPhantom(l.name)) {
                const wf = frEnsure(store, r.season_name, w.key); wf.wins += r.winning_score || 0; wf.losses += r.losing_score || 0;
                const lf = frEnsure(store, r.season_name, l.key); lf.losses += r.winning_score || 0; lf.wins += r.losing_score || 0;
            }
            // Diamonds — Golden Spaceship/Wooden Spoon are league; Silver Submarine is the Classic.
            if (r.round === 'Golden Spaceship') (seasonDiamond[r.season_name] = seasonDiamond[r.season_name] || {}).spaceship = w.key;
            else if (r.round === 'Wooden Spoon') (seasonDiamond[r.season_name] = seasonDiamond[r.season_name] || {}).spoon = l.key; // loser earns it
            else if (r.round === 'Silver Submarine') (classicDiamond[r.season_name] = classicDiamond[r.season_name] || {}).submarine = w.key;
        });

        // Player's league seasons (roster history) and Classic seasons.
        const seasons = {};
        const classicSeasons = {};
        const ensure = (name) => {
            if (!seasons[name]) {
                seasons[name] = {
                    season: name, franchises: [], positions: new Set(),
                    spaceship: false, spoon: false, mva: false, lvsc: false, tgaoot: false
                };
            }
            return seasons[name];
        };
        const ensureC = (name) => {
            if (!classicSeasons[name]) {
                classicSeasons[name] = { season: name, franchises: [], positions: new Set(), submarine: false, mva: false, lvsc: false, tgaoot: false };
            }
            return classicSeasons[name];
        };

        historyRes.rows.forEach(r => {
            const s = ensure(r.season);
            const fk = fInfo(r.team_name, null).key;
            if (!s.franchises.some(f => f.key === fk)) s.franchises.push({ key: fk, histName: r.team_name });
            if (r.position) s.positions.add(r.position);
        });

        // League diamonds for the player's franchise(s).
        Object.values(seasons).forEach(s => {
            const sd = seasonDiamond[s.season] || {};
            s.franchises.forEach(f => {
                if (sd.spaceship === f.key) s.spaceship = true;
                if (sd.spoon === f.key) s.spoon = true;
            });
        });

        // Classic participation comes from the Classic's own drafted rosters (a player
        // is often drafted onto a different team than his league club), not the league
        // roster. Map each classic the player was drafted into to its owning franchise.
        let classicRosterRows = [];
        const classicIdToSeason = {};
        try {
            classicRosterRows = (await pool.query(
                `SELECT r.classic_id, r.user_id, rc.assignment, cp.control, cp.ip
                 FROM rosters r
                 JOIN roster_cards rc ON r.roster_id = rc.roster_id
                 JOIN cards_player cp ON rc.card_id = cp.card_id
                 WHERE r.roster_type = 'classic' AND rc.card_id = $1`,
                [cardId]
            )).rows;
            const mapRows = (await pool.query(
                `SELECT DISTINCT s.classic_id, sr.season_name
                 FROM series_results sr
                 JOIN teams wt ON wt.team_id = sr.winning_team_id
                 JOIN teams lt ON lt.team_id = sr.losing_team_id
                 JOIN series s ON s.series_type = 'classic'
                     AND ((s.series_home_user_id = wt.user_id AND s.series_away_user_id = lt.user_id)
                       OR (s.series_home_user_id = lt.user_id AND s.series_away_user_id = wt.user_id))
                 WHERE sr.style = 'Classic' AND s.classic_id IS NOT NULL`
            )).rows;
            mapRows.forEach(m => { classicIdToSeason[m.classic_id] = m.season_name; });
        } catch (_) { /* series/classics tables may be absent in some environments */ }

        const userToTeam = {};
        currentTeams.forEach(t => { if (t.user_id != null) userToTeam[t.user_id] = t; });
        classicRosterRows.forEach(cr => {
            const season = classicIdToSeason[cr.classic_id];
            const ownerTeam = userToTeam[cr.user_id];
            if (!season || !ownerTeam) return;
            const fk = `ID-${ownerTeam.team_id}`;
            const c = ensureC(season);
            if (!c.franchises.some(x => x.key === fk)) c.franchises.push({ key: fk, histName: `${ownerTeam.city} ${ownerTeam.name}`, abbr: ownerTeam.abbreviation });
            // Position: derive SP/RP from the card for pitchers, else the drafted assignment.
            let pos = cr.assignment;
            if (cr.control !== null && cr.control !== undefined) pos = Number(cr.ip) > 3 ? 'SP' : 'RP';
            if (pos && pos !== 'PITCHING_STAFF') c.positions.add(pos);
            if ((classicDiamond[season] || {}).submarine === fk) c.submarine = true;
        });

        // Personal honors — attributed to the league or the Classic by where they were won.
        series.forEach(r => {
            const tgt = r.style === 'Classic' ? ensureC : ensure;
            if (r.mva && normName(r.mva) === cardKey) tgt(r.season_name).mva = true;
            if (r.lvsc && normName(r.lvsc) === cardKey) tgt(r.season_name).lvsc = true;
            if (r.tgaoot && normName(r.tgaoot) === cardKey) tgt(r.season_name).tgaoot = true;
        });

        // Per-season point value: the card's price in the point set that season used
        // (matches how the League tab prices historical rosters).
        const { mapSeasonToPointSet } = require('./utils/seasonUtils');
        const seasonPsName = {};
        Object.keys(seasons).forEach(s => { seasonPsName[s] = mapSeasonToPointSet(s); });
        const psNames = [...new Set(Object.values(seasonPsName))];
        let seasonPoints = () => null;
        if (psNames.length) {
            const psRows = (await pool.query(
                'SELECT point_set_id, name FROM point_sets WHERE name = ANY($1)', [psNames]
            )).rows;
            const psNameToId = {};
            psRows.forEach(r => { psNameToId[r.name] = r.point_set_id; });
            const psIds = psRows.map(r => r.point_set_id);
            const ppvByPs = {};
            if (psIds.length) {
                const ppvRows = (await pool.query(
                    'SELECT point_set_id, points FROM player_point_values WHERE card_id = $1 AND point_set_id = ANY($2)',
                    [cardId, psIds]
                )).rows;
                ppvRows.forEach(r => { ppvByPs[r.point_set_id] = r.points; });
            }
            seasonPoints = (season) => {
                const id = psNameToId[seasonPsName[season]];
                return id != null && ppvByPs[id] != null ? ppvByPs[id] : null;
            };
        }

        // Era-correct short code for a team name (single word -> first 3 letters,
        // multi-word -> initials, keeping all-caps tokens like "NY").
        const abbrevTeam = (name) => {
            if (!name) return '';
            // Known era-name abbreviations that don't follow the initials rule.
            const SPECIAL = { 'Redwood City': 'RDC' };
            for (const key in SPECIAL) if (name.includes(key)) return SPECIAL[key];
            const words = name.trim().split(/\s+/);
            if (words.length === 1) {
                const w0 = words[0];
                return (/^[A-Z]{2,}$/.test(w0) ? w0 : w0.slice(0, 3)).toUpperCase().slice(0, 4);
            }
            return words.map(w => /^[A-Z]{2,}$/.test(w) ? w : (w[0] || '')).join('').toUpperCase().slice(0, 4);
        };

        const byDateDesc = (a, b) => {
            const da = seasonDate[a.season] ? new Date(seasonDate[a.season]).getTime() : -Infinity;
            const db = seasonDate[b.season] ? new Date(seasonDate[b.season]).getTime() : -Infinity;
            return db - da;
        };

        // Logo for a franchise in a given era — handles deprecated era logos
        // (Lugnuts, Catastrophe, Phantoms) and falls back to the current club logo.
        const { getLogoForTeam } = require('./utils/franchiseUtils');
        const teamById = {};
        currentTeams.forEach(t => { teamById[t.team_id] = t; });
        const logoForFranchise = (fk, eraName) => {
            let def = null;
            if (fk && fk.startsWith('ID-')) { const t = teamById[parseInt(fk.slice(3), 10)]; if (t) def = t.logo_url; }
            return getLogoForTeam(eraName, def);
        };

        // One row per (season, franchise): a player on multiple clubs in a season gets
        // multiple rows rather than a slash-joined one.
        const seasonList = Object.values(seasons)
            .flatMap(s => {
                const sd = seasonDiamond[s.season] || {};
                const single = s.franchises.length === 1;
                return s.franchises.map(f => {
                    const eraName = leagueFr[s.season]?.[f.key]?.eraName || f.histName;
                    const fr = leagueFr[s.season]?.[f.key];
                    const spaceship = sd.spaceship === f.key;
                    const spoon = sd.spoon === f.key;
                    return {
                        season: s.season,
                        team: eraName,
                        team_abbr: abbrevTeam(eraName),
                        logo: logoForFranchise(f.key, eraName),
                        position: [...s.positions].join(', '),
                        points: seasonPoints(s.season),
                        wins: fr ? fr.wins : null,
                        losses: fr ? fr.losses : null,
                        spaceship, spoon,
                        mva: s.mva && (single || spaceship),
                        lvsc: s.lvsc && (single || spoon),
                        tgaoot: s.tgaoot && (single || spaceship)
                    };
                });
            })
            .sort(byDateDesc);

        const classicList = Object.values(classicSeasons)
            .flatMap(c => {
                const cd = classicDiamond[c.season] || {};
                return c.franchises.map(f => {
                    const eraName = classicFr[c.season]?.[f.key]?.eraName || f.histName;
                    const fr = classicFr[c.season]?.[f.key];
                    return {
                        season: c.season,
                        team: eraName,
                        // A Classic team is a current franchise — use its real abbreviation (BOS, LA…).
                        team_abbr: f.abbr || abbrevTeam(eraName),
                        logo: logoForFranchise(f.key, eraName),
                        position: [...c.positions].join(', '),
                        wins: fr ? fr.wins : null,
                        losses: fr ? fr.losses : null,
                        submarine: cd.submarine === f.key,
                        mva: c.mva, lvsc: c.lvsc, tgaoot: c.tgaoot
                    };
                });
            })
            .sort(byDateDesc);

        const count = (arr, key) => arr.reduce((n, x) => n + (x[key] ? 1 : 0), 0);
        const totals = {
            spaceships: count(seasonList, 'spaceship'),
            spoons: count(seasonList, 'spoon'),
            submarines: count(classicList, 'submarine'),
            mvas: count(seasonList, 'mva') + count(classicList, 'mva'),
            lvscs: count(seasonList, 'lvsc') + count(classicList, 'lvsc'),
            tgaoots: count(seasonList, 'tgaoot') + count(classicList, 'tgaoot'),
            wins: seasonList.reduce((n, s) => n + (s.wins || 0), 0),
            losses: seasonList.reduce((n, s) => n + (s.losses || 0), 0)
        };

        res.json({ card_id: cardId, seasons: seasonList, classic: classicList, totals });
    } catch (error) {
        console.error('Error fetching player league history:', error);
        res.status(500).json({ message: 'Server error fetching league history.' });
    }
});

// GET AGGREGATE LEAGUE STATS FOR EVERY PLAYER (career trophies, W-L, seasons per franchise)
app.get('/api/players/league-stats', authenticateToken, async (req, res) => {
    const normName = (n) => (n || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    try {
        const [seriesRes, teamsRes, histRes, cardsRes] = await Promise.all([
            pool.query(`SELECT season_name, round, style, winning_team_id, losing_team_id,
                               winning_team_name, losing_team_name, winning_score, losing_score, mva, lvsc, tgaoot
                        FROM series_results`),
            pool.query('SELECT * FROM teams'),
            pool.query('SELECT card_id, season, team_name FROM historical_rosters'),
            pool.query('SELECT card_id, name FROM cards_player')
        ]);
        const currentTeams = teamsRes.rows;
        const series = seriesRes.rows;
        const { findTeamForRecord } = require('./utils/standingsUtils');
        const isPhantom = (n) => (n || '').includes('Phantoms');
        const LEAGUE_DIAMONDS = ['Golden Spaceship', 'Wooden Spoon'];

        const fCache = {};
        const fInfo = (name, id) => {
            const ck = `${name || ''}|${id || ''}`;
            if (fCache[ck]) return fCache[ck];
            const t = findTeamForRecord(name, id, currentTeams);
            return (fCache[ck] = { key: t.team_id ? `ID-${t.team_id}` : `NAME-${(t.name || '').trim()}`, name: t.name });
        };

        // Per-season franchise regular-season W-L (league only) and diamond winners.
        const leagueFr = {};
        const seasonDiamond = {};
        const classicDiamond = {};
        series.forEach(r => {
            const isClassic = r.style === 'Classic';
            const w = fInfo(r.winning_team_name, r.winning_team_id);
            const l = fInfo(r.losing_team_name, r.losing_team_id);
            if (!isClassic && r.winning_score != null) {
                if (!isPhantom(w.name)) { (leagueFr[r.season_name] = leagueFr[r.season_name] || {}); const fr = (leagueFr[r.season_name][w.key] = leagueFr[r.season_name][w.key] || { wins: 0, losses: 0 }); fr.wins += r.winning_score || 0; fr.losses += r.losing_score || 0; }
                if (!isPhantom(l.name)) { (leagueFr[r.season_name] = leagueFr[r.season_name] || {}); const fr = (leagueFr[r.season_name][l.key] = leagueFr[r.season_name][l.key] || { wins: 0, losses: 0 }); fr.losses += r.winning_score || 0; fr.wins += r.losing_score || 0; }
            }
            if (r.round === 'Golden Spaceship') (seasonDiamond[r.season_name] = seasonDiamond[r.season_name] || {}).spaceship = w.key;
            else if (r.round === 'Wooden Spoon') (seasonDiamond[r.season_name] = seasonDiamond[r.season_name] || {}).spoon = l.key;
            else if (r.round === 'Silver Submarine') (classicDiamond[r.season_name] = classicDiamond[r.season_name] || {}).submarine = w.key;
        });

        const nameToCards = {};
        cardsRes.rows.forEach(c => { const k = normName(c.name); (nameToCards[k] = nameToCards[k] || []).push(c.card_id); });

        const stats = {};
        const ensureStat = (cid) => {
            if (!stats[cid]) stats[cid] = { wins: 0, losses: 0, spaceships: 0, submarines: 0, spoons: 0, mvas: 0, lvscs: 0, tgaoots: 0, seasonsByTeam: {}, totalSeasons: 0 };
            return stats[cid];
        };

        // Group a card's roster history by season; use the primary (first) franchise per season.
        const histByCard = {};
        histRes.rows.forEach(r => { (histByCard[r.card_id] = histByCard[r.card_id] || []).push(r); });
        for (const cid in histByCard) {
            const seasonKeys = {};
            histByCard[cid].forEach(r => {
                const fk = fInfo(r.team_name, null).key;
                (seasonKeys[r.season] = seasonKeys[r.season] || new Set()).add(fk);
            });
            const st = ensureStat(cid);
            for (const season in seasonKeys) {
                st.totalSeasons++;
                const keys = seasonKeys[season];
                keys.forEach(k => {
                    if (k.startsWith('ID-')) { const tid = k.slice(3); st.seasonsByTeam[tid] = (st.seasonsByTeam[tid] || 0) + 1; }
                    const fr = leagueFr[season] && leagueFr[season][k];
                    if (fr) { st.wins += fr.wins; st.losses += fr.losses; }
                });
                const sd = seasonDiamond[season] || {};
                if (sd.spaceship && keys.has(sd.spaceship)) st.spaceships++;
                if (sd.spoon && keys.has(sd.spoon)) st.spoons++;
            }
        }

        // Silver Submarine is a Classic honor — credited via the Classic's drafted
        // rosters (the team that drafted the player), not the league roster.
        try {
            const mapRows = (await pool.query(
                `SELECT DISTINCT s.classic_id, sr.season_name
                 FROM series_results sr
                 JOIN teams wt ON wt.team_id = sr.winning_team_id
                 JOIN teams lt ON lt.team_id = sr.losing_team_id
                 JOIN series s ON s.series_type = 'classic'
                     AND ((s.series_home_user_id = wt.user_id AND s.series_away_user_id = lt.user_id)
                       OR (s.series_home_user_id = lt.user_id AND s.series_away_user_id = wt.user_id))
                 WHERE sr.style = 'Classic' AND s.classic_id IS NOT NULL`
            )).rows;
            const classicIdToSeason = {};
            mapRows.forEach(m => { classicIdToSeason[m.classic_id] = m.season_name; });
            const userToTeam = {};
            currentTeams.forEach(t => { if (t.user_id != null) userToTeam[t.user_id] = t; });
            const classicRosterRows = (await pool.query(
                `SELECT r.classic_id, r.user_id, rc.card_id
                 FROM rosters r JOIN roster_cards rc ON r.roster_id = rc.roster_id
                 WHERE r.roster_type = 'classic'`
            )).rows;
            classicRosterRows.forEach(cr => {
                const season = classicIdToSeason[cr.classic_id];
                const ownerTeam = userToTeam[cr.user_id];
                if (!season || !ownerTeam) return;
                if ((classicDiamond[season] || {}).submarine === `ID-${ownerTeam.team_id}`) ensureStat(cr.card_id).submarines++;
            });
        } catch (_) { /* series/classics tables may be absent in some environments */ }

        // Name-based awards.
        series.forEach(r => {
            [['mvas', r.mva], ['lvscs', r.lvsc], ['tgaoots', r.tgaoot]].forEach(([key, val]) => {
                if (!val) return;
                (nameToCards[normName(val)] || []).forEach(cid => { ensureStat(cid)[key]++; });
            });
        });

        const franchises = currentTeams
            .filter(t => t.abbreviation)
            .map(t => ({ team_id: t.team_id, abbr: t.abbreviation, city: t.city }))
            .sort((a, b) => a.city.localeCompare(b.city));

        res.json({ franchises, stats });
    } catch (error) {
        console.error('Error fetching league stats:', error);
        res.status(500).json({ message: 'Server error fetching league stats.' });
    }
});

// GET LEAGUE ROSTERS
app.get('/api/league', authenticateToken, async (req, res) => {
    const { point_set_id } = req.query;
    if (!point_set_id) {
        return res.status(400).json({ message: 'A point_set_id is required.' });
    }

    try {
        const query = `
            SELECT
                t.team_id, t.city, t.name as team_name, t.logo_url, t.display_format,
                u.owner_first_name, u.owner_last_name,
                cp.*,
                rc.assignment, rc.is_starter,
                ppv.points
            FROM teams t
            JOIN users u ON t.user_id = u.user_id
            JOIN rosters r ON u.user_id = r.user_id AND r.roster_type = 'league'
            JOIN roster_cards rc ON r.roster_id = rc.roster_id
            JOIN cards_player cp ON rc.card_id = cp.card_id
            LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $1
            ORDER BY t.city, t.name, rc.is_starter DESC, cp.display_name
        `;
        const result = await pool.query(query, [point_set_id]);

        // Group by team
        const teamsMap = {};
        result.rows.forEach(row => {
             if (!teamsMap[row.team_id]) {
                 const format = row.display_format || '{city} {name}';
                 teamsMap[row.team_id] = {
                     team_id: row.team_id,
                     city: row.city,
                     name: row.team_name,
                     logo_url: row.logo_url,
                     owner: `${row.owner_first_name} ${row.owner_last_name}`,
                     full_display_name: format.replace('{city}', row.city).replace('{name}', row.team_name),
                     roster: []
                 };
             }
             // Process player
             const player = { ...row };
             // Cleanup team properties from player object
             delete player.team_id;
             delete player.city;
             delete player.team_name;
             delete player.logo_url;
             delete player.display_format;
             delete player.owner_first_name;
             delete player.owner_last_name;

             teamsMap[row.team_id].roster.push(player);
        });

        // Process players for each team
        const positionOrder = {
            'SP': 1, 'RP': 2, 'C': 3, '1B': 4, '2B': 5, 'SS': 6, '3B': 7,
            'LF': 8, 'CF': 9, 'RF': 10, 'DH': 11, 'B': 12
        };

        const leagueData = Object.values(teamsMap).map(team => {
            team.roster = processPlayers(team.roster);

            // Apply transformations and sorting
            team.roster.forEach(p => {
                if (p.assignment === 'BENCH') {
                    p.assignment = 'B';
                    if (p.points) p.points = Math.round(p.points / 5);
                }
            });

            team.roster.sort((a, b) => {
                const getSortPos = (p) => {
                    if (p.assignment === 'B') return 'B';
                    if (p.assignment === 'PITCHING_STAFF') {
                        return p.displayPosition; // SP or RP
                    }
                    return p.assignment || p.displayPosition;
                };

                const posA = getSortPos(a);
                const posB = getSortPos(b);

                const rankA = positionOrder[posA] || 99;
                const rankB = positionOrder[posB] || 99;

                if (rankA !== rankB) {
                    return rankA - rankB;
                }

                return (b.points || 0) - (a.points || 0);
            });

            return team;
        });

        res.json(leagueData);
    } catch (error) {
        console.error('Error fetching league data:', error);
        res.status(500).json({ message: 'Server error fetching league data.' });
    }
});

// GAME SETUP & PLAY
app.post('/api/games', authenticateToken, async (req, res) => {
    // series_result_id (optional): launch a scheduled series from the league schedule. When present the
    // series_type is derived from the scheduled row's round, the new series is linked back to that row
    // (so results auto-populate the standings), and the launcher's team must be one of the two matched
    // up. Without it this behaves as before: an ad-hoc exhibition/series game.
    const { roster_id, home_or_away, league_designation, series_type, series_result_id } = req.body;
    const userId = req.user.userId;
    if (!roster_id || !home_or_away || !league_designation || (!series_type && !series_result_id)) {
        return res.status(400).json({ message: 'roster_id, home_or_away, league_designation, and series_type (or series_result_id) are required.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let gameId;

        if (series_result_id) {
            // Lock the scheduled row so two owners can't both launch the same matchup at once.
            const schedRes = await client.query(
                `SELECT id, round, style, status, winning_team_id, losing_team_id
                 FROM series_results WHERE id = $1 FOR UPDATE`,
                [series_result_id]
            );
            if (schedRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Scheduled series not found.' });
            }
            const sched = schedRes.rows[0];

            // The launcher must be one of the two teams in this scheduled matchup.
            const teamRes = await client.query('SELECT team_id FROM users WHERE user_id = $1', [userId]);
            const myTeamId = teamRes.rows[0] && teamRes.rows[0].team_id;
            if (myTeamId !== sched.winning_team_id && myTeamId !== sched.losing_team_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: 'Your team is not part of this scheduled series.' });
            }

            // Don't launch twice: if a live series is already linked, send the caller to it.
            const existing = await client.query('SELECT id FROM series WHERE series_result_id = $1 LIMIT 1', [series_result_id]);
            if (existing.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: 'This series has already been started.', seriesId: existing.rows[0].id });
            }

            const derivedType = seriesTypeForRound(sched.round, sched.style);
            const newSeries = await client.query(
                `INSERT INTO series (series_type, series_home_user_id, series_result_id) VALUES ($1, $2, $3) RETURNING id`,
                [derivedType, userId, series_result_id]
            );
            const seriesId = newSeries.rows[0].id;

            const newGame = await client.query(
                `INSERT INTO games (status, series_id, game_in_series) VALUES ('pending', $1, 1) RETURNING game_id`,
                [seriesId]
            );
            gameId = newGame.rows[0].game_id;
        } else if (series_type !== 'exhibition') {
            const newSeries = await client.query(
                `INSERT INTO series (series_type, series_home_user_id) VALUES ($1, $2) RETURNING id`,
                [series_type, userId] // The creator is the series home user
            );
            const seriesId = newSeries.rows[0].id;

            const newGame = await client.query(
                `INSERT INTO games (status, series_id, game_in_series) VALUES ('pending', $1, 1) RETURNING game_id`,
                [seriesId]
            );
            gameId = newGame.rows[0].game_id;
        } else {
            const newGame = await client.query(`INSERT INTO games (status) VALUES ('pending') RETURNING game_id`);
            gameId = newGame.rows[0].game_id;
        }

        await client.query(`INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, roster_id, home_or_away, league_designation]);

        await client.query('COMMIT');
        io.emit('games-updated');
        res.status(201).json({ message: 'Game created and waiting for an opponent.', gameId: gameId });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Game creation error:', error);
        res.status(500).json({ message: 'Server error during game creation.' });
    } finally {
        client.release();
    }
});

// SET UP GAME DETAILS (HOME TEAM, DH RULE)
app.post('/api/games/:gameId/setup', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { homeTeamUserId, useDh } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`3. Backend: Received request for /api/games/${gameId}/setup.`);

    // 1. Update the main game record
    await client.query(
      `UPDATE games SET home_team_user_id = $1, use_dh = $2, status = 'lineups' WHERE game_id = $3`,
      [homeTeamUserId, useDh, gameId]
    );

    // 2. Synchronize the game_participants table
    // Set the declared home team user to 'home'
    await client.query(
        `UPDATE game_participants SET home_or_away = 'home' WHERE game_id = $1 AND user_id = $2`,
        [gameId, homeTeamUserId]
    );
    // Set the other user (who is NOT the home team user) to 'away'
    await client.query(
        `UPDATE game_participants SET home_or_away = 'away' WHERE game_id = $1 AND user_id != $2`,
        [gameId, homeTeamUserId]
    );

    await client.query('COMMIT');

    console.log(`4. Backend: Emitting 'setup-complete' to room ${gameId}.`);
    io.emit('games-updated'); // This is the global signal for all dashboards.
    io.to(gameId).emit('setup-complete'); // This is the specific signal for the two players in this game.
    
    res.status(200).json({ message: 'Game setup complete.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in game setup:', error);
    res.status(500).json({ message: 'Server error during game setup.' });
  } finally {
    client.release();
  }
});

// in server.js
app.get('/api/games/:gameId/setup', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  try {
    // 1. Get game info, including the declared home team
    const gameQuery = await pool.query(
      'SELECT setup_rolls, home_team_user_id, use_dh, status FROM games WHERE game_id = $1',
      [gameId]
    );

    // 2. Get participant info, including team branding
    const participantsQuery = await pool.query(
      `SELECT u.user_id, t.city, t.name, t.logo_url, t.display_format, gp.roster_id
       FROM users u
       JOIN teams t ON u.team_id = t.team_id
       JOIN game_participants gp ON u.user_id = gp.user_id
       WHERE gp.game_id = $1`,
      [gameId]
    );
    
    // 3. Process participants to create the full display name and fetch DH cards
    const participants = await Promise.all(participantsQuery.rows.map(async p => {
        const format = p.display_format || '{city} {name}'; // Use default if null
        p.full_display_name = format.replace('{city}', p.city).replace('{name}', p.name);

        // Fetch the assigned DH card
        if (p.roster_id) {
            const dhCardResult = await pool.query(`
                SELECT cp.*
                FROM cards_player cp
                JOIN roster_cards rc ON cp.card_id = rc.card_id
                WHERE rc.roster_id = $1 AND rc.assignment = 'DH'
            `, [p.roster_id]);

            p.dhCards = processPlayers(dhCardResult.rows);
        } else {
            p.dhCards = [];
        }

        return p;
    }));

    // 4. Send the complete payload to the frontend
    res.json({
        rolls: gameQuery.rows[0]?.setup_rolls || {},
        homeTeamUserId: gameQuery.rows[0]?.home_team_user_id || null,
        useDh: gameQuery.rows[0]?.use_dh,
        status: gameQuery.rows[0]?.status,
        participants: participants
    });

  } catch (error) {
    console.error(`Error fetching setup for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error fetching setup data.' });
  }
});

// ROLL FOR HOME TEAM CHOICE
app.post('/api/games/:gameId/roll', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.userId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const gameQuery = await client.query('SELECT setup_rolls FROM games WHERE game_id = $1', [gameId]);
    let rolls = gameQuery.rows[0].setup_rolls || {};

    // Generate and store the roll if the user hasn't rolled yet
    if (!rolls[userId]) {
        rolls[userId] = Math.floor(Math.random() * 20) + 1;
    }

    await client.query('UPDATE games SET setup_rolls = $1 WHERE game_id = $2', [rolls, gameId]);
    await client.query('COMMIT');

    // Notify the room that the setup state has changed
    io.to(gameId).emit('roll-updated');
    res.sendStatus(200);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during roll:', error);
    res.status(500).json({ message: 'Server error during roll.' });
  } finally {
    client.release();
  }
});

app.post('/api/games/:gameId/declare-home', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { homeTeamUserId } = req.body;
  try {
    // THIS IS THE FIX: Save the choice to the database to make it persistent.
    await pool.query(
      `UPDATE games SET home_team_user_id = $1 WHERE game_id = $2`,
      [homeTeamUserId, gameId]
    );
    
    // Notify any other player who is currently on the page
    io.to(gameId).emit('choice-updated', { homeTeamUserId });
    res.sendStatus(200);
  } catch (error) {
    console.error('Error declaring home team:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

app.post('/api/games/:gameId/join', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { roster_id } = req.body;
    const joiningUserId = req.user.userId;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const gameResult = await client.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
        if (gameResult.rows.length === 0) return res.status(404).json({ message: 'Game not found.' });
        if (gameResult.rows[0].status !== 'pending') return res.status(400).json({ message: 'This game is not available to join.' });
        
        // --- VALIDATION: Ensure rosters are compatible ---
        // Fetch host's roster type
        const participantsResult = await client.query(`
            SELECT gp.*, r.roster_type
            FROM game_participants gp
            JOIN rosters r ON gp.roster_id = r.roster_id
            WHERE gp.game_id = $1
        `, [gameId]);
        
        if (participantsResult.rows.length >= 2) return res.status(400).json({ message: 'This game is already full.' });
        if (participantsResult.rows[0].user_id === joiningUserId) return res.status(400).json({ message: 'You cannot join your own game.' });
        
        const hostPlayerParticipant = participantsResult.rows[0];
        const hostRosterType = hostPlayerParticipant.roster_type;

        // Fetch joining player's roster type
        const joiningRosterResult = await client.query('SELECT roster_type FROM rosters WHERE roster_id = $1', [roster_id]);
        if (joiningRosterResult.rows.length === 0) {
             await client.query('ROLLBACK');
             return res.status(400).json({ message: 'Invalid roster provided.' });
        }
        const joiningRosterType = joiningRosterResult.rows[0].roster_type;

        if (hostRosterType !== joiningRosterType) {
             await client.query('ROLLBACK');
             return res.status(400).json({ message: `Cannot join a ${hostRosterType} game with a ${joiningRosterType} roster.` });
        }
        // -------------------------------------------------

        const joiningPlayerHomeOrAway = hostPlayerParticipant.home_or_away === 'home' ? 'away' : 'home';
        const joiningPlayerLeague = hostPlayerParticipant.league_designation === 'AL' ? 'NL' : 'AL';

        await client.query(`INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation) VALUES ($1, $2, $3, $4, $5)`, [gameId, joiningUserId, roster_id, joiningPlayerHomeOrAway, joiningPlayerLeague]);
        
        await client.query('COMMIT');
        io.emit('games-updated');
        res.json({ message: 'Successfully joined game.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Game join error:', error);
        res.status(500).json({ message: 'Server error while joining game.' });
    } finally {
        client.release();
    }
});

// HIDE GAME (Soft Delete)
app.post('/api/games/:gameId/hide', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const userId = req.user.userId;
    try {
        await pool.query(
            `UPDATE game_participants SET is_hidden = true WHERE game_id = $1 AND user_id = $2`,
            [gameId, userId]
        );
        res.json({ message: 'Game hidden successfully.' });
    } catch (error) {
        console.error('Error hiding game:', error);
        res.status(500).json({ message: 'Server error while hiding game.' });
    }
});

// --- NEW REUSABLE FUNCTION ---
async function getAndProcessGameData(gameId, dbClient) {
  const allCardsResult = await dbClient.query('SELECT name, team FROM cards_player');
  const gameResult = await dbClient.query('SELECT * FROM games WHERE game_id = $1', [gameId]);
  if (gameResult.rows.length === 0) {
    return null; // Game not found
  }
  const game = gameResult.rows[0];
  let series = null;
  if (game.series_id) {
      const seriesResult = await dbClient.query('SELECT * FROM series WHERE id = $1', [game.series_id]);
      series = seriesResult.rows[0];

      // Re-calculate historical series score up to this game
      if (series && game.status === 'completed') {
          try {
              const prevGamesResult = await dbClient.query(`
                  SELECT g.game_id, g.home_team_user_id,
                         (SELECT state_data->>'winningTeam' FROM game_states gs WHERE gs.game_id = g.game_id ORDER BY turn_number DESC LIMIT 1) as winning_team,
                         (SELECT user_id FROM game_participants gp WHERE gp.game_id = g.game_id AND gp.user_id != g.home_team_user_id LIMIT 1) as away_team_user_id
                  FROM games g
                  WHERE g.series_id = $1 AND g.game_in_series <= $2 AND g.status = 'completed'
              `, [game.series_id, game.game_in_series]);

              let histHomeWins = 0;
              let histAwayWins = 0;

              for (const row of prevGamesResult.rows) {
                  const winnerId = row.winning_team === 'home' ? row.home_team_user_id : row.away_team_user_id;
                  if (winnerId === series.series_home_user_id) {
                      histHomeWins++;
                  } else {
                      histAwayWins++;
                  }
              }

              series.historical_home_wins = histHomeWins;
              series.historical_away_wins = histAwayWins;
          } catch (e) {
              console.error("Error calculating historical series score:", e);
          }
      }
  }

  let nextGameId = null;
  if (game.series_id && game.status === 'completed') {
      const nextGameResult = await dbClient.query('SELECT game_id FROM games WHERE series_id = $1 AND game_in_series = $2', [game.series_id, game.game_in_series + 1]);
      if (nextGameResult.rows.length > 0) {
          nextGameId = nextGameResult.rows[0].game_id;
      }
  }

  const participantsResult = await dbClient.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
  const teamsData = {};
  for (const p of participantsResult.rows) {
    const teamResult = await dbClient.query('SELECT * FROM teams WHERE user_id = $1', [p.user_id]);
    if (p.user_id === game.home_team_user_id) {
      teamsData.home = teamResult.rows[0];
    } else {
      teamsData.away = teamResult.rows[0];
    }
  }

  if (game.status === 'pending') {
    return { game, series, gameState: null, gameEvents: [], batter: null, pitcher: null, lineups: {}, rosters: {}, teams: teamsData, nextGameId };
  }

  const stateResult = await dbClient.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
  if (stateResult.rows.length === 0) {
    return { game, series, gameState: null, gameEvents: [], batter: null, pitcher: null, lineups: {}, rosters: {}, teams: teamsData };
  }
  const currentState = stateResult.rows[0];

  const eventsResult = await dbClient.query('SELECT * FROM game_events WHERE game_id = $1 ORDER BY "timestamp" ASC', [gameId]);
  let batter = null, pitcher = null, lineups = { home: null, away: null }, rosters = { home: [], away: [] };

  if (game.status === 'in_progress' || game.status === 'completed') {
    const activePlayers = await getActivePlayers(gameId, currentState.state_data);
    batter = activePlayers.batter;
    pitcher = activePlayers.pitcher;
    const homeParticipant = participantsResult.rows.find(p => p.user_id === game.home_team_user_id);
    const awayParticipant = participantsResult.rows.find(p => p.user_id !== game.home_team_user_id);

    for (const p of participantsResult.rows) {
      const rosterResult = await dbClient.query('SELECT roster_data FROM game_rosters WHERE game_id = $1 AND user_id = $2', [gameId, p.user_id]);
      let fullRosterCards = rosterResult.rows[0]?.roster_data || [];

      // --- RECOVERY: Check for missing assignments (Legacy Data Fix) ---
      fullRosterCards = await hydrateRosterAssignments(dbClient, fullRosterCards, p.roster_id);
      // --- END RECOVERY ---

      if (p.lineup?.battingOrder) {
        const lineupWithDetails = p.lineup.battingOrder.map(spot => {
            let playerCard;
            if (spot.card_id === -1) {
                playerCard = REPLACEMENT_HITTER_CARD;
            } else if (spot.card_id === -2) {
                playerCard = REPLACEMENT_PITCHER_CARD;
            } else {
                playerCard = fullRosterCards.find(c => c.card_id === spot.card_id);
            }
            return { ...spot, player: playerCard };
        });

        let spCard;
        const spId = p.lineup.startingPitcher;
        if (spId === -1) {
            spCard = REPLACEMENT_HITTER_CARD;
        } else if (spId === -2) {
            spCard = REPLACEMENT_PITCHER_CARD;
        } else {
            spCard = fullRosterCards.find(c => c.card_id === spId);
        }

        processPlayers(lineupWithDetails.map(l => l.player));
        processPlayers(fullRosterCards);
        if (spCard) processPlayers([spCard]);

        if (p.user_id === game.home_team_user_id) {
          lineups.home = { battingOrder: lineupWithDetails, startingPitcher: spCard };
          rosters.home = fullRosterCards;
        } else {
          lineups.away = { battingOrder: lineupWithDetails, startingPitcher: spCard };
          rosters.away = fullRosterCards;
        }
      }
    }
    if (batter) processPlayers([batter]);
    if (pitcher) {
        processPlayers([pitcher]);
        // Add effectiveControl to the active pitcher object
        const pitcherOwnerId = currentState.state_data.isTopInning ? currentState.state_data.homeTeam.userId : currentState.state_data.awayTeam.userId;
        pitcher.effectiveControl = getEffectiveControl(pitcher, currentState.state_data.pitcherStats, currentState.state_data.inning, pitcherOwnerId);
    }

    // Add fatigue status to all bullpen pitchers in the rosters
    const processRosterFatigue = (roster, pitcherStats, inning, teamUserId) => {
        if (!roster) return;
        roster.forEach(player => {
            // FIX: A reliever is identified by having a base IP of 3 or less.
            // The `player.ip > 0` check was preventing us from flagging relievers
            // who were tired from a previous game but hadn't pitched in this one.
            if (player.ip <= 3) { // It's a reliever
                const compositeKey = `${teamUserId}_${player.card_id}`;
                const stats = pitcherStats ? pitcherStats[compositeKey] : null;

                if (stats) {
                    if (stats.pitchedYesterday) player.pitchedYesterday = true;
                    if (stats.isBufferUsed) player.isBufferUsed = true;

                    // Calculate total penalty (incorporating pre-game and in-game).
                    // Bullpen pitchers are resting, so bank only innings actually thrown
                    // (no current-inning projection) — they shouldn't show fatigue for an
                    // inning they haven't committed to.
                    const effectiveControl = getEffectiveControl(player, pitcherStats, inning, teamUserId, false);
                    const totalPenalty = Math.max(0, player.control - effectiveControl);

                    // The stored fatigue_modifier is the pre-game state.
                    // We want to show the WORST case of pre-game vs current calculated penalty.
                    // (Usually getEffectiveControl covers it, but edge cases where it returns 0 for tired pitchers exist).
                    const basePenalty = Math.abs(stats.fatigue_modifier || 0);
                    const finalPenalty = Math.max(totalPenalty, basePenalty);

                    if (finalPenalty > 0) {
                        player.fatigueStatus = 'tired';
                        player.fatigue_modifier = -finalPenalty;
                    } else {
                        player.fatigueStatus = 'rested';
                        player.fatigue_modifier = 0;
                    }
                } else {
                    player.fatigueStatus = 'rested';
                }
            }
        });
    };

    if (currentState?.state_data?.pitcherStats) {
        processRosterFatigue(rosters.home, currentState.state_data.pitcherStats, currentState.state_data.inning, game.home_team_user_id);
        const awayUserId = participantsResult.rows.find(p => p.user_id !== game.home_team_user_id)?.user_id;
        processRosterFatigue(rosters.away, currentState.state_data.pitcherStats, currentState.state_data.inning, awayUserId);
    }
  }

  return { game, series, gameState: currentState, gameEvents: eventsResult.rows, batter, pitcher, lineups, rosters, teams: teamsData, nextGameId };
}
module.exports.getAndProcessGameData = getAndProcessGameData;

// GET A SPECIFIC GAME'S STATE (now processed)
app.get('/api/games/:gameId', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  try {
    const gameData = await getAndProcessGameData(gameId, pool);
    if (!gameData) {
      return res.status(404).json({ message: 'Game not found.' });
    }
    res.json(gameData);
  } catch (error) {
    console.error(`Error fetching game data for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error while fetching game data.' });
  }
});

// in server.js
app.post('/api/games/:gameId/set-action', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { action } = req.body;
  const userId = req.user.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
    let stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    // Idempotency guard: if the at-bat already has a swing result, this is a duplicate request
    if (currentState.currentAtBat.swingRollResult) {
        await client.query('ROLLBACK');
        console.log(`Idempotency guard: /set-action duplicate blocked for game ${gameId}`);
        const gameData = await getAndProcessGameData(gameId, client);
        return res.status(200).json(gameData);
    }

    let finalState = { ...currentState };
    if (finalState.stealAttemptDetails) {
        finalState.stealAttemptDetails.clearedForOffense = true;
        if (finalState.stealAttemptDetails.clearedForDefense) {
            finalState.stealAttemptDetails = null;
        }
    }
    const { offensiveTeam } = await getActivePlayers(gameId, finalState);

    commitTransientPlayerIds(finalState);

    finalState.currentAtBat.batterAction = action;

    // If the pitcher has already acted, we resolve the at-bat now.
    if (finalState.currentAtBat.pitcherAction === 'pitch') {
      // Now that both players have acted, clear any leftover steal/throw results from the previous state.
      finalState.lastStealResult = null;
      finalState.pendingStealAttempt = null;
      finalState.throwRollResult = null;
      finalState.runnersScored = [];

      const { batter, pitcher, defensiveTeam } = await getActivePlayers(gameId, finalState);
      processPlayers([batter, pitcher]);

      const { infieldDefense, outfieldDefense } = finalState.isTopInning ? finalState.homeDefensiveRatings : finalState.awayDefensiveRatings;

      // --- THIS IS THE FIX ---
      // Add the scores before the outcome is applied.
      finalState.currentAtBat.homeScoreBeforePlay = finalState.homeScore;
      finalState.currentAtBat.awayScoreBeforePlay = finalState.awayScore;

      let outcome = 'OUT';
      let swingRoll = 0;
      const { advantage } = finalState.currentAtBat.pitchRollResult;
      let chartHolder = null;

      if (action === 'bunt') {
          outcome = 'BUNT';
      } else { // 'swing'
          swingRoll = Math.floor(Math.random() * 20) + 1;
          chartHolder = advantage === 'pitcher' ? pitcher : batter;
          for (const range in chartHolder.chart_data) {
              const [min, max] = range.split('-').map(Number);
              if (swingRoll >= min && swingRoll <= max) { outcome = chartHolder.chart_data[range]; break; }
          }
      }

      const teams = await client.query(
        `SELECT t.abbreviation, p.home_or_away
         FROM teams t JOIN users u ON t.user_id = u.user_id
         JOIN game_participants p ON u.user_id = p.user_id
         WHERE p.game_id = $1`, [gameId]
      );
      const teamInfo = {
        home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
        away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
      };

      const { newState, events, scorers, outcome: finalOutcome, infieldInSingle, advantageBackfired, pitcherHomeRun } = applyOutcome(finalState, outcome, batter, pitcher, infieldDefense, outfieldDefense, getSpeedValue, swingRoll, chartHolder, teamInfo);
      finalState = { ...newState };
      finalState.defensivePlayerWentSecond = false;
      finalState.currentAtBat.swingRollResult = { roll: swingRoll, outcome: finalState.walkoffAdjustedOutcome || finalOutcome, batter, eventCount: events.length, infieldInSingle, advantageBackfired, pitcherHomeRun };
      
      
      if ((events && events.length > 0) || finalState.doublePlayDetails) {
        const originalOuts = currentState.outs;
        const originalScore = currentState.awayScore + currentState.homeScore;
        let combinedLogMessage;

        if (finalState.doublePlayDetails) {
            const { batter } = finalState.currentAtBat.swingRollResult;
            if (finalState.doublePlayDetails.outcome === 'DOUBLE_PLAY') {
                let scorersString = '';
                if (scorers && scorers.length > 0) {
                    scorersString = ` ${scorers.join(' and ')} scores!`;
                }
                combinedLogMessage = `${batter.displayName} grounds into a double play.${scorersString}`;
            } else {
                let scorersString = '';
                if (scorers && scorers.length > 0) {
                    scorersString = ` ${scorers.join(' and ')} scores!`;
                }
                combinedLogMessage = `${batter.displayName} hits into a fielder's choice.${scorersString}`;
            }
        } else if (finalState.currentPlay?.payload?.initialEvent) {
            // This is the key change. If a play is pending, we don't log the event now.
            // The initialEvent is already stored in the currentPlay payload.
            // We just let the state save and wait for the user's decision.
            combinedLogMessage = null;
        }
        else {
            combinedLogMessage = events.join(' ');
        }

        if (finalState.isBetweenHalfInningsAway || finalState.isBetweenHalfInningsHome) {
          combinedLogMessage += ` <strong>Outs: 3</strong>`;
        } else if (finalState.outs > originalOuts) {
          combinedLogMessage += ` <strong>Outs: ${finalState.outs}</strong>`;
        }

        if (combinedLogMessage) {
            const finalLogMessage = appendScoreToLog(combinedLogMessage, finalState, currentState.awayScore, currentState.homeScore);
            const rollData = buildRollData({ pitch: finalState.currentAtBat.pitchRollResult?.roll, swing: swingRoll, throwRoll: finalState.doublePlayDetails?.roll, isTopInning: currentState.isTopInning });
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, userId, currentTurn + 1, 'game_event', finalLogMessage, rollData]);
        }
      }

      await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);

      // --- NEW: Check for Game Over ---
      if (finalState.gameOver) {
        const updateResult = await client.query(
          `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
          [gameId]
        );
        if (updateResult.rowCount > 0) {
            await handleSeriesProgression(gameId, client, finalState);
        }
      }
    }
    
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, finalState]);
    await client.query('COMMIT');
    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.sendStatus(200);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error setting offensive action for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error while setting action.' });
  } finally {
    client.release();
  }
});

app.post('/api/games/:gameId/pitch', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { action } = req.body;
  const userId = req.user.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
    let stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

     // Idempotency guard: if a pitch result already exists, this is a duplicate request
    if (currentState.currentAtBat.pitchRollResult) {
        await client.query('ROLLBACK');
        console.log(`Idempotency guard: /pitch duplicate blocked for game ${gameId}`);
        const gameData = await getAndProcessGameData(gameId, client);
        return res.status(200).json(gameData);
    }

    commitTransientPlayerIds(currentState);
    const { batter, pitcher, offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, currentState);
    processPlayers([batter, pitcher]);
    
    // --- Pitcher Fatigue Logic ---
    // Ensure the current inning is recorded for the pitcher stats immediately upon throwing a pitch.
    // This handles cases where a reliever enters mid-inning and solves the "Missing Inning" bug.
    if (pitcher && pitcher.card_id > 0) {
        if (!currentState.pitcherStats) {
            currentState.pitcherStats = {};
        }
        const pOwnerId = currentState.isTopInning ? currentState.homeTeam.userId : currentState.awayTeam.userId;
        const pid = `${pOwnerId}_${pitcher.card_id}`;
        let stats = currentState.pitcherStats[pid] || { runs: 0, innings_pitched: [], fatigue_modifier: 0, batters_faced: 0 };

        // Initialize if missing
        if (!stats.innings_pitched) stats.innings_pitched = [];
        if (stats.batters_faced === undefined) stats.batters_faced = 0;

        // Add current inning if not present
        if (!stats.innings_pitched.includes(currentState.inning)) {
            stats.innings_pitched.push(currentState.inning);
        }
        currentState.pitcherStats[pid] = stats;
    }

    // Retrieve the effectiveControl for the current at-bat.
    const pitcherOwnerId = currentState.isTopInning ? currentState.homeTeam.userId : currentState.awayTeam.userId;
    const effectiveControl = getEffectiveControl(pitcher, currentState.pitcherStats, currentState.inning, pitcherOwnerId);

     let finalState = { ...currentState };
    if (finalState.stealAttemptDetails) {
        finalState.stealAttemptDetails.clearedForDefense = true;
        if (finalState.stealAttemptDetails.clearedForOffense) {
            finalState.stealAttemptDetails = null;
        }
    }
    const events = [];

    if (action === 'intentional_walk') {
        // Add the scores before the outcome is applied.
        currentState.currentAtBat.homeScoreBeforePlay = currentState.homeScore;
        currentState.currentAtBat.awayScoreBeforePlay = currentState.awayScore;
        const teams = await client.query(
            `SELECT t.abbreviation, p.home_or_away
             FROM teams t JOIN users u ON t.user_id = u.user_id
             JOIN game_participants p ON u.user_id = p.user_id
             WHERE p.game_id = $1`, [gameId]
          );
        const teamInfo = {
            home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
            away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
        };
        const { newState, events: walkEvents } = applyOutcome(currentState, 'IBB', batter, pitcher, 0, 0, getSpeedValue, 0, null, teamInfo);
        finalState = { ...newState };
        finalState.currentAtBat.pitcherAction = 'intentional_walk';
        finalState.currentAtBat.batterAction = 'take';
        finalState.currentAtBat.pitchRollResult = { roll: 'IBB', outcome: 'IBB' };

        for (const logMessage of walkEvents) {
          const finalLog = appendScoreToLog(logMessage, finalState, currentState.awayScore, currentState.homeScore);
          await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'walk', finalLog]);
        }

        if (finalState.gameOver) {
            const updateResult = await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
                [gameId]
            );
            if (updateResult.rowCount > 0) {
                await handleSeriesProgression(gameId, client, finalState);
            }
        } else {
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]);
        }
    } else {
        const pitchRoll = Math.floor(Math.random() * 20) + 1;

        // --- THIS IS THE FIX: Calculate controlPenalty directly in this route ---
        let controlPenalty = 0;
        if (pitcher && currentState.pitcherStats) {
            const pOwnerId = currentState.isTopInning ? currentState.homeTeam.userId : currentState.awayTeam.userId;
            const pitcherId = `${pOwnerId}_${pitcher.card_id}`;
            const stats = currentState.pitcherStats[pitcherId] || { runs: 0, innings_pitched: [], fatigue_modifier: 0 };
            const inningsPitched = stats.innings_pitched || [];
            let potentialInningsPitched = [...inningsPitched];
            if (!potentialInningsPitched.includes(currentState.inning)) {
                potentialInningsPitched.push(currentState.inning);
            }
            const inningsPitchedCount = potentialInningsPitched.length;
            const modifiedIp = pitcher.ip + (stats.fatigue_modifier || 0);
            const fatigueThreshold = modifiedIp - Math.floor((stats.runs || 0) / 3);
            if (inningsPitchedCount > fatigueThreshold) {
                controlPenalty = inningsPitchedCount - fatigueThreshold;
                // If they are pitching with a penalty, mark them as having pitched while tired.
                // This is used for series fatigue calculations.
                if (finalState.pitcherStats && finalState.pitcherStats[pitcherId]) {
                    finalState.pitcherStats[pitcherId].pitchedWhileTired = true;
                }
            }
        }
        // --- END FIX ---

        // If the batter is a pitcher (has a 'control' rating), they can never have the advantage.
        const advantage = batter.control !== null
            ? 'pitcher'
            : (pitchRoll + effectiveControl) > batter.on_base ? 'pitcher' : 'batter';
            
        finalState.currentAtBat.pitcherAction = 'pitch';
        finalState.currentAtBat.pitchRollResult = { roll: pitchRoll, advantage, penalty: controlPenalty };

        if (finalState.currentAtBat.batterAction) {
            // Now that both players have acted, clear any leftover steal/throw results from the previous state.
            finalState.lastStealResult = null;
            finalState.pendingStealAttempt = null;
            finalState.throwRollResult = null;
            finalState.runnersScored = [];

            // --- THIS IS THE FIX ---
            // Batter was waiting, so resolve the whole at-bat now.
            const { infieldDefense, outfieldDefense } = finalState.isTopInning ? finalState.homeDefensiveRatings : finalState.awayDefensiveRatings;

            // --- THIS IS THE FIX ---
            // Add the scores before the outcome is applied.
            finalState.currentAtBat.homeScoreBeforePlay = finalState.homeScore;
            finalState.currentAtBat.awayScoreBeforePlay = finalState.awayScore;

            const originalOuts = finalState.outs;
            const originalScore = finalState.awayScore + finalState.homeScore;
            let outcome = 'OUT';
            let swingRoll = 0;
            let chartHolder = null;
            if (finalState.currentAtBat.batterAction === 'bunt') {
                outcome = 'BUNT';
            } else {
                swingRoll = Math.floor(Math.random() * 20) + 1;
                chartHolder = advantage === 'pitcher' ? pitcher : batter;
                for (const range in chartHolder.chart_data) {
                    const [min, max] = range.split('-').map(Number);
                    if (swingRoll >= min && swingRoll <= max) { outcome = chartHolder.chart_data[range]; break; }
                }
            }
            const teams = await client.query(
                `SELECT t.abbreviation, p.home_or_away
                 FROM teams t JOIN users u ON t.user_id = u.user_id
                 JOIN game_participants p ON u.user_id = p.user_id
                 WHERE p.game_id = $1`, [gameId]
              );
              const teamInfo = {
                home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
                away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
              };

            const { newState, events, scorers, outcome: finalOutcome, infieldInSingle, advantageBackfired, pitcherHomeRun } = applyOutcome(finalState, outcome, batter, pitcher, infieldDefense, outfieldDefense, getSpeedValue, swingRoll, chartHolder, teamInfo);
            finalState = { ...newState };
            finalState.defensivePlayerWentSecond = true;
            finalState.currentAtBat.swingRollResult = { roll: swingRoll, outcome: finalState.walkoffAdjustedOutcome || finalOutcome, batter, eventCount: events.length, infieldInSingle, advantageBackfired, pitcherHomeRun };

            // --- ADD THESE DEBUG LOGS ---
        console.log('--- PITCH OUTS DEBUG ---');
        console.log('Original Outs:', originalOuts);
        console.log('Final Outs:', finalState.outs);
        // --- End of Debug Logs ---
            
            if ((events && events.length > 0) || finalState.doublePlayDetails) {
              const originalOuts = currentState.outs;
              const originalScore = currentState.awayScore + currentState.homeScore;
              let combinedLogMessage;

              if (finalState.doublePlayDetails) {
                const { batter } = finalState.currentAtBat.swingRollResult;
                if (finalState.doublePlayDetails.outcome === 'DOUBLE_PLAY') {
                    let scorersString = '';
                    if (scorers && scorers.length > 0) {
                        scorersString = ` ${scorers.join(' and ')} scores!`;
                    }
                    combinedLogMessage = `${batter.displayName} grounds into a double play.${scorersString}`;
                } else {
                    let scorersString = '';
                    if (scorers && scorers.length > 0) {
                        scorersString = ` ${scorers.join(' and ')} scores!`;
                    }
                    combinedLogMessage = `${batter.displayName} hits into a fielder's choice.${scorersString}`;
                }
              } else if (finalState.currentPlay?.payload?.initialEvent) {
                  // This is the key change. If a play is pending, we don't log the event now.
                  // The initialEvent is already stored in the currentPlay payload.
                  // We just let the state save and wait for the user's decision.
                  combinedLogMessage = null;
              }
              else {
                  combinedLogMessage = events.join(' ');
              }

              if (finalState.isBetweenHalfInningsAway || finalState.isBetweenHalfInningsHome) {
                combinedLogMessage += ` <strong>Outs: 3</strong>`;
              } else if (finalState.outs > originalOuts) {
                combinedLogMessage += ` <strong>Outs: ${finalState.outs}</strong>`;
              }

              if (combinedLogMessage) {
                  const finalLogMessage = appendScoreToLog(combinedLogMessage, finalState, currentState.awayScore, currentState.homeScore);
                  const rollData = buildRollData({ pitch: pitchRoll, swing: swingRoll, throwRoll: finalState.doublePlayDetails?.roll, isTopInning: currentState.isTopInning });
                  await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, userId, currentTurn + 1, 'game_event', finalLogMessage, rollData]);
              }
            }

            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);

            // --- NEW: Check for Game Over ---
            if (finalState.gameOver) {
              const updateResult = await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
                [gameId]
              );
              if (updateResult.rowCount > 0) {
                  await handleSeriesProgression(gameId, client, finalState);
              }
            }
        }
    }
    
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, finalState]);
    await client.query('COMMIT');
    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.status(200).json({ message: 'Pitch action complete.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during pitch:', error);
    res.status(500).json({ message: 'Server error during pitch.' });
  } finally {
    client.release();
  }
});

app.post('/api/games/:gameId/swing', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let finalState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;
    
    // The only job is to change the status to reveal the outcome.

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, finalState]);
    await client.query('COMMIT');
    
    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.sendStatus(200);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error during swing for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error during swing.' });
  } finally {
    client.release();
  }
});

// in server.js
app.post('/api/games/:gameId/next-hitter', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    const originalState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    let newState = JSON.parse(JSON.stringify(originalState));

    commitTransientPlayerIds(newState);

    const isHomePlayer = Number(userId) === Number(newState.homeTeam.userId);

    // --- GUARD CLAUSE: Prevent premature advancement ---
    // Ensure the current play is actually finished before allowing the state to advance.
    const isBetweenInnings = originalState.isBetweenHalfInningsAway || originalState.isBetweenHalfInningsHome;
    const isAtBatResolved = originalState.currentAtBat && originalState.currentAtBat.pitcherAction && originalState.currentAtBat.batterAction;
    const isSpecialEndState = originalState.inningEndedOnCaughtStealing;

    if (!isBetweenInnings && !isAtBatResolved && !isSpecialEndState) {
        // If the play isn't done, we shouldn't be here.
        // However, if one player is already "ready" (meaning they successfully called this before),
        // we might just need to mark the second player as ready.
        // But if NEITHER is ready, and the play isn't done, this is an illegal state transition.
        if (!originalState.homePlayerReadyForNext && !originalState.awayPlayerReadyForNext) {
             console.warn(`[next-hitter] blocked premature advancement for game ${gameId}. AtBat resolved: ${!!isAtBatResolved}`);
             return res.status(400).json({ message: "Current play is not yet resolved." });
        }
    }

    // --- THIS IS THE NEW LOGIC ---
    // If you are the FIRST player to click, advance the game state.
    if (!originalState.homePlayerReadyForNext && !originalState.awayPlayerReadyForNext) {
      // 1. Save the completed/interrupted at-bat for the other player to see.
      // NEW: If a steal is in progress, the at-bat was already advanced before
      // the steal was initiated. Skip re-advancement to prevent double batting
      // order increment and duplicate lastCompletedAtBat creation.
      if (originalState.pendingStealAttempt) {
          // No advancement needed — just fall through to mark the player as ready.
      } else {newState.lastCompletedAtBat = { ...newState.currentAtBat,
        bases: newState.currentAtBat.basesBeforePlay,
        eventCount: newState.currentAtBat.swingRollResult?.eventCount || 1,
        outs: newState.outsBeforePlay
       };

      // Clear all transient details from the previous play *before* creating the new `currentAtBat`.
      // This prevents stale data from causing UI glitches for the first player to click.
      // FIX: Do NOT clear pendingStealAttempt or stealAttemptDetails here.
      // If we are waiting for the opponent (e.g. steal defense interaction), clearing this
      // prematurely hides the interaction from the opponent who hasn't clicked Next yet.
      // These should only be cleared when BOTH players are ready.
      
      const wasBetweenHalfInnings = newState.isBetweenHalfInningsAway || newState.isBetweenHalfInningsHome;

      // Logic to advance the batting order.
      // If the inning ended, we first advance the state to the next half, THEN advance the new team's order.
      if (wasBetweenHalfInnings) {
        newState = advanceToNextHalfInning(newState);
        const teamToAdvance = newState.isTopInning ? 'awayTeam' : 'homeTeam';
        newState[teamToAdvance].battingOrderPosition = (newState[teamToAdvance].battingOrderPosition + 1) % 9;
        
      } else {
    // Otherwise, it's a normal at-bat, advance the current team's order.
    const teamToAdvance = newState.isTopInning ? 'awayTeam' : 'homeTeam';
    newState[teamToAdvance].battingOrderPosition = (newState[teamToAdvance].battingOrderPosition + 1) % 9;

}

      // Now that the state is correct for the new at-bat, get the players.
      const { batter, pitcher, defensiveTeam } = await getActivePlayers(gameId, newState);

      // --- NEW: Update pitcher fatigue for the new at-bat ---
      newState = updatePitcherFatigueForNewInning(newState, pitcher);

      // Calculate effectiveControl and attach it to the pitcher object for this specific at-bat.
      if (pitcher) {
          const pitcherOwnerId = newState.isTopInning ? newState.homeTeam.userId : newState.awayTeam.userId;
          pitcher.effectiveControl = getEffectiveControl(pitcher, newState.pitcherStats, newState.inning, pitcherOwnerId);
      }

      // Create a fresh scorecard for the new at-bat.
      newState.currentAtBat = {
          batter: batter,
          pitcher: pitcher, // This pitcher object now includes effectiveControl
          pitcherAction: null, batterAction: null,
          pitchRollResult: null, swingRollResult: null,
          outsBeforePlay: newState.outs,
          basesBeforePlay: newState.bases,
          homeScoreBeforePlay: newState.homeScore,
          awayScoreBeforePlay: newState.awayScore
      };

      // --- THIS IS THE FIX ---
      // Validate the new defensive lineup. This will correctly set awaiting_lineup_change.
      if (defensiveTeam && defensiveTeam.lineup) {
          // --- START PRODUCTION DEBUGGING ---
          console.log('[next-hitter] Calling validateLineup...');
          // --- END PRODUCTION DEBUGGING ---
          newState = await validateLineup(defensiveTeam, newState, gameId, client);
      } else {
          console.warn(`[next-hitter] Defensive team lineup missing or invalid for game ${gameId}. Skipping validation.`);
      }

      // If the inning ended AND we DON'T need a new pitcher, create the change event.
      // We always attempt to create the event. createInningChangeEvent validates if we have a pitcher to announce.
      // This ensures that if we have a valid pitcher but an invalid fielder (e.g. PH at SS), we still announce the inning.
      if (wasBetweenHalfInnings) {
        await createInningChangeEvent(gameId, newState, userId, currentTurn + 1, client);
      }

      // If there is no runner on third base OR there are 2 outs, the infield must be brought back to normal.
      if (!newState.bases.third || newState.outs >= 2) {
          newState.currentAtBat.infieldIn = false;
      }
    }
    }

    // Mark the current player as ready.
    if (isHomePlayer) {
      newState.homePlayerReadyForNext = true;
    } else {
      newState.awayPlayerReadyForNext = true;
    }

    if (newState.pendingStealAttempt && newState.homePlayerReadyForNext && newState.awayPlayerReadyForNext) {
        // Clear transient throw/play data from the previous at-bat now that both players have caught up to the steal
        newState.throwRollResult = null;
        newState.doublePlayDetails = null;

        // Resolve the pending steal — move data to lastStealResult so both players see it
        const pending = newState.pendingStealAttempt;
        newState.lastStealResult = {
            runner: pending.runnerName,
            outcome: pending.outcome,
            runnerTeamId: pending.runnerTeamId,
            batterPlayerId: pending.batterPlayerId,
            roll: pending.roll,
            defense: pending.defense,
            target: pending.target,
            penalty: pending.penalty,
            throwToBase: pending.throwToBase
        };
        newState.pendingStealAttempt = null;
        newState.currentPlay = null;
        newState.currentAtBat.basesBeforePlay = { ...newState.bases };

        // Reset flags — both players view the result, then each must act again
        // However, if the at-bat is already resolved (e.g. by an intentional walk),
        // we DO NOT reset the flags here, so that the logic below can immediately
        // advance the game state to the next hitter.
        const isAtBatResolvedForSteal = newState.currentAtBat && newState.currentAtBat.pitcherAction && newState.currentAtBat.batterAction;
        if (!isAtBatResolvedForSteal) {
            newState.homePlayerReadyForNext = false;
            newState.awayPlayerReadyForNext = false;
        }
        
        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]);
      }
    
    if (newState.homePlayerReadyForNext && newState.awayPlayerReadyForNext) {
        // Clear transient throw/play data now that BOTH players have seen the result
      newState.throwRollResult = null;
      newState.doublePlayDetails = null;
      if (newState.currentPlay?.type !== 'STEAL_ATTEMPT') {
        newState.currentPlay = null;
      }

      if (newState.pendingStealAttempt) {} else {
        // Normal both-ready logic (non-steal)
        newState.homePlayerReadyForNext = false;
        newState.awayPlayerReadyForNext = false;
        newState.defensivePlayerWentSecond = false;
        
        newState.lastStealResult = null;
        newState.runnersScored = [];
        newState.inningEndedOnCaughtStealing = false;

        // Deferred inning transition
        const stillBetweenInnings = newState.isBetweenHalfInningsAway || newState.isBetweenHalfInningsHome;
        if (stillBetweenInnings) {
          newState.currentPlay = null;
          newState = advanceToNextHalfInning(newState);
          const teamToAdvance = newState.isTopInning ? 'awayTeam' : 'homeTeam';
          newState[teamToAdvance].battingOrderPosition = (newState[teamToAdvance].battingOrderPosition + 1) % 9;

          const { batter, pitcher, defensiveTeam } = await getActivePlayers(gameId, newState);
          newState = updatePitcherFatigueForNewInning(newState, pitcher);
          if (pitcher) {
              const pitcherOwnerId = newState.isTopInning ? newState.homeTeam.userId : newState.awayTeam.userId;
              pitcher.effectiveControl = getEffectiveControl(pitcher, newState.pitcherStats, newState.inning, pitcherOwnerId);
          }
          newState.currentAtBat = {
              batter: batter,
              pitcher: pitcher,
              pitcherAction: null, batterAction: null,
              pitchRollResult: null, swingRollResult: null,
              outsBeforePlay: newState.outs,
              basesBeforePlay: newState.bases,
              homeScoreBeforePlay: newState.homeScore,
              awayScoreBeforePlay: newState.awayScore
          };
          if (defensiveTeam && defensiveTeam.lineup) {
              newState = await validateLineup(defensiveTeam, newState, gameId, client);
          }
          await createInningChangeEvent(gameId, newState, userId, currentTurn + 1, client);
          if (!newState.bases.third || newState.outs >= 2) {
              newState.currentAtBat.infieldIn = false;
          }
        }
      }
    }
    
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
    await client.query('COMMIT');
    
    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);

    res.sendStatus(200);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error advancing to next hitter for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error during next hitter.' });
  } finally {
    client.release();
  }
});

// in server.js

// NEW ENDPOINT for Infield In Defense Choice
app.post('/api/games/:gameId/resolve-infield-in-defense-choice', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { throwHome } = req.body; // true or false
    const userId = req.user.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const currentState = stateResult.rows[0].state_data;
        let newState = JSON.parse(JSON.stringify(currentState));
        const currentTurn = stateResult.rows[0].turn_number;

        if (newState.currentPlay?.type !== 'INFIELD_IN_DEFENSE_CHOICE') {
            return res.status(400).json({ message: 'Invalid game state for this action.' });
        }

        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);
        const { batter, runnerOnThird, runnerOnSecond, runnerOnFirst } = newState.currentPlay.payload;
        const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';
        const events = [];

        if (throwHome) {
            const infieldDefense = await getInfieldDefense(defensiveTeam);
            const runnerSpeed = getSpeedValue(runnerOnThird);
            const d20Roll = Math.floor(Math.random() * 20) + 1;
            const defenseTotal = infieldDefense + d20Roll;
            const isSafe = runnerSpeed >= defenseTotal;

            newState.throwRollResult = {
                roll: d20Roll,
                defense: infieldDefense,
                target: runnerSpeed,
                baseSpeed: runnerSpeed,
                penalty: 0,
                outcome: isSafe ? 'SAFE' : 'OUT',
                runner: runnerOnThird.name,
                throwToBase: 4 // Home plate
            };

            // Batter is safe at first in the 'send' scenario
            newState.bases.first = batter;

            if (isSafe) {
                newState[scoreKey]++;
                if (!newState.runnersScored) newState.runnersScored = [];
                newState.runnersScored.push(toRunnerCard(runnerOnThird));
                recordRunForPitcher(newState, runnerOnThird, newState.currentAtBat.pitcher);
                events.push(`${runnerOnThird.name} is SENT HOME... SAFE! ${batter.displayName} reaches on a fielder's choice.`);
            } else {
                recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                events.push(`${runnerOnThird.name} is THROWN OUT at the plate! ${batter.displayName} reaches on a fielder's choice.`);
            }
            newState.bases.third = null; // Runner from third is no longer there.

            // Handle other runners
            if (runnerOnSecond) {
                // Runner on 2nd holds, as per user instruction
            }
            if (runnerOnFirst) {
                newState.bases.second = runnerOnFirst;
            }
        } else {
            // Defense chooses to throw to 1st
            events.push(`${batter.displayName} grounds out to first.`);
            recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);

            // Runner from third scores
            newState[scoreKey]++;
            if (!newState.runnersScored) newState.runnersScored = [];
            newState.runnersScored.push(toRunnerCard(runnerOnThird));
            recordRunForPitcher(newState, runnerOnThird, newState.currentAtBat.pitcher);
            events.push(`${runnerOnThird.name} scores on the play.`);
            newState.bases.third = null;

            if (newState.outs < 3) {
                 if (runnerOnFirst && runnerOnSecond) { // 1st and 2nd
                    // This case isn't possible based on the entry condition (must have runner on 3rd)
                    // but handling defensively.
                 } else if (runnerOnFirst) { // 1st and 3rd
                    newState.bases.second = runnerOnFirst;
                 }
                 newState.bases.first = null; // Batter is out
            } else {
                 newState.bases = { first: null, second: null, third: null };
            }
        }

        newState.currentPlay = null;

        const combinedLogMessage = events.join(' ');
        if (events.length > 0) {
            const finalLogMessage = appendScoreToLog(combinedLogMessage, newState, currentState.awayScore, currentState.homeScore);
            const rollData = buildAtBatRollData(newState, currentState.isTopInning);
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, userId, currentTurn + 1, 'baserunning', finalLogMessage, rollData]);
        }

        // --- Check for Game Over ---
        const teams = await client.query(
            `SELECT t.abbreviation, p.home_or_away
             FROM teams t JOIN users u ON t.user_id = u.user_id
             JOIN game_participants p ON u.user_id = p.user_id
             WHERE p.game_id = $1`, [gameId]
        );
        const teamInfo = {
            home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
            away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
        };
        const gameOverEvents = [];
        checkGameOverOrInningChange(newState, gameOverEvents, teamInfo);

        if (gameOverEvents.length > 0) {
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'system', gameOverEvents[0]]);
        }

        if (newState.gameOver) {
              const updateResult = await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
                [gameId]
              );
              if (updateResult.rowCount > 0) {
                  await handleSeriesProgression(gameId, client, newState);
              }
        }

        newState.awayPlayerReadyForNext = false;
        newState.homePlayerReadyForNext = false;

        await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]);
        await client.query('COMMIT');

        const gameData = await getAndProcessGameData(gameId, client);
        io.to(gameId).emit('game-updated', gameData);
        res.status(200).json(gameData);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error resolving infield in defense choice for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error during infield in defense choice.' });
    } finally {
        client.release();
    }
});

app.post('/api/games/:gameId/reset-rolls', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  try {
    // Set the setup_rolls column back to an empty object
    await pool.query(`UPDATE games SET setup_rolls = '{}'::jsonb WHERE game_id = $1`, [gameId]);
    
    // Notify both players that the rolls have been updated (cleared)
    io.to(gameId).emit('roll-updated');
    res.sendStatus(200);
  } catch (error) {
    console.error(`Error resetting rolls for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error while resetting rolls.' });
  }
});

app.post('/api/games/:gameId/declare-home', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { homeTeamUserId } = req.body;
  
  console.log(`2. BACKEND: Received request to declare home team for game ${gameId}.`);
  
  try {
    await pool.query(
      `UPDATE games SET home_team_user_id = $1 WHERE game_id = $2`,
      [homeTeamUserId, gameId]
    );
    console.log(`3. BACKEND: Database updated. Home team is now ${homeTeamUserId}.`);
    
    // Notify any other player who is currently on the page
    io.to(gameId).emit('choice-updated', { homeTeamUserId });
    res.sendStatus(200);
  } catch (error) {
    console.error('Error declaring home team:', error);
    res.status(500).json({ message: 'Server error.' });
  }
});

app.post('/api/games/:gameId/initiate-steal', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { decisions } = req.body;
  const userId = req.user.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
    let stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let newState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    // Idempotency guard: if a steal is already pending for this exact runner/base combo, this is a duplicate
const requestedBases = Object.keys(decisions).filter(k => decisions[k]);
if (newState.pendingStealAttempt && requestedBases.length === 1) {
    const alreadyStealingToBase = newState.pendingStealAttempt.throwToBase;
    const requestedFromBase = parseInt(requestedBases[0], 10);
    if (requestedFromBase + 1 === alreadyStealingToBase) {
        await client.query('ROLLBACK');
        console.log(`Idempotency guard: /initiate-steal duplicate blocked for game ${gameId}`);
        const gameData = await getAndProcessGameData(gameId, client);
        return res.status(200).json(gameData);
    }
}

    commitTransientPlayerIds(newState);
    const { offensiveTeam, defensiveTeam, batter } = await getActivePlayers(gameId, newState);
    const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

    // This is the core of the fix. If a steal is ALREADY in progress,
    // this new request is a consecutive steal. We queue it up and lock
    // the offensive player until the defense resolves the first throw.
    let isSingleSteal = false;
    let isSafe = true; // Default to true, only becomes false if caught.

    if (newState.currentPlay?.type === 'STEAL_ATTEMPT') {
        newState.currentPlay.payload.queuedDecisions = decisions;
        // Lock the turn to the defensive player, creating the "waiting" state.
        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
    } else {
        // This is the first steal attempt in a potential sequence.
        const stealingRunners = Object.keys(decisions).filter(key => decisions[key]);
        isSingleSteal = stealingRunners.length === 1;

        if (isSingleSteal) {
            const fromBase = parseInt(stealingRunners[0], 10);
            const toBase = fromBase + 1;
            const runner = newState.bases[baseMap[fromBase]];
            if (runner) {
                const catcherArm = await getCatcherArm(defensiveTeam);
                const stealResult = calculateStealResult(runner, toBase, catcherArm, getSpeedValue, offensiveTeam);
                isSafe = stealResult.isSafe;
                const { outcome, ...resultDetails } = stealResult;
                const runnerName = runner.name;

                recordStealAttempt(newState, runner, isSafe);
                if (!isSafe) {
                    recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                }

                const logMessage = outcome === 'SAFE'
                    ? `${runnerName} takes off for ${getOrdinal(toBase)}... SAFE!`
                    : `${runnerName} takes off for ${getOrdinal(toBase)}... CAUGHT STEALING! <strong>Outs: ${newState.outs}</strong>`;
                const stealRollData = buildRollData({ throwRoll: stealResult.roll, isTopInning: newState.isTopInning });
                await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, userId, currentTurn + 1, 'steal', logMessage, stealRollData]);

                if (isSafe) {
                    newState.bases[baseMap[toBase]] = runner;
                }
                newState.bases[baseMap[fromBase]] = null;

                newState.pendingStealAttempt = {
                    runner,
                    runnerName,
                    throwToBase: toBase,
                    outcome,
                    batterPlayerId: batter.card_id,
                    runnerTeamId: Number(offensiveTeam.team_id),
                    ...resultDetails
                };
                // We still use currentPlay to manage the overall "steal sequence" state
                newState.currentPlay = {
                    type: 'STEAL_ATTEMPT',
                    payload: { decisions, batterPlayerId: batter.card_id }
                };

                const nextTurnUserId = isSafe ? 0 : defensiveTeam.user_id;
                await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [nextTurnUserId, gameId]);
            }
        } else { // Double steal
            newState.currentPlay = {
                type: 'STEAL_ATTEMPT',
                payload: { decisions, batterPlayerId: batter.card_id }
            };
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
        }
    }

    // Common state updates for any steal
    newState.currentAtBat.pitcherAction = null;
    newState.currentAtBat.pitchRollResult = null;

    // --- NEW: Check for Game Over on caught stealing ---
    if (!isSafe && isSingleSteal && !newState.currentPlay?.payload?.queuedDecisions) {
        const teams = await client.query(
            `SELECT t.abbreviation, p.home_or_away
             FROM teams t JOIN users u ON t.user_id = u.user_id
             JOIN game_participants p ON u.user_id = p.user_id
             WHERE p.game_id = $1`, [gameId]
        );
        const teamInfo = {
            home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
            away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
        };
        // We can't easily append to the existing event since it was already inserted above.
        // But checkGameOverOrInningChange will return true if game over, and we can log a separate message if needed,
        // OR we rely on it pushing a new event.
        // checkGameOverOrInningChange pushes to 'events' array passed to it.
        const gameOverEvents = [];
        checkGameOverOrInningChange(newState, gameOverEvents, teamInfo);

        if (gameOverEvents.length > 0) {
             await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'system', gameOverEvents[0]]);
        }

        if (newState.gameOver) {
              const updateResult = await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
                [gameId]
              );
              if (updateResult.rowCount > 0) {
                  await handleSeriesProgression(gameId, client, newState);
              }
        } else if (newState.outs >= 3) {
            if (newState.isTopInning) {
                newState.isBetweenHalfInningsAway = true;
                newState.awayTeam.battingOrderPosition = (newState.awayTeam.battingOrderPosition - 1 + 9) % 9;
            } else {
                newState.isBetweenHalfInningsHome = true;
                newState.homeTeam.battingOrderPosition = (newState.homeTeam.battingOrderPosition - 1 + 9) % 9;
            }
            newState.inningEndedOnCaughtStealing = true;
            // Reset ready flags to ensure both players must click 'Next Hitter' to see the new inning
            //newState.homePlayerReadyForNext = false;
            //newState.awayPlayerReadyForNext = false;
        }
    }

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
    await client.query('COMMIT');
    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.sendStatus(200);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error initiating steal for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error during steal initiation.' });
  } finally {
    client.release();
  }
});

app.post('/api/games/:gameId/resolve-steal', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { throwToBase } = req.body;
  const userId = req.user.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let newState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    // Idempotency guard: if there's no pending steal to resolve, this is a duplicate
    if (!newState.pendingStealAttempt && !newState.currentPlay?.type?.includes('STEAL')) {
        await client.query('ROLLBACK');
        console.log(`Idempotency guard: /resolve-steal duplicate blocked for game ${gameId}`);
        const gameData = await getAndProcessGameData(gameId, client);
        return res.status(200).json(gameData);
    }

    commitTransientPlayerIds(newState);
    const { offensiveTeam, defensiveTeam, batter } = await getActivePlayers(gameId, newState);

    // Reset ready-for-next flags. Resolving a steal is a new game action that
    // invalidates any previous "ready for next" synchronization.
    newState.awayPlayerReadyForNext = false;
    newState.homePlayerReadyForNext = false;

    const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

    // --- SINGLE STEAL RESOLUTION ---
    if (newState.pendingStealAttempt) {
        // The outcome was already calculated in initiate-steal. We just use it here.
        const { outcome, runnerName, runner, ...resultDetails } = newState.pendingStealAttempt;

        // Explicitly cast team_id to Number to ensure consistent frontend comparisons
        newState.lastStealResult = { runner: runnerName, outcome, runnerTeamId: Number(offensiveTeam.team_id), ...resultDetails };
        if (outcome === 'OUT' && runner) {
            newState.lastStealResult.runnerOut = toRunnerCard(runner);
        }
        newState.pendingStealAttempt = null;

        // FIX: Define queuedDecisions before using it.
        const queuedDecisions = newState.currentPlay?.payload?.queuedDecisions;

        if (outcome === 'SAFE') {
            if (queuedDecisions) {
                const fromBase = parseInt(Object.keys(queuedDecisions)[0], 10);
                const toBase = fromBase + 1;
                const runner = newState.bases[baseMap[fromBase]];

                if (runner) {
                    const catcherArm = await getCatcherArm(defensiveTeam);
                    const { outcome: newOutcome, isSafe, ...resultDetails } = calculateStealResult(runner, toBase, catcherArm, getSpeedValue, offensiveTeam);
                    const newRunnerName = runner.name;

                    recordStealAttempt(newState, runner, isSafe);
                    if (!isSafe) {
                        recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                    }

                    const logMessage = newOutcome === 'SAFE'
                        ? `${newRunnerName} takes off for ${getOrdinal(toBase)}... SAFE!`
                        : `${newRunnerName} takes off for ${getOrdinal(toBase)}... CAUGHT STEALING! <strong>Outs: ${newState.outs}</strong>`;
                    const stealRollData = buildRollData({ throwRoll: resultDetails.roll, isTopInning: newState.isTopInning });
                    await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, userId, currentTurn + 1, 'steal', logMessage, stealRollData]);

                    if (isSafe) { newState.bases[baseMap[toBase]] = runner; }
                    newState.bases[baseMap[fromBase]] = null;

                    newState.pendingStealAttempt = {
                        runner,
                        runnerName: newRunnerName,
                        throwToBase: toBase,
                        outcome: newOutcome,
                        batterPlayerId: batter.card_id,
                        ...resultDetails
                    };
                }
                newState.currentPlay.payload = { decisions: queuedDecisions, batterPlayerId: batter.card_id };
                await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
            } else {
                newState.currentPlay = null;
                await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]);
            }
        } else { // Caught stealing.
            newState.currentPlay = null;
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
        }
        newState.currentAtBat.basesBeforePlay = { ...newState.bases };
    }
    // --- DOUBLE STEAL RESOLUTION ---
    else if (newState.currentPlay?.type === 'STEAL_ATTEMPT') {
        const { decisions } = newState.currentPlay.payload;
        const catcherArm = await getCatcherArm(defensiveTeam);
        let allEvents = [];
        const contestedFromBase = throwToBase - 1;
        const originalBases = JSON.parse(JSON.stringify(newState.bases));
        const outcomes = {};
        let contestedRunnerDetails = {};
        const originalOuts = newState.outs;

        for (const fromBaseStr in decisions) {
            if (decisions[fromBaseStr]) {
                const fromBase = parseInt(fromBaseStr, 10);
                const runner = originalBases[baseMap[fromBase]];
                if (!runner) continue;
                if (fromBase === contestedFromBase) {
                    const d20Roll = Math.floor(Math.random() * 20) + 1;
                    const defenseTotal = catcherArm + d20Roll;
                    let runnerSpeed = getSpeedValue(runner);
                    let penalty = 0;
                    if (throwToBase === 3) { runnerSpeed -= 5; penalty = 5; }
                    outcomes[fromBase] = { runner, isSafe: runnerSpeed > defenseTotal, isContested: true };
                    contestedRunnerDetails = {
                        outcome: outcomes[fromBase].isSafe ? 'SAFE' : 'OUT',
                        runnerName: runner.name, roll: d20Roll, defense: catcherArm, target: getSpeedValue(runner),
                        penalty, throwToBase,
                        runnerOut: outcomes[fromBase].isSafe ? null : toRunnerCard(runner)
                    };
                } else {
                    outcomes[fromBase] = { runner, isSafe: true, isContested: false };
                }
            }
        }

        Object.keys(outcomes).sort((a, b) => b - a).forEach(fromBaseStr => {
            const fromBase = parseInt(fromBaseStr, 10);
            const { runner, isSafe, isContested } = outcomes[fromBase];
            const toBase = fromBase + 1;
            newState.bases[baseMap[fromBase]] = null;
            recordStealAttempt(newState, runner, isSafe);
            if (isSafe) {
                newState.bases[baseMap[toBase]] = runner;
                allEvents.push(isContested ? `${runner.name} is SAFE at ${getOrdinal(toBase)}!` : `${runner.name} advances to ${getOrdinal(toBase)}.`);
            } else {
                recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                allEvents.push(`${runner.name} is OUT at ${getOrdinal(toBase)}!`);
            }
        });

        let logMessage = allEvents.join(' ');
        if (newState.outs > originalOuts) {
            logMessage += ` <strong>Outs: ${newState.outs}</strong>`;
        }
        newState.throwRollResult = { ...contestedRunnerDetails, consolidatedOutcome: logMessage, runnerTeamId: offensiveTeam.team_id };
        const stealRollData = buildRollData({ throwRoll: contestedRunnerDetails?.roll, isTopInning: newState.isTopInning });
        await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, userId, currentTurn + 1, 'steal', logMessage, stealRollData]);
        newState.currentPlay = null;

        // --- NEW: Check for Game Over on caught stealing ---
        const teams = await client.query(
            `SELECT t.abbreviation, p.home_or_away
             FROM teams t JOIN users u ON t.user_id = u.user_id
             JOIN game_participants p ON u.user_id = p.user_id
             WHERE p.game_id = $1`, [gameId]
        );
        const teamInfo = {
            home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
            away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
        };
        const gameOverEvents = [];
        checkGameOverOrInningChange(newState, gameOverEvents, teamInfo);

        if (gameOverEvents.length > 0) {
             await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'system', gameOverEvents[0]]);
        }

        if (newState.gameOver) {
              const updateResult = await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
                [gameId]
              );
              if (updateResult.rowCount > 0) {
                  await handleSeriesProgression(gameId, client, newState);
              }
        } else if (newState.outs >= 3) {
            if (newState.isTopInning) { 
                newState.isBetweenHalfInningsAway = true; 
                newState.awayTeam.battingOrderPosition = (newState.awayTeam.battingOrderPosition - 1 + 9) % 9;
            }
            else { 
                newState.isBetweenHalfInningsHome = true; 
                newState.homeTeam.battingOrderPosition = (newState.homeTeam.battingOrderPosition - 1 + 9) % 9;
            }
            newState.inningEndedOnCaughtStealing = true;
        }

        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]);
        newState.currentAtBat.basesBeforePlay = { ...newState.bases };
    }

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
    await client.query('COMMIT');
    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.sendStatus(200);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error resolving steal for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error during steal resolution.' });
  } finally {
    client.release();
  }
});


app.post('/api/games/:gameId/submit-decisions', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { decisions } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const currentState = stateResult.rows[0].state_data;

        // Idempotency guard: if there is no active play awaiting a decision, this is a
        // duplicate/stale request (the decision was already resolved). Don't re-apply.
        if (!currentState.currentPlay) {
            await client.query('ROLLBACK');
            console.log(`Idempotency guard: /submit-decisions duplicate blocked for game ${gameId}`);
            const gameData = await getAndProcessGameData(gameId, client);
            return res.status(200).json(gameData);
        }

        let newState = JSON.parse(JSON.stringify(currentState));
        const currentTurn = stateResult.rows[0].turn_number;
        commitTransientPlayerIds(newState);
        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);

        const sentRunners = Object.keys(decisions).filter(key => decisions[key]);

        if (sentRunners.length === 1) {
            const fromBaseStr = sentRunners[0];
            const decision = newState.currentPlay.payload.decisions.find(d => d.from.toString() === fromBaseStr);

            if (!decision || !decision.runner) {
                return res.status(400).json({ message: 'Invalid runner specified for the decision.' });
            }

            const { type } = newState.currentPlay;
            let throwTo;
            if (type === 'TAG_UP') {
                throwTo = decision.from + 1;
            } else {
                const { hitType } = newState.currentPlay.payload;
                if (hitType === '2B') {
                    throwTo = 4;
                } else {
                    throwTo = decision.from + 2;
                }
            }
            const outfieldDefense = await getOutfieldDefense(defensiveTeam);

            const teams = await client.query(
              `SELECT t.abbreviation, p.home_or_away
               FROM teams t JOIN users u ON t.user_id = u.user_id
               JOIN game_participants p ON u.user_id = p.user_id
               WHERE p.game_id = $1`, [gameId]
            );
            const teamInfo = {
              home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
              away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
            };

            let { initialEvent, autoHoldDecisions = [] } = newState.currentPlay.payload;
            const sentRunnerFromBase = parseInt(fromBaseStr, 10);
            const runnersWhoHeld = autoHoldDecisions.filter(d => d.from !== sentRunnerFromBase);
            if (runnersWhoHeld.length > 0) {
                const heldMessages = runnersWhoHeld.map(d => {
                    const advancement = newState.currentPlay.type === 'TAG_UP' ? 1 : 1;
                    const holdBase = d.from + advancement;
                    return `${d.runner.name} holds at ${getOrdinal(holdBase)}.`;
                });
                initialEvent += ` ${heldMessages.join(' ')}`;
            }

            // Trailing runners NOT sent stay at their current positions:
            // - ADVANCE: already at optimistic positions (original base + 1) from applyOutcome
            // - TAG_UP: still on their original bases (they hold)
            // No additional base mutations needed here.

            const originalOuts = newState.outs;

            const { newState: resolvedState, events } = resolveThrow(newState, throwTo, outfieldDefense, getSpeedValue, finalizeEvent, initialEvent, teamInfo);
            newState = resolvedState;

            const batterOnFirst = newState.bases.first;
            if (batterOnFirst && !newState.bases.second && newState.currentAtBat.swingRollResult?.outcome === '1B+') {
                newState.bases.second = batterOnFirst;
                newState.bases.first = null;
                const stealEvent = `${batterOnFirst.displayName} steals second without a throw!`;
                await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, offensiveTeam.user_id, currentTurn + 1, 'game_event', stealEvent]);
            }
            if (newState.currentPlay?.payload?.hitType === '2B' && newState.currentPlay?.payload?.batter) {
                newState.bases.second = newState.currentPlay.payload.batter;
            }

            newState.currentPlay = null;

            if (events.length > 0) {
                let consolidatedLogMessage = events[0];
                if (newState.outs > originalOuts || type === 'TAG_UP') {
                    consolidatedLogMessage += ` <strong>Outs: ${newState.outs}</strong>`;
                }
                if (consolidatedLogMessage) {
                    const finalLogMessageWithScore = appendScoreToLog(consolidatedLogMessage, newState, currentState.currentAtBat.awayScoreBeforePlay, currentState.currentAtBat.homeScoreBeforePlay);
                    const rollData = buildAtBatRollData(newState, currentState.isTopInning);
                    await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, offensiveTeam.user_id, currentTurn + 1, 'baserunning', finalLogMessageWithScore, rollData]);
                }
            }

            if (newState.gameOver) {
              const updateResult = await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
                [gameId]
              );
              if (updateResult.rowCount > 0) {
                  await handleSeriesProgression(gameId, client, newState);
              }
            } else if (newState.outs >= 3) {
                 if (newState.isTopInning) {
                    newState.isBetweenHalfInningsAway = true;
                } else {
                    newState.isBetweenHalfInningsHome = true;
                }
            }

            newState.awayPlayerReadyForNext = false;
            newState.homePlayerReadyForNext = false;
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]);

        } else if (sentRunners.length > 1) {
            newState.currentPlay.payload.choices = decisions;
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
        } else { // 0 runners sent
            let { initialEvent, autoHoldDecisions = [] } = newState.currentPlay.payload;

            if (autoHoldDecisions.length > 0) {
                const heldMessages = autoHoldDecisions.map(d => {
                    const advancement = newState.currentPlay.type === 'TAG_UP' ? 1 : 1; // On a single, they hold at the next base
                    const holdBase = d.from + advancement;
                    return `${d.runner.name} holds at ${getOrdinal(holdBase)}.`;
                });
                initialEvent += ` ${heldMessages.join(' ')}`;
            }

            const batterOnFirst = newState.bases.first;
            const rawOutcome = newState.currentAtBat.swingRollResult?.outcome;
            const outcome = typeof rawOutcome === 'string' ? rawOutcome.trim() : rawOutcome;

            if (batterOnFirst && !newState.bases.second && outcome === '1B+') {
                newState.bases.second = batterOnFirst;
                newState.bases.first = null;
                const stealEvent = `${batterOnFirst.displayName} steals second without a throw!`;

                // Append this event to the initial event if possible, or create a new one.
                // Here we just append it to initialEvent for the log.
                initialEvent = initialEvent ? `${initialEvent} ${stealEvent}` : stealEvent;

                // We also need to explicitly log it if we aren't creating a consolidated event below?
                // The block below logs `initialEvent`. So modifying `initialEvent` is sufficient.
            }

            if (initialEvent) {
                if (newState.currentPlay?.type === 'TAG_UP') {
                    initialEvent += ` <strong>Outs: ${newState.outs}</strong>`;
                }
                const finalLogMessage = appendScoreToLog(initialEvent, newState, currentState.currentAtBat.awayScoreBeforePlay, currentState.currentAtBat.homeScoreBeforePlay);
                const rollData = buildAtBatRollData(newState, currentState.isTopInning);
                await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, offensiveTeam.user_id, currentTurn + 1, 'baserunning', finalLogMessage, rollData]);
            }
            newState.currentPlay = null;
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);
        }
        
        await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
        await client.query('COMMIT');

        const gameData = await getAndProcessGameData(gameId, client);
        io.to(gameId).emit('game-updated', gameData);
        res.sendStatus(200);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error submitting decisions for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error during decision submission.' });
    } finally {
        client.release();
    }
});

app.post('/api/games/:gameId/resolve-throw', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { throwTo } = req.body;
    const userId = req.user.userId;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const currentState = stateResult.rows[0].state_data;
        let newState = JSON.parse(JSON.stringify(currentState));
        const currentTurn = stateResult.rows[0].turn_number;
        
        commitTransientPlayerIds(newState);
        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);
        const outfieldDefense = await getOutfieldDefense(defensiveTeam);

        if (!newState.currentPlay || !newState.currentPlay.payload) {
            console.error(`Error in resolve-throw for game ${gameId}: currentPlay is missing or invalid.`);
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid game state for resolving a throw.' });
        }

        const { payload } = newState.currentPlay;
        const { choices, initialEvent, decisions } = payload;
        const autoHoldDecisions = payload.autoHoldDecisions || [];  // <-- NEW: extract autoHoldDecisions
        const baseMap = { 1: 'first', 2: 'second', 3: 'third', 4: 'home' };
        const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';
        const originalOuts = newState.outs;

        let allEvents = [];
        const finalBases = { first: null, second: null, third: null };
        const batter = newState.currentAtBat.batter;

        // 1. Place the batter. In this scenario, the batter always ends up on first.
        // We find him by checking who is on the bases in the optimistic state that isn't a part of the advancement decisions.
        const decisionRunnerIds = decisions.map(d => d.runner.card_id);
        if (newState.bases.first && !decisionRunnerIds.includes(newState.bases.first.card_id)) {
            finalBases.first = newState.bases.first;
        } else if (newState.bases.second && !decisionRunnerIds.includes(newState.bases.second.card_id)) {
            finalBases.first = newState.bases.second; // He might have advanced optimistically
        }


        const isTagUp = newState.currentPlay.type === 'TAG_UP';
        const advancementBases = isTagUp ? 1 : 2;

        // 2. Handle runners who were sent.
        for (const decision of decisions) {
            const { runner, from } = decision;
            const targetBase = from + advancementBases;

            if (choices[from.toString()]) { // This runner was sent.
                if (targetBase !== throwTo) {
                    // This is the UNCONTESTED runner.
                    if (targetBase === 4) {
                        newState[scoreKey]++;
                        if (!newState.runnersScored) newState.runnersScored = [];
                        newState.runnersScored.push(toRunnerCard(runner));
                        recordRunForPitcher(newState, runner, newState.currentAtBat.pitcher);
                        allEvents.push(`${runner.name} scores.`);
                    } else {
                        finalBases[baseMap[targetBase]] = runner;
                        allEvents.push(`${runner.name} advances to ${getOrdinal(targetBase)}.`);
                    }
                }
            } else {
    const isTagUp = newState.currentPlay.type === 'TAG_UP';
    const advancedBase = isTagUp ? from : from + 1;
    finalBases[baseMap[advancedBase]] = runner;
}
        }

        // --- NEW: Handle autoHoldDecisions runners (TAG_UP only) ---
        // These runners were not included in the decisions array but need to be
        // placed into finalBases so they don't disappear.
        for (const holdDec of autoHoldDecisions) {
            const holdBase = holdDec.from + 1; // Tag-up advances 1 base
            if (holdBase <= 3) {
                finalBases[baseMap[holdBase]] = holdDec.runner;
            }
        }

        // 3. Resolve the contested throw.
        const contestedDecision = decisions.find(d => d.from + advancementBases === throwTo);
        if (contestedDecision && choices[contestedDecision.from.toString()]) {
            const contestedRunner = contestedDecision.runner;

            const { type } = newState.currentPlay;
            const d20Roll = Math.floor(Math.random() * 20) + 1;
            const baseSpeed = parseInt(getSpeedValue(contestedRunner), 10);
            let speed = baseSpeed;
            let penalty = 0;
            const adjustments = [];

            if (type === 'ADVANCE') {
                if (throwTo === 4) {
                    speed += 5; // Bonus for going home
                    adjustments.push({ value: 5, reason: 'Going Home' });
                }
                if (newState.outs === 2) {
                    speed += 5; // Bonus for 2 outs
                    adjustments.push({ value: 5, reason: '2 Outs' });
                }
            } else if (type === 'TAG_UP') {
                if (throwTo === 4) {
                    speed += 5; // Bonus for going home
                    adjustments.push({ value: 5, reason: 'Going Home' });
                }
                if (throwTo === 2) {
                    speed -= 5;
                    adjustments.push({ value: -5, reason: 'Tagging to 2nd' });
                }
            }

            const isSafe = speed >= (outfieldDefense + d20Roll);

            newState.throwRollResult = {
                roll: d20Roll, defense: outfieldDefense, target: speed, baseSpeed, penalty,
                outcome: isSafe ? 'SAFE' : 'OUT',
                runner: contestedRunner.name,
                throwToBase: throwTo,
                adjustments
            };

            if (isSafe) {
                if (throwTo === 4) {
                    newState[scoreKey]++;
                    if (!newState.runnersScored) newState.runnersScored = [];
                    newState.runnersScored.push(toRunnerCard(contestedRunner));
                    recordRunForPitcher(newState, contestedRunner, newState.currentAtBat.pitcher);
                    allEvents.push(`${contestedRunner.name} is SAFE at home!`);
                } else {
                    finalBases[baseMap[throwTo]] = contestedRunner;
                    allEvents.push(`${contestedRunner.name} is SAFE at ${getOrdinal(throwTo)}!`);
                }
            } else {
                // Outs on the bases are charged to the current pitcher (runs go to the runner's
                // original pitcher, handled inside recordRunForPitcher via pitcherOfRecordId).
                recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                newState.throwRollResult.runnerOut = toRunnerCard(contestedRunner);
                if (throwTo === 4) {
                    allEvents.push(`${contestedRunner.name} is THROWN OUT at home!`);
                } else {
                    allEvents.push(`${contestedRunner.name} is THROWN OUT at ${getOrdinal(throwTo)}!`);
                }
            }
        }

        // 4. Finalize state updates.
        newState.bases = finalBases;
        newState.currentPlay = null;

        const batterOnFirst = newState.bases.first;
        if (batterOnFirst && !newState.bases.second && newState.currentAtBat.swingRollResult.outcome === '1B+' && throwTo !== 2) {
            newState.bases.second = batterOnFirst;
            newState.bases.first = null;
            allEvents.push(`${batterOnFirst.displayName} steals second without a throw!`);
        }

        // --- NEW: Check for Game Over using the shared logic ---
        // We need team info for the potential game over message
        const teams = await client.query(
            `SELECT t.abbreviation, p.home_or_away
             FROM teams t JOIN users u ON t.user_id = u.user_id
             JOIN game_participants p ON u.user_id = p.user_id
             WHERE p.game_id = $1`, [gameId]
        );
        const teamInfo = {
            home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
            away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
        };

        // Pass the allEvents array. checkGameOverOrInningChange will append to it if needed.
        checkGameOverOrInningChange(newState, allEvents, teamInfo);

        // Sort events to be more logical: lead runner first.
        allEvents.sort((a, b) => a.includes('3rd') ? -1 : 1);
        let combinedLogMessage = initialEvent ? `${initialEvent} ${allEvents.join(' ')}` : allEvents.join(' ');
        if (newState.outs > originalOuts || isTagUp) {
            combinedLogMessage += ` <strong>Outs: ${newState.outs}</strong>`;
        }

        if (newState.throwRollResult) {
            newState.throwRollResult.consolidatedOutcome = combinedLogMessage;
        }

        if (allEvents.length > 0) {
            const finalLogMessage = appendScoreToLog(combinedLogMessage, newState, currentState.awayScore, currentState.homeScore);
            const rollData = buildAtBatRollData(newState, currentState.isTopInning);
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, userId, currentTurn + 1, 'baserunning', finalLogMessage, rollData]);
        }

        if (newState.gameOver) {
              const updateResult = await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
                [gameId]
              );
              if (updateResult.rowCount > 0) {
                  await handleSeriesProgression(gameId, client, newState);
              }
        } else if (newState.outs >= 3) {
            if (newState.isTopInning) {
                newState.isBetweenHalfInningsAway = true;
                newState.awayTeam.battingOrderPosition = (newState.awayTeam.battingOrderPosition - 1 + 9) % 9;
            } else {
                newState.isBetweenHalfInningsHome = true;
                newState.homeTeam.battingOrderPosition = (newState.homeTeam.battingOrderPosition - 1 + 9) % 9;
            }
            newState.inningEndedOnCaughtStealing = true;
            // Reset ready flags to ensure both players must click 'Next Hitter' to see the new inning
            newState.homePlayerReadyForNext = false;
            newState.awayPlayerReadyForNext = false;
        }

        newState.awayPlayerReadyForNext = false;
        newState.homePlayerReadyForNext = false;

        await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]);
        await client.query('COMMIT');
        
        const gameData = await getAndProcessGameData(gameId, client);
        io.to(gameId).emit('game-updated', gameData);
        res.status(200).json(gameData);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error resolving throw for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error during throw resolution.' });
    } finally {
        client.release();
    }
});

// NEW ENDPOINT for Infield In Ground Ball Choice
app.post('/api/games/:gameId/resolve-infield-in-gb', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { sendRunner } = req.body; // true or false
    const userId = req.user.userId;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
await client.query('SELECT game_id FROM games WHERE game_id = $1 FOR UPDATE', [gameId]);
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const currentState = stateResult.rows[0].state_data;
        let newState = JSON.parse(JSON.stringify(currentState));
        const currentTurn = stateResult.rows[0].turn_number;

        if (newState.currentPlay?.type !== 'INFIELD_IN_CHOICE') {
            return res.status(400).json({ message: 'Invalid game state for this action.' });
        }
        
        commitTransientPlayerIds(newState);
        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);
        const { batter, runnerOnThird, runnerOnSecond, runnerOnFirst } = newState.currentPlay.payload;
        const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';
        const events = [];

        if (sendRunner) {
            // Give defense a choice to throw home or 1st
            newState.currentPlay = {
                type: 'INFIELD_IN_DEFENSE_CHOICE',
                payload: {
                    batter,
                    runnerOnThird,
                    runnerOnSecond,
                    runnerOnFirst,
                    batterPlayerId: batter.card_id
                }
            };

            await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
            await client.query('COMMIT');

            const gameData = await getAndProcessGameData(gameId, client);
            io.to(gameId).emit('game-updated', gameData);
            return res.status(200).json(gameData);
        } else { // Hold runner
            events.push(`${batter.displayName} grounds out, the runner on third holds.`);
            recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);

            if (newState.outs < 3) {
                 if (runnerOnFirst && runnerOnSecond) { // 1st and 2nd
                    // This case isn't possible based on the entry condition (must have runner on 3rd)
                    // but handling defensively.
                    newState.bases.third = runnerOnSecond;
                    newState.bases.second = runnerOnFirst;
                    newState.bases.first = null;
                } else if (runnerOnFirst) { // 1st and 3rd
                    newState.bases.second = runnerOnFirst;
                    newState.bases.first = null; // runner advanced off first; don't leave a duplicate behind
                }
                // Runner on 2nd holds if they were there (2nd & 3rd)
            }
        }

        newState.currentPlay = null;

        // --- NEW: Check for Game Over on defensive choice ---
        const teams = await client.query(
            `SELECT t.abbreviation, p.home_or_away
             FROM teams t JOIN users u ON t.user_id = u.user_id
             JOIN game_participants p ON u.user_id = p.user_id
             WHERE p.game_id = $1`, [gameId]
        );
        const teamInfo = {
            home_team_abbr: teams.rows.find(t => t.home_or_away === 'home').abbreviation,
            away_team_abbr: teams.rows.find(t => t.home_or_away === 'away').abbreviation
        };

        checkGameOverOrInningChange(newState, events, teamInfo);

        if (newState.gameOver) {
            if (newState.winningTeam === 'home' && !newState.isTopInning && newState.homeScore > newState.awayScore && !events.some(e => e.includes('WALK-OFF'))) {
                 events.push(`WALK-OFF!`);
            }
            const updateResult = await client.query(
              `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1 AND status != 'completed'`,
              [gameId]
            );
            if (updateResult.rowCount > 0) {
                await handleSeriesProgression(gameId, client, newState);
            }
        } else if (newState.outs >= 3) {
             if (newState.isTopInning) {
                newState.isBetweenHalfInningsAway = true;
            } else {
                newState.isBetweenHalfInningsHome = true;
            }
        }
        
        await client.query('INSERT INTO game_states (game_id, turn_number, state_data) VALUES ($1, $2, $3)', [gameId, currentTurn + 1, newState]);
        if (events.length > 0) {
            let logMessage = events.join(' ');
            if (newState.outs > currentState.outs) {
                logMessage += ` <strong>Outs: ${newState.outs}</strong>`;
            }
            const finalLogMessage = appendScoreToLog(logMessage, newState, currentState.awayScore, currentState.homeScore);
            const rollData = buildAtBatRollData(newState, currentState.isTopInning);
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message, roll_data) VALUES ($1, $2, $3, $4, $5, $6)`, [gameId, userId, currentTurn + 1, 'infield-in-gb', finalLogMessage, rollData]);
        }

        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [0, gameId]); // Both players need to see the result
        await client.query('COMMIT');

        const gameData = await getAndProcessGameData(gameId, client);
        io.to(gameId).emit('game-updated', gameData);
        res.sendStatus(200);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error resolving infield in GB for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error during infield in GB resolution.' });
    } finally {
        client.release();
    }
});


// --- HELPER: Determines pitcher availability for a series game ---
async function getPitcherAvailability(gameId, userId, dbClient) {
    const participantResult = await dbClient.query(
      `SELECT roster_id FROM game_participants WHERE game_id = $1 AND user_id = $2`,
      [gameId, userId]
    );

    if (participantResult.rows.length === 0) {
      return { mandatoryPitcherId: null, unavailablePitcherIds: [] };
    }
    const rosterId = participantResult.rows[0].roster_id;

    let mandatoryPitcherId = null;
    let unavailablePitcherIds = [];
    const gameDetailsResult = await dbClient.query('SELECT series_id, game_in_series FROM games WHERE game_id = $1', [gameId]);

    if (gameDetailsResult.rows.length > 0) {
        const { series_id, game_in_series } = gameDetailsResult.rows[0];

        if (series_id && game_in_series > 1) {
            // Find recently used pitchers
            const recentGames = [];
            if (game_in_series > 1) recentGames.push(game_in_series - 1);
            if (game_in_series > 2) recentGames.push(game_in_series - 2);
            if (game_in_series > 3) recentGames.push(game_in_series - 3);

            if (recentGames.length > 0) {
                 const recentStartersResult = await dbClient.query(
                    `SELECT (gp.lineup ->> 'startingPitcher')::int as pitcher_id
                     FROM game_participants gp
                     JOIN games g ON g.game_id = gp.game_id
                     WHERE g.series_id = $1 AND gp.user_id = $2::int AND g.game_in_series = ANY($3::int[]) AND gp.lineup IS NOT NULL`,
                    [series_id, userId, recentGames]
                );
                unavailablePitcherIds = recentStartersResult.rows.map(r => r.pitcher_id).filter(id => id);
            }

            // Determine mandatory pitcher for games 4+
            if (game_in_series > 3) {
                if (game_in_series === 4) {
                    const previousStartersResult = await dbClient.query(
                        `SELECT (gp.lineup ->> 'startingPitcher')::int as pitcher_id
                         FROM game_participants gp
                         JOIN games g ON g.game_id = gp.game_id
                         WHERE g.series_id = $1 AND gp.user_id = $2 AND g.game_in_series IN (1, 2, 3) AND gp.lineup IS NOT NULL`,
                        [series_id, userId]
                    );
                    const previousStarterIds = previousStartersResult.rows.map(r => r.pitcher_id);

                    const rosterSPsResult = await dbClient.query(
                        `SELECT card_id FROM roster_cards WHERE roster_id = $1 AND assignment = 'SP'`,
                        [rosterId]
                    );
                    const rosterSPIds = rosterSPsResult.rows.map(r => r.card_id);

                    const game4Starter = rosterSPIds.find(id => !previousStarterIds.includes(id));
                    if (game4Starter) {
                        mandatoryPitcherId = game4Starter;
                    }
                } else { // Games 5, 6, 7
                    const sourceGameNumber = game_in_series - 4;
                    const sourceGameStarterResult = await dbClient.query(
                        `SELECT (gp.lineup ->> 'startingPitcher')::int as pitcher_id
                         FROM game_participants gp
                         JOIN games g ON g.game_id = gp.game_id
                         WHERE g.series_id = $1 AND gp.user_id = $2 AND g.game_in_series = $3`,
                        [series_id, userId, sourceGameNumber]
                    );
                    if (sourceGameStarterResult.rows.length > 0) {
                        mandatoryPitcherId = sourceGameStarterResult.rows[0].pitcher_id;
                    }
                }
            }
        }
    }
    return { mandatoryPitcherId, unavailablePitcherIds };
}


// GET A USER'S PARTICIPANT INFO FOR A SPECIFIC GAME
// in server.js
app.get('/api/games/:gameId/my-roster', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.userId;
  try {
    const participantResult = await pool.query(
      `SELECT roster_id FROM game_participants WHERE game_id = $1 AND user_id = $2`,
      [gameId, userId]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({ message: 'You are not a participant in this game.' });
    }
    const rosterId = participantResult.rows[0].roster_id;

    const { mandatoryPitcherId, unavailablePitcherIds } = await getPitcherAvailability(gameId, userId, pool);

    const suggestedLineup = await getSuggestedLineup(gameId, userId, pool);

    res.json({ roster_id: rosterId, mandatoryPitcherId, unavailablePitcherIds, suggestedLineup });

  } catch (error) {
    console.error(`Error fetching participant info for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error fetching participant data.' });
  }
});

// GET TEAM ACCOLADES
app.get('/api/teams/:teamId/accolades', authenticateToken, async (req, res) => {
    const { teamId } = req.params;
    try {
        const teamRes = await pool.query(`SELECT team_id, city, name FROM teams WHERE team_id = $1`, [teamId]);
        if (teamRes.rows.length === 0) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        const team = teamRes.rows[0];

        const namePattern = `%${team.name}%`;
        const mappedIds = getMappedIds(teamId);
        const aliases = getFranchiseAliases(team.name);
        const searchPatterns = [namePattern, ...aliases.map(a => `%${a}%`)];

        const allTeamsRes = await pool.query('SELECT team_id, city, name FROM teams');
        const allTeams = allTeamsRes.rows;

        const spaceshipQuery = `
            SELECT season_name, date, winning_team_id, winning_team_name, round FROM series_results
            WHERE (winning_team_id = ANY($1::int[]) OR winning_team_name ILIKE ANY($2::text[]))
            AND round = 'Golden Spaceship'
            ORDER BY date DESC
        `;
        const spoonQuery = `
            SELECT season_name, date, losing_team_id, losing_team_name, round FROM series_results
            WHERE (losing_team_id = ANY($1::int[]) OR losing_team_name ILIKE ANY($2::text[]))
            AND round = 'Wooden Spoon'
            ORDER BY date DESC
        `;
        const submarineQuery = `
            SELECT season_name, date, winning_team_id, winning_team_name, round FROM series_results
            WHERE (winning_team_id = ANY($1::int[]) OR winning_team_name ILIKE ANY($2::text[]))
            AND round = 'Silver Submarine'
            ORDER BY date DESC
        `;

        const spaceshipsRes = await pool.query(spaceshipQuery, [mappedIds, searchPatterns]);
        const spoonsRes = await pool.query(spoonQuery, [mappedIds, searchPatterns]);
        const submarinesRes = await pool.query(submarineQuery, [mappedIds, searchPatterns]);

        const filterAccolades = (rows, isWinner) => {
            return rows.filter(r => {
                const idToCheck = isWinner ? r.winning_team_id : r.losing_team_id;
                const nameToCheck = isWinner ? r.winning_team_name : r.losing_team_name;
                return matchesFranchise(nameToCheck, idToCheck, team, allTeams, mappedIds);
            }).map(r => ({ season_name: r.season_name, date: r.date }));
        };

        res.json({
            spaceships: filterAccolades(spaceshipsRes.rows, true),
            spoons: filterAccolades(spoonsRes.rows, false),
            submarines: filterAccolades(submarinesRes.rows, true)
        });
    } catch (error) {
        console.error('Error fetching team accolades:', error);
        res.status(500).json({ message: 'Server error fetching accolades.' });
    }
});

// Enrich a stored lineup blob (card ids only) with full card details so the
// frontend can display player names / open card modals.
async function enrichLineup(lineup) {
    if (!lineup || !Array.isArray(lineup.battingOrder)) return null;

    const cardIds = lineup.battingOrder.map(spot => spot.card_id);
    if (lineup.startingPitcher) cardIds.push(lineup.startingPitcher);
    const validCardIds = cardIds.filter(id => id > 0);

    const cardsMap = {};
    if (validCardIds.length > 0) {
        const cardsResult = await pool.query(
            `SELECT card_id, name, display_name, team, year, set_name, fielding_ratings, speed, ip, control FROM cards_player WHERE card_id = ANY($1::int[])`,
            [validCardIds]
        );
        cardsResult.rows.forEach(c => {
            c.displayName = c.display_name; // Ensure display property exists
            cardsMap[c.card_id] = c;
        });
    }

    const resolveCard = (cardId) => {
        const card = cardsMap[cardId];
        if (card) return card;
        if (cardId === -1) return REPLACEMENT_HITTER_CARD;
        if (cardId === -2) return REPLACEMENT_PITCHER_CARD;
        return { name: 'Unknown', display_name: 'Unknown', displayName: 'Unknown' };
    };

    return {
        battingOrder: lineup.battingOrder.map(spot => ({ ...spot, player: resolveCard(spot.card_id) })),
        startingPitcher: resolveCard(lineup.startingPitcher)
    };
}

// GET A USER'S LINEUP STATUS FOR A SPECIFIC GAME
app.get('/api/games/:gameId/my-lineup', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.userId;
  try {
    const participantsResult = await pool.query(
      `SELECT user_id, lineup, home_or_away FROM game_participants WHERE game_id = $1`,
      [gameId]
    );

    const myParticipant = participantsResult.rows.find(p => Number(p.user_id) === userId);
    const opponentParticipant = participantsResult.rows.find(p => Number(p.user_id) !== userId);

    if (!myParticipant) {
      // If the user is not a participant, they technically don't have a lineup set.
      return res.json({ hasLineup: false });
    }

    const result = {
        hasLineup: !!myParticipant.lineup
    };

    // Return the user's own submitted lineup so they can review it on the waiting screen.
    if (myParticipant.lineup) {
        result.myLineup = await enrichLineup(myParticipant.lineup);
    }

    // FIX: Only the away team can see the home team's lineup (opponent's lineup) while waiting.
    // The home team cannot see the away team's lineup.
    if (opponentParticipant && opponentParticipant.home_or_away === 'home' && opponentParticipant.lineup) {
        result.opponentLineup = await enrichLineup(opponentParticipant.lineup);
    }

    res.json(result);

  } catch (error) {
    console.error(`Error fetching user lineup info for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error fetching lineup data.' });
  }
});

// GET THE OPPONENT'S FULL ROSTER FOR A SPECIFIC GAME (for scouting on the lineup screens)
app.get('/api/games/:gameId/opponent-roster', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { point_set_id } = req.query;
  const userId = req.user.userId;

  if (!point_set_id) {
    return res.status(400).json({ message: 'A point_set_id is required.' });
  }

  try {
    const participantsResult = await pool.query(
      `SELECT gp.user_id, gp.roster_id, r.roster_type
       FROM game_participants gp
       LEFT JOIN rosters r ON r.roster_id = gp.roster_id
       WHERE gp.game_id = $1`,
      [gameId]
    );

    const me = participantsResult.rows.find(p => Number(p.user_id) === userId);
    if (!me) {
      return res.status(404).json({ message: 'You are not a participant in this game.' });
    }

    const opponent = participantsResult.rows.find(p => Number(p.user_id) !== userId);
    if (!opponent || !opponent.roster_id) {
      return res.json({ cards: [] });
    }

    // Value the opponent's roster against the current season's point set, matching the
    // dashboard. Using the raw requested set valued league rosters at a stale season,
    // which inflated the displayed total above the 5000-point cap.
    const effectivePointSetId = await resolveEffectivePointSetId(point_set_id, opponent.roster_type);

    const rosterCardsResult = await pool.query(`
        SELECT cp.*, rc.is_starter, rc.assignment, ppv.points
        FROM cards_player cp
        JOIN roster_cards rc ON cp.card_id = rc.card_id
        LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id AND ppv.point_set_id = $2
        WHERE rc.roster_id = $1
    `, [opponent.roster_id, effectivePointSetId]);

    res.json({ cards: processPlayers(rosterCardsResult.rows) });

  } catch (error) {
    console.error(`Error fetching opponent roster for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error fetching opponent roster.' });
  }
});

// TEST ROUTE
app.get('/api/test', async (req, res) => {
    try {
        const dbTime = await pool.query('SELECT NOW()');
        res.json({ message: 'API server is running and connected to the database!', dbTime: dbTime.rows[0].now });
    } catch (error) {
        console.error('Database connection test failed:', error);
        res.status(500).json({ message: 'Error connecting to the database.' });
    }
});


// --- SOCKET.IO ---
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('join-game-room', (gameId) => {
    socket.join(gameId);
  });
  socket.on('choice-made', (data) => {
    socket.to(data.gameId).emit('choice-updated', { homeTeamUserId: data.homeTeamUserId });
  });
  socket.on('dh-rule-changed', (data) => {
    socket.to(data.gameId).emit('dh-rule-updated', { useDh: data.useDh });
  });
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// --- SERVER STARTUP ---
async function startServer() {
  console.log('Attempting to connect to database...');
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful!');

    // Start Cron Jobs
    startDraftMonitor();
    startPhantomMonitor();

    // Verify Email Connection
    verifyConnection();

    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ DATABASE CONNECTION FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
startServer();