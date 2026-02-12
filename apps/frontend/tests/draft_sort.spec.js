import { test, expect } from '@playwright/test';

test.describe('Draft View Sorting', () => {

  test('should sort history items by points descending in historical view', async ({ page }) => {
    // Mock History Only State
    await page.route('**/api/draft/state**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            season_name: 'Old Season',
            is_active: false,
            current_round: 0,
            history: [
                { id: 1, player_name: 'Low Points', points: 100, action: 'ADDED', round: 'Round 1', pick_number: 1, team_name: 'Team A' },
                { id: 2, player_name: 'High Points', points: 500, action: 'ADDED', round: 'Round 1', pick_number: 2, team_name: 'Team B' },
                { id: 3, player_name: 'Mid Points', points: 300, action: 'ADDED', round: 'Round 1', pick_number: 3, team_name: 'Team C' }
            ],
            randomRemovals: [],
            takenPlayerIds: [],
            isSeasonOver: true,
            teams: {}
          })
        });
    });

    // Mock other endpoints
    await page.route('**/api/auth/user', async route => route.fulfill({ status: 200, body: JSON.stringify({ userId: 1 }) }));
    await page.route('**/api/draft/seasons', async route => route.fulfill({ status: 200, body: JSON.stringify(['Old Season']) }));
    await page.route('**/api/point-sets', async route => route.fulfill({ status: 200, body: JSON.stringify([]) }));
    await page.route('**/api/players**', async route => route.fulfill({ status: 200, body: JSON.stringify([]) }));

    // Go to page
    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        localStorage.setItem('token', 'fake-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1 }));
    });
    await page.goto('http://localhost:5173/draft');

    // Wait for table
    const table = page.locator('.draft-table tbody');
    await expect(table).toBeVisible();

    const rows = table.locator('tr');
    await expect(rows).toHaveCount(3);

    // Verify Order: High (500) -> Mid (300) -> Low (100)
    await expect(rows.nth(0)).toContainText('High Points');
    await expect(rows.nth(1)).toContainText('Mid Points');
    await expect(rows.nth(2)).toContainText('Low Points');
  });

  test('should sort history items by points descending within same pick in active draft', async ({ page }) => {
    // Mock Active Draft State with multiple adds in same pick
    await page.route('**/api/draft/state**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            season_name: 'Active Season',
            is_active: true,
            current_round: 4, // Add/Drop 1
            current_pick_number: 11,
            active_team_id: 1,
            draft_order: [1, 2, 3, 4, 5],
            history: [
                { id: 10, player_name: 'Low Pts Add', points: 100, action: 'ADDED', round: 'Add/Drop 1', pick_number: 11, team_name: 'My Team' },
                { id: 11, player_name: 'High Pts Add', points: 400, action: 'ADDED', round: 'Add/Drop 1', pick_number: 11, team_name: 'My Team' }
            ],
            randomRemovals: [],
            takenPlayerIds: [],
            teams: { 1: 'My Team' }
          })
        });
    });

    // Mock other endpoints
    await page.route('**/api/auth/user', async route => route.fulfill({ status: 200, body: JSON.stringify({ userId: 1, team: { team_id: 1 } }) }));
    await page.route('**/api/draft/seasons', async route => route.fulfill({ status: 200, body: JSON.stringify(['Active Season']) }));
    await page.route('**/api/point-sets', async route => route.fulfill({ status: 200, body: JSON.stringify([]) }));
    await page.route('**/api/players**', async route => route.fulfill({ status: 200, body: JSON.stringify([]) }));

    await page.goto('http://localhost:5173/');
    await page.evaluate(() => {
        localStorage.setItem('token', 'fake-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1 }));
    });
    await page.goto('http://localhost:5173/draft');

    const table = page.locator('.draft-table tbody');
    await expect(table).toBeVisible();

    // Find the rows for Pick 11
    // Since it's an active draft with 5 teams, there are 20 pick slots rendered.
    // Pick 11 corresponds to row index 10 (0-based) IF there is only 1 item per pick.
    // But here pick 11 has 2 history items. So it generates 2 rows.
    // Picks 1-10 generate 10 rows (placeholders or history).
    // So Pick 11 starts at row index 10.
    
    // Pick 11 items should be sorted High -> Low.
    const rows = table.locator('tr');
    
    // Row 10: High Pts Add
    await expect(rows.nth(10)).toContainText('High Pts Add');
    
    // Row 11: Low Pts Add
    await expect(rows.nth(11)).toContainText('Low Pts Add');
  });

});
