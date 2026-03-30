const { matchesFranchise, getMappedIds } = require('../utils/franchiseUtils');

describe('franchiseUtils', () => {
    const mockCurrentTeams = [
        { team_id: 1, name: 'Boston', city: 'Boston' },
        { team_id: 3, name: 'New York', city: 'New York' },
        { team_id: 5, name: 'Los Angeles', city: 'Los Angeles' },
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
        const laTeam = mockCurrentTeams[2]; // ID 5
        const detroit = mockCurrentTeams[3]; // ID 7

        const mappedIds = [1, 3, 5];

        test('Matches exact name', () => {
            expect(matchesFranchise('Boston', 1, boston, mockCurrentTeams, mappedIds)).toBe(true);
        });

        test('Matches known alias (San Diego -> Boston)', () => {
            expect(matchesFranchise('San Diego', 5, boston, mockCurrentTeams, mappedIds)).toBe(true);
        });

        test('Matches new alias (Fargo -> Los Angeles)', () => {
            expect(matchesFranchise('Fargo', 5, laTeam, mockCurrentTeams, mappedIds)).toBe(true);
        });

        test('Matches new alias (Laramie -> Detroit)', () => {
            expect(matchesFranchise('Laramie', 7, detroit, mockCurrentTeams, [7])).toBe(true);
        });

        test('Exclusion: "New York" matches New York but NOT Los Angeles', () => {
            expect(matchesFranchise('New York', 3, newYork, mockCurrentTeams, mappedIds)).toBe(true);
            // Los Angeles shouldn't claim New York
            expect(matchesFranchise('New York', 3, laTeam, mockCurrentTeams, mappedIds)).toBe(false);
        });

        test('Exclusion: "New York South" matches Los Angeles but NOT New York', () => {
            expect(matchesFranchise('New York South', 5, laTeam, mockCurrentTeams, mappedIds)).toBe(true);
            // New York shouldn't claim New York South
            expect(matchesFranchise('New York South', 5, newYork, mockCurrentTeams, mappedIds)).toBe(false);
        });

        test('Safeguard: New York should NOT claim NYDC (Los Angeles alias) via ID match', () => {
            // "NYDC" is alias of Los Angeles.
            // ID match: NYDC (ID 5) matches New York (ID 3) via mappedIds [1,3,5].
            // But Safeguard should see NYDC belongs to Los Angeles (Alias).
            expect(matchesFranchise('NYDC', 5, newYork, mockCurrentTeams, mappedIds)).toBe(false);
        });

        test('Safeguard: Boston should claim San Diego even if ID 5 (shared with Los Angeles)', () => {
            // San Diego is alias of Boston.
            // ID 5 matches Boston ID 1 via mappedIds.
            // Safeguard should see San Diego belongs to Boston (me), so keep it.
            // Check if it belongs to anyone else?
            // "San Diego" doesn't belong to Los Angeles (ID 5).
            // So Boston keeps it.
            expect(matchesFranchise('San Diego', 5, boston, mockCurrentTeams, mappedIds)).toBe(true);
        });

        test('Safeguard: Los Angeles should NOT claim San Diego (Boston Alias) via ID match', () => {
             // San Diego (ID 5). Los Angeles (ID 5). ID Match.
             // Safeguard: San Diego matches Boston (Other).
             // Matches Me (Los Angeles)? No.
             // Should return false.
             expect(matchesFranchise('San Diego', 5, laTeam, mockCurrentTeams, mappedIds)).toBe(false);
        });
    });
});
