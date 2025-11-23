
import { test, expect } from '@playwright/test';

test.describe('Substitution Icon Visibility', () => {
  test('verifies substitution icons visibility based on SP eligibility and bench assignment', async ({ page }) => {

    page.on('console', msg => console.log(`PAGE LOG: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`PAGE ERROR: "${exception}"`));

    // Define a mock game state (inner state_data)
    const mockGameState = {
      id: 'game1',
      status: 'in_progress',
      inning: 1,
      isTopInning: true, // Away team batting
      homeTeam: { userId: 1, abbreviation: 'HOME', team_id: 'team1', battingOrderPosition: 0, used_player_ids: [] },
      awayTeam: { userId: 2, abbreviation: 'AWAY', team_id: 'team2', battingOrderPosition: 0, used_player_ids: [] },
      current_turn_user_id: 1,

      // Pitcher stats for the SP
      pitcherStats: {
        'sp_card_id': {
           runs: 0,
           innings_pitched: ['1st'], // Only 1 IP
           fatigue_modifier: 0,
           outs_recorded: 3
        }
      },

      bases: { first: null, second: null, third: null },
      outs: 0,
      currentAtBat: { batterAction: null, pitcherAction: null },
      lastCompletedAtBat: null
    };

    // Mock lineups
    const homeLineup = {
       battingOrder: [
         { player: { card_id: 'p1', displayName: 'Player 1', assignment: 'BENCH' }, position: '1B' },
         { player: { card_id: 'p2', displayName: 'Player 2', assignment: 'BENCH' }, position: '2B' },
         { player: { card_id: 'p3', displayName: 'Player 3' }, position: '3B' },
         { player: { card_id: 'p4', displayName: 'Player 4' }, position: 'SS' },
         { player: { card_id: 'p5', displayName: 'Player 5' }, position: 'LF' },
         { player: { card_id: 'p6', displayName: 'Player 6' }, position: 'CF' },
         { player: { card_id: 'p7', displayName: 'Player 7' }, position: 'RF' },
         { player: { card_id: 'p8', displayName: 'Player 8' }, position: 'C' },
         { player: { card_id: 'p9', displayName: 'Player 9' }, position: 'DH' },
       ],
       startingPitcher: { card_id: 'sp_card_id', displayName: 'Starting Pitcher', control: 5, ip: 6 }
    };

    const awayLineup = {
        battingOrder: [],
        startingPitcher: { card_id: 'away_sp', displayName: 'Away SP', control: 5 }
    };

    const homeRoster = [
        // SP
        { card_id: 'sp_card_id', displayName: 'Starting Pitcher', control: 5, ip: 6 },
        // Bullpen
        { card_id: 'rp1', displayName: 'Reliever 1', control: 5, ip: 1, displayPosition: 'RP' },
        // Bench
        { card_id: 'bench1', displayName: 'Bench Warmer', control: null, assignment: 'BENCH' },
        { card_id: 'bench2', displayName: 'Utility Player', control: null, assignment: 'LFRF' }, // Eligible to sub early
        ...homeLineup.battingOrder.map(spot => spot.player)
    ];

    // Construct the full API response structure expected by fetchGame
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
        batter: null, // Can be null if not started or between
        pitcher: { card_id: 'away_sp', displayName: 'Away SP' }, // Current pitcher
        lineups: { home: homeLineup, away: awayLineup },
        rosters: { home: homeRoster, away: [] },
        teams: {
            home: { primary_color: '#000', secondary_color: '#fff', abbreviation: 'HOME', city: 'City' },
            away: { primary_color: '#000', secondary_color: '#fff', abbreviation: 'AWAY', city: 'City' }
        }
    };

    // Setup route mocks
    // Note: Playwright routes are matched in order of definition (or reverse? usually first match wins).
    // Using exact match for game1
    await page.route('**/api/games/game1', async route => {
      await route.fulfill({ json: fullMockResponse });
    });

    await page.route('**/api/games/game1/lineup', async route => {
        await route.fulfill({ json: { home: homeLineup, away: awayLineup } });
    });

    await page.route('**/api/rosters/team1/details*', async route => {
        await route.fulfill({ json: homeRoster });
    });

    await page.route('**/api/teams/team1', async route => {
        await route.fulfill({ json: { primary_color: '#000', secondary_color: '#fff', abbreviation: 'HOME', city: 'City' } });
    });

    await page.route('**/api/teams/team2', async route => {
        await route.fulfill({ json: { primary_color: '#000', secondary_color: '#fff', abbreviation: 'AWAY', city: 'City' } });
    });

    // Authenticate as Home Team User
    await page.addInitScript(() => {
      localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'home_user' }));
      localStorage.setItem('token', 'fake-token');
    });

    await page.goto('http://localhost:5173/game/game1');

    // Wait for game to load
    await page.waitForSelector('.game-view-container', { timeout: 10000 });

    // 1. Toggle Sub Mode
    const toggleSubBtn = page.locator('.lineup-header .sub-icon').first();
    await toggleSubBtn.click();

    // Wait for sub icons to appear
    await expect(page.locator('.sub-icon.visible').first()).toBeVisible();

    // CHECK 1: SP Sub Icon should NOT be visible because SP is locked (only 1 IP, need 4 IP or fatigue)
    const spSubIcon = page.locator('.pitcher-info .sub-icon');
    await expect(spSubIcon).not.toHaveClass(/visible/);

    // CHECK 2: Bullpen icons should be HIDDEN if SP is locked
    const p1SubIcon = page.locator('.lineup-item').filter({ hasText: 'Player 1' }).locator('.sub-icon');
    await p1SubIcon.click();

    const rp1SubIcon = page.locator('.lineup-item').filter({ hasText: 'Reliever 1' }).locator('.sub-icon');
    await expect(rp1SubIcon).not.toHaveClass(/visible/);

    // CHECK 3: Bench icons
    const bench1SubIcon = page.locator('.lineup-item').filter({ hasText: 'Bench Warmer' }).locator('.sub-icon');
    const bench2SubIcon = page.locator('.lineup-item').filter({ hasText: 'Utility Player' }).locator('.sub-icon');

    // Bench Warmer (assignment: BENCH) should be HIDDEN (< 7th inning)
    await expect(bench1SubIcon).not.toHaveClass(/visible/);

    // Utility Player (assignment: LFRF) should be VISIBLE
    await expect(bench2SubIcon).toHaveClass(/visible/);

  });
});
