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
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const authenticateToken = require('./middleware/authenticateToken');
const { applyOutcome, resolveThrow, calculateStealResult, appendScoreToLog, recordOutsForPitcher, recordBatterFaced } = require('./gameLogic');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

const REPLACEMENT_HITTER_CARD = {
    card_id: -1, name: 'Replacement Hitter', display_name: 'Replacement Hitter', on_base: -10, speed: 15,
    points: 0,
    fielding_ratings: { 'C': 0, '1B': 0, '2B': 0, 'SS': 0, '3B': 0, 'LF': 0, 'CF': 0, 'RF': 0 },
    chart_data: { '1-2': 'SO', '3-20': 'GB' },
    control: null,
    image_url: `${BACKEND_URL}/images/replacement.jpg`
};
const REPLACEMENT_PITCHER_CARD = {
    card_id: -2, name: 'Replacement Pitcher', display_name: 'Replacement Pitcher', control: -1, ip: 1, speed: 10,
    points: 0,
    chart_data: { '1-3': 'PU', '4-8': 'SO', '9-12': 'GB', '13-16': 'FB', '17':'BB', '18-19':'1B','20':'2B'},
    fielding_ratings: {},
    image_url: `${BACKEND_URL}/images/replacement.jpg`
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
  methods: ["GET", "POST"]
};
app.use(cors(corsOptions));
const io = module.exports.io = new Server(server, {
  cors: corsOptions
});
const PORT = process.env.PORT || 3001;

// My debugging code starts right after this line
console.log('--- DEBUGGING RENDER ENV ---');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL is set:', !!process.env.DATABASE_URL);
// The following line will print your database URL to the logs.
// We will remove this after debugging.
console.log('DATABASE_URL value:', process.env.DATABASE_URL);
console.log('--- END DEBUGGING ---');

const dbConfig = process.env.NODE_ENV === 'production'
  ? { // For Render/production
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : { // For local development
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_DATABASE,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    };
const pool = module.exports.pool = new Pool(dbConfig);
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'card_images')));


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

async function getSuggestedLineup(gameId, userId, dbClient) {
    try {
        // 1. Get current game details
        const gameResult = await dbClient.query('SELECT series_id, game_in_series, use_dh FROM games WHERE game_id = $1', [gameId]);
        if (gameResult.rows.length === 0) return null;
        const { series_id, game_in_series, use_dh } = gameResult.rows[0];

        // 2. If not a series or first game, return null
        if (!series_id || game_in_series <= 1) return null;

        // 3. Find previous game in series with SAME DH rule
        const sameRuleQuery = `
            SELECT gp.lineup
            FROM game_participants gp
            JOIN games g ON gp.game_id = g.game_id
            WHERE g.series_id = $1
              AND gp.user_id = $2
              AND g.game_in_series < $3
              AND g.use_dh = $4
              AND gp.lineup IS NOT NULL
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
            SELECT gp.lineup, g.use_dh as prev_use_dh
            FROM game_participants gp
            JOIN games g ON gp.game_id = g.game_id
            WHERE g.series_id = $1
              AND gp.user_id = $2
              AND g.game_in_series < $3
              AND gp.lineup IS NOT NULL
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
                // Need to replace 'DH' with 'P' (placeholder for pitcher)
                return battingOrder.map(spot => {
                    if (spot.position === 'DH') {
                        return { ...spot, position: 'P', card_id: 'PITCHER_PLACEHOLDER' };
                    }
                    return spot;
                });
            } else if (!prev_use_dh && use_dh) {
                // Previous: DH (NO) -> Current: DH (YES)
                // Need to replace 'P' with 'DH' (placeholder for DH)
                return battingOrder.map(spot => {
                    if (spot.position === 'P') {
                         return { ...spot, position: 'DH', card_id: 'DH_PLACEHOLDER' };
                    }
                    return spot;
                });
            }
            return battingOrder;
        }
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

function getEffectiveControl(pitcher, pitcherStats, inning) {
    if (!pitcher || typeof pitcher.control !== 'number') return null;
    if (!pitcherStats) return pitcher.control;

    const pitcherId = pitcher.card_id;
    const stats = pitcherStats[pitcherId] || { runs: 0, innings_pitched: [], fatigue_modifier: 0 };
    const inningsPitched = stats.innings_pitched || [];

    // For UI display purposes, we want to predict the fatigue for the current inning
    // before the first pitch has been thrown.
    let potentialInningsPitched = [...inningsPitched];
    if (!potentialInningsPitched.includes(inning)) {
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
    const pitcherId = pitcher.card_id;

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

async function validateLineup(participant, newState, gameId, client) {
    const lineup = participant.lineup.battingOrder;

    const teamKey = participant.home_or_away === 'home' ? 'homeTeam' : 'awayTeam';
    const teamState = newState[teamKey];

    // --- ROSTER RECOVERY LOGIC ---
    if (!teamState.roster) {
        console.warn(`[validateLineup] Roster missing for ${teamKey}. Attempting to fetch...`);

        // Try 1: Fetch from game_rosters (the snapshot)
        try {
            const rosterResult = await client.query(
                'SELECT roster_data FROM game_rosters WHERE game_id = $1 AND user_id = $2',
                [gameId, participant.user_id]
            );
            if (rosterResult.rows.length > 0) {
                teamState.roster = rosterResult.rows[0].roster_data;
                console.log(`[validateLineup] Roster recovered from game_rosters for ${teamKey}.`);
            } else {
                // Try 2: Fetch from current roster_cards (fallback for very old games)
                console.warn(`[validateLineup] Snapshot not found. Fetching from current roster for ${teamKey}...`);
                if (participant.roster_id) {
                     const rosterCardsResult = await client.query(`
                        SELECT cp.*, rc.assignment
                        FROM cards_player cp
                        JOIN roster_cards rc ON cp.card_id = rc.card_id
                        WHERE rc.roster_id = $1
                    `, [participant.roster_id]);
                    teamState.roster = rosterCardsResult.rows;
                    console.log(`[validateLineup] Roster recovered from roster_cards for ${teamKey}.`);
                }
            }
        } catch (err) {
            console.error(`[validateLineup] Error fetching roster:`, err);
        }
    }

    // --- ASSIGNMENT RECOVERY LOGIC (For old snapshots) ---
    if (participant.roster_id) {
        teamState.roster = await hydrateRosterAssignments(client, teamState.roster, participant.roster_id);
    }

    if (!teamState || !teamState.roster) {
        // Defensive: If roster isn't in the state for some reason (e.g., older game),
        // we'll skip the more advanced validation for now.
        console.warn(`[validateLineup] Roster missing for ${teamKey}. Skipping validation.`);
        newState.awaiting_lineup_change = false;
        return newState;
    }

    const cardsById = teamState.roster.reduce((acc, card) => {
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

    const participants = await client.query('SELECT user_id, roster_id FROM game_participants WHERE game_id = $1', [gameId]);

    for (const participant of participants.rows) {
        const rosterCardsResult = await client.query(
            `SELECT cp.* FROM cards_player cp JOIN roster_cards rc ON cp.card_id = rc.card_id WHERE rc.roster_id = $1 AND cp.ip IS NOT NULL AND cp.ip <= 3`,
            [participant.roster_id]
        );
        const relievers = rosterCardsResult.rows;

        const prevGameNumber = game_in_series - 1;
        const prevTwoGameNumber = game_in_series - 2;

        const prevGameResult = await client.query('SELECT game_id FROM games WHERE series_id = $1 AND game_in_series = $2', [series_id, prevGameNumber]);
        if (prevGameResult.rows.length === 0) continue;
        const prevGameId = prevGameResult.rows[0].game_id;

        let prevTwoGameId = null;
        if (prevTwoGameNumber > 0) {
            const prevTwoGameResult = await client.query('SELECT game_id FROM games WHERE series_id = $1 AND game_in_series = $2', [series_id, prevTwoGameNumber]);
            if (prevTwoGameResult.rows.length > 0) {
                prevTwoGameId = prevTwoGameResult.rows[0].game_id;
            }
        }

        // Fetch only the last state of the previous game to check final stats
        const prevGameStatesResult = await client.query('SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [prevGameId]);
        const lastPrevGameState = prevGameStatesResult.rows.length > 0 ? prevGameStatesResult.rows[0].state_data : null;

        let lastPrevTwoGameState = null;
        if (prevTwoGameId) {
             const prevTwoGameStatesResult = await client.query('SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [prevTwoGameId]);
             lastPrevTwoGameState = prevTwoGameStatesResult.rows.length > 0 ? prevTwoGameStatesResult.rows[0].state_data : null;
        }

        for (const reliever of relievers) {
            let isTired = false;
            let pitchedInPrevGame = false;

            // Check if they pitched in the previous game (Yesterday)
            if (lastPrevGameState) {
                const prevGameStats = lastPrevGameState.pitcherStats && lastPrevGameState.pitcherStats[reliever.card_id];
                pitchedInPrevGame = prevGameStats && (prevGameStats.batters_faced > 0 || (prevGameStats.innings_pitched && prevGameStats.innings_pitched.length > 0));
            }

            if (lastPrevTwoGameState && lastPrevGameState) {
                // Check if they pitched in both of the last two games
                // We check the pitcherStats object in the final state of each game.
                const prevTwoGameStats = lastPrevTwoGameState.pitcherStats && lastPrevTwoGameState.pitcherStats[reliever.card_id];
                const pitchedInPrevTwoGame = prevTwoGameStats && (prevTwoGameStats.batters_faced > 0 || (prevTwoGameStats.innings_pitched && prevTwoGameStats.innings_pitched.length > 0));

                if (pitchedInPrevGame && pitchedInPrevTwoGame) {
                    isTired = true;
                }
            }

            if (!isTired && lastPrevGameState) {
                // Check if they exceeded their fatigue threshold in the previous game alone.
                // We use the final stats from the last game.
                const stats = (lastPrevGameState.pitcherStats && lastPrevGameState.pitcherStats[reliever.card_id]) || { runs: 0, innings_pitched: [] };

                // FIX: Use innings_pitched.length instead of undefined .ip property
                const ipRecorded = stats.innings_pitched ? stats.innings_pitched.length : 0;
                const fatigueThreshold = reliever.ip - Math.floor(stats.runs / 3);

                // FIX: A reliever is only considered tired for the NEXT game if they pitched MORE than 1 inning
                // AND exceeded their threshold. This prevents a reliever who pitched 1 inning but allowed runs (threshold < 1)
                // from being marked as tired, honoring the rule that you aren't tired if you didn't pitch *while* tired.
                if (ipRecorded > fatigueThreshold && ipRecorded > 1) {
                    isTired = true;
                }
            }

            let statsEntry = finalPitcherStats[reliever.card_id] || { runs: 0, innings_pitched: [], fatigue_modifier: 0 };

            if (isTired) {
                statsEntry.fatigue_modifier = -reliever.ip;
            }

            if (pitchedInPrevGame) {
                statsEntry.pitchedYesterday = true;
            }

            if (isTired || pitchedInPrevGame) {
                finalPitcherStats[reliever.card_id] = statsEntry;
            }
        }
    }

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
            s.series_type
        FROM games g
        JOIN series s ON g.series_id = s.id
        WHERE g.game_id = $1
    `, [gameId]);

    if (gameAndSeriesResult.rows.length === 0) {
        return; // Not a series game.
    }

    const seriesInfo = gameAndSeriesResult.rows[0];
    const { series_id, game_home_user_id, game_in_series, series_home_user_id, series_type } = seriesInfo;
    let { series_away_user_id, home_wins, away_wins } = seriesInfo; // mutable wins/away user

    const participantsResult = await client.query('SELECT user_id, roster_id, league_designation FROM game_participants WHERE game_id = $1', [gameId]);
    const gameAwayParticipant = participantsResult.rows.find(p => p.user_id !== game_home_user_id);
    const gameAwayUserId = gameAwayParticipant.user_id;

    // 2. Update series away user if it's the first game and not set yet
    if (!series_away_user_id) {
        await client.query('UPDATE series SET series_away_user_id = $1 WHERE id = $2', [gameAwayUserId, series_id]);
        series_away_user_id = gameAwayUserId; // Update local copy
    }

    // 3. Robustly determine winner and update series score
    const gameWinnerId = finalState.winningTeam === 'home' ? game_home_user_id : gameAwayUserId;

    if (gameWinnerId === series_home_user_id) {
        await client.query('UPDATE series SET home_wins = home_wins + 1 WHERE id = $1', [series_id]);
        home_wins++;
    } else if (gameWinnerId === series_away_user_id) {
        await client.query('UPDATE series SET away_wins = away_wins + 1 WHERE id = $1', [series_id]);
        away_wins++;
    }

    // 4. Check if the series is over
    let isSeriesOver = false;
    if (series_type === 'playoff' && (home_wins >= 4 || away_wins >= 4)) {
        isSeriesOver = true;
    }
    if (series_type === 'regular_season' && game_in_series >= 7) {
        isSeriesOver = true;
    }

    if (isSeriesOver) {
        await client.query(`UPDATE series SET status = 'completed' WHERE id = $1`, [series_id]);
        io.emit('games-updated'); // Notify clients the series is done
        return;
    }

    // 5. If not over, create the next game in the series
    const nextGameNumber = game_in_series + 1;
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

// --- SINGLE ROSTER ENDPOINTS ---
// in server.js
app.get('/api/my-roster', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
        const rosterResult = await pool.query('SELECT roster_id, user_id FROM rosters WHERE user_id = $1', [userId]);
        if (rosterResult.rows.length === 0) {
            return res.json(null);
        }
        
        const roster = rosterResult.rows[0];
        const cardsResult = await pool.query(
            `SELECT cp.*, rc.is_starter, rc.assignment 
             FROM cards_player cp 
             JOIN roster_cards rc ON cp.card_id = rc.card_id 
             WHERE rc.roster_id = $1`,
            [roster.roster_id]
        );
        
        res.json({ ...roster, cards: cardsResult.rows });

    } catch (error) {
        console.error('Error fetching user roster:', error);
        res.status(500).json({ message: 'Server error while fetching roster.' });
    }
});

// CREATE or UPDATE a user's single roster (Upsert)
app.post('/api/my-roster', authenticateToken, async (req, res) => {
    const { cards } = req.body;
    const userId = req.user.userId;

    if (!cards || cards.length !== 20) {
        return res.status(400).json({ message: 'A valid roster requires a name and 20 cards.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const existingRoster = await client.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userId]);
        let rosterId;

        if (existingRoster.rows.length > 0) {
            rosterId = existingRoster.rows[0].roster_id;
            await client.query('DELETE FROM roster_cards WHERE roster_id = $1', [rosterId]);
        } else {
            const newRoster = await client.query('INSERT INTO rosters (user_id) VALUES ($1) RETURNING roster_id', [userId]);
            rosterId = newRoster.rows[0].roster_id;
        }

        // Insert the new set of cards with their specific assignments
        for (const card of cards) {
            await client.query(
                'INSERT INTO roster_cards (roster_id, card_id, is_starter, assignment) VALUES ($1, $2, $3, $4)',
                [rosterId, card.card_id, card.is_starter, card.assignment]
            );
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
      `UPDATE game_participants SET lineup = $1::jsonb WHERE game_id = $2 AND user_id = $3`,
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
        isBetweenHalfInningsAway: false,
        isBetweenHalfInningsHome: false,
        awayTeam: { userId: awayParticipant.user_id, team_id: awayParticipant.team_id, rosterId: awayParticipant.roster_id, battingOrderPosition: 0, used_player_ids: [], roster: awayRosterData },
        homeTeam: { userId: homeParticipant.user_id, team_id: homeParticipant.team_id, rosterId: homeParticipant.roster_id, battingOrderPosition: 0, used_player_ids: [], roster: homeRosterData },
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

      console.log(`--- BACKEND: Emitting 'game-starting' to room ${gameId} ---`);
      io.to(gameId).emit('game-starting');
    } else {
      io.to(gameId).emit('lineup-submitted');
    }

    await client.query('COMMIT');
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
    console.log('4. Backend received request for /api/available-teams.');
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

    const pitcherStats = gameState.pitcherStats ? gameState.pitcherStats[playerOutId] : null;

    if (playerOutId == startingPitcherId) {
        const outsRecorded = pitcherStats ? (pitcherStats.outs_recorded || 0) : 0;
        if (outsRecorded < 12) {
            // Check 1: Is the pitcher tired RIGHT NOW? (Primarily for defensive subs)
            const effectiveControl = getEffectiveControl(playerOutCard, gameState.pitcherStats, gameState.inning);
            if (effectiveControl < playerOutCard.control) {
                return { isValid: true }; // Pitcher is tired, can be subbed out.
            }

            // Check 2: If it's an offensive sub, will the pitcher be tired for their NEXT defensive inning?
            if (isOffensiveSub) {
                // If the offensive team is the away team (top of inning), their next defensive inning is the bottom of the current inning.
                // If the offensive team is the home team (bottom of inning), their next defensive inning is the top of the next inning.
                const nextDefensiveInning = !gameState.isTopInning ? gameState.inning + 1 : gameState.inning;
                const projectedEffectiveControl = getEffectiveControl(playerOutCard, gameState.pitcherStats, nextDefensiveInning);
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

    const isPlayerInLineup = (p, id) => p && p.lineup && (
        p.lineup.battingOrder.some(spot => spot.card_id === id) ||
        p.lineup.startingPitcher === id
    );

    let participant;
    let teamKey;

    if (isPlayerInLineup(homeParticipant, playerOutId)) {
        participant = homeParticipant;
        teamKey = 'homeTeam';
    } else if (isPlayerInLineup(awayParticipant, playerOutId)) {
        participant = awayParticipant;
        teamKey = 'awayTeam';
    } else {
        // Fallback for players not in a lineup (e.g., pinch runners on base)
        const requestingParticipant = allParticipants.find(p => p.user_id === userId);
        if (!requestingParticipant) {
             return res.status(403).json({ message: 'Requesting user not found in this game.' });
        }
        participant = requestingParticipant;
        teamKey = participant.home_or_away === 'home' ? 'homeTeam' : 'awayTeam';
    }

    const offensiveTeamKey = newState.isTopInning ? 'awayTeam' : 'homeTeam';
    const isOffensiveSub = teamKey === offensiveTeamKey;
    // --- END REVISED TEAM IDENTIFICATION LOGIC ---

    const homeUsed = newState.homeTeam.used_player_ids || [];
    const awayUsed = newState.awayTeam.used_player_ids || [];
    const allUsedPlayerIds = [...homeUsed, ...awayUsed];
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

    let originalStartingPitcher = teamKey === 'homeTeam' ? initialState.currentHomePitcher : initialState.currentAwayPitcher;
    // Fallback for corrupted game states where the original starter wasn't saved (likely a replacement pitcher bug)
    if (!originalStartingPitcher) {
        originalStartingPitcher = REPLACEMENT_PITCHER_CARD;
    }

    const pitcherValidationResult = validatePitcherSubstitution(newState, playerOutCard, playerOutId, originalStartingPitcher.card_id, isOffensiveSub);
    if (!pitcherValidationResult.isValid) {
        return res.status(400).json({ message: pitcherValidationResult.message });
    }

    if (playerInIdInt > 0 && allUsedPlayerIds.includes(playerInIdInt)) {
        return res.status(400).json({ message: 'This player has already been in the game and cannot re-enter.' });
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
                const pitcherId = playerOutCard.card_id;

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
                 const pitcherId = playerOutCard.card_id;
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
        }
        // Pinch runner logic is handled by updating the `bases` object, which was done above.

        // The critical check: If the player being replaced was a pitcher (either as batter or runner),
        // the substituting team will need a new pitcher for their NEXT defensive inning.
        // We flag this by nullifying their designated pitcher slot, but we DO NOT touch `currentAtBat.pitcher`.
        if (playerOutCard.control !== null) {
            if (teamKey === 'homeTeam') {
                newState.currentHomePitcher = null;
            } else {
                newState.currentAwayPitcher = null;
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
            lineup[spotIndex].position = position;
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
        if (!newState[teamKey].used_player_ids) {
            newState[teamKey].used_player_ids = [];
        }
        if (!newState[teamKey].used_player_ids.includes(playerOutIdInt)) {
            newState[teamKey].used_player_ids.push(playerOutIdInt);
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
        const rosterCardsResult = await pool.query(rosterCardsQuery, [rosterId, point_set_id]);

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

// in server.js
// in server.js
app.get('/api/games', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const gamesResult = await pool.query(
      `SELECT g.game_id, g.status, g.current_turn_user_id, g.home_team_user_id, g.game_in_series, g.created_at, g.completed_at
       FROM games g JOIN game_participants gp ON g.game_id = gp.game_id 
       WHERE gp.user_id = $1 ORDER BY g.created_at DESC`,
      [userId]
    );

    const processedGames = [];
    for (const game of gamesResult.rows) {
        const participantsResult = await pool.query(
            `SELECT u.user_id, t.city, t.name, t.abbreviation, t.display_format
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
            if (Number(p.user_id) === homeUserId) {
                home_team_abbr = p.abbreviation;
            } else {
                away_team_abbr = p.abbreviation;
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
        if (game.series_id) {
            const seriesResult = await pool.query('SELECT * FROM series WHERE id = $1', [game.series_id]);
            if (seriesResult.rows.length > 0) {
                series = seriesResult.rows[0];
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


        processedGames.push({ ...game, opponent, gameState, series, home_team_abbr, away_team_abbr, status_text });
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
    // Order by created_at descending to have the newest sets first
    const pointSetsResult = await pool.query('SELECT * FROM point_sets ORDER BY created_at DESC');
    res.json(pointSetsResult.rows);
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
            SELECT
                cp.*,
                ppv.points
            FROM cards_player cp
            LEFT JOIN player_point_values ppv ON cp.card_id = ppv.card_id
            WHERE ppv.point_set_id = $1
            ORDER BY cp.display_name;
        `;
        const allCardsResult = await pool.query(query, [point_set_id]);
        const processedCards = processPlayers(allCardsResult.rows);
        res.json(processedCards);
    } catch (error) {
        console.error('Error fetching player cards with points:', error);
        res.status(500).json({ message: 'Server error fetching player cards.' });
    }
});

// GAME SETUP & PLAY
app.post('/api/games', authenticateToken, async (req, res) => {
    const { roster_id, home_or_away, league_designation, series_type } = req.body;
    const userId = req.user.userId;
    if (!roster_id || !home_or_away || !league_designation || !series_type) {
        return res.status(400).json({ message: 'roster_id, home_or_away, league_designation, and series_type are required.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let gameId;

        if (series_type !== 'exhibition') {
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

  try {
    console.log(`3. Backend: Received request for /api/games/${gameId}/setup.`);
    await pool.query(
      `UPDATE games SET home_team_user_id = $1, use_dh = $2, status = 'lineups' WHERE game_id = $3`,
      [homeTeamUserId, useDh, gameId]
    );
    console.log(`4. Backend: Emitting 'setup-complete' to room ${gameId}.`);
    io.emit('games-updated'); // This is the global signal for all dashboards.
    io.to(gameId).emit('setup-complete'); // This is the specific signal for the two players in this game.
    
    res.status(200).json({ message: 'Game setup complete.' });
  } catch (error) {
    console.error('Error in game setup:', error);
    res.status(500).json({ message: 'Server error during game setup.' });
  }
});

// in server.js
app.get('/api/games/:gameId/setup', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  try {
    // 1. Get game info, including the declared home team
    const gameQuery = await pool.query(
      'SELECT setup_rolls, home_team_user_id, use_dh FROM games WHERE game_id = $1',
      [gameId]
    );

    // 2. Get participant info, including team branding
    const participantsQuery = await pool.query(
      `SELECT u.user_id, t.city, t.name, t.logo_url, t.display_format 
       FROM users u
       JOIN teams t ON u.team_id = t.team_id
       JOIN game_participants gp ON u.user_id = gp.user_id
       WHERE gp.game_id = $1`,
      [gameId]
    );
    
    // 3. Process participants to create the full display name
    const participants = participantsQuery.rows.map(p => {
        const format = p.display_format || '{city} {name}'; // Use default if null
        p.full_display_name = format.replace('{city}', p.city).replace('{name}', p.name);
        return p;
    });

    // 4. Send the complete payload to the frontend
    res.json({
        rolls: gameQuery.rows[0]?.setup_rolls || {},
        homeTeamUserId: gameQuery.rows[0]?.home_team_user_id || null,
        useDh: gameQuery.rows[0]?.use_dh,
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
        const participantsResult = await client.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
        if (participantsResult.rows.length >= 2) return res.status(400).json({ message: 'This game is already full.' });
        if (participantsResult.rows[0].user_id === joiningUserId) return res.status(400).json({ message: 'You cannot join your own game.' });
        
        const hostPlayerParticipant = participantsResult.rows[0];
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
        pitcher.effectiveControl = getEffectiveControl(pitcher, currentState.state_data.pitcherStats, currentState.state_data.inning);
    }

    // Add fatigue status to all bullpen pitchers in the rosters
    const processRosterFatigue = (roster, pitcherStats, inning) => {
        if (!roster) return;
        roster.forEach(player => {
            // FIX: A reliever is identified by having a base IP of 3 or less.
            // The `player.ip > 0` check was preventing us from flagging relievers
            // who were tired from a previous game but hadn't pitched in this one.
            if (player.ip <= 3) { // It's a reliever
                const stats = pitcherStats ? pitcherStats[player.card_id] : null;

                if (stats?.pitchedYesterday) {
                    player.pitchedYesterday = true;
                }

                if (stats?.fatigue_modifier && stats.fatigue_modifier < 0) {
                    player.fatigueStatus = 'tired';
                } else {
                    const effectiveControl = getEffectiveControl(player, pitcherStats, inning);
                    if (effectiveControl < player.control) {
                         player.fatigueStatus = 'tired';
                    } else {
                         player.fatigueStatus = 'rested';
                    }
                }
            }
        });
    };

    if (currentState?.state_data?.pitcherStats) {
        processRosterFatigue(rosters.home, currentState.state_data.pitcherStats, currentState.state_data.inning);
        processRosterFatigue(rosters.away, currentState.state_data.pitcherStats, currentState.state_data.inning);
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
    let stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    let finalState = { ...currentState };
    if (finalState.stealAttemptDetails) {
        finalState.stealAttemptDetails.clearedForOffense = true;
        if (finalState.stealAttemptDetails.clearedForDefense) {
            finalState.stealAttemptDetails = null;
        }
    }
    const { offensiveTeam } = await getActivePlayers(gameId, finalState);

    finalState.currentAtBat.batterAction = action;

    // If the pitcher has already acted, we resolve the at-bat now.
    if (finalState.currentAtBat.pitcherAction === 'pitch') {
      // Now that both players have acted, clear any leftover steal/throw results from the previous state.
      finalState.lastStealResult = null;
      finalState.pendingStealAttempt = null;
      finalState.throwRollResult = null;

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

      const { newState, events, scorers, outcome: finalOutcome } = applyOutcome(finalState, outcome, batter, pitcher, infieldDefense, outfieldDefense, getSpeedValue, swingRoll, chartHolder, teamInfo);
      finalState = { ...newState };
      finalState.defensivePlayerWentSecond = false;
      finalState.currentAtBat.swingRollResult = { roll: swingRoll, outcome: finalState.walkoffAdjustedOutcome || finalOutcome, batter, eventCount: events.length };
      
      
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
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'game_event', finalLogMessage]);
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
    let stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    const { batter, pitcher, offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, currentState);
    processPlayers([batter, pitcher]);
    
    // --- Pitcher Fatigue Logic ---
    // The fatigue calculation is now handled in the `/next-hitter` endpoint.
    // We just need to retrieve the effectiveControl for the current at-bat.
    const effectiveControl = getEffectiveControl(pitcher, currentState.pitcherStats, currentState.inning);

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
            const pitcherId = pitcher.card_id;
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

            const { newState, events, scorers, outcome: finalOutcome } = applyOutcome(finalState, outcome, batter, pitcher, infieldDefense, outfieldDefense, getSpeedValue, swingRoll, chartHolder, teamInfo);
            finalState = { ...newState };
            finalState.defensivePlayerWentSecond = true;
            finalState.currentAtBat.swingRollResult = { roll: swingRoll, outcome: finalState.walkoffAdjustedOutcome || finalOutcome, batter, eventCount: events.length };

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
                  await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'game_event', finalLogMessage]);
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
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    const originalState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;
    let newState = JSON.parse(JSON.stringify(originalState));

    const isHomePlayer = Number(userId) === Number(newState.homeTeam.userId);

    // --- THIS IS THE NEW LOGIC ---
    // If you are the FIRST player to click, advance the game state.
    if (!originalState.homePlayerReadyForNext && !originalState.awayPlayerReadyForNext) {
      // 1. Save the completed/interrupted at-bat for the other player to see.
      newState.lastCompletedAtBat = { ...newState.currentAtBat,
        bases: newState.currentAtBat.basesBeforePlay,
        eventCount: newState.currentAtBat.swingRollResult?.eventCount || 1,
        outs: newState.outsBeforePlay
       };

      // Clear details from the previous play.
      delete newState.stealAttemptDetails;
      
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
          pitcher.effectiveControl = getEffectiveControl(pitcher, newState.pitcherStats, newState.inning);
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

    // Mark the current player as ready.
    if (isHomePlayer) {
      newState.homePlayerReadyForNext = true;
    } else {
      newState.awayPlayerReadyForNext = true;
    }
    
    // If BOTH players are now ready, reset the flags for the next cycle.
    if (newState.homePlayerReadyForNext && newState.awayPlayerReadyForNext) {
      newState.homePlayerReadyForNext = false;
      newState.awayPlayerReadyForNext = false;
      newState.defensivePlayerWentSecond = false; // Reset for the new at-bat cycle
      newState.inningEndedOnCaughtStealing = false,
      // --- THIS IS THE FIX ---
      // Now that both players have acknowledged the result, clear the details.
      newState.doublePlayDetails = null;
      newState.throwRollResult = null;
      newState.lastStealResult = null;

      if (newState.currentPlay?.type !== 'STEAL_ATTEMPT') {
        newState.currentPlay = null;
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
    let stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let newState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    const { defensiveTeam } = await getActivePlayers(gameId, newState);
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
                const stealResult = calculateStealResult(runner, toBase, catcherArm, getSpeedValue);
                isSafe = stealResult.isSafe;
                const { outcome, ...resultDetails } = stealResult;
                const runnerName = runner.name;

                if (!isSafe) {
                    recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                }

                const logMessage = outcome === 'SAFE'
                    ? `${runnerName} takes off for ${getOrdinal(toBase)}... SAFE!`
                    : `${runnerName} takes off for ${getOrdinal(toBase)}... CAUGHT STEALING! <strong>Outs: ${newState.outs}</strong>`;
                await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'steal', logMessage]);

                if (isSafe) {
                    newState.bases[baseMap[toBase]] = runner;
                }
                newState.bases[baseMap[fromBase]] = null;

                newState.pendingStealAttempt = {
                    runner,
                    runnerName,
                    throwToBase: toBase,
                    outcome,
                    ...resultDetails
                };
                // We still use currentPlay to manage the overall "steal sequence" state
                newState.currentPlay = {
                    type: 'STEAL_ATTEMPT',
                    payload: { decisions }
                };

                // CRITICAL CHANGE: If safe, it's both players' turn. If out, it's the defense's turn to clean up.
                const nextTurnUserId = isSafe ? 0 : defensiveTeam.user_id;
                await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [nextTurnUserId, gameId]);

            }
        } else { // Double steal
            newState.currentPlay = {
                type: 'STEAL_ATTEMPT',
                payload: { decisions }
            };
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
        }
    }

    // Common state updates for any steal
    newState.currentAtBat.pitcherAction = null;
    newState.currentAtBat.pitchRollResult = null;

    if (newState.outs >= 3 && isSingleSteal && !isSafe && !newState.currentPlay?.payload?.queuedDecisions) {
        if (newState.isTopInning) {
            newState.isBetweenHalfInningsAway = true;
        } else {
            newState.isBetweenHalfInningsHome = true;
        }
        newState.inningEndedOnCaughtStealing = true;
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
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let newState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;
    const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);

    const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

    // --- SINGLE STEAL RESOLUTION ---
    if (newState.pendingStealAttempt) {
        // The outcome was already calculated in initiate-steal. We just use it here.
        const { outcome, runnerName, runner, ...resultDetails } = newState.pendingStealAttempt;

        const offensiveTeam = newState.isTopInning ? newState.awayTeam : newState.homeTeam;
        newState.lastStealResult = { runner: runnerName, outcome, runnerTeamId: offensiveTeam.team_id, ...resultDetails };
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
                    const { outcome: newOutcome, isSafe, ...resultDetails } = calculateStealResult(runner, toBase, catcherArm, getSpeedValue);
                    const newRunnerName = runner.name;

                    if (!isSafe) {
                        recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);
                    }

                    const logMessage = newOutcome === 'SAFE'
                        ? `${newRunnerName} takes off for ${getOrdinal(toBase)}... SAFE!`
                        : `${newRunnerName} takes off for ${getOrdinal(toBase)}... CAUGHT STEALING! <strong>Outs: ${newState.outs}</strong>`;
                    await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'steal', logMessage]);

                    if (isSafe) { newState.bases[baseMap[toBase]] = runner; }
                    newState.bases[baseMap[fromBase]] = null;

                    newState.pendingStealAttempt = {
                        runner,
                        runnerName: newRunnerName,
                        throwToBase: toBase,
                        outcome: newOutcome,
                        ...resultDetails
                    };
                }
                newState.currentPlay.payload = { decisions: queuedDecisions };
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
                        penalty, throwToBase
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
        await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'steal', logMessage]);
        newState.currentPlay = null;

        if (newState.outs >= 3) {
            if (newState.isTopInning) { newState.isBetweenHalfInningsAway = true; }
            else { newState.isBetweenHalfInningsHome = true; }
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
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const currentState = stateResult.rows[0].state_data;
        let newState = JSON.parse(JSON.stringify(currentState));
        const currentTurn = stateResult.rows[0].turn_number;
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

            const originalOuts = newState.outs;

            const { newState: resolvedState, events } = resolveThrow(newState, throwTo, outfieldDefense, getSpeedValue, finalizeEvent, initialEvent, teamInfo, decision.runner.pitcherOfRecordId ? { card_id: decision.runner.pitcherOfRecordId } : null);
            newState = resolvedState;

            const batterOnFirst = newState.bases.first;
            if (batterOnFirst && !newState.bases.second && newState.currentAtBat.swingRollResult.outcome === '1B+') {
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
                    await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, offensiveTeam.user_id, currentTurn + 1, 'baserunning', finalLogMessageWithScore]);
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

            if (initialEvent) {
                if (newState.currentPlay?.type === 'TAG_UP') {
                    initialEvent += ` <strong>Outs: ${newState.outs}</strong>`;
                }
                const finalLogMessage = appendScoreToLog(initialEvent, newState, currentState.currentAtBat.awayScoreBeforePlay, currentState.currentAtBat.homeScoreBeforePlay);
                await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, offensiveTeam.user_id, currentTurn + 1, 'baserunning', finalLogMessage]);
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
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const currentState = stateResult.rows[0].state_data;
        let newState = JSON.parse(JSON.stringify(currentState));
        const currentTurn = stateResult.rows[0].turn_number;
        
        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);
        const outfieldDefense = await getOutfieldDefense(defensiveTeam);

        if (!newState.currentPlay || !newState.currentPlay.payload) {
            console.error(`Error in resolve-throw for game ${gameId}: currentPlay is missing or invalid.`);
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Invalid game state for resolving a throw.' });
        }

        const { payload } = newState.currentPlay;
        const { choices, initialEvent, decisions } = payload;
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
                        allEvents.push(`${runner.name} scores.`);
                    } else {
                        finalBases[baseMap[targetBase]] = runner;
                        allEvents.push(`${runner.name} advances to ${getOrdinal(targetBase)}.`);
                    }
                }
            } else {
                // This runner was HELD. They stay at their optimistically advanced base.
                const advancedBase = from + 1;
                finalBases[baseMap[advancedBase]] = runner;
            }
        }

        // 3. Resolve the contested throw.
        const contestedDecision = decisions.find(d => d.from + advancementBases === throwTo);
        if (contestedDecision && choices[contestedDecision.from.toString()]) {
            const contestedRunner = contestedDecision.runner;

            const d20Roll = Math.floor(Math.random() * 20) + 1;
            const baseSpeed = parseInt(getSpeedValue(contestedRunner), 10);
            let speed = baseSpeed;
            let penalty = 0;

            if (throwTo === 4) speed += 5; // Bonus for going home
            if (newState.outs === 2) speed += 5; // Bonus for 2 outs

            const isSafe = speed >= (outfieldDefense + d20Roll);

            newState.throwRollResult = {
                roll: d20Roll, defense: outfieldDefense, target: speed, baseSpeed, penalty,
                outcome: isSafe ? 'SAFE' : 'OUT',
                runner: contestedRunner.name,
                throwToBase: throwTo
            };

            if (isSafe) {
                if (throwTo === 4) {
                    newState[scoreKey]++;
                    allEvents.push(`${contestedRunner.name} is SAFE at home!`);
                } else {
                    finalBases[baseMap[throwTo]] = contestedRunner;
                    allEvents.push(`${contestedRunner.name} is SAFE at ${getOrdinal(throwTo)}!`);
                }
            } else {
                // Resolve who to charge the out to.
                let pitcherOfRecord = null;
                if (contestedRunner.pitcherOfRecordId) {
                    pitcherOfRecord = { card_id: contestedRunner.pitcherOfRecordId };
                } else {
                    // Fallback to current pitcher if no record exists
                    pitcherOfRecord = newState.currentAtBat.pitcher;
                }
                recordOutsForPitcher(newState, pitcherOfRecord, 1);
                allEvents.push(`${contestedRunner.name} is THROWN OUT at ${getOrdinal(throwTo)}!`);
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
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'baserunning', finalLogMessage]);
        }

        if (newState.outs >= 3) {
            if (newState.isTopInning) {
                newState.isBetweenHalfInningsAway = true;
            } else {
                newState.isBetweenHalfInningsHome = true;
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
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        const currentState = stateResult.rows[0].state_data;
        let newState = JSON.parse(JSON.stringify(currentState));
        const currentTurn = stateResult.rows[0].turn_number;

        if (newState.currentPlay?.type !== 'INFIELD_IN_CHOICE') {
            return res.status(400).json({ message: 'Invalid game state for this action.' });
        }

        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);
        const { batter, runnerOnThird, runnerOnSecond, runnerOnFirst } = newState.currentPlay.payload;
        const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';
        const events = [];

        if (sendRunner) {
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
                events.push(`${runnerOnThird.name} is SENT HOME... SAFE! ${batter.displayName} reaches on a fielder's choice.`);
                if (!newState.isTopInning && newState.inning >= 9 && newState.homeScore > newState.awayScore) {
                    newState.gameOver = true;
                    newState.winningTeam = 'home';
                }
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

        } else { // Hold runner
            events.push(`${batter.displayName} grounds out, the runner on third holds.`);
            recordOutsForPitcher(newState, newState.currentAtBat.pitcher, 1);

            if (newState.outs < 3) {
                 if (runnerOnFirst && runnerOnSecond) { // 1st and 2nd
                    // This case isn't possible based on the entry condition (must have runner on 3rd)
                    // but handling defensively.
                    newState.bases.third = runnerOnSecond;
                    newState.bases.second = runnerOnFirst;
                } else if (runnerOnFirst) { // 1st and 3rd
                    newState.bases.second = runnerOnFirst;
                }
                // Runner on 2nd holds if they were there (2nd & 3rd)
            }
        }

        newState.currentPlay = null;

        if (newState.gameOver) {
            events.push(`WALK-OFF!`);
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
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'infield-in-gb', finalLogMessage]);
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

// GET A USER'S LINEUP STATUS FOR A SPECIFIC GAME
app.get('/api/games/:gameId/my-lineup', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.userId;
  try {
    const participantResult = await pool.query(
      `SELECT lineup FROM game_participants WHERE game_id = $1 AND user_id = $2`,
      [gameId, userId]
    );

    if (participantResult.rows.length === 0) {
      // If the user is not a participant, they technically don't have a lineup set.
      return res.json({ hasLineup: false });
    }

    const participant = participantResult.rows[0];
    res.json({ hasLineup: !!participant.lineup });

  } catch (error) {
    console.error(`Error fetching user lineup info for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error fetching lineup data.' });
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