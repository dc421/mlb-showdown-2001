
import { test, expect } from '@playwright/test';

test.describe('Scorecard Hidden Outcome Fix', () => {
  test('should NOT show inning as completed when outcome is hidden (rollback scenario)', async ({ page, context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('token', 'test-token');
      localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'test-user' }));
    });

    // Scenario:
    // Top 1st Inning just ended with a 3rd out.
    // Raw Game State has advanced to Bottom 1st, 0 outs.
    // User has NOT seen the outcome yet (isOutcomeHidden = true).

    // Setup: User 1 is Away Team. User 2 is Home Team.
    // Game is between innings (Top 1 -> Bottom 1).
    // Away User (Me) is NOT ready. Home User (Opponent) IS ready.

    const mockGameData = {
      game: { id: 1, home_team_user_id: 2, away_team_user_id: 1, game_in_series: 1, series_id: 1, home_team_id: 1, away_team_id: 2 },
      series: { series_type: 'exhibition' },
      gameState: {
        state_data: {
          inning: 1,
          isTopInning: false, // Raw state: Bottom 1st
          outs: 0, // Raw state: 0 outs
          homeScore: 0, awayScore: 0, bases: {},
          isBetweenHalfInningsAway: true, // Raw state: Top inning just ended
          isBetweenHalfInningsHome: false,

          homeTeam: { userId: 2, battingOrderPosition: 0, used_player_ids: [] },
          awayTeam: { userId: 1, battingOrderPosition: 3, used_player_ids: [] },

          // I am Away (User 1). Opponent is Home (User 2).
          // Opponent is READY (saw result). I am NOT ready.
          awayPlayerReadyForNext: false,
          homePlayerReadyForNext: true,

          lastCompletedAtBat: {
             batter: { card_id: 102, name: 'Last Batter' },
             pitcher: { card_id: 202, name: 'Pitcher' },
             outsBeforePlay: 2,
             basesBeforePlay: {},
             homeScoreBeforePlay: 0,
             awayScoreBeforePlay: 0,
          },

          currentAtBat: {
             outsBeforePlay: 0 // New inning start
          }
        }
      },
      gameEvents: [
        { event_type: "inning-change-message", log_message: "<strong>Top 1st</strong>" },
        { event_type: "at-bat-result", log_message: "Out 1" },
        { event_type: "at-bat-result", log_message: "Out 2" },
        { event_type: "at-bat-result", log_message: "Out 3. Inning over." },
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
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGameData) });
    });

    await page.route('**/api/point-sets', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/images/*', (route) => {
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') });
    });

    await page.goto('http://localhost:5173/game/1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.linescore-table');

    // Force hidden outcome
    await page.evaluate(() => {
      const gameStore = window.pinia.state.value.game;
      if (gameStore) {
        gameStore.isOutcomeHidden = true;
        gameStore.isStealResultVisible = false;
      }
    });

    // Linescore checks
    const awayScoreCell = page.locator('.linescore-table tbody tr:nth-child(1) td').nth(1); // 1st Inning
    const homeScoreCell = page.locator('.linescore-table tbody tr:nth-child(2) td').nth(1); // 1st Inning

    // With the fix:
    // Rolled back state: Top 1, 2 outs.
    // `displayGameState.isTopInning` is TRUE.
    // Away row gets `current-inning`.

    await expect(awayScoreCell).toHaveClass(/current-inning/);
    await expect(homeScoreCell).not.toHaveClass(/current-inning/);
  });
});
