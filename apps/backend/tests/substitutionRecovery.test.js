const fs = require('fs');
const path = require('path');
const vm = require('vm');
const substitutionUtils = require('../utils/substitutionUtils');

// Exercise the real route and validator without starting the monolithic server,
// opening database connections, or running its scheduled jobs.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const rolen = { card_id: 292, name: 'Scott Rolen', control: null, fielding_ratings: { '3B': 3 } };
const king = { card_id: 490, name: 'Ray King', control: 3, fielding_ratings: null };
const remlinger = { card_id: 422, name: 'Mike Remlinger', control: 3, fielding_ratings: null };
const cards = [rolen, king, remlinger];
const clone = value => JSON.parse(JSON.stringify(value));

function createGame() {
    const participant = {
        user_id: 8, home_or_away: 'away',
        lineup: { startingPitcher: 495, battingOrder: [
            { card_id: 292, position: '3B' }, { card_id: 422, position: 'P' }
        ] }
    };
    let state = {
        inning: 8, isTopInning: false, outs: 0, homeScore: 0, awayScore: 0,
        bases: { first: null, second: null, third: null },
        homeTeam: { userId: 6, used_player_ids: [] },
        awayTeam: { userId: 8, used_player_ids: [] },
        currentAtBat: { batter: clone(rolen), pitcher: clone(remlinger),
            batterAction: 'swing', pitcherAction: null,
            basesBeforePlay: { first: null, second: null, third: null } },
        currentAwayPitcher: clone(remlinger), pitcherStats: {}, awaiting_lineup_change: false
    };
    const events = [];
    const query = jest.fn(async (sql, args = []) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.startsWith('SELECT game_id FROM games')) return { rows: [{ game_id: 183 }] };
        if (sql.startsWith('SELECT * FROM game_states')) return { rows: [{ state_data: clone(state), turn_number: 1 }] };
        if (sql.includes('SELECT state_data FROM game_states')) return { rows: [{ state_data: clone(state) }] };
        if (sql.startsWith('SELECT * FROM game_participants')) return { rows: [clone(participant), { user_id: 6, home_or_away: 'home' }] };
        if (sql.startsWith('SELECT home_team_user_id')) return { rows: [{ home_team_user_id: 6 }] };
        if (sql.startsWith('SELECT * FROM cards_player')) return { rows: [clone(cards.find(c => c.card_id === Number(args[0])))] };
        if (sql.startsWith('SELECT city')) return { rows: [{ city: 'New York' }] };
        if (sql.startsWith('SELECT use_dh')) return { rows: [{ use_dh: false }] };
        if (sql.startsWith('SELECT roster_data')) return { rows: [{ roster_data: clone(cards) }] };
        if (sql.includes('SELECT 1 FROM game_events')) return { rows: [{ exists: 1 }] };
        if (sql.startsWith('UPDATE game_participants')) {
            participant.lineup = JSON.parse(args[0]);
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO game_states')) {
            state = clone(args[2]);
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO game_events')) {
            events.push(args[4]);
            return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
    });
    let handler;
    const client = { query, release: jest.fn() };
    const sandbox = {
        ...substitutionUtils,
        pool: { connect: async () => client, query },
        app: { post: (url, auth, fn) => { handler = fn; } },
        authenticateToken: () => {},
        console: { log() {}, warn() {}, error: (...args) => { throw new Error(args.join(' ')); } },
        validatePitcherSubstitution: () => ({ isValid: true }),
        getEffectiveControl: () => 3,
        getCatcherArm: async () => 0, getInfieldDefense: async () => 3, getOutfieldDefense: async () => 0,
        createInningChangeEvent: async () => {}, getOrdinal: n => `${n}th`,
        getAndProcessGameData: async () => ({}), io: { to: () => ({ emit() {} }) }
    };
    vm.createContext(sandbox);
    const validator = source.slice(source.indexOf('async function validateLineup('), source.indexOf('async function initializePitcherFatigue('));
    const routeStart = source.indexOf("app.post('/api/games/:gameId/substitute'");
    const routeEnd = source.indexOf('// SWAP DEFENSIVE POSITIONS', routeStart);
    vm.runInContext(validator + source.slice(routeStart, routeEnd), sandbox);
    const commitStart = source.indexOf('function commitTransientPlayerIds(');
    vm.runInContext(source.slice(commitStart, source.indexOf('const BACKEND_URL', commitStart)), sandbox);
    return {
        get state() { return state; }, participant, events,
        async sub(playerInId, playerOutId, position, lineupIndex) {
            const response = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json: jest.fn() };
            await handler({ params: { gameId: 183 }, user: { userId: 8 }, body: { playerInId, playerOutId, position, lineupIndex } }, response);
            return response;
        },
        commit() { sandbox.commitTransientPlayerIds(state); }
    };
}

test('undo restores Rolen to 3B after a position swap, then King replaces Remlinger at P', async () => {
    const game = createGame();
    expect((await game.sub(490, 292, '3B', 0)).statusCode).toBe(200);
    expect(game.state.awaiting_lineup_change).toBe(true);
    expect(game.state.currentAtBat.pitcher.card_id).toBe(422);
    expect(game.state.awayTeam.transient_lineup_positions[292]).toBe('3B');

    // The user tries to fix King by swapping him with the pitcher before undoing.
    game.participant.lineup.battingOrder[0].position = 'P';
    game.participant.lineup.battingOrder[1].position = '3B';
    expect((await game.sub(292, 490, 'P', 0)).statusCode).toBe(200);
    expect(game.participant.lineup.battingOrder[0]).toEqual({ card_id: 292, position: '3B' });
    expect(game.state.awayTeam.transient_lineup_positions[292]).toBeUndefined();
    expect(game.state.currentAtBat.pitcher.card_id).toBe(422);

    expect((await game.sub(490, 422, '3B', 1)).statusCode).toBe(200);
    expect(game.participant.lineup.battingOrder[1]).toEqual({ card_id: 490, position: 'P' });
    expect(game.state.currentAtBat.pitcher.card_id).toBe(490);
    expect(game.state.currentAwayPitcher.card_id).toBe(490);
    expect(game.state.awaiting_lineup_change).toBe(false);
    expect(game.state.currentAtBat.batter.card_id).toBe(292);
    expect(game.state.currentAtBat.batterAction).toBe('swing');
    expect(game.events[1]).toContain('Scott Rolen will now play 3B');
});

test('a pitcher substituted at 3B while lineup is invalid leaves the active pitcher alone', async () => {
    const game = createGame();
    game.state.awaiting_lineup_change = true;
    await game.sub(490, 292, '3B', 0);
    expect(game.state.currentAtBat.pitcher.card_id).toBe(422);
    expect(game.state.currentAwayPitcher.card_id).toBe(422);
    expect(game.state.awaiting_lineup_change).toBe(true);
});

test('straight reversal restores a valid lineup and does not consume either player', async () => {
    const game = createGame();
    await game.sub(490, 292, '3B', 0);
    await game.sub(292, 490, '3B', 0);
    expect(game.state.awaiting_lineup_change).toBe(false);
    expect(game.state.awayTeam.transient_used_player_ids).toEqual([]);
    expect(game.state.awayTeam.transient_subbed_in_player_ids).toEqual([]);
    await game.sub(490, 422, 'P', 1);
    expect(game.state.currentAwayPitcher.card_id).toBe(490);
});

test('a returning player cannot enter another batting slot', async () => {
    const game = createGame();
    await game.sub(490, 292, '3B', 0);
    expect((await game.sub(292, 422, 'P', 1)).statusCode).toBe(400);
    expect(game.participant.lineup.battingOrder[0].card_id).toBe(490);
});

test('committing the next play clears recovery metadata and prevents re-entry', async () => {
    const game = createGame();
    await game.sub(490, 292, '3B', 0);
    game.commit();
    expect(game.state.awayTeam.transient_lineup_positions).toEqual({});
    expect(game.state.awayTeam.transient_lineup_slots).toEqual({});
    expect(game.state.awayTeam.used_player_ids).toContain(292);
    expect((await game.sub(292, 490, '3B', 0)).statusCode).toBe(400);
});

test('older state without saved positions uses the requested position', async () => {
    const game = createGame();
    await game.sub(490, 292, '3B', 0);
    delete game.state.awayTeam.transient_lineup_positions;
    expect((await game.sub(292, 490, '3B', 0)).statusCode).toBe(200);
    expect(game.state.awaiting_lineup_change).toBe(false);
});
