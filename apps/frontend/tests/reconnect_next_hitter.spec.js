import { test, expect } from '@playwright/test';

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
}

for (const opponentHasAdvanced of [false, true]) {
  test(`refresh reveals a completed walk (opponent advanced: ${opponentHasAdvanced})`, async ({ page, context }) => {
    const data = buildMockGameData({});
    const state = data.gameState.state_data;
    const completed = structuredClone(state.currentAtBat);
    completed.batter.name = 'Mike Lieberthal';
    completed.batter.displayName = 'Mike Lieberthal';
    completed.swingRollResult.outcome = 'BB';
    state.bases.first = completed.batter;
    if (opponentHasAdvanced) {
      state.lastCompletedAtBat = completed;
      state.homePlayerReadyForNext = true;
      state.currentAtBat = {
        ...state.currentAtBat,
        batter: { ...state.currentAtBat.batter, card_id: 206, name: 'Steve Finley', displayName: 'Steve Finley' },
        batterAction: null,
        swingRollResult: null,
        basesBeforePlay: structuredClone(state.bases),
      };
    } else {
      state.currentAtBat = completed;
    }
    await setupPage(page, context, data);
    await expect(page.getByRole('button', { name: 'Next Hitter', exact: true })).toBeVisible({ timeout: 4000 });
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('showdown-game-')) localStorage.removeItem(key);
      }
    });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Next Hitter', exact: true })).toBeVisible({ timeout: 4000 });
  });
}

test('reconnect fetches a missed update without rolling back a newer socket snapshot', async ({ page, context }) => {
  const data = buildMockGameData({ currentAtBat: { batterAction: null, swingRollResult: null } });
  data.gameState.game_state_id = 100;
  await setupPage(page, context, data);
  expect(await page.getByRole('button', { name: 'Next Hitter', exact: true }).count()).toBe(0);

  // The opponent resolved the walk while this client was disconnected.
  const resolved = buildMockGameData({});
  resolved.gameState.game_state_id = 101;
  await page.route('**/api/games/1', route => route.fulfill({ json: resolved }));
  await page.evaluate(() => {
    for (const onConnect of window.socket.listeners('connect')) onConnect();
  });
  await expect(page.getByRole('button', { name: 'Next Hitter', exact: true })).toBeVisible();

  // The HTTP snapshot also establishes the floor for delayed socket messages.
  await page.evaluate((older) => window.pinia._s.get('game').updateGameData(older), data);
  expect(await page.evaluate(() => window.pinia._s.get('game').gameState))
    .toEqual(resolved.gameState.state_data);

  // A delayed HTTP response must not overwrite a socket update that arrived first.
  const newer = structuredClone(resolved);
  newer.gameState.game_state_id = 102;
  newer.gameState.state_data.inning = 3;
  await page.evaluate((snapshot) => {
    window.pinia._s.get('game').updateGameData(snapshot);
  }, newer);
  await page.evaluate(() => window.pinia._s.get('game').fetchGame(1));
  const appliedState = await page.evaluate(() => window.pinia._s.get('game').gameState);
  expect(appliedState).toEqual(newer.gameState.state_data);

  await expect(page.getByRole('button', { name: 'Next Hitter', exact: true })).toBeVisible();
});
