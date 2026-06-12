import { test, expect } from '@playwright/test';

// Covers the window where the swing roll has been revealed but the play has
// not been completed because a baserunning/fielding decision is pending
// (currentPlay = ADVANCE / TAG_UP / INFIELD_IN_*). The server has already
// applied automatic runs/outs to the game state, but no game event has been
// logged yet, so the linescore (which tallies log messages) must account for
// the pending play's initialEvent.

const inningMarker = (label) => ({
  event_type: 'system',
  log_message: `<div class="inning-change-message"><b>${label}</b></div>`,
});

function buildMockGameData(overrides) {
  const batter = { card_id: 205, name: 'A4', displayName: 'A4', display_name: 'A4', speed: 15, image_url: '' };
  const pitcher = { card_id: 110, name: 'H-P', displayName: 'H-P', display_name: 'H-P', control: 4, chart_data: {}, image_url: '' };

  const base = {
    game: { game_id: 1, id: 1, status: 'in_progress', home_team_user_id: 2, away_team_user_id: 1, game_in_series: 1, series_id: 1, home_team_id: 1, away_team_id: 2 },
    series: { series_type: 'exhibition' },
    gameState: {
      state_data: {
        inning: 2, isTopInning: true, outs: 1, homeScore: 0, awayScore: 1,
        bases: { first: null, second: null, third: null },
        isBetweenHalfInningsAway: false, isBetweenHalfInningsHome: false,
        homePlayerReadyForNext: false, awayPlayerReadyForNext: false,
        homeDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
        awayDefensiveRatings: { catcherArm: 0, infieldDefense: 0, outfieldDefense: 0 },
        homeTeam: { userId: 2, battingOrderPosition: 0, used_player_ids: [] },
        awayTeam: { userId: 1, battingOrderPosition: 4, used_player_ids: [] },
        pitcherStats: {},
        currentAtBat: {
          batter, pitcher,
          batterAction: 'swing', pitcherAction: 'pitch',
          pitchRollResult: { roll: 9, advantage: 'batter' },
          swingRollResult: { roll: 14, outcome: '1B', batter },
          basesBeforePlay: { first: null, second: null, third: null },
          outsBeforePlay: 1, homeScoreBeforePlay: 0, awayScoreBeforePlay: 1,
        },
        lastCompletedAtBat: {
          batter: { card_id: 204, name: 'A3', displayName: 'A3' }, pitcher,
          basesBeforePlay: { first: null, second: null, third: null },
          outsBeforePlay: 0, homeScoreBeforePlay: 0, awayScoreBeforePlay: 1,
        },
        currentPlay: null,
      },
    },
    gameEvents: [
      inningMarker('Top 1st'),
      { event_type: 'game_event', log_message: 'A0 hits a HOME RUN!' },
      inningMarker('Bottom 1st'),
      inningMarker('Top 2nd'),
    ],
    teams: {
      away: { team_id: 20, abbreviation: 'AWY', city: 'Away', logo_url: '' },
      home: { team_id: 10, abbreviation: 'HOM', city: 'Home', logo_url: '' },
    },
    batter, pitcher,
    lineups: {
      home: { battingOrder: Array(9).fill(0).map((_, i) => ({ player: { card_id: 100 + i, displayName: `H${i}`, name: `H${i}`, position: '1B' }, position: '1B' })), startingPitcher: pitcher },
      away: { battingOrder: Array(9).fill(0).map((_, i) => ({ player: { card_id: 200 + i, displayName: `A${i}`, name: `A${i}`, position: '1B' }, position: '1B' })), startingPitcher: { card_id: 210, name: 'A-P', displayName: 'A-P', control: 3, chart_data: {} } },
    },
    rosters: { home: [], away: [] },
  };

  const stateOverrides = overrides.state || {};
  Object.assign(base.gameState.state_data, stateOverrides);
  if (overrides.currentAtBat) Object.assign(base.gameState.state_data.currentAtBat, overrides.currentAtBat);
  return base;
}

async function setupPage(page, context, mockGameData) {
  await context.addInitScript(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'test-user' }));
  });

  await page.route('**/api/**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/games/1', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGameData) });
  });
  await page.route('**/images/*', (route) => {
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') });
  });

  await page.goto('http://localhost:5173/game/1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.linescore-table');
  // Simulate the post-reveal state (in real play the staged reveal sets this
  // 900ms after the websocket update that resolves both actions).
  await page.evaluate(() => {
    window.pinia.state.value.game.isSwingResultVisible = true;
  });
}

test.describe('Linescore & outs during pending baserunning/fielding decisions', () => {
  test('ADVANCE pending: run that already scored shows in linescore once swing is visible', async ({ page, context }) => {
    const runnerOnFirst = { card_id: 250, name: 'Speedy', displayName: 'Speedy', speed: 15 };
    const runnerOnThird = { card_id: 251, name: 'Trea', displayName: 'Trea', speed: 20 };
    const mock = buildMockGameData({
      state: {
        awayScore: 2, // runner from third already scored on the server
        bases: { first: { card_id: 205, name: 'A4', displayName: 'A4' }, second: runnerOnFirst, third: null },
        currentPlay: {
          type: 'ADVANCE',
          payload: {
            decisions: [{ runner: runnerOnFirst, from: 1, type: 'manual' }],
            hitType: '1B',
            initialEvent: 'A4 hits a SINGLE! Trea scores!',
            scorers: ['Trea'],
            batterPlayerId: 205,
          },
        },
      },
      currentAtBat: {
        basesBeforePlay: { first: runnerOnFirst, second: null, third: runnerOnThird },
      },
    });

    await setupPage(page, context, mock);

    const awayRow = page.locator('.linescore-table tbody tr:first-child');
    // Inning cells: td(0)=team, td(1)=1st inning, td(2)=2nd inning, last=R
    await expect(awayRow.locator('td').nth(1)).toHaveText('1');
    await expect(awayRow.locator('td').nth(2)).toHaveText('1');
    await expect(awayRow.locator('td').last()).toHaveText('2');
  });

  test('ADVANCE pending on a double: both runs that already scored show in linescore', async ({ page, context }) => {
    const runnerOnFirst = { card_id: 250, name: 'Speedy', displayName: 'Speedy', speed: 15 };
    const mock = buildMockGameData({
      state: {
        awayScore: 3, // runners from second and third already scored on the server
        bases: { first: null, second: { card_id: 205, name: 'A4', displayName: 'A4' }, third: runnerOnFirst },
        currentPlay: {
          type: 'ADVANCE',
          payload: {
            decisions: [{ runner: runnerOnFirst, from: 1, type: 'manual' }],
            hitType: '2B',
            initialEvent: 'A4 hits a DOUBLE! Trea scores! Jeter scores!',
            scorers: ['Trea', 'Jeter'],
            batterPlayerId: 205,
          },
        },
      },
      currentAtBat: {
        swingRollResult: { roll: 17, outcome: '2B', batter: { card_id: 205, name: 'A4', displayName: 'A4' } },
        basesBeforePlay: { first: runnerOnFirst, second: { card_id: 253, name: 'Jeter', displayName: 'Jeter' }, third: { card_id: 251, name: 'Trea', displayName: 'Trea' } },
      },
    });

    await setupPage(page, context, mock);

    const awayRow = page.locator('.linescore-table tbody tr:first-child');
    await expect(awayRow.locator('td').nth(2)).toHaveText('2');
    await expect(awayRow.locator('td').last()).toHaveText('3');
  });

  test('ADVANCE pending: run stays hidden while the outcome is hidden', async ({ page, context }) => {
    const runnerOnFirst = { card_id: 250, name: 'Speedy', displayName: 'Speedy', speed: 15 };
    const runnerOnThird = { card_id: 251, name: 'Trea', displayName: 'Trea', speed: 20 };
    const mock = buildMockGameData({
      state: {
        awayScore: 2,
        bases: { first: { card_id: 205, name: 'A4', displayName: 'A4' }, second: runnerOnFirst, third: null },
        currentPlay: {
          type: 'ADVANCE',
          payload: {
            decisions: [{ runner: runnerOnFirst, from: 1, type: 'manual' }],
            hitType: '1B',
            initialEvent: 'A4 hits a SINGLE! Trea scores!',
            scorers: ['Trea'],
            batterPlayerId: 205,
          },
        },
      },
      currentAtBat: {
        basesBeforePlay: { first: runnerOnFirst, second: null, third: runnerOnThird },
      },
    });

    await setupPage(page, context, mock);

    // Simulate the pre-reveal window: swing result not visible -> outcome hidden.
    await page.evaluate(() => {
      window.pinia.state.value.game.isSwingResultVisible = false;
    });

    const awayRow = page.locator('.linescore-table tbody tr:first-child');
    await expect(awayRow.locator('td').nth(2)).toHaveText('0');
    await expect(awayRow.locator('td').last()).toHaveText('1');
  });

  test('TAG_UP pending: fly-ball out shows in outs display once swing is visible', async ({ page, context }) => {
    const runnerOnSecond = { card_id: 252, name: 'Jeter', displayName: 'Jeter', speed: 15 };
    const mock = buildMockGameData({
      state: {
        outs: 2, // fly out already recorded on the server
        bases: { first: null, second: runnerOnSecond, third: null },
        currentPlay: {
          type: 'TAG_UP',
          payload: {
            decisions: [{ runner: runnerOnSecond, from: 2, type: 'manual' }],
            autoHoldDecisions: [],
            initialEvent: 'A4 flies out.',
            batterPlayerId: 205,
          },
        },
      },
      currentAtBat: {
        swingRollResult: { roll: 5, outcome: 'FB', batter: { card_id: 205, name: 'A4', displayName: 'A4' } },
        basesBeforePlay: { first: null, second: runnerOnSecond, third: null },
      },
    });

    await setupPage(page, context, mock);

    await expect(page.locator('.global-nav .outs-display .out-dot.filled')).toHaveCount(2);

    // Score must not change on a fly out with no runs in.
    const awayRow = page.locator('.linescore-table tbody tr:first-child');
    await expect(awayRow.locator('td').nth(2)).toHaveText('0');
    await expect(awayRow.locator('td').last()).toHaveText('1');
  });

  test('TAG_UP pending: outs roll back while the outcome is hidden', async ({ page, context }) => {
    const runnerOnSecond = { card_id: 252, name: 'Jeter', displayName: 'Jeter', speed: 15 };
    const mock = buildMockGameData({
      state: {
        outs: 2,
        bases: { first: null, second: runnerOnSecond, third: null },
        currentPlay: {
          type: 'TAG_UP',
          payload: {
            decisions: [{ runner: runnerOnSecond, from: 2, type: 'manual' }],
            autoHoldDecisions: [],
            initialEvent: 'A4 flies out.',
            batterPlayerId: 205,
          },
        },
      },
      currentAtBat: {
        swingRollResult: { roll: 5, outcome: 'FB', batter: { card_id: 205, name: 'A4', displayName: 'A4' } },
        basesBeforePlay: { first: null, second: runnerOnSecond, third: null },
      },
    });

    await setupPage(page, context, mock);

    await page.evaluate(() => {
      window.pinia.state.value.game.isSwingResultVisible = false;
    });

    await expect(page.locator('.global-nav .outs-display .out-dot.filled')).toHaveCount(1);
  });
});
