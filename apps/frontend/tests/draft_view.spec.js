import { test, expect } from '@playwright/test';

test.describe('Draft View Unified Layout', () => {
  test('should display pre-filled draft table and season select', async ({ page }) => {
    // 1. Mock API responses
    await page.route('**/api/auth/user', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ userId: 1, team: { team_id: 1, name: "My Team" } })
      });
    });

    await page.route('**/api/draft/seasons', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(['8/4/25 Season', 'Old Season'])
      });
    });

    await page.route('**/api/draft/state**', async route => {
        // Mock active draft state
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            season_name: '8/4/25 Season',
            is_active: true,
            current_round: 2, // UI Round 1
            current_pick_number: 1,
            active_team_id: 1, // My Turn
            draft_order: [1, 2, 3, 4, 5],
            history: [],
            randomRemovals: [],
            takenPlayerIds: [],
            isSeasonOver: false,
            teams: {
                1: 'My Team',
                2: 'Team 2',
                3: 'Team 3',
                4: 'Team 4',
                5: 'Team 5'
            }
          })
        });
    });

    await page.route('**/api/point-sets', async route => {
         await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });
    await page.route('**/api/players**', async route => {
         await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    // 2. Navigate to draft page
    // We need to set localStorage token first to pass auth guard
    await page.goto('http://localhost:5173/'); // Navigate first to set storage
    await page.evaluate(() => {
        localStorage.setItem('token', 'fake-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1, team: { team_id: 1 } }));
    });

    await page.goto('http://localhost:5173/draft');

    // 3. Verify Layout

    // Check Season Select
    await expect(page.locator('select.season-select-inline')).toBeVisible();
    await expect(page.locator('select.season-select-inline')).toHaveValue('8/4/25 Season');

    // Check Draft Table
    const table = page.locator('.draft-table');
    await expect(table).toBeVisible();

    // Should have header + 20 rows (4 rounds * 5 teams)
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(20);

    // Verify first row content (Round 1, Pick 1, Team 1)
    const firstRow = rows.first();
    const roundCell = firstRow.locator('td').first();
    await expect(roundCell).toHaveText('1');
    await expect(firstRow).toContainText('1'); // Pick #
    await expect(firstRow).toContainText('My Team');

    // Verify last row content (Add/Drop 2, Pick 20, Team 5)
    // Round 4 is "Add/Drop 2"
    const lastRow = rows.last();
    const roundCellLast = lastRow.locator('td').first();
    await expect(roundCellLast).toHaveText('Add/Drop 2');
    await expect(lastRow).toContainText('20'); // Pick #
    await expect(lastRow).toContainText('Team 5');

    // Check Picking Interface (Since it is my turn)
    await expect(page.locator('.pick-interface')).toBeVisible();
    await expect(page.locator('.pick-interface h3')).toContainText('Pick #1');
  });

  test('should append history items for add/drop rounds', async ({ page }) => {
     // Mock state in Add/Drop Round
     await page.route('**/api/draft/state**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            season_name: '8/4/25 Season',
            is_active: true,
            current_round: 4, // Add/Drop 1
            current_pick_number: 11,
            active_team_id: 1,
            draft_order: [1, 2, 3, 4, 5],
            history: [
                { id: 100, round: 'Add/Drop 1', pick_number: 11, team_name: 'My Team', player_name: 'New Player', action: 'ADDED' }
            ],
            randomRemovals: [],
            takenPlayerIds: [],
            isSeasonOver: false,
            teams: { 1: 'My Team' }
          })
        });
    });

     await page.route('**/api/auth/user', async route => {
        await route.fulfill({ status: 200, body: JSON.stringify({ userId: 1, team: { team_id: 1 } }) });
     });
     await page.route('**/api/point-sets', async route => {
         await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });
    await page.route('**/api/players**', async route => {
         await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });
    await page.route('**/api/draft/seasons', async route => {
      await route.fulfill({ status: 200, body: JSON.stringify(['8/4/25 Season']) });
    });

    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        localStorage.setItem('token', 'fake-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1 }));
    });
    await page.goto('http://localhost:5173/draft');

    // Table should have 20 rows
    const rows = page.locator('.draft-table tbody tr');
    await expect(rows).toHaveCount(20);

    // Verify pick #11 (index 10)
    // Add/Drop 1 corresponds to picks 11-15 in a 5 team league.
    const pickRow = rows.nth(10);

    // Adjusted expectation: 'Add/Drop 1'
    await expect(pickRow).toContainText('Add/Drop 1');
    await expect(pickRow).toContainText('New Player');
    await expect(pickRow).toContainText('11');
  });

  test('should show Start Season button when season is over, even if removals exist', async ({ page }) => {
    // 1. Mock API responses
    await page.route('**/api/auth/user', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ userId: 1, team: { team_id: 1, name: "My Team" } })
      });
    });

    await page.route('**/api/draft/seasons', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(['Old Season'])
      });
    });

    await page.route('**/api/draft/state**', async route => {
        // Mock inactive draft state (historical)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            season_name: 'Old Season',
            is_active: false,
            current_round: 0,
            current_pick_number: 1,
            active_team_id: null,
            history: [],
            randomRemovals: [{ player_name: 'Guy', team_name: 'Team' }], // Removals EXIST
            takenPlayerIds: [],
            isSeasonOver: true, // Season IS over
            teams: {}
          })
        });
    });

    await page.route('**/api/point-sets', async route => {
         await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });
    await page.route('**/api/players**', async route => {
         await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    // 2. Navigate to draft page
    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        localStorage.setItem('token', 'fake-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1, team: { team_id: 1 } }));
    });

    await page.goto('http://localhost:5173/draft');

    // 3. Verify Button Visibility
    const startButton = page.locator('button.start-btn');
    await expect(startButton).toBeVisible();
    await expect(startButton).toHaveText('Perform Random Removals');
  });

  test('should HIDE Start Season button when draft is active (even if season is over)', async ({ page }) => {
    // This reproduces the "Active but button visible" bug state
    await page.route('**/api/auth/user', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ userId: 1, team: { team_id: 1, name: "My Team" } })
      });
    });

    await page.route('**/api/draft/seasons', async route => {
      await route.fulfill({ status: 200, body: JSON.stringify(['8/4/25 Season']) });
    });

    await page.route('**/api/draft/state**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            season_name: '8/4/25 Season',
            is_active: true, // ACTIVE
            current_round: 1,
            current_pick_number: 1,
            active_team_id: 1,
            history: [],
            randomRemovals: [],
            takenPlayerIds: [],
            isSeasonOver: true, // OVER (e.g. gap between seasons)
            teams: {}
          })
        });
    });

    await page.route('**/api/point-sets', async route => {
         await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });
    await page.route('**/api/players**', async route => {
         await route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        localStorage.setItem('token', 'fake-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1, team: { team_id: 1 } }));
    });

    await page.goto('http://localhost:5173/draft');

    // 3. Verify Button is HIDDEN
    const startButton = page.locator('button.start-btn');
    await expect(startButton).not.toBeVisible();

    // Verify Controls ARE visible
    await expect(page.locator('.active-controls')).toBeVisible();
  });
});
