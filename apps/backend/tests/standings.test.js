const { calculateStandings } = require('../utils/standingsUtils');

// Mock Data
const mockTeams = [
    { team_id: 1, name: 'Boston', city: 'Boston', logo_url: 'boston.png' },
    { team_id: 2, name: 'New York', city: 'New York', logo_url: 'ny.png' },
    { team_id: 3, name: 'Laramie', city: 'Laramie', logo_url: 'laramie.png' },
    { team_id: 4, name: 'Ann Arbor', city: 'Ann Arbor', logo_url: 'aa.png' },
    { team_id: 5, name: 'NY South', city: 'NY South', logo_url: 'nys.png' }
];

const mockPhantoms = { team_id: 99, name: 'Phantoms', city: 'Phantoms', logo_url: 'phantoms.png' };

describe('Standings Logic', () => {

    test('should exclude Phantoms from standings', () => {
        const teamsWithPhantoms = [...mockTeams, mockPhantoms];
        
        // Mock a series where Phantoms win
        const seriesResults = [
            {
                winning_team_name: 'Phantoms', winning_team_id: 99,
                losing_team_name: 'Boston', losing_team_id: 1,
                winning_score: 5, losing_score: 2,
                round: 'Regular Season'
            },
            {
                winning_team_name: 'Boston', winning_team_id: 1,
                losing_team_name: 'New York', losing_team_id: 2,
                winning_score: 3, losing_score: 1,
                round: 'Regular Season'
            }
        ];

        const standings = calculateStandings(seriesResults, teamsWithPhantoms, false);

        expect(standings).toBeDefined();
        // Check if Phantoms is present
        const phantoms = standings.find(t => t.name === 'Phantoms');
        expect(phantoms).toBeUndefined();

        // Check Boston and NY are present
        const boston = standings.find(t => t.name === 'Boston');
        const ny = standings.find(t => t.name === 'New York');
        expect(boston).toBeDefined();
        expect(ny).toBeDefined();
    });

    test('should assign x- and z- prefixes correctly for completed season with postseason series', () => {
        // Mock a "Completed" season where everyone played
        // Crucially, we have Spaceship and Spoon series
        const seriesResults = [
            // Golden Spaceship Series (Boston vs New York)
            { winning_team_name: 'Boston', winning_team_id: 1, losing_team_name: 'New York', losing_team_id: 2, winning_score: 4, losing_score: 3, round: 'Golden Spaceship' },
            
            // Wooden Spoon Series (Laramie vs NY South)
            { winning_team_name: 'Laramie', winning_team_id: 3, losing_team_name: 'NY South', losing_team_id: 5, winning_score: 4, losing_score: 3, round: 'Wooden Spoon' }
        ];

        // Add dummy regular season games so all teams appear in standings
        const regularSeason = [
            { winning_team_name: 'Boston', winning_team_id: 1, losing_team_name: 'New York', losing_team_id: 2, winning_score: 1, losing_score: 0, round: 'R1' },
            { winning_team_name: 'Laramie', winning_team_id: 3, losing_team_name: 'NY South', losing_team_id: 5, winning_score: 1, losing_score: 0, round: 'R1' },
            { winning_team_name: 'Ann Arbor', winning_team_id: 4, losing_team_name: 'Boston', losing_team_id: 1, winning_score: 1, losing_score: 0, round: 'R1' }
        ];

        const fullResults = [...regularSeason, ...seriesResults];

        const standings = calculateStandings(fullResults, mockTeams, false);

        // Expect 5 teams
        expect(standings.length).toBe(5);

        // Boston (ID 1) -> x- (Spaceship)
        const boston = standings.find(t => t.team_id === 1);
        expect(boston.clinch).toBe('x-');

        // New York (ID 2) -> x- (Spaceship)
        const ny = standings.find(t => t.team_id === 2);
        expect(ny.clinch).toBe('x-');

        // Laramie (ID 3) -> z- (Spoon)
        const laramie = standings.find(t => t.team_id === 3);
        expect(laramie.clinch).toBe('z-');

        // NY South (ID 5) -> z- (Spoon)
        const nySouth = standings.find(t => t.team_id === 5);
        expect(nySouth.clinch).toBe('z-');

        // Ann Arbor (ID 4) -> No prefix
        const aa = standings.find(t => t.team_id === 4);
        expect(aa.clinch).toBe('y-');
    });
});

describe('Playoff Odds', () => {
    // One completed series per pair plus one unplayed series, so the season is
    // in-progress and the Monte Carlo runs.
    const inProgressSeason = [
        { id: 1, winning_team_name: 'Boston', winning_team_id: 1, losing_team_name: 'New York', losing_team_id: 2, winning_score: 4, losing_score: 2, round: 'Regular Season' },
        { id: 2, winning_team_name: 'Laramie', winning_team_id: 3, losing_team_name: 'Ann Arbor', losing_team_id: 4, winning_score: 4, losing_score: 1, round: 'Regular Season' },
        { id: 3, winning_team_name: 'NY South', winning_team_id: 5, losing_team_name: 'Boston', losing_team_id: 1, winning_score: 4, losing_score: 3, round: 'Regular Season' },
        // Unplayed (scores null) -> simulated
        { id: 4, winning_team_name: 'New York', winning_team_id: 2, losing_team_name: 'Laramie', losing_team_id: 3, winning_score: null, losing_score: null, round: 'Regular Season' },
        { id: 5, winning_team_name: 'Ann Arbor', winning_team_id: 4, losing_team_name: 'NY South', losing_team_id: 5, winning_score: null, losing_score: null, round: 'Regular Season' }
    ];

    test('simulated odds: spaceship spots sum to ~2 and spoon spots to ~2', () => {
        const standings = calculateStandings(inProgressSeason, mockTeams, false, { numSims: 20000 });
        const spaceshipSum = standings.reduce((s, t) => s + t.spaceshipOdds, 0);
        const spoonSum = standings.reduce((s, t) => s + t.spoonOdds, 0);
        // 2 spaceship seeds and 2 spoon seeds are awarded each simulation.
        expect(spaceshipSum).toBeCloseTo(2, 1);
        expect(spoonSum).toBeCloseTo(2, 1);
        standings.forEach(t => {
            expect(t.spaceshipOdds).toBeGreaterThanOrEqual(0);
            expect(t.spaceshipOdds).toBeLessThanOrEqual(1);
        });
    });

    test('precomputedOdds are attached verbatim and the simulation is skipped', () => {
        const precomputedOdds = {
            'ID-1': { spaceshipOdds: 0.81, spoonOdds: 0.01 },
            'ID-2': { spaceshipOdds: 0.42, spoonOdds: 0.12 },
            'ID-3': { spaceshipOdds: 0.42, spoonOdds: 0.12 },
            'ID-4': { spaceshipOdds: 0.20, spoonOdds: 0.40 },
            'ID-5': { spaceshipOdds: 0.15, spoonOdds: 0.35 }
        };
        const standings = calculateStandings(inProgressSeason, mockTeams, false, { precomputedOdds });
        standings.forEach(t => {
            expect(t.spaceshipOdds).toBe(precomputedOdds[`ID-${t.team_id}`].spaceshipOdds);
            expect(t.spoonOdds).toBe(precomputedOdds[`ID-${t.team_id}`].spoonOdds);
        });
    });

    test('teams missing from precomputedOdds default to 0 (no crash)', () => {
        const standings = calculateStandings(inProgressSeason, mockTeams, false, { precomputedOdds: {} });
        standings.forEach(t => {
            expect(t.spaceshipOdds).toBe(0);
            expect(t.spoonOdds).toBe(0);
        });
    });
});

describe('Playoff odds cache signature', () => {
    const { computeSignature } = require('../services/playoffOddsService');
    const rows = [
        { id: 1, round: 'Regular Season', winning_team_id: 1, losing_team_id: 2, winning_team_name: 'Boston', losing_team_name: 'New York', winning_score: 4, losing_score: 2 },
        { id: 2, round: 'Regular Season', winning_team_id: 3, losing_team_id: 4, winning_team_name: 'Laramie', losing_team_name: 'Ann Arbor', winning_score: null, losing_score: null }
    ];

    test('is stable and order-independent', () => {
        expect(computeSignature(rows)).toBe(computeSignature([...rows].reverse()));
    });

    test('changes when a result score changes', () => {
        const edited = rows.map(r => r.id === 2 ? { ...r, winning_score: 4, losing_score: 1 } : r);
        expect(computeSignature(edited)).not.toBe(computeSignature(rows));
    });

    test('changes when a result is added', () => {
        const added = [...rows, { id: 3, round: 'Regular Season', winning_team_id: 5, losing_team_id: 1, winning_team_name: 'NY South', losing_team_name: 'Boston', winning_score: 4, losing_score: 0 }];
        expect(computeSignature(added)).not.toBe(computeSignature(rows));
    });
});
