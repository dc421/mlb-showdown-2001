const { matchesFranchise, getMappedIds } = require('../utils/franchiseUtils');

describe('franchiseUtils', () => {
    const mockCurrentTeams = [
        { team_id: 3, name: 'Boston', city: 'Boston' },
        { team_id: 5, name: 'New York', city: 'New York' },
        { team_id: 1, name: 'NY South', city: 'NY South' }, // Assuming mapped ID handles 1 -> [1, 3] in Prod or something, but let's test logic
        { team_id: 7, name: 'Detroit', city: 'Detroit' },
        { team_id: 9, name: 'Ann Arbor', city: 'Ann Arbor' }
    ];

    describe('getMappedIds', () => {
        test('maps 1 -> 1, 3', () => {
            expect(getMappedIds(1)).toContain(1);
            expect(getMappedIds(1)).toContain(3);
        });
        test('maps 3 -> 3, 5', () => {
            expect(getMappedIds(3)).toContain(3);
            expect(getMappedIds(3)).toContain(5);
        });
        test('maps 5 -> 5, 1', () => {
            expect(getMappedIds(5)).toContain(5);
            expect(getMappedIds(5)).toContain(1);
        });
        test('maps other -> itself', () => {
             expect(getMappedIds(7)).toEqual([7]);
        });
    });

    describe('matchesFranchise', () => {
        const boston = mockCurrentTeams[0];
        const newYork = mockCurrentTeams[1];
        const nySouth = mockCurrentTeams[2];
        const detroit = mockCurrentTeams[3];
        const annArbor = mockCurrentTeams[4];

        // Mocks based on getMappedIds logic (simplified for test)
        // Boston (3) -> [3, 5] (Wait, code says 3 -> 3, 5)
        // New York (5) -> [5, 1]
        // NY South (1) -> [1, 3]

        test('Matches exact name', () => {
            expect(matchesFranchise('Boston', null, boston, mockCurrentTeams, [3])).toBe(true);
        });

        test('Matches known alias (San Diego -> Boston)', () => {
            expect(matchesFranchise('San Diego', null, boston, mockCurrentTeams, [3])).toBe(true);
        });

        test('Matches new alias (Fargo -> NY South)', () => {
            expect(matchesFranchise('Fargo', null, nySouth, mockCurrentTeams, [1])).toBe(true);
        });

        test('Matches new alias (Laramie -> Detroit)', () => {
            expect(matchesFranchise('Laramie', null, detroit, mockCurrentTeams, [7])).toBe(true);
        });

        test('Exclusion: "New York" matches New York but NOT NY South', () => {
            // New York checks "New York" -> True
            expect(matchesFranchise('New York', null, newYork, mockCurrentTeams, [5])).toBe(true);

            // NY South checks "New York" -> Should be False (False Positive Logic)
            // Because "New York" matches 'New York' (Other Team) better or equal?
            // "New York" is contained in "New York".
            // "New York" is NOT contained in "NY South".
            // Wait, "New York" IS contained in "New York" (Other Team).
            // Does "New York" match "NY South"? No.
            expect(matchesFranchise('New York', null, nySouth, mockCurrentTeams, [1])).toBe(false);
        });

        test('Exclusion: "New York South" matches NY South but NOT New York', () => {
            expect(matchesFranchise('New York South', null, nySouth, mockCurrentTeams, [1])).toBe(true); // Fuzzy match
             // New York checks "New York South".
             // It matches "New York" (Me).
             // But it matches "NY South" (Other)? "New York South" contains "NY South"? No.
             // But "New York South" contains "South".
             // Code: if recordName.includes('South') && !currentTeamName.includes('South') -> True (Belongs to other)
            expect(matchesFranchise('New York South', null, newYork, mockCurrentTeams, [5])).toBe(false);
        });

        test('ID Match with Name Safeguard', () => {
            // ID 1 maps to Boston (via getMappedIds logic: 1 -> 1,3).
            // Assume we are Boston (3). Record has ID 1. MappedIds [3, 5]... Wait.
            // If Boston is 3, getMappedIds(3) returns [3, 5].
            // If Record is 5 (New York ID on Prod?), Boston claims it?
            // No, New York exists.

            // Let's test explicit safeguard.
            // Record: "New York", ID: 5.
            // Current: Boston (ID 3). MappedIDs: [3, 5].
            // ID Match: True (5 is in [3, 5]).
            // Name Safeguard: Record "New York" matches Other Team (New York).
            // Does it match Me (Boston)? No.
            // Result: False.
            expect(matchesFranchise('New York', 5, boston, mockCurrentTeams, [3, 5])).toBe(false);
        });
    });
});
