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
const { applyOutcome } = require('./gameLogic');

const REPLACEMENT_HITTER_CARD = {
    card_id: -1, name: 'Replacement Hitter', display_name: 'Replacement Hitter', on_base: -10, speed: 'B',
    points: 0,
    fielding_ratings: { 'C': 0, '1B': 0, '2B': 0, 'SS': 0, '3B': 0, 'LF': 0, 'CF': 0, 'RF': 0 },
    chart_data: { '1-2': 'SO', '3-20': 'GB' },
    control: null,
    image_url: '/images/replacement.jpg'
};
const REPLACEMENT_PITCHER_CARD = {
    card_id: -2, name: 'Replacement Pitcher', display_name: 'Replacement Pitcher', control: -1, ip: 1,
    points: 0,
    chart_data: { '1-3': 'PU', '4-8': 'SO', '9-12': 'GB', '13-16': 'FB', '17':'BB', '18-19':'1B','20':'2B'},
    fielding_ratings: {},
    image_url: '/images/replacement.jpg'
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
        const participantsResult = await pool.query('SELECT * FROM game_participants WHERE game_id = $1', [gameId]);
        const game = await pool.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);

        const homeParticipant = participantsResult.rows.find(p => p.user_id === game.rows[0].home_team_user_id);
        const awayParticipant = participantsResult.rows.find(p => p.user_id !== game.rows[0].home_team_user_id);

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
                    // Check if they are a DH (no ratings at all).
                    if (Object.keys(card.fielding_ratings).length === 0) {
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

// --- HELPER FUNCTIONS ---
function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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

        const prevGameStatesResult = await client.query('SELECT state_data FROM game_states WHERE game_id = $1', [prevGameId]);
        const prevGameStates = prevGameStatesResult.rows.map(r => r.state_data);

        let prevTwoGameStates = [];
        if (prevTwoGameId) {
             const prevTwoGameStatesResult = await client.query('SELECT state_data FROM game_states WHERE game_id = $1', [prevTwoGameId]);
             prevTwoGameStates = prevTwoGameStatesResult.rows.map(r => r.state_data);
        }

        for (const reliever of relievers) {
            let isTired = false;

            if (prevTwoGameId) {
                const pitchedInPrevGame = prevGameStates.some(state => state.pitcherStats && state.pitcherStats[reliever.card_id]);
                const pitchedInPrevTwoGame = prevTwoGameStates.some(state => state.pitcherStats && state.pitcherStats[reliever.card_id]);
                if (pitchedInPrevGame && pitchedInPrevTwoGame) {
                    isTired = true;
                }
            }

            if (!isTired) {
                for (const state of prevGameStates) {
                    const pitcherInState = state.currentAtBat?.pitcher || state.lastCompletedAtBat?.pitcher;
                    if (pitcherInState?.card_id === reliever.card_id) {
                        const stats = state.pitcherStats[reliever.card_id] || { ip: 0, runs: 0 };
                        const fatigueThreshold = reliever.ip - Math.floor(stats.runs / 3);
                        if (stats.ip > fatigueThreshold) {
                            isTired = true;
                            break;
                        }
                    }
                }
            }

            if (isTired) {
                finalPitcherStats[reliever.card_id] = { ip: reliever.ip + 1, runs: 0 };
            }
        }
    }

    return finalPitcherStats;
}

// --- HELPER: Handles series logic after a game completes ---
async function handleSeriesProgression(gameId, client) {
    // 1. Get game and series info
    const gameResult = await client.query('SELECT series_id, home_team_user_id, game_in_series FROM games WHERE game_id = $1', [gameId]);
    if (!gameResult.rows[0] || !gameResult.rows[0].series_id) {
        return; // Not a series game, do nothing.
    }
    const { series_id, home_team_user_id, game_in_series } = gameResult.rows[0];

    const seriesResult = await client.query('SELECT * FROM series WHERE id = $1', [series_id]);
    const series = seriesResult.rows[0];

    const finalStateResult = await client.query('SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    const finalState = finalStateResult.rows[0].state_data;

    const participantsResult = await client.query('SELECT user_id, roster_id, league_designation FROM game_participants WHERE game_id = $1', [gameId]);
    const gameAwayUser = participantsResult.rows.find(p => p.user_id !== home_team_user_id);

    // 2. Update series away user if it's the first game and not set yet
    if (!series.series_away_user_id) {
        await client.query('UPDATE series SET series_away_user_id = $1 WHERE id = $2', [gameAwayUser.user_id, series_id]);
        series.series_away_user_id = gameAwayUser.user_id; // Update local copy
    }

    // 3. Update series score
    const winnerId = finalState.winningTeam === 'home' ? home_team_user_id : gameAwayUser.user_id;
    if (winnerId === series.series_home_user_id) {
        await client.query('UPDATE series SET home_wins = home_wins + 1 WHERE id = $1', [series_id]);
        series.home_wins++;
    } else {
        await client.query('UPDATE series SET away_wins = away_wins + 1 WHERE id = $1', [series_id]);
        series.away_wins++;
    }

    // 4. Check if the series is over
    let isSeriesOver = false;
    if (series.series_type === 'playoff' && (series.home_wins >= 4 || series.away_wins >= 4)) {
        isSeriesOver = true;
    }
    if (series.series_type === 'regular_season' && game_in_series >= 7) {
        isSeriesOver = true;
    }

    if (isSeriesOver) {
        await client.query(`UPDATE series SET status = 'completed' WHERE id = $1`, [series_id]);
        io.emit('games-updated'); // Notify clients the series is done
        return;
    }

    // 5. If not over, create the next game in the series
    const nextGameNumber = game_in_series + 1;
    const nextHomeUserId = [3, 4, 5].includes(nextGameNumber) ? series.series_away_user_id : series.series_home_user_id;
    const nextAwayUserId = nextHomeUserId === series.series_home_user_id ? series.series_away_user_id : series.series_home_user_id;

    // Use the DH rule from the completed game for the next one. This is a simplification.
    const lastGameSettings = await client.query('SELECT use_dh FROM games WHERE game_id = $1', [gameId]);
    const useDhForNextGame = lastGameSettings.rows[0].use_dh;

    const newGameResult = await client.query(
        `INSERT INTO games (status, series_id, game_in_series, home_team_user_id, use_dh) VALUES ('lineups', $1, $2, $3, $4) RETURNING game_id`,
        [series_id, nextGameNumber, nextHomeUserId, useDhForNextGame]
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

    // Also emit a specific event to the two players in the game room with the next game details
    io.to(gameId.toString()).emit('series-next-game-ready', {
        nextGameId: newGameId,
        home_wins: series.home_wins,
        away_wins: series.away_wins
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
    const mandatoryPitcherId = await getMandatoryPitcher(gameId, userId, client);
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

    const allParticipants = await client.query('SELECT user_id, roster_id, lineup FROM game_participants WHERE game_id = $1', [gameId]);
    
    if (allParticipants.rows.length === 2 && allParticipants.rows.every(p => p.lineup !== null)) {
      const game = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
      const homePlayerId = game.rows[0].home_team_user_id;

      const homeParticipant = allParticipants.rows.find(p => Number(p.user_id) === Number(homePlayerId));
      const awayParticipant = allParticipants.rows.find(p => Number(p.user_id) !== Number(homePlayerId));

      // --- NEW: Snapshot the rosters for this game ---
      const homeRosterCardsResult = await client.query(`SELECT * FROM cards_player WHERE card_id = ANY(SELECT card_id FROM roster_cards WHERE roster_id = $1)`, [homeParticipant.roster_id]);
      const homeRosterData = homeRosterCardsResult.rows;
      await client.query(`INSERT INTO game_rosters (game_id, user_id, roster_data) VALUES ($1, $2, $3)`, [gameId, homeParticipant.user_id, JSON.stringify(homeRosterData)]);

      const awayRosterCardsResult = await client.query(`SELECT * FROM cards_player WHERE card_id = ANY(SELECT card_id FROM roster_cards WHERE roster_id = $1)`, [awayParticipant.roster_id]);
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

      const batterResult = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [firstBatterCardId]);
      const homePitcherResult = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [homeStartingPitcherId]);
      const awayPitcherResult = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [awayStartingPitcherId]);
      
      const batter = batterResult.rows[0];
      const homePitcher = homePitcherResult.rows[0];
      const awayPitcher = awayPitcherResult.rows[0];

      const initialGameState = {
        inning: 1, isTopInning: true, awayScore: 0, homeScore: 0, outs: 0,
        bases: { first: null, second: null, third: null },
        pitcherStats: await initializePitcherFatigue(gameId, client),
        awayTeam: { userId: awayParticipant.user_id, rosterId: awayParticipant.roster_id, battingOrderPosition: 0, used_player_ids: [] },
        homeTeam: { userId: homeParticipant.user_id, rosterId: homeParticipant.roster_id, battingOrderPosition: 0, used_player_ids: [] },
        currentAwayPitcher: awayPitcher,
        currentHomePitcher: homePitcher,
        awayPlayerReadyForNext: false,
        homePlayerReadyForNext: false,
        isBetweenHalfInningsAway: false,
        isBetweenHalfInningsHome: false,
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

      await client.query(`INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)`, [gameId, 1, initialGameState, false, false]);
      
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

app.post('/api/games/:gameId/substitute', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const { playerInId, playerOutId, position } = req.body;
  const userId = req.user.userId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    const currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    let newState = JSON.parse(JSON.stringify(currentState));

    const participantResult = await client.query('SELECT * FROM game_participants WHERE game_id = $1 AND user_id = $2', [gameId, userId]);
    const participant = participantResult.rows[0];
    const teamKey = participant.home_or_away === 'home' ? 'homeTeam' : 'awayTeam';

    if (newState[teamKey].used_player_ids.includes(playerInId)) {
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

    const playerOutResult = await pool.query('SELECT * FROM cards_player WHERE card_id = $1', [playerOutId]);
    const playerOutCard = playerOutResult.rows[0];
    
    newState[teamKey].used_player_ids.push(playerOutId);

    // Get the correct user ID for the team being substituted
    const teamUserId = newState[teamKey].userId;
    // Get the team's city for a more descriptive log message
    const teamResult = await client.query('SELECT city FROM teams WHERE user_id = $1', [teamUserId]);
    const teamName = teamResult.rows[0]?.city || (teamKey === 'homeTeam' ? 'Home' : 'Away');

    let wasPinchRunner = false;
    let wasPinchHitter = false;
    let wasReliefPitcher = false;

    // 1. Update bases (for pinch runners)
    if (newState.bases.first && newState.bases.first.card_id === playerOutId) {
        newState.bases.first = playerInCard;
        wasPinchRunner = true;
    }
    if (newState.bases.second && newState.bases.second.card_id === playerOutId) {
        newState.bases.second = playerInCard;
        wasPinchRunner = true;
    }
    if (newState.bases.third && newState.bases.third.card_id === playerOutId) {
        newState.bases.third = playerInCard;
        wasPinchRunner = true;
    }

    // 2. Update currentAtBat (for pinch hitters and relief pitchers)
    if (newState.awaitingPitcherSelection) {
        if (playerInCard.control !== null) {
            newState.awaitingPitcherSelection = false;
            newState.currentAtBat.pitcher = playerInCard;
            wasReliefPitcher = true;
            if (teamKey === 'homeTeam') {
                newState.currentHomePitcher = playerInCard;
            } else {
                newState.currentAwayPitcher = playerInCard;
            }
        } else {
            newState.awaitingPitcherSelection = true;
        }
    }
    else if (newState.currentAtBat.batter.card_id === playerOutId) {
        wasPinchHitter = true;
        newState.currentAtBat.batter = playerInCard;
        // Check if the player being pinch-hit for is actually the pitcher.
        if (playerOutCard.control !== null) {
            // The pitcher has been removed from the batting lineup.
            // Nullify them as the current pitcher for their team and flag that a new one is needed.
            if (teamKey === 'homeTeam') {
                newState.currentHomePitcher = null;
            } else {
                newState.currentAwayPitcher = null;
            }
            newState.awaitingPitcherSelection = true;
        }
    } else if (newState.currentAtBat.pitcher && newState.currentAtBat.pitcher.card_id === playerOutId) {
        wasReliefPitcher = true;
        newState.currentAtBat.pitcher = playerInCard;
        if (teamKey === 'homeTeam') {
            newState.currentHomePitcher = playerInCard;
        } else {
            newState.currentAwayPitcher = playerInCard;
        }
    }

    // 3. Update the persistent lineup in game_participants
    if (participant.lineup.startingPitcher === playerOutId) {
        participant.lineup.startingPitcher = playerInCard.card_id;
    }
    const lineup = participant.lineup.battingOrder;
    const spotIndex = lineup.findIndex(spot => spot.card_id === playerOutId);
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

    await client.query('UPDATE game_participants SET lineup = $1::jsonb WHERE game_id = $2 AND user_id = $3', [JSON.stringify(participant.lineup), gameId, userId]);
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
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
    const newState = { ...currentState, infieldIn: infieldIn };
    
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
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
      `SELECT g.game_id, g.status, g.current_turn_user_id, g.home_team_user_id, g.game_in_series
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
        if (game.status === 'in_progress') {
            const stateResult = await pool.query(
                'SELECT state_data FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1',
                [game.game_id]
            );
            if (stateResult.rows.length > 0) {
                gameState = stateResult.rows[0].state_data;
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


        processedGames.push({ ...game, opponent, gameState, home_team_abbr, away_team_abbr, status_text });
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
    return { game, series, gameState: null, gameEvents: [], batter: null, pitcher: null, lineups: {}, rosters: {}, teams: teamsData };
  }

  const stateResult = await dbClient.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
  if (stateResult.rows.length === 0) {
    return { game, series, gameState: null, gameEvents: [], batter: null, pitcher: null, lineups: {}, rosters: {}, teams: teamsData };
  }
  const currentState = stateResult.rows[0];

  const eventsResult = await dbClient.query('SELECT * FROM game_events WHERE game_id = $1 ORDER BY "timestamp" ASC', [gameId]);
  let batter = null, pitcher = null, lineups = { home: null, away: null }, rosters = { home: [], away: [] };

  if (game.status === 'in_progress') {
    const activePlayers = await getActivePlayers(gameId, currentState.state_data);
    batter = activePlayers.batter;
    pitcher = activePlayers.pitcher;
    const homeParticipant = participantsResult.rows.find(p => p.user_id === game.home_team_user_id);
    const awayParticipant = participantsResult.rows.find(p => p.user_id !== game.home_team_user_id);

    currentState.state_data.homeDefensiveRatings = {
        catcherArm: await getCatcherArm(homeParticipant),
        infieldDefense: await getInfieldDefense(homeParticipant),
        outfieldDefense: await getOutfieldDefense(homeParticipant),
    };

    currentState.state_data.awayDefensiveRatings = {
        catcherArm: await getCatcherArm(awayParticipant),
        infieldDefense: await getInfieldDefense(awayParticipant),
        outfieldDefense: await getOutfieldDefense(awayParticipant),
    };

    for (const p of participantsResult.rows) {
      const rosterResult = await dbClient.query('SELECT roster_data FROM game_rosters WHERE game_id = $1 AND user_id = $2', [gameId, p.user_id]);
      const fullRosterCards = rosterResult.rows[0]?.roster_data || [];
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
    if (pitcher) processPlayers([pitcher]);
  }

  return { game, series, gameState: currentState, gameEvents: eventsResult.rows, batter, pitcher, lineups, rosters, teams: teamsData };
}

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
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;
    
    let finalState = { ...currentState };
    const { offensiveTeam } = await getActivePlayers(gameId, finalState);

    finalState.currentAtBat.batterAction = action;

    // If the pitcher has already acted, we resolve the at-bat now.
    if (finalState.currentAtBat.pitcherAction === 'pitch') {
      const { batter, pitcher, defensiveTeam } = await getActivePlayers(gameId, finalState);
      processPlayers([batter, pitcher]);
      const infieldDefense = await getInfieldDefense(defensiveTeam);
      const outfieldDefense = await getOutfieldDefense(defensiveTeam);

      // --- THIS IS THE FIX ---
      // Add the scores before the outcome is applied.
      finalState.currentAtBat.homeScoreBeforePlay = finalState.homeScore;
      finalState.currentAtBat.awayScoreBeforePlay = finalState.awayScore;

      let outcome = 'OUT';
      let swingRoll = 0;
      const { advantage } = finalState.currentAtBat.pitchRollResult;

      if (action === 'bunt') {
          outcome = 'BUNT';
      } else { // 'swing'
          swingRoll = Math.floor(Math.random() * 20) + 1;
          const chartHolder = advantage === 'pitcher' ? pitcher : batter;
          for (const range in chartHolder.chart_data) {
              const [min, max] = range.split('-').map(Number);
              if (swingRoll >= min && swingRoll <= max) { outcome = chartHolder.chart_data[range]; break; }
          }
      }
      const { newState, events } = applyOutcome(finalState, outcome, batter, pitcher, infieldDefense, outfieldDefense);
      finalState = { ...newState };
      finalState.defensivePlayerWentSecond = false;
      finalState.currentAtBat.swingRollResult = { roll: swingRoll, outcome, batter, eventCount: events.length };
      
      
      if (events && events.length > 0) {
        const originalOuts = currentState.outs;
        const originalScore = currentState.awayScore + currentState.homeScore;
        let combinedLogMessage = events.join(' ');

        if (finalState.isBetweenHalfInningsAway || finalState.isBetweenHalfInningsHome) {
          combinedLogMessage += ` <strong>Outs: 3</strong>`;
        } else if (finalState.outs > originalOuts) {
          combinedLogMessage += ` <strong>Outs: ${finalState.outs}</strong>`;
        }

        if ((finalState.awayScore + finalState.homeScore) > originalScore) {
          combinedLogMessage += ` <strong>Score: ${finalState.awayScore}-${finalState.homeScore}</strong>`;
        }

        await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'game_event', combinedLogMessage]);

        if (finalState.isBetweenHalfInningsAway || finalState.isBetweenHalfInningsHome) {
          const participants = await client.query('SELECT * from game_participants WHERE game_id = $1', [gameId]);
          const game = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
          const home_team_user_id = game.rows[0].home_team_user_id;

          const homeParticipant = participants.rows.find(p => p.user_id === home_team_user_id);
          const awayParticipant = participants.rows.find(p => p.user_id !== home_team_user_id);

          const defensiveParticipant = finalState.isTopInning ? homeParticipant : awayParticipant;
          const offensiveParticipant = finalState.isTopInning ? awayParticipant : homeParticipant;

          const pitcherCardId = defensiveParticipant.lineup.startingPitcher;
          const pitcherResult = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [pitcherCardId]);
          const pitcher = pitcherResult.rows[0];
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
          await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'system', inningChangeEvent]);
        }
      }
      
      await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);

      // --- NEW: Check for Game Over ---
      if (finalState.gameOver) {
        await client.query(
          `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1`,
          [gameId]
        );
        await handleSeriesProgression(gameId, client);
      }
    }
    
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, finalState, finalState.isBetweenHalfInningsHome, finalState.isBetweenHalfInningsAway]);
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
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    const { batter, pitcher, offensiveTeam } = await getActivePlayers(gameId, currentState);
    processPlayers([batter, pitcher]);
    
    // --- Pitcher Fatigue Logic ---
    if (!currentState.pitcherStats) { currentState.pitcherStats = {}; }
    const pitcherId = pitcher.card_id;
    let stats = currentState.pitcherStats[pitcherId] || { ip: 0, runs: 0 };
    if (currentState.outs === 0 && ((currentState.isTopInning && currentState.awayTeam.battingOrderPosition === 0) || (!currentState.isTopInning && currentState.homeTeam.battingOrderPosition === 0))) {
      stats.ip++;
    }
    let controlPenalty = 0;
    const fatigueThreshold = pitcher.ip - Math.floor(stats.runs / 3);
    if (stats.ip > fatigueThreshold) {
        controlPenalty = stats.ip - fatigueThreshold;
    }
    const effectiveControl = pitcher.control - controlPenalty;

     let finalState = { ...currentState };
    const events = [];

    if (action === 'intentional_walk') {
        const { newState, events: walkEvents } = applyOutcome(currentState, 'IBB', batter, pitcher);
        finalState = { ...newState };
        finalState.currentAtBat.pitcherAction = 'intentional_walk';
        finalState.currentAtBat.batterAction = 'take';
        finalState.currentAtBat.pitchRollResult = { roll: 'IBB', outcome: 'IBB' };

        for (const logMessage of walkEvents) {
          let finalLog = logMessage;
          if ((finalState.awayScore + finalState.homeScore) > (currentState.awayScore + currentState.homeScore)) {
              finalLog += ` <strong>(Score: ${finalState.awayScore}-${finalState.homeScore})</strong>`;
          }
          await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'walk', finalLog]);
        }
        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);
    } else {
        const pitchRoll = Math.floor(Math.random() * 20) + 1;
        // If the batter is a pitcher (has a 'control' rating), they can never have the advantage.
        const advantage = batter.control !== null
            ? 'pitcher'
            : (pitchRoll + effectiveControl) > batter.on_base ? 'pitcher' : 'batter';
            
        finalState.currentAtBat.pitcherAction = 'pitch';
        finalState.currentAtBat.pitchRollResult = { roll: pitchRoll, advantage, penalty: controlPenalty };

        if (finalState.currentAtBat.batterAction) {
            // --- THIS IS THE FIX ---
            // Batter was waiting, so resolve the whole at-bat now.
            const { defensiveTeam } = await getActivePlayers(gameId, finalState);
            const infieldDefense = await getInfieldDefense(defensiveTeam);
            const outfieldDefense = await getOutfieldDefense(defensiveTeam);

            // --- THIS IS THE FIX ---
            // Add the scores before the outcome is applied.
            finalState.currentAtBat.homeScoreBeforePlay = finalState.homeScore;
            finalState.currentAtBat.awayScoreBeforePlay = finalState.awayScore;

            const originalOuts = finalState.outs;
            const originalScore = finalState.awayScore + finalState.homeScore;
            let outcome = 'OUT';
            let swingRoll = 0;
            if (finalState.currentAtBat.batterAction === 'bunt') {
                outcome = 'BUNT';
            } else {
                swingRoll = Math.floor(Math.random() * 20) + 1;
                const chartHolder = advantage === 'pitcher' ? pitcher : batter;
                for (const range in chartHolder.chart_data) {
                    const [min, max] = range.split('-').map(Number);
                    if (swingRoll >= min && swingRoll <= max) { outcome = chartHolder.chart_data[range]; break; }
                }
            }
            const { newState, events } = applyOutcome(finalState, outcome, batter, pitcher, infieldDefense, outfieldDefense);
            finalState = { ...newState };
            finalState.defensivePlayerWentSecond = true;
            finalState.currentAtBat.swingRollResult = { roll: swingRoll, outcome, batter, eventCount: events.length };

            // --- ADD THESE DEBUG LOGS ---
        console.log('--- PITCH OUTS DEBUG ---');
        console.log('Original Outs:', originalOuts);
        console.log('Final Outs:', finalState.outs);
        // --- End of Debug Logs ---
            
            if (events && events.length > 0) {
              const originalOuts = currentState.outs;
              const originalScore = currentState.awayScore + currentState.homeScore;
              let combinedLogMessage = events.join(' ');

              if (finalState.isBetweenHalfInningsAway || finalState.isBetweenHalfInningsHome) {
                combinedLogMessage += ` <strong>Outs: 3</strong>`;
              } else if (finalState.outs > originalOuts) {
                combinedLogMessage += ` <strong>Outs: ${finalState.outs}</strong>`;
              }

              if ((finalState.awayScore + finalState.homeScore) > originalScore) {
                combinedLogMessage += ` <strong>(Score: ${finalState.awayScore}-${finalState.homeScore})</strong>`;
              }

              await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'game_event', combinedLogMessage]);

              if (finalState.isBetweenHalfInningsAway || finalState.isBetweenHalfInningsHome) {
                const participants = await client.query('SELECT * from game_participants WHERE game_id = $1', [gameId]);
                const game = await client.query('SELECT home_team_user_id FROM games WHERE game_id = $1', [gameId]);
                const home_team_user_id = game.rows[0].home_team_user_id;

                const homeParticipant = participants.rows.find(p => p.user_id === home_team_user_id);
                const awayParticipant = participants.rows.find(p => p.user_id !== home_team_user_id);

                const defensiveParticipant = finalState.isTopInning ? homeParticipant : awayParticipant;
                const offensiveParticipant = finalState.isTopInning ? awayParticipant : homeParticipant;

                const pitcherCardId = defensiveParticipant.lineup.startingPitcher;
                const pitcherResult = await client.query('SELECT * FROM cards_player WHERE card_id = $1', [pitcherCardId]);
                const pitcher = pitcherResult.rows[0];
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
                await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'system', inningChangeEvent]);
              }
            }

            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);

            // --- NEW: Check for Game Over ---
            if (finalState.gameOver) {
              await client.query(
                `UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1`,
                [gameId]
              );
              await handleSeriesProgression(gameId, client);
            }
        }
    }
    
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, finalState, finalState.isBetweenHalfInningsHome, finalState.isBetweenHalfInningsAway]);
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

// in server.js
app.post('/api/games/:gameId/resolve-double-play', authenticateToken, async (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.userId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    const currentState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;

    if (!currentState.awaitingDoublePlayRoll) {
      return res.status(400).json({ message: 'Not awaiting a double play roll.' });
    }

    let newState = JSON.parse(JSON.stringify(currentState));
    const { batter, pitcher, defensiveTeam, offensiveTeam } = await getActivePlayers(gameId, newState);
    const infieldDefense = await getInfieldDefense(defensiveTeam);

    const dpRoll = Math.floor(Math.random() * 20) + 1;
    const isDoublePlay = (infieldDefense + dpRoll) >= batter.speed;
    const outcome = isDoublePlay ? 'DOUBLE_PLAY' : 'FIELDERS_CHOICE';

    const runnerData = { ...batter, pitcherOfRecordId: pitcher.card_id };
    const events = [];
    const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';
    const scoreRun = (runnerOnBase) => {
      if (!runnerOnBase) return;
      newState[scoreKey]++;
      events.push(`${runnerOnBase.name} scores!`);
    };

    if (isDoublePlay) {
      events.push(`It's a DOUBLE PLAY!`);
      newState.outs += 2;
      newState.bases.first = null;
    } else {
      events.push(`Batter is SAFE, out at second. Fielder's choice.`);
      newState.outs++;
      if (newState.outs < 3 && !currentState.infieldIn) {
        if (newState.bases.third) { scoreRun(newState.bases.third); newState.bases.third = null; }
        if (newState.bases.second) { newState.bases.third = newState.bases.second; newState.bases.second = null;}
      }
      newState.bases.first = runnerData;
    }

    newState.doublePlayDetails = {
      roll: dpRoll,
      defense: infieldDefense,
      target: batter.speed,
      outcome: outcome
    };

    newState.awaitingDoublePlayRoll = false;

    // Pass the turn to the offensive player to click "Next Hitter"
    await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);

    // --- Handle Inning Change & Game Over Check ---
    if (newState.outs >= 3 && !newState.gameOver) {
      const isGameOver = (
        (newState.inning >= 9 && !newState.isTopInning && newState.homeScore !== newState.awayScore) ||
        (newState.inning >= 9 && newState.isTopInning && newState.homeScore > newState.awayScore)
      );

      if (isGameOver) {
        newState.gameOver = true;
        newState.winningTeam = newState.homeScore > newState.awayScore ? 'home' : 'away';
        events.push(`That's the ballgame!`);
        await client.query(`UPDATE games SET status = 'completed', completed_at = NOW() WHERE game_id = $1`, [gameId]);
        await handleSeriesProgression(gameId, client);
      } else {
        newState.inningChanged = true;
        if (newState.isTopInning) { newState.isBetweenHalfInningsAway = true; }
        else { newState.isBetweenHalfInningsHome = true; }
        newState.isTopInning = !newState.isTopInning;
        if (newState.isTopInning) newState.inning++;
        newState.outs = 0;
        newState.bases = { first: null, second: null, third: null };
      }
    }

    if (events.length > 0) {
      let combinedLogMessage = events.join(' ');
      await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'game_event', combinedLogMessage]);
    }

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
    await client.query('COMMIT');

    const gameData = await getAndProcessGameData(gameId, client);
    io.to(gameId).emit('game-updated', gameData);
    res.sendStatus(200);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error resolving double play for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error during double play resolution.' });
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

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, finalState, finalState.isBetweenHalfInningsHome, finalState.isBetweenHalfInningsAway]);
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
      // 1. Save the completed at-bat for the other player to see.
      newState.lastCompletedAtBat = { ...newState.currentAtBat,
        bases: newState.currentAtBat.basesBeforePlay,
        eventCount: newState.currentAtBat.swingRollResult?.eventCount || 1, // Save the event count
        outs: newState.outsBeforePlay 
       };

      // NEW: Clear the double play details from the previous play
      delete newState.doublePlayDetails;
      delete newState.stealAttemptDetails;

      // --- THIS IS THE FIX ---
      // Determine which team's batting order needs to be advanced.
      // If we are between innings, we advance the order for the team that JUST finished batting.
      // Otherwise, it's a normal mid-inning batter change for the current offensive team.
      let teamToAdvance;
      if (newState.isBetweenHalfInningsAway) {
        // The away team just finished batting. Advance their order.
        teamToAdvance = 'awayTeam';
      } else if (newState.isBetweenHalfInningsHome) {
        // The home team just finished batting. Advance their order.
        teamToAdvance = 'homeTeam';
      } else {
        // Not an inning change, so advance the current offensive team.
        teamToAdvance = newState.isTopInning ? 'awayTeam' : 'homeTeam';
      }
      newState[teamToAdvance].battingOrderPosition = (newState[teamToAdvance].battingOrderPosition + 1) % 9;

      // Reset the between-innings flags now that the new at-bat is set up.
      if (newState.isBetweenHalfInningsHome) {
        newState.isBetweenHalfInningsHome = false;
      }
      if (newState.isBetweenHalfInningsAway) {
        newState.isBetweenHalfInningsAway = false;
      }
      
      // 3. Create a fresh scorecard for the new at-bat.
      const { batter, pitcher } = await getActivePlayers(gameId, newState);
      newState.currentAtBat = {
          batter: batter,
          pitcher: pitcher,
          pitcherAction: null, batterAction: null,
          pitchRollResult: null, swingRollResult: null,
          outsBeforePlay: newState.outs,
          basesBeforePlay: newState.bases
      };

      // 4. Check if we are now awaiting a pitcher selection
      if (newState.currentAtBat.pitcher === null) {
          newState.awaitingPitcherSelection = true;
      } else {
          newState.awaitingPitcherSelection = false;
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
    }
    
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
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
  const { decisions } = req.body; // e.g., { '1': true, '2': true }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let newState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;
    const { defensiveTeam } = await getActivePlayers(gameId, newState);

    newState.currentPlay = {
      type: 'STEAL_ATTEMPT',
      payload: { decisions }
    };

    // Pass the turn to the defensive player to make their throw
    await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);

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
  const { throwTo } = req.body; // e.g., 2 for second base, 3 for third base
  const userId = req.user.userId;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
    let newState = stateResult.rows[0].state_data;
    const currentTurn = stateResult.rows[0].turn_number;
    const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);

    const { decisions } = newState.currentPlay.payload;
    const events = [];
    const baseMap = { 1: 'first', 2: 'second', 3: 'third' };

    // 1. Handle automatic advances for any runner not being thrown at
    for (const fromBaseStr in decisions) {
      if (decisions[fromBaseStr]) {
        const fromBase = parseInt(fromBaseStr, 10);
        const toBase = fromBase + 1;
        if (toBase !== throwTo) {
          const runner = newState.bases[baseMap[fromBase]];
          if (runner) {
            newState.bases[baseMap[toBase]] = runner;
            newState.bases[baseMap[fromBase]] = null;
            events.push(`${runner.name} steals ${getOrdinal(toBase)} base uncontested.`);
          }
        }
      }
    }

    // 2. Resolve the contested throw
    const fromBaseOfThrow = throwTo - 1;
    const runner = newState.bases[baseMap[fromBaseOfThrow]];
    if (runner) {
      const catcherArm = await getCatcherArm(defensiveTeam);
      const d20Roll = Math.floor(Math.random() * 20) + 1;
      const defenseTotal = catcherArm + d20Roll;
      const isSafe = runner.speed > defenseTotal;

      newState.stealAttemptDetails = {
        roll: d20Roll,
        defense: catcherArm,
        target: runner.speed,
        outcome: isSafe ? 'SAFE' : 'OUT'
      };

      if (isSafe) { // SAFE
        newState.bases[baseMap[throwTo]] = runner;
        newState.bases[baseMap[fromBaseOfThrow]] = null;
        events.push(`${runner.name} is SAFE at ${getOrdinal(throwTo)}! (Speed ${runner.speed} vs. Throw ${defenseTotal})`);
      } else { // OUT
        newState.outs++;
        newState.bases[baseMap[fromBaseOfThrow]] = null;
        events.push(`${runner.name} is THROWN OUT at ${getOrdinal(throwTo)}! (Speed ${runner.speed} vs. Throw ${defenseTotal})`);
      }
    }

    // 3. Finalize the turn state
    newState.currentPlay = null;

    if (newState.outs >= 3) {
        // Inning change logic
        const wasTop = newState.isTopInning;
        newState.isTopInning = !newState.isTopInning;
        if (newState.isTopInning) newState.inning++;
        newState.outs = 0;
        newState.bases = { first: null, second: null, third: null };
        // Inning change event will be created by the client or a subsequent state change
    }

    await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
    for (const logMessage of events) {
        await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'steal', logMessage]);
    }

    // Turn goes back to the offensive player to continue the at-bat
    await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);
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
        let newState = JSON.parse(JSON.stringify(stateResult.rows[0].state_data));
        const currentTurn = stateResult.rows[0].turn_number;
        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);

        const runnersWereSent = Object.values(decisions).some(sent => sent);

        if (runnersWereSent) {
            newState.currentPlay.payload.choices = decisions;
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [defensiveTeam.user_id, gameId]);
        } else {
            newState.currentPlay = null;
            // THIS IS THE BUG. The batter is advanced here AND in the next-hitter call.
            // const offensiveTeamKey = newState.isTopInning ? 'awayTeam' : 'homeTeam';
            // newState[offensiveTeamKey].battingOrderPosition = (newState[offensiveTeamKey].battingOrderPosition + 1) % 9;
            await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);
        }
        
        await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
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
        let newState = JSON.parse(JSON.stringify(stateResult.rows[0].state_data));
        const currentTurn = stateResult.rows[0].turn_number;
        
        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);
        const outfieldDefense = await getOutfieldDefense(defensiveTeam);

        const { type, payload } = newState.currentPlay;
        const { choices } = payload;
        const events = [];
        const baseMap = { 1: 'first', 2: 'second', 3: 'third' };
        const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';

        for (const fromBaseStr in choices) {
            if (choices[fromBaseStr]) {
                const fromBase = parseInt(fromBaseStr, 10);
                const toBase = fromBase + 1;
                const runner = newState.bases[baseMap[fromBase]];

                if (runner && toBase !== throwTo) {
                    if (toBase === 4) {
                        newState[scoreKey]++;
                        events.push(`${runner.name} scores!`);
                    } else {
                        newState.bases[baseMap[toBase]] = runner;
                        events.push(`${runner.name} advances to ${getOrdinal(toBase)}.`);
                    }
                    newState.bases[baseMap[fromBase]] = null;
                }
            }
        }

        const fromBaseOfThrow = throwTo - 1;
        const runnerToChallenge = newState.bases[baseMap[fromBaseOfThrow]];
        if (runnerToChallenge) {
            const d20Roll = Math.floor(Math.random() * 20) + 1;
            let speed = runnerToChallenge.speed;
            let defenseRoll = outfieldDefense + d20Roll;

            if (type === 'ADVANCE') {
                if (throwTo === 4) speed += 5;
                if (newState.outs === 2) speed += 5;
            } else if (type === 'TAG_UP') {
                if (throwTo === 4) speed += 5;
                if (throwTo === 2) speed -= 5;
            }

            const isSafe = type === 'ADVANCE' ? speed >= defenseRoll : speed > defenseRoll;

            if (isSafe) {
                if (throwTo === 4) {
                    newState[scoreKey]++;
                    events.push(`${runnerToChallenge.name} is SAFE at home!`);
                } else {
                    newState.bases[baseMap[throwTo]] = runnerToChallenge;
                    events.push(`${runnerToChallenge.name} is SAFE at ${getOrdinal(throwTo)}!`);
                }
                newState.bases[baseMap[fromBaseOfThrow]] = null;
            } else {
                newState.outs++;
                newState.bases[baseMap[fromBaseOfThrow]] = null;
                events.push(`${runnerToChallenge.name} is THROWN OUT at ${getOrdinal(throwTo)}!`);
            }
        }

        newState.currentPlay = null;

        if (newState.outs >= 3) {
            newState.isTopInning = !newState.isTopInning;
            if (newState.isTopInning) newState.inning++;
            newState.outs = 0;
            newState.bases = { first: null, second: null, third: null };
        }

        await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
        for (const logMessage of events) {
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'baserunning', logMessage]);
        }
        
        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);
        await client.query('COMMIT');
        
        const gameData = await getAndProcessGameData(gameId, client);
        io.to(gameId).emit('game-updated', gameData);
        res.sendStatus(200);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error resolving throw for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error during throw resolution.' });
    } finally {
        client.release();
    }
});

app.post('/api/games/:gameId/resolve-infield-in-play', authenticateToken, async (req, res) => {
    const { gameId } = req.params;
    const { sendRunner } = req.body;
    const userId = req.user.userId;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const stateResult = await client.query('SELECT * FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1', [gameId]);
        let newState = JSON.parse(JSON.stringify(stateResult.rows[0].state_data));
        const currentTurn = stateResult.rows[0].turn_number;

        const { offensiveTeam, defensiveTeam } = await getActivePlayers(gameId, newState);
        const infieldDefense = await getInfieldDefense(defensiveTeam);

        const { runner, batter } = newState.currentPlay.payload;
        const events = [];
        const scoreKey = newState.isTopInning ? 'awayScore' : 'homeScore';

        if (sendRunner) {
            const d20Roll = Math.floor(Math.random() * 20) + 1;
            const defenseTotal = infieldDefense + d20Roll;
            if (runner.speed > defenseTotal) {
                newState[scoreKey]++;
                newState.bases.third = null;
                newState.bases.first = batter;
                events.push(`${runner.name} is SENT HOME... and scores! Batter reaches on a fielder's choice.`);
            } else {
                newState.outs++;
                newState.bases.third = null;
                newState.bases.first = batter;
                events.push(`${runner.name} is THROWN OUT at the plate! Batter reaches on a fielder's choice.`);
            }
        } else {
            newState.outs++;
            events.push(`The runner holds at third. ${batter.name} is out at first.`);
        }

        newState.currentPlay = null;

        if (newState.outs >= 3) {
            newState.isTopInning = !newState.isTopInning;
            if (newState.isTopInning) newState.inning++;
            newState.outs = 0;
            newState.bases = { first: null, second: null, third: null };
        }
        
        await client.query('INSERT INTO game_states (game_id, turn_number, state_data, is_between_half_innings_home, is_between_half_innings_away) VALUES ($1, $2, $3, $4, $5)', [gameId, currentTurn + 1, newState, newState.isBetweenHalfInningsHome, newState.isBetweenHalfInningsAway]);
        for (const logMessage of events) {
            await client.query(`INSERT INTO game_events (game_id, user_id, turn_number, event_type, log_message) VALUES ($1, $2, $3, $4, $5)`, [gameId, userId, currentTurn + 1, 'infield-in', logMessage]);
        }

        await client.query('UPDATE games SET current_turn_user_id = $1 WHERE game_id = $2', [offensiveTeam.user_id, gameId]);
        await client.query('COMMIT');

        const gameData = await getAndProcessGameData(gameId, client);
        io.to(gameId).emit('game-updated', gameData);
        res.sendStatus(200);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error resolving infield-in play for game ${gameId}:`, error);
        res.status(500).json({ message: 'Server error during infield-in play resolution.' });
    } finally {
        client.release();
    }
});


// --- HELPER: Determines the mandatory starting pitcher for a series game ---
async function getMandatoryPitcher(gameId, userId, dbClient) {
    const participantResult = await dbClient.query(
      `SELECT roster_id FROM game_participants WHERE game_id = $1 AND user_id = $2`,
      [gameId, userId]
    );

    if (participantResult.rows.length === 0) {
      // This case should be handled by the calling route, but we'll be safe.
      return null;
    }
    const rosterId = participantResult.rows[0].roster_id;

    let mandatoryPitcherId = null;
    const gameDetailsResult = await dbClient.query('SELECT series_id, game_in_series FROM games WHERE game_id = $1', [gameId]);

    if (gameDetailsResult.rows.length > 0) {
        const { series_id, game_in_series } = gameDetailsResult.rows[0];

        if (series_id && game_in_series > 3) {
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
    return mandatoryPitcherId;
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

    const mandatoryPitcherId = await getMandatoryPitcher(gameId, userId, pool);

    res.json({ roster_id: rosterId, mandatoryPitcherId });

  } catch (error) {
    console.error(`Error fetching participant info for game ${gameId}:`, error);
    res.status(500).json({ message: 'Server error fetching participant data.' });
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