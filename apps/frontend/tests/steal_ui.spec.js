import { test, expect } from '@playwright/test';

test.describe('Steal UI Logic', () => {
  test('should show Single Steal UI (ROLL FOR THROW) when pendingStealAttempt is missing but currentPlay indicates single steal', async ({ page, context }) => {
    // 1. Set up authentication.
    await context.addInitScript(() => {
      localStorage.setItem('token', 'test-token');
      localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'DefenseUser' }));
    });

    // 2. Mock game data
    const mockGameData = {
      game: { id: 1, home_team_user_id: 1, away_team_user_id: 2, game_in_series: 1, series_id: 1, home_team_id: 1, away_team_id: 2, current_turn_user_id: 1 },
      series: { series_type: 'exhibition' },
      gameState: {
        state_data: {
          inning: 1, isTopInning: true, outs: 0, homeScore: 0, awayScore: 0,
          bases: { first: { card_id: 200, displayName: 'Speedy Runner' }, second: null, third: null },
          isBetweenHalfInningsAway: false, isBetweenHalfInningsHome: false,
          homeDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
          awayDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
          homeTeam: { userId: 1, battingOrderPosition: 0, used_player_ids: [] },
          awayTeam: { userId: 2, battingOrderPosition: 0, used_player_ids: [] },
          currentAtBat: {
            batter: { card_id: 201, name: 'Away Batter' }, pitcher: { card_id: 101, name: 'Home Pitcher' },
            basesBeforePlay: { first: { card_id: 200, displayName: 'Speedy Runner' } }, outsBeforePlay: 0, homeScoreBeforePlay: 0, awayScoreBeforePlay: 0,
            batterAction: 'swing', pitcherAction: 'pitch'
          },
          lastCompletedAtBat: null,
          // CRITICAL: currentPlay is STEAL_ATTEMPT, decisions has 1 entry, but pendingStealAttempt is NULL
          currentPlay: {
              type: 'STEAL_ATTEMPT',
              payload: {
                  decisions: { '1': true }, // Runner on 1st stealing
                  batterPlayerId: 201
              }
          },
          pendingStealAttempt: null, // Simulate missing pending state
          lastStealResult: null,
          awayPlayerReadyForNext: true, // Opponent (Offense) is ready
          homePlayerReadyForNext: false, // I (Defense) am not ready
        }
      },
      gameEvents: [],
      teams: { away: { abbreviation: 'AWAY', city: 'Away', logo_url: '' }, home: { abbreviation: 'HOME', city: 'Home', logo_url: '' } },
      batter: { card_id: 201, name: 'Away Batter', image_url: '' },
      pitcher: { card_id: 101, name: 'Home Pitcher', image_url: '' },
      lineups: {
        home: { battingOrder: Array(9).fill(0).map((_, i) => ({ player: { card_id: 100 + i, displayName: `H${i}`, position: '1B' }, position: '1B' })) },
        away: { battingOrder: Array(9).fill(0).map((_, i) => ({ player: { card_id: 200 + i, displayName: `A${i}`, position: '1B' }, position: '1B' })) }
      },
      rosters: { home: [], away: [] },
    };

    await page.route('**/api/games/1', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockGameData),
      });
    });

    await page.route('**/api/point-sets', (route) => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([])
        });
    });

    await page.route('**/images/*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: Buffer.from(''),
      });
    });

    // 3. Navigate to game view
    await page.goto('http://localhost:5173/game/1', { waitUntil: 'domcontentloaded' });

    // 4. Assertions
    // Expect to see "Speedy Runner is stealing 2nd!"
    await expect(page.getByText('Speedy Runner is stealing 2nd!')).toBeVisible({ timeout: 5000 });

    // Expect to see "ROLL FOR THROW" button (Single Steal UI)
    await expect(page.getByRole('button', { name: 'ROLL FOR THROW' })).toBeVisible();

    // Expect NOT to see "Opponent is attempting a double steal!"
    await expect(page.getByText('Opponent is attempting a double steal!')).not.toBeVisible();

    // Expect NOT to see "Throw to 2nd" button (Double Steal UI specific)
    await expect(page.getByRole('button', { name: 'Throw to 2nd' })).not.toBeVisible();
  });
});
