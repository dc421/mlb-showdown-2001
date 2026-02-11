const { matchesFranchise, getMappedIds } = require('../utils/franchiseUtils');

describe('franchiseUtils', () => {
    const mockCurrentTeams = [
        { team_id: 1, name: 'Boston', city: 'Boston' },
        { team_id: 3, name: 'New York', city: 'New York' },
        { team_id: 5, name: 'NY South', city: 'NY South' },
        { team_id: 7, name: 'Detroit', city: 'Detroit' },
        { team_id: 9, name: 'Ann Arbor', city: 'Ann Arbor' }
    ];

    describe('getMappedIds', () => {
        test('maps 1 -> 1, 3, 5', () => {
            expect(getMappedIds(1)).toEqual([1, 3, 5]);
        });
        test('maps 3 -> 1, 3, 5', () => {
            expect(getMappedIds(3)).toEqual([1, 3, 5]);
        });
        test('maps 5 -> 1, 3, 5', () => {
            expect(getMappedIds(5)).toEqual([1, 3, 5]);
        });
        test('maps other -> itself', () => {
             expect(getMappedIds(7)).toEqual([7]);
        });
    });

    describe('matchesFranchise', () => {
        const boston = mockCurrentTeams[0]; // ID 1
        const newYork = mockCurrentTeams[1]; // ID 3
        const nySouth = mockCurrentTeams[2]; // ID 5
        const detroit = mockCurrentTeams[3]; // ID 7

        const mappedIds = [1, 3, 5];

        test('Matches exact name', () => {
            expect(matchesFranchise('Boston', 1, boston, mockCurrentTeams, mappedIds)).toBe(true);
        });

        test('Matches known alias (San Diego -> Boston)', () => {
            expect(matchesFranchise('San Diego', 5, boston, mockCurrentTeams, mappedIds)).toBe(true);
        });

        test('Matches new alias (Fargo -> NY South)', () => {
            expect(matchesFranchise('Fargo', 5, nySouth, mockCurrentTeams, mappedIds)).toBe(true);
        });

        test('Matches new alias (Laramie -> Detroit)', () => {
            expect(matchesFranchise('Laramie', 7, detroit, mockCurrentTeams, [7])).toBe(true);
        });

        test('Exclusion: "New York" matches New York but NOT NY South', () => {
            expect(matchesFranchise('New York', 3, newYork, mockCurrentTeams, mappedIds)).toBe(true);
            // NY South shouldn't claim New York
            expect(matchesFranchise('New York', 3, nySouth, mockCurrentTeams, mappedIds)).toBe(false);
        });

        test('Exclusion: "New York South" matches NY South but NOT New York', () => {
            expect(matchesFranchise('New York South', 5, nySouth, mockCurrentTeams, mappedIds)).toBe(true);
            // New York shouldn't claim New York South
            expect(matchesFranchise('New York South', 5, newYork, mockCurrentTeams, mappedIds)).toBe(false);
        });

        test('Safeguard: New York should NOT claim NYDC (NY South alias) via ID match', () => {
            // "NYDC" is alias of NY South.
            // ID match: NYDC (ID 5) matches New York (ID 3) via mappedIds [1,3,5].
            // But Safeguard should see NYDC belongs to NY South (Alias).
            expect(matchesFranchise('NYDC', 5, newYork, mockCurrentTeams, mappedIds)).toBe(false);
        });

        test('Safeguard: Boston should claim San Diego even if ID 5 (shared with NY South)', () => {
            // San Diego is alias of Boston.
            // ID 5 matches Boston ID 1 via mappedIds.
            // Safeguard should see San Diego belongs to Boston (me), so keep it.
            // Check if it belongs to anyone else?
            // "San Diego" doesn't belong to NY South (ID 5).
            // So Boston keeps it.
            expect(matchesFranchise('San Diego', 5, boston, mockCurrentTeams, mappedIds)).toBe(true);
        });

        test('Safeguard: NY South should NOT claim San Diego (Boston Alias) via ID match', () => {
             // San Diego (ID 5). NY South (ID 5). ID Match.
             // Safeguard: San Diego matches Boston (Other).
             // Matches Me (NY South)? No.
             // Should return false.
             expect(matchesFranchise('San Diego', 5, nySouth, mockCurrentTeams, mappedIds)).toBe(false);
        });
    });
});
