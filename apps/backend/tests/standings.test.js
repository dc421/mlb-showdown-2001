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

    test('clinch letters follow the odds when the regular season is decided (h2h tiebreaks)', () => {
        // Complete 5-team round robin (no postseason series yet) forming a clean ladder via h2h:
        // A beats B,C,D,E; B beats C,D,E; etc. Records tie up at 16/15/14/13/12 but ranks are fixed,
        // so the field is mathematically decided: A,B -> spaceship, C -> middle, D,E -> spoon.
        const order = [1, 2, 3, 4, 5];
        const nameOf = (tid) => mockTeams.find(t => t.team_id === tid).name;
        const series = [];
        let id = 1;
        for (let i = 0; i < order.length; i++) {
            for (let j = i + 1; j < order.length; j++) {
                // higher-ranked team (earlier in `order`) wins each series 4-3
                series.push({
                    id: id++, round: 'R',
                    winning_team_id: order[i], losing_team_id: order[j],
                    winning_team_name: nameOf(order[i]),
                    losing_team_name: nameOf(order[j]),
                    winning_score: 4, losing_score: 3
                });
            }
        }
        const standings = calculateStandings(series, mockTeams, false, { numSims: 200 });
        const clinchOf = (tid) => standings.find(s => s.team_id === tid).clinch;
        expect(clinchOf(1)).toBe('x-'); // A — spaceship
        expect(clinchOf(2)).toBe('x-'); // B — spaceship
        expect(clinchOf(3)).toBe('y-'); // C — locked into the middle
        expect(clinchOf(4)).toBe('z-'); // D — spoon
        expect(clinchOf(5)).toBe('z-'); // E — spoon
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

describe('Playoff scenarios', () => {
    const { computePlayoffScenarios } = require('../utils/standingsUtils');

    // Build a completed regular-season series row (7 games, scores sum to 7).
    const done = (id, w, l, ws, ls) => ({
        id, round: 'R',
        winning_team_id: w, losing_team_id: l,
        winning_team_name: String.fromCharCode(64 + w), losing_team_name: String.fromCharCode(64 + l),
        winning_score: ws, losing_score: ls
    });
    // Build an unplayed series row.
    const unplayed = (id, t1, t2) => ({
        id, round: 'R',
        winning_team_id: t1, losing_team_id: t2,
        winning_team_name: String.fromCharCode(64 + t1), losing_team_name: String.fromCharCode(64 + t2),
        winning_score: null, losing_score: null
    });
    const teamsN = (n) => Array.from({ length: n }, (_, i) => ({
        team_id: i + 1, name: String.fromCharCode(65 + i), city: String.fromCharCode(65 + i), logo_url: ''
    }));

    const rowFor = (out, sid, tid) => out[sid].teams.find(p => p.team_id === tid);
    const idsIn = (out, sid) => out[sid].teams.map(p => p.team_id);

    // Every team is plotted against the SERIES RESULT (team1's wins). 3-team round robin: A and B each
    // beat C 4-3; A vs B is the only unplayed series. A reaches the top 2 once it wins >= 2; B is its
    // mirror (B's wins = 7 - A's); and C — which isn't even playing — flips between a spaceship seat
    // and the spoon depending on how A vs B goes, so it's shown too.
    test('all-team outlook indexed by series result, including a non-playing team', () => {
        const teams = teamsN(3);
        const series = [done(10, 1, 3, 4, 3), done(11, 2, 3, 4, 3), unplayed(12, 1, 2)];
        const out = computePlayoffScenarios(series, teams);

        expect(Object.keys(out)).toEqual(['12']);
        expect(idsIn(out, 12).slice().sort()).toEqual([1, 2, 3]); // A, B and the non-playing C
        expect(rowFor(out, 12, 1).spaceship).toEqual([0, 0, 1, 1, 1, 1, 1, 1]); // A, by A's wins
        expect(rowFor(out, 12, 2).spaceship).toEqual([1, 1, 1, 1, 1, 1, 0, 0]); // B, mirror of A
        expect(rowFor(out, 12, 3).spoon).toEqual([0, 0, 1, 1, 1, 1, 0, 0]);     // C: spoon only in the middle
    });

    // 5-team season: A and B win out (locked into the spaceship regardless), so they're flat and
    // dropped. The D-vs-E result still swings C's spoon fate (a non-participant) and D's and E's, so
    // those three are shown. A team's t1 row is indexed by its own wins (D is team1 here).
    test('drops flat/decided teams and keeps every team the result still swings', () => {
        const teams = teamsN(5);
        const series = [
            done(1, 1, 2, 4, 3), done(2, 1, 3, 7, 0), done(3, 1, 4, 7, 0), done(4, 1, 5, 7, 0),
            done(5, 2, 3, 7, 0), done(6, 2, 4, 7, 0), done(7, 2, 5, 7, 0),
            done(8, 3, 4, 4, 3), done(9, 3, 5, 4, 3),
            unplayed(99, 4, 5)
        ];
        const out = computePlayoffScenarios(series, teams);
        const ids = idsIn(out, 99);
        expect(ids).not.toContain(1); // A — flat spaceship, dropped
        expect(ids).not.toContain(2); // B — flat spaceship, dropped
        expect(ids.slice().sort()).toEqual([3, 4, 5]); // C (non-playing), D, E
        expect(rowFor(out, 99, 3).spoon).toEqual([1, 1, 0, 0, 0, 0, 1, 1]); // C swings in/out of spoon
        expect(rowFor(out, 99, 4).spoon).toEqual([1, 1, 1, 1, 1, 1, 0, 0]); // D (team1) by its own wins
        expect(rowFor(out, 99, 4).spaceship.every(v => v === 0)).toBe(true);
    });

    // A team's t1 row can lock spoon-safety (spoon → 0) with fewer wins than it needs to clinch the
    // spaceship (spaceship → 1), with a "neither" band between.
    test('t1 row shows spoon-safety locking before the spaceship clinch', () => {
        const teams = teamsN(5);
        const series = [
            done(1, 1, 2, 4, 3), done(2, 1, 3, 4, 3), done(3, 1, 4, 5, 2), done(4, 1, 5, 5, 2),
            done(5, 2, 3, 4, 3), done(6, 2, 4, 4, 3), done(7, 2, 5, 4, 3),
            done(8, 3, 5, 5, 2),
            done(9, 5, 4, 4, 3),
            unplayed(99, 3, 4)
        ];
        const c = rowFor(computePlayoffScenarios(series, teams), 99, 3); // C is team1
        expect(c.spaceship).toEqual([0, 0, 0, 0, 0, 1, 1, 1]); // clinch at 5 wins
        expect(c.spoon).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);     // spoon-safe at 3 wins
    });

    // With multiple series unplayed the curves are fractional, but every row must stay well-formed:
    // probabilities in [0,1] and spaceship + spoon never exceeding 1 (a team can't be both at once).
    test('probabilities are bounded and mutually exclusive', () => {
        const teams = teamsN(5);
        const series = [
            done(1, 1, 2, 4, 3), done(2, 1, 3, 4, 3), done(3, 2, 4, 4, 3), done(4, 3, 5, 4, 3),
            unplayed(50, 1, 4), unplayed(51, 2, 5), unplayed(52, 3, 4)
        ];
        const out = computePlayoffScenarios(series, teams);
        expect(Object.keys(out).length).toBeGreaterThan(0);
        for (const sid of Object.keys(out)) {
            for (const p of out[sid].teams) {
                for (let k = 0; k < 8; k++) {
                    expect(p.spaceship[k]).toBeGreaterThanOrEqual(0);
                    expect(p.spoon[k]).toBeGreaterThanOrEqual(0);
                    expect(p.spaceship[k] + p.spoon[k]).toBeLessThanOrEqual(1 + 1e-9);
                }
            }
        }
    });

    test('returns empty when no series remain', () => {
        const teams = teamsN(3);
        const series = [done(10, 1, 3, 4, 3), done(11, 2, 3, 4, 3), done(12, 1, 2, 4, 3)];
        expect(computePlayoffScenarios(series, teams)).toEqual({});
    });

    // A series is only surfaced once some result locks an outcome. Early on, with everything still up
    // for grabs, no single series can guarantee anything, so nothing is shown.
    test('omits series where no result locks an outcome', () => {
        const teams = teamsN(6);
        // 6 teams, 6 unplayed series (each team in two), no completed games — nothing is decidable.
        const series = [
            unplayed(1, 1, 2), unplayed(2, 3, 4), unplayed(3, 5, 6),
            unplayed(4, 1, 3), unplayed(5, 2, 5), unplayed(6, 4, 6)
        ];
        expect(computePlayoffScenarios(series, teams)).toEqual({});
    });

    test('performance guard: returns empty when too many series remain (R > 6)', () => {
        const teams = teamsN(4);
        // 7 unplayed series — above the 8^6 enumeration cap.
        const series = Array.from({ length: 7 }, (_, i) => unplayed(100 + i, (i % 2) + 1, (i % 2) + 3));
        expect(computePlayoffScenarios(series, teams)).toEqual({});
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
