
const { io } = require("socket.io-client");
const { Pool } = require('pg');

const BACKEND_URL = 'http://localhost:3001';
const DB_CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/baseball'; // Adjust as needed

async function registerUser(prefix) {
    const email = `${prefix}_${Date.now()}@example.com`;
    const password = 'password';
    const team_id = Math.floor(Math.random() * 1000000); // Random team ID to avoid conflict

    // Check if team_id exists (unlikely collision but good to be safe or just use random large number)
    // Actually, for this test, we can just pick a team from available teams or create one?
    // The register endpoint expects a valid team_id that exists in the teams table but is unclaimed?
    // Wait, the register endpoint CLAIMS a team. The team must exist.

    // We need to insert teams first directly into DB or pick from available.
    // Let's insert a team directly using PG client to ensure we can register.

    return { email, password, team_id };
}

async function main() {
    const pool = new Pool({ connectionString: DB_CONNECTION_STRING });

    try {
        console.log('Connecting to DB...');
        // 1. Setup Users and Rosters
        // We need 2 teams.
        const team1Id = Math.floor(Math.random() * 1000000);
        const team2Id = Math.floor(Math.random() * 1000000);

        await pool.query(`INSERT INTO teams (team_id, city, name, display_format) VALUES ($1, 'TestCity1', 'Team1', '{city} {name}') ON CONFLICT DO NOTHING`, [team1Id]);
        await pool.query(`INSERT INTO teams (team_id, city, name, display_format) VALUES ($1, 'TestCity2', 'Team2', '{city} {name}') ON CONFLICT DO NOTHING`, [team2Id]);

        // Register User A
        const userA = { email: `userA_${Date.now()}@test.com`, password: 'password', owner_first_name: 'User', owner_last_name: 'A', team_id: team1Id };
        const resA = await fetch(`${BACKEND_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userA)
        });
        if (!resA.ok) {
            const txt = await resA.text();
            console.error('Register A failed:', txt);
            throw new Error('Register A failed');
        }

        // Login User A
        const loginA = await fetch(`${BACKEND_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userA.email, password: userA.password })
        });
        const dataA = await loginA.json();
        const tokenA = dataA.token;
        const userIdA = JSON.parse(atob(tokenA.split('.')[1])).userId;

        // Register User B
        const userB = { email: `userB_${Date.now()}@test.com`, password: 'password', owner_first_name: 'User', owner_last_name: 'B', team_id: team2Id };
        const resB = await fetch(`${BACKEND_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userB)
        });

        // Login User B
        const loginB = await fetch(`${BACKEND_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userB.email, password: userB.password })
        });
        const dataB = await loginB.json();
        const tokenB = dataB.token;
        const userIdB = JSON.parse(atob(tokenB.split('.')[1])).userId;

        console.log(`User A: ${userIdA}, User B: ${userIdB}`);

        // Create Rosters
        // We need valid card IDs. Let's fetch some available cards from DB.
        const cardsRes = await pool.query('SELECT card_id FROM cards_player LIMIT 20');
        if (cardsRes.rows.length < 20) throw new Error('Not enough cards in DB');
        const cardIds = cardsRes.rows.map(r => r.card_id);

        const rosterCards = cardIds.map((id, idx) => ({
            card_id: id,
            is_starter: idx < 10, // 9 starters + 1 pitcher
            assignment: idx === 0 ? 'SP' : (idx < 10 ? 'C' : 'BENCH') // Simplified assignment
        }));
        // Fix assignments for validation
        const positions = ['SP', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'];
        rosterCards.forEach((c, i) => {
            if (i < 10) c.assignment = positions[i];
        });

        // Save Roster A
        await fetch(`${BACKEND_URL}/api/my-roster`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
            body: JSON.stringify({ cards: rosterCards })
        });
        const rosterARes = await pool.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userIdA]);
        const rosterIdA = rosterARes.rows[0].roster_id;

        // Save Roster B
        await fetch(`${BACKEND_URL}/api/my-roster`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
            body: JSON.stringify({ cards: rosterCards })
        });
        const rosterBRes = await pool.query('SELECT roster_id FROM rosters WHERE user_id = $1', [userIdB]);
        const rosterIdB = rosterBRes.rows[0].roster_id;

        // 2. Create Series Game 2 Manually
        console.log('Creating Series and Game 2...');
        const seriesRes = await pool.query(`INSERT INTO series (series_type, series_home_user_id, series_away_user_id) VALUES ('regular_season', $1, $2) RETURNING id`, [userIdA, userIdB]);
        const seriesId = seriesRes.rows[0].id;

        // Manually insert Game 2
        const gameRes = await pool.query(
            `INSERT INTO games (status, series_id, game_in_series, home_team_user_id, use_dh) VALUES ('lineups', $1, 2, $2, true) RETURNING game_id`,
            [seriesId, userIdB] // User B is home for Game 2? Doesn't matter much, just need a game.
        );
        const gameId = gameRes.rows[0].game_id;
        console.log(`Game 2 Created: ${gameId}`);

        // Insert Participants (simulate handleSeriesProgression)
        await pool.query(
            `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation) VALUES ($1, $2, $3, 'away', 'AL')`,
            [gameId, userIdA, rosterIdA]
        );
        await pool.query(
            `INSERT INTO game_participants (game_id, user_id, roster_id, home_or_away, league_designation) VALUES ($1, $2, $3, 'home', 'AL')`,
            [gameId, userIdB, rosterIdB]
        );

        // 3. Connect Sockets
        console.log('Connecting sockets...');
        const socketA = io(BACKEND_URL);
        const socketB = io(BACKEND_URL);

        const joinPromiseA = new Promise(resolve => {
            socketA.on('connect', () => {
                socketA.emit('join-game-room', gameId.toString()); // Ensure string
                resolve();
            });
        });
        const joinPromiseB = new Promise(resolve => {
            socketB.on('connect', () => {
                socketB.emit('join-game-room', gameId.toString());
                resolve();
            });
        });

        await Promise.all([joinPromiseA, joinPromiseB]);
        console.log('Sockets joined room.');

        // 4. Setup Listeners
        let gameStartingReceivedA = false;
        let gameStartingReceivedB = false;

        socketA.on('game-starting', () => {
            console.log('User A received game-starting!');
            gameStartingReceivedA = true;
        });
        socketB.on('game-starting', () => {
            console.log('User B received game-starting!');
            gameStartingReceivedB = true;
        });

        socketA.on('lineup-submitted', () => console.log('User A received lineup-submitted'));
        socketB.on('lineup-submitted', () => console.log('User B received lineup-submitted'));

        // 5. Submit Lineups
        // Construct lineup object
        const lineupA = {
            battingOrder: rosterCards.slice(1, 10).map(c => ({ card_id: c.card_id, position: c.assignment })),
            startingPitcher: rosterCards[0].card_id
        };
        const lineupB = {
            battingOrder: rosterCards.slice(1, 10).map(c => ({ card_id: c.card_id, position: c.assignment })),
            startingPitcher: rosterCards[0].card_id
        };

        console.log('Submitting Lineup A...');
        await fetch(`${BACKEND_URL}/api/games/${gameId}/lineup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
            body: JSON.stringify(lineupA)
        });

        console.log('Submitting Lineup B...');
        await fetch(`${BACKEND_URL}/api/games/${gameId}/lineup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
            body: JSON.stringify(lineupB)
        });

        // 6. Wait for event
        console.log('Waiting for events...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('--- RESULT ---');
        console.log('Game Starting A:', gameStartingReceivedA);
        console.log('Game Starting B:', gameStartingReceivedB);

        if (gameStartingReceivedA && gameStartingReceivedB) {
            console.log('SUCCESS: Both users received game-starting.');
        } else {
            console.error('FAILURE: game-starting event missed.');
        }

        socketA.disconnect();
        socketB.disconnect();
        await pool.end();

    } catch (err) {
        console.error('Script failed:', err);
        await pool.end();
        process.exit(1);
    }
}

main();
