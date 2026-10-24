const { resolveSeriesResultUpdate, seriesTypeForRound, relieverCarryoverPenalty, homeFieldRule, higherClassicSeedUserId, classicRoundForPair } = require('../utils/seriesUtils');

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

describe('relieverCarryoverPenalty', () => {
    test('every point of fatigue comes off his IP', () => {
        expect(relieverCarryoverPenalty(0)).toBe(0);
        expect(relieverCarryoverPenalty(1)).toBe(1); // 2-IP reliever after 1 inning: C / C-1 / C-2
        expect(relieverCarryoverPenalty(2)).toBe(2); // after 2 innings: C-1 / C-2 / C-3
        expect(relieverCarryoverPenalty(3)).toBe(3);
    });
});

describe('homeFieldRule', () => {
    test('regular-season series roll for home', () => {
        expect(homeFieldRule('regular_season')).toBe('roll');
    });
    test('Spaceship, Spoon and Classic series give home to the higher seed', () => {
        expect(homeFieldRule('golden_spaceship')).toBe('seed');
        expect(homeFieldRule('wooden_spoon')).toBe('seed');
        expect(homeFieldRule('classic')).toBe('seed');
    });
    test('everything else lets the players choose', () => {
        expect(homeFieldRule('exhibition')).toBe('choose');
        expect(homeFieldRule('playoff')).toBe('choose');
        expect(homeFieldRule(undefined)).toBe('choose');
    });
});

describe('higherClassicSeedUserId', () => {
    // Ordered 5th → 1st seed.
    const seeding = [{ user_id: 5 }, { user_id: 4 }, { user_id: 3 }, { user_id: 2 }, { user_id: 1 }];
    test('picks the better seed regardless of argument order', () => {
        expect(higherClassicSeedUserId(seeding, 5, 4)).toBe(4);
        expect(higherClassicSeedUserId(seeding, 1, 4)).toBe(1);
        expect(higherClassicSeedUserId(seeding, 3, 2)).toBe(2);
    });
    test('matches ids across number/string types', () => {
        expect(higherClassicSeedUserId(seeding, '5', '1')).toBe('1');
    });
    test('null when either team is unseeded', () => {
        expect(higherClassicSeedUserId(seeding, 1, 99)).toBeNull();
        expect(higherClassicSeedUserId([], 1, 2)).toBeNull();
    });
});

describe('classicRoundForPair', () => {
    // Ordered 5th → 1st seed: user N is seed N.
    const seeding = [{ user_id: 5 }, { user_id: 4 }, { user_id: 3 }, { user_id: 2 }, { user_id: 1 }];
    test('4 v 5 is the Play-In', () => {
        expect(classicRoundForPair(seeding, 5, 4)).toBe('Play-In');
        expect(classicRoundForPair(seeding, 4, 5)).toBe('Play-In');
    });
    test('1 v play-in team and 2 v 3 are Semi-Finals', () => {
        expect(classicRoundForPair(seeding, 1, 4)).toBe('Semi-Final');
        expect(classicRoundForPair(seeding, 5, 1)).toBe('Semi-Final');
        expect(classicRoundForPair(seeding, 3, 2)).toBe('Semi-Final');
    });
    test('any other seeded pairing is the Silver Submarine', () => {
        expect(classicRoundForPair(seeding, 1, 2)).toBe('Silver Submarine');
        expect(classicRoundForPair(seeding, 4, 3)).toBe('Silver Submarine');
    });
    test('null when either team is unseeded', () => {
        expect(classicRoundForPair(seeding, 1, 99)).toBeNull();
        expect(classicRoundForPair([], 1, 2)).toBeNull();
    });
});
