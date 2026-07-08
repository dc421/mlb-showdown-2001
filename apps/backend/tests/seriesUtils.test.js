const { resolveSeriesResultUpdate, seriesTypeForRound } = require('../utils/seriesUtils');

describe('seriesTypeForRound', () => {
    test('regular-season rounds map to regular_season', () => {
        expect(seriesTypeForRound('Regular Season')).toBe('regular_season');
        expect(seriesTypeForRound('Round Robin')).toBe('regular_season');
        expect(seriesTypeForRound('anything else')).toBe('regular_season');
    });
    test('postseason rounds map to their best-of-7 types', () => {
        expect(seriesTypeForRound('Golden Spaceship')).toBe('golden_spaceship');
        expect(seriesTypeForRound('Wooden Spoon')).toBe('wooden_spoon');
        expect(seriesTypeForRound('Semifinal')).toBe('playoff');
        expect(seriesTypeForRound('Play-In')).toBe('playoff');
    });
    test('Classic style overrides the round', () => {
        expect(seriesTypeForRound('Regular Season', 'Classic')).toBe('classic');
    });
});

// A scheduled row's orientation: home team in the winning_* slot, away in the losing_* slot.
const scheduled = () => ({
    winning_team_id: 10, winning_team_name: 'Boston',
    losing_team_id: 20, losing_team_name: 'New York',
});

describe('resolveSeriesResultUpdate', () => {
    test('in-progress: keeps schedule orientation and records the partial tally', () => {
        const u = resolveSeriesResultUpdate(scheduled(), {
            homeTeamId: 10, awayTeamId: 20, homeGames: 3, awayGames: 1, isOver: false,
        });
        expect(u.status).toBe('in_progress');
        expect(u.result_source).toBe('in_app');
        expect(u.winning_team_id).toBe(10);
        expect(u.winning_score).toBe(3);
        expect(u.losing_team_id).toBe(20);
        expect(u.losing_score).toBe(1);
    });

    test('completed, home (slot A) won: no swap, marked completed', () => {
        const u = resolveSeriesResultUpdate(scheduled(), {
            homeTeamId: 10, awayTeamId: 20, homeGames: 4, awayGames: 2, isOver: true,
        });
        expect(u.status).toBe('completed');
        expect(u.winning_team_id).toBe(10);
        expect(u.winning_score).toBe(4);
        expect(u.losing_team_id).toBe(20);
        expect(u.losing_score).toBe(2);
    });

    test('completed, away won: normalizes so the winner lands in the winning_* slot', () => {
        const u = resolveSeriesResultUpdate(scheduled(), {
            homeTeamId: 10, awayTeamId: 20, homeGames: 3, awayGames: 4, isOver: true,
        });
        expect(u.status).toBe('completed');
        expect(u.winning_team_id).toBe(20); // away team won -> now in winning slot
        expect(u.winning_team_name).toBe('New York');
        expect(u.winning_score).toBe(4);
        expect(u.losing_team_id).toBe(10);
        expect(u.losing_score).toBe(3);
    });

    test('maps by team id, not home/away: slot A holding the away team gets the away games', () => {
        // Schedule put the (eventual) away team in slot A.
        const row = {
            winning_team_id: 20, winning_team_name: 'New York',
            losing_team_id: 10, losing_team_name: 'Boston',
        };
        const u = resolveSeriesResultUpdate(row, {
            homeTeamId: 10, awayTeamId: 20, homeGames: 5, awayGames: 2, isOver: false,
        });
        expect(u.winning_team_id).toBe(20);
        expect(u.winning_score).toBe(2);  // away team's games, not home's
        expect(u.losing_team_id).toBe(10);
        expect(u.losing_score).toBe(5);
    });
});
