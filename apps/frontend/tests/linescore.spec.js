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
      game: { id: 1, home_team_user_id: 2, away_team_user_id: 1 }, // User 1 is the away team.
      series: { series_type: 'exhibition' }, // Required to prevent component crashes.
      gameState: {
        state_data: {
          inning: 1,
          isTopInning: true,
          outs: 0, // Server reports 0 outs for the *next* half-inning.
          homeScore: 0,
          awayScore: 0,
          bases: {},
          isBetweenHalfInningsAway: true, // The critical flag: away team just finished batting.
          isBetweenHalfInningsHome: false,
          // These objects are required to prevent component crashes.
          homeTeam: { userId: 2, battingOrderPosition: 1, used_player_ids: [] },
          awayTeam: { userId: 1, battingOrderPosition: 1, used_player_ids: [] },
          currentAtBat: { homeScoreBeforePlay: 0, awayScoreBeforePlay: 0 },
        }
      },
      // The event log contains the third-out play and the inning change message,
      // both of which will be hidden by `gameEventsToDisplay`.
      gameEvents: [
        { event_type: "inning-change-message", log_message: "<strong>Top 1st</strong>" },
        { event_type: "at-bat-result", log_message: "A fly out ends the inning." },
        { event_type: "inning-change-message", log_message: "<strong>Bottom 1st</strong>" },
      ],
      // Abbreviated team/player data to prevent crashes.
      teams: { away: { abbreviation: 'AWAY' }, home: { abbreviation: 'HOME' } },
      batter: { image_url: '' },
      pitcher: { image_url: '' },
      lineups: { home: {}, away: {} },
      rosters: { home: [], away: [] },
    };

    await page.route('**/api/games/1', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockGameData),
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
      game: { id: 1, home_team_user_id: 2, away_team_user_id: 1 },
      series: { series_type: 'exhibition' },
      gameState: {
        state_data: {
          inning: 1,
          isTopInning: true,
          outs: 3,
          homeScore: 0,
          awayScore: 0,
          bases: {},
          isBetweenHalfInningsAway: true,
          isBetweenHalfInningsHome: false,
          homeTeam: { userId: 2, battingOrderPosition: 1, used_player_ids: [] },
          awayTeam: { userId: 1, battingOrderPosition: 1, used_player_ids: [] },
          currentAtBat: { homeScoreBeforePlay: 0, awayScoreBeforePlay: 0 },
        }
      },
      // Provide a minimal event log to prevent the linescore component from crashing.
      gameEvents: [
        { event_type: "inning-change-message", log_message: "<strong>Top 1st</strong>" },
      ],
      teams: { away: { abbreviation: 'AWAY' }, home: { abbreviation: 'HOME' } },
      batter: { image_url: '' },
      pitcher: { image_url: '' },
      lineups: { home: {}, away: {} },
      rosters: { home: [], away: [] },
    };

    await page.route('**/api/games/1', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockGameData),
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