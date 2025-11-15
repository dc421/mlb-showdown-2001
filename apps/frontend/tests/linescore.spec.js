import { test, expect } from '@playwright/test';

test.describe('Linescore component', () => {
  test('should display a 0 for a completed inning when the outcome is hidden', async ({ page, context }) => {
    // 1. Set up authentication in localStorage. This is necessary for the game store
    // to fetch data, as API routes are protected.
    await context.addInitScript(() => {
      localStorage.setItem('token', 'test-token');
      localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'test-user' }));
    });

    // 2. Mock the game data API response to simulate the exact scenario.
    const mockGameData = {
      game: { id: 1, home_team_user_id: 2, away_team_user_id: 1, game_in_series: 1, series_id: 1, home_team_id: 1, away_team_id: 2 },
      series: { series_type: 'exhibition' },
      gameState: {
        state_data: {
          inning: 1, isTopInning: true, outs: 0, homeScore: 0, awayScore: 0, bases: {},
          isBetweenHalfInningsAway: true, isBetweenHalfInningsHome: false,
          homeDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
          awayDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
          homeTeam: { userId: 2, battingOrderPosition: 0, used_player_ids: [] },
          awayTeam: { userId: 1, battingOrderPosition: 3, used_player_ids: [] },
          currentAtBat: {
            batter: { card_id: 101, name: 'Home Batter' }, pitcher: { card_id: 201, name: 'Away Pitcher' },
            basesBeforePlay: {}, outsBeforePlay: 0, homeScoreBeforePlay: 0, awayScoreBeforePlay: 0,
          },
          lastCompletedAtBat: {
            batter: { card_id: 102, name: 'Away Batter' }, pitcher: { card_id: 202, name: 'Home Pitcher' },
            basesBeforePlay: {}, outsBeforePlay: 2, homeScoreBeforePlay: 0, awayScoreBeforePlay: 0,
          }
        }
      },
      gameEvents: [
        { event_type: "inning-change-message", log_message: "<strong>Top 1st</strong>" },
        { event_type: "at-bat-result", log_message: "A fly out ends the inning." },
        { event_type: "inning-change-message", log_message: "<strong>Bottom 1st</strong>" },
      ],
      teams: { away: { abbreviation: 'AWAY', city: 'Away', logo_url: '' }, home: { abbreviation: 'HOME', city: 'Home', logo_url: '' } },
      batter: { card_id: 101, name: 'Home Batter', image_url: '' },
      pitcher: { card_id: 201, name: 'Away Pitcher', image_url: '' },
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

    // ADDED: Mock image requests to prevent them from hitting the backend proxy and causing timeouts.
    await page.route('**/images/*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: Buffer.from(''), // Empty buffer for the image body
      });
    });

    // 3. Navigate to the game view.
    await page.goto('http://localhost:5173/game/1');

    // Wait for a key element to be visible, ensuring the Vue app is mounted.
    await page.waitForSelector('.linescore-table');

    // 4. Manually set the `isOutcomeHidden` flag to true in the Pinia store.
    // This simulates the state right after a play, before the user clicks to reveal the outcome.
    await page.evaluate(() => {
      // Access the store directly through the exposed pinia instance.
      // This is more robust than relying on the Vue app instance's internal structure.
      const gameStore = window.pinia.state.value.game;
      if (gameStore) {
        gameStore.isOutcomeHidden = true;
      }
    });

    // 5. Assert that the linescore is rendered correctly.
    // The linescore table's first `tbody tr` is for the away team.
    const awayTeamRow = page.locator('.linescore-table tbody tr:first-child');
    // The second `td` in that row is the score for the first inning.
    const firstInningScoreCell = awayTeamRow.locator('td').nth(1);

    // Before the fix, this cell would be empty. After the fix, it should contain '0'.
    await expect(firstInningScoreCell).toHaveText('0');
  });

  test('should keep inning highlighted when outcome is hidden and opponent is ready', async ({ page, context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('token', 'test-token');
      localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'test-user' }));
    });

    const mockGameData = {
      game: { id: 1, home_team_user_id: 2, away_team_user_id: 1, game_in_series: 1, series_id: 1, home_team_id: 1, away_team_id: 2 },
      series: { series_type: 'exhibition' },
      gameState: {
        state_data: {
          inning: 1, isTopInning: true, outs: 3, homeScore: 0, awayScore: 0, bases: {},
          isBetweenHalfInningsAway: true, isBetweenHalfInningsHome: false,
          homeDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
          awayDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
          homeTeam: { userId: 2, battingOrderPosition: 0, used_player_ids: [] },
          awayTeam: { userId: 1, battingOrderPosition: 3, used_player_ids: [] },
          currentAtBat: {
            batter: { card_id: 101, name: 'Home Batter' }, pitcher: { card_id: 201, name: 'Away Pitcher' },
            basesBeforePlay: {}, outsBeforePlay: 0, homeScoreBeforePlay: 0, awayScoreBeforePlay: 0,
          },
          lastCompletedAtBat: {
            batter: { card_id: 102, name: 'Away Batter' }, pitcher: { card_id: 202, name: 'Home Pitcher' },
            basesBeforePlay: {}, outsBeforePlay: 2, homeScoreBeforePlay: 0, awayScoreBeforePlay: 0,
          }
        }
      },
      gameEvents: [
        { event_type: "inning-change-message", log_message: "<strong>Top 1st</strong>" },
      ],
      teams: { away: { abbreviation: 'AWAY', city: 'Away', logo_url: '' }, home: { abbreviation: 'HOME', city: 'Home', logo_url: '' } },
      batter: { card_id: 101, name: 'Home Batter', image_url: '' },
      pitcher: { card_id: 201, name: 'Away Pitcher', image_url: '' },
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

    // ADDED: Mock image requests to prevent them from hitting the backend proxy and causing timeouts.
    await page.route('**/images/*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: Buffer.from(''), // Empty buffer for the image body
      });
    });

    await page.goto('http://localhost:5173/game/1');
    await page.waitForSelector('.linescore-table');

    await page.evaluate(() => {
      const gameStore = window.pinia.state.value.game;
      if (gameStore) {
        gameStore.isOutcomeHidden = true;
        gameStore.isSwingResultVisible = true;
        gameStore.opponentReadyForNext = true;
      }
    });

    const firstInningHeader = page.locator('.linescore-table thead th').nth(1);
    await expect(firstInningHeader).toHaveClass(/current-inning/);
  });
});