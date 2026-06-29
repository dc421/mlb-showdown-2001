const { schedulePlayoffsIfClinched } = require('../services/playoffSchedulingService');

// Mock db that records INSERTs and answers everything else with no rows. Passing standings +
// seriesResults means the service never issues the SELECTs, so only INSERTs reach the mock.
function mockDb() {
    const inserts = [];
    const db = {
        query: (sql, params) => {
            if (/INSERT/i.test(sql)) inserts.push({ round: params[1], a: params[2], b: params[3] });
            return Promise.resolve({ rows: [] });
        }
    };
    return { db, inserts };
}

const decidedStandings = [
    { team_id: 1, name: 'A', clinch: 'x-' },
    { team_id: 2, name: 'B', clinch: 'x-' },
    { team_id: 3, name: 'C', clinch: 'y-' },
    { team_id: 4, name: 'D', clinch: 'z-' },
    { team_id: 5, name: 'E', clinch: 'z-' }
];

describe('schedulePlayoffsIfClinched', () => {
    test('creates Golden Spaceship (top 2) and Wooden Spoon (bottom 2) when the field is clinched', async () => {
        const { db, inserts } = mockDb();
        const created = await schedulePlayoffsIfClinched(db, 'S1', { standings: decidedStandings, seriesResults: [] });
        expect(created).toBe(true);
        expect(inserts).toHaveLength(2);
        const spaceship = inserts.find(i => i.round === 'Golden Spaceship');
        const spoon = inserts.find(i => i.round === 'Wooden Spoon');
        expect([spaceship.a, spaceship.b].sort()).toEqual([1, 2]); // A vs B
        expect([spoon.a, spoon.b].sort()).toEqual([4, 5]);          // D vs E
    });

    test('does nothing until BOTH fields are clinched', async () => {
        const { db, inserts } = mockDb();
        // Spaceship locked, but the spoon is still contested (only one z-).
        const partial = [
            { team_id: 1, name: 'A', clinch: 'x-' },
            { team_id: 2, name: 'B', clinch: 'x-' },
            { team_id: 3, name: 'C', clinch: '' },
            { team_id: 4, name: 'D', clinch: '' },
            { team_id: 5, name: 'E', clinch: 'z-' }
        ];
        const created = await schedulePlayoffsIfClinched(db, 'S1', { standings: partial, seriesResults: [] });
        expect(created).toBe(false);
        expect(inserts).toHaveLength(0);
    });

    test('does not recreate series that already exist', async () => {
        const { db, inserts } = mockDb();
        const seriesResults = [
            { round: 'Golden Spaceship' },
            { round: 'Wooden Spoon' }
        ];
        const created = await schedulePlayoffsIfClinched(db, 'S1', { standings: decidedStandings, seriesResults });
        expect(created).toBe(false);
        expect(inserts).toHaveLength(0);
    });

    test('creates only the missing series', async () => {
        const { db, inserts } = mockDb();
        const seriesResults = [{ round: 'Golden Spaceship' }]; // spaceship already exists, spoon missing
        const created = await schedulePlayoffsIfClinched(db, 'S1', { standings: decidedStandings, seriesResults });
        expect(created).toBe(true);
        expect(inserts).toHaveLength(1);
        expect(inserts[0].round).toBe('Wooden Spoon');
    });
});
