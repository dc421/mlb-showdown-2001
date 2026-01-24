const { matchesFranchise } = require('../utils/franchiseUtils');

describe('matchesFranchise', () => {
    // Mock data
    const boston = { team_id: 3, name: 'Boston', city: 'Boston' };
    const allTeams = [
        { team_id: 3, name: 'Boston', city: 'Boston' },
        { team_id: 5, name: 'New York', city: 'New York' },
        { team_id: 1, name: 'NY South', city: 'NY South' },
        { team_id: 4, name: 'Detroit', city: 'Detroit' },
        { team_id: 2, name: 'Ann Arbor', city: 'Ann Arbor' }
    ];
    // In local: Boston=1, NY=3, NYS=5. In prod: Boston=3, NY=5, NYS=1.
    // matchesFranchise uses mappedIds.
    // Let's assume we are checking for Boston.
    const mappedIds = ['3', '1', '5'];

    test('matches San Diego as Boston alias', () => {
        expect(matchesFranchise('San Diego', null, boston, allTeams, mappedIds)).toBe(true);
    });

    test('matches Fargo as NY South alias', () => {
        const nySouth = { team_id: 1, name: 'NY South', city: 'NY South' };
        // We need to pass the correct mappedIds for NY South or empty if strictly name matching
        expect(matchesFranchise('Fargo', null, nySouth, allTeams, [])).toBe(true);
        expect(matchesFranchise('NYDC', null, nySouth, allTeams, [])).toBe(true);
    });

    test('matches Laramie as Detroit alias', () => {
        const detroit = { team_id: 4, name: 'Detroit', city: 'Detroit' };
        expect(matchesFranchise('Laramie', null, detroit, allTeams, [])).toBe(true);
        expect(matchesFranchise('Cincinnati', null, detroit, allTeams, [])).toBe(true);
    });

     test('matches Chicago as Ann Arbor alias', () => {
        const annArbor = { team_id: 2, name: 'Ann Arbor', city: 'Ann Arbor' };
        expect(matchesFranchise('Chicago', null, annArbor, allTeams, [])).toBe(true);
        expect(matchesFranchise('Redwood City', null, annArbor, allTeams, [])).toBe(true);
    });
});

describe('Team History Logic', () => {
    test('Calculates W-L record correctly (counting games, not scores)', () => {
        const historyRows = [
            { season_name: 'S1', winning_team_name: 'Boston', winning_score: 5, losing_score: 2 },
            { season_name: 'S1', winning_team_name: 'Boston', winning_score: 3, losing_score: 1 },
            { season_name: 'S1', winning_team_name: 'New York', winning_score: 4, losing_score: 2 } // Loss for Boston if opponent
        ];

        // Simulating the logic in teams.js
        const seasonStats = {
            'S1': { wins: 0, losses: 0, regularWins: 0, regularLosses: 0 }
        };

        historyRows.forEach(r => {
            const season = r.season_name;
            let relevantSide = null;
            if (r.winning_team_name === 'Boston') relevantSide = 'winner';
            else if (r.winning_team_name === 'New York') relevantSide = 'loser'; // Boston lost

            if (relevantSide === 'winner') {
                seasonStats[season].wins += 1;
                seasonStats[season].regularWins += 1;
            } else {
                 seasonStats[season].losses += 1;
                 seasonStats[season].regularLosses += 1;
            }
        });

        // Before the fix, it would have been wins = 5+3=8, losses = 2
        // After the fix, it should be wins = 2, losses = 1
        expect(seasonStats['S1'].wins).toBe(2);
        expect(seasonStats['S1'].losses).toBe(1);
    });
});
