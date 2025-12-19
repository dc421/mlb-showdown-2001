import { test, expect } from '@playwright/test';

test('verify steal 3rd caught stealing game over synchronization', async ({ page }) => {
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));

  // Mock API responses
  await page.route('**/api/games/game123', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        game: {
          game_id: 'game123',
          home_team_user_id: '1',
          away_team_user_id: '2',
          status: 'completed', // Game is over on server
          home_score: 1,
          away_score: 0,
          current_turn_user_id: '1',
          game_in_series: 1,
          series_id: 'series1',
        },
        gameState: {
          state_data: {
            gameId: 'game123',
            inning: 9,
            isTopInning: true,
            outs: 3, // 3 outs (Game Over)
            homeScore: 1,
            awayScore: 0,
            bases: { second: { card_id: 'runner1', name: 'Runner', speed: 'A' } },
            currentAtBat: {
              pitcher: { card_id: 'pitcher1', control: 5 },
              batter: { card_id: 'batter1', name: 'Batter' },
              pitcherAction: 'pitch',
              batterAction: 'take',
            },
            homeTeam: { userId: '1', battingOrderPosition: 0 },
            awayTeam: { userId: '2', battingOrderPosition: 0 },
            pendingStealAttempt: {
              runnerPlayerId: 'runner1',
              throwToBase: 3,
              runnerName: 'Runner',
              outcome: 'OUT',
              target: 15,
              penalty: 5,
              defense: 3
            },
            inningEndedOnCaughtStealing: true,
            status: 'completed'
          }
        },
        teams: {
            home: { team_id: 1, abbreviation: 'HOM', primary_color: '#000000', secondary_color: '#FFFFFF' },
            away: { team_id: 2, abbreviation: 'AWY', primary_color: '#FFFFFF', secondary_color: '#000000' }
        },
        gameEvents: [
            { event_id: 1, log_message: 'Runner steals... OUT!' }
        ],
        lineups: {
            home: { battingOrder: [] },
            away: { battingOrder: [] }
        },
        rosters: { home: [], away: [] }
      })
    });
  });

  // Mock socket.io request to prevent connection refused error
  await page.route('**/socket.io/**', async (route) => {
    await route.fulfill({
      status: 200,
      body: 'ok'
    });
  });

  await page.goto('http://localhost:5173/game/game123');

  await page.evaluate(() => {
    localStorage.setItem('user', JSON.stringify({ userId: '1', username: 'HomeUser' }));
    localStorage.setItem('token', 'fake-token');
  });

  await page.reload();

  await page.waitForSelector('.game-view-container');

  // Verify "ROLL FOR THROW" button is visible
  const rollButton = page.locator('button', { hasText: 'ROLL FOR THROW' });
  await expect(rollButton).toBeVisible();

  // Verify Outs display. It SHOULD be 2 outs (waiting for the throw), NOT 3 outs.
  const filledDots = page.locator('.out-dot.filled');
  await expect(filledDots).toHaveCount(2); // Expect 2 outs

  // Check for "FINAL" score message - Should NOT be visible
  const finalMessage = page.locator('.final-score-message');
  await expect(finalMessage).not.toBeVisible();
});
