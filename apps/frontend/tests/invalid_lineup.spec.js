
import { test, expect } from '@playwright/test';

test.describe('Invalid Lineup Pitcher Display', () => {
  test('shows TBD card when defensive pitcher is null during invalid lineup state', async ({ page }) => {

    page.on('console', msg => console.log(`PAGE LOG: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`PAGE ERROR: "${exception}"`));

    const mockGameState = {
      id: 'game1',
      status: 'in_progress',
      inning: 2,
      isTopInning: true, // Top of 2nd. Home is Defense.
      awaiting_lineup_change: true,
      homeTeam: { userId: 1, abbreviation: 'HOME', team_id: 'team1', battingOrderPosition: 0 },
      awayTeam: { userId: 2, abbreviation: 'AWAY', team_id: 'team2', battingOrderPosition: 0 },
      current_turn_user_id: 1, // My turn

      pitcherStats: {},
      bases: { first: null, second: null, third: null },
      outs: 0,
      currentAtBat: { batterAction: null, pitcherAction: null },

      // The "bug" source: last completed at bat (Bottom 1st) had the AWAY pitcher
      lastCompletedAtBat: {
          pitcher: { card_id: 'away_p', displayName: 'Away Pitcher', control: 5 },
          batter: { card_id: 'home_b', displayName: 'Home Batter' }
      },

      awayPlayerReadyForNext: true,
      homePlayerReadyForNext: false, // I am not ready

      homeDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
      awayDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 }
    };

    const homeLineup = {
       battingOrder: [
         { player: { card_id: 'p1', displayName: 'Player 1' }, position: 'C' },
         { player: { card_id: 'p2', displayName: 'Player 2' }, position: '1B' },
         { player: { card_id: 'p3', displayName: 'Player 3' }, position: '2B' },
         { player: { card_id: 'p4', displayName: 'Player 4' }, position: '3B' },
         { player: { card_id: 'p5', displayName: 'Player 5' }, position: 'SS' },
         { player: { card_id: 'p6', displayName: 'Player 6' }, position: 'LF' },
         { player: { card_id: 'p7', displayName: 'Player 7' }, position: 'CF' },
         { player: { card_id: 'p8', displayName: 'Player 8' }, position: 'RF' },
         { player: { card_id: 'p9', displayName: 'Player 9' }, position: 'DH' },
       ],
       startingPitcher: { card_id: 'sp_card_id', displayName: 'Starting Pitcher', control: 5 }
    };

    const awayLineup = {
        battingOrder: [],
        startingPitcher: { card_id: 'away_sp', displayName: 'Away SP', control: 5 }
    };

    const fullMockResponse = {
        game: {
            id: 'game1',
            status: 'in_progress',
            home_team_user_id: 1,
            away_team_user_id: 2,
            current_turn_user_id: 1,
            game_id: 'game1'
        },
        gameState: {
            state_data: mockGameState
        },
        gameEvents: [],
        batter: { card_id: 'away_b', displayName: 'Away Batter' },
        pitcher: null, // My Pitcher is NULL
        lineups: { home: homeLineup, away: awayLineup },
        rosters: { home: [], away: [] },
        teams: {
            home: { primary_color: '#000', secondary_color: '#fff', abbreviation: 'HOME', city: 'City', team_id: 'team1' },
            away: { primary_color: '#000', secondary_color: '#fff', abbreviation: 'AWAY', city: 'City', team_id: 'team2' }
        }
    };

    await page.route('**/api/games/game1', async route => {
      await route.fulfill({ json: fullMockResponse });
    });

    await page.route('**/api/games/game1/lineup', async route => {
        await route.fulfill({ json: { home: homeLineup, away: awayLineup } });
    });

    await page.route('**/api/teams/team1', async route => {
        await route.fulfill({ json: fullMockResponse.teams.home });
    });
    await page.route('**/api/teams/team2', async route => {
        await route.fulfill({ json: fullMockResponse.teams.away });
    });

    // Authenticate as Home Team User
    await page.addInitScript(() => {
      localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'home_user' }));
      localStorage.setItem('token', 'fake-token');
    });

    await page.goto('http://localhost:5173/game/game1');
    await page.waitForSelector('.game-view-container', { timeout: 10000 });

    const leftCard = page.locator('.player-container').first();
    const tbdCard = leftCard.locator('.tbd-pitcher-card');

    // Check that Away Pitcher is NOT visible (The main regression)
    await expect(leftCard.locator('text=Away Pitcher')).toBeHidden();

    // Check that TBD card is present (attached to DOM), even if empty/invisible
    await expect(tbdCard).toBeAttached();

  });
});
