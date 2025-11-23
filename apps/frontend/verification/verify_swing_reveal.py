import json
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()

    # Pre-load user auth
    context.add_init_script("""
        localStorage.setItem('token', 'fake-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1, email: 'test@example.com' }));
    """)

    page = context.new_page()

    # Mock Game State
    mock_game_state = {
        "inning": 1,
        "isTopInning": True,
        "outs": 0,
        "awayScore": 0,
        "homeScore": 0,
        "bases": {"first": None, "second": None, "third": None},
        "currentAtBat": {
            "batterAction": None,
            "pitcherAction": "pitch", # Pitcher has acted
            "pitchRollResult": { "roll": 10, "advantage": "batter" },
            "swingRollResult": None,
            "batter": { "card_id": 1, "name": "Batter", "image_url": "" },
            "pitcher": { "card_id": 2, "name": "Pitcher", "control": 10, "image_url": "" }
        },
        "homeTeam": { "userId": 2, "roster": [] },
        "awayTeam": { "userId": 1, "roster": [] },
        "isBetweenHalfInningsAway": False,
        "isBetweenHalfInningsHome": False,
        "lastCompletedAtBat": { "batter": { "card_id": 1 } } # Prevent crash
    }

    # Mock APIs
    page.route("**/api/games/1", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({
            "game": { "game_id": 1, "status": "in_progress", "current_turn_user_id": 1, "home_team_user_id": 2, "away_team_user_id": 1 },
            "gameState": { "state_data": mock_game_state },
            "gameEvents": [],
            "teams": {
                "home": { "primary_color": "#000000", "secondary_color": "#FFFFFF" },
                "away": { "primary_color": "#000000", "secondary_color": "#FFFFFF" }
            },
            "lineups": {
                "home": { "battingOrder": [{"player": {"card_id": 2, "name": "Pitcher", "position": "P"}}], "startingPitcher": {"card_id": 2} },
                "away": { "battingOrder": [{"player": {"card_id": 1, "name": "Batter", "position": "DH"}}], "startingPitcher": {"card_id": 2} }
            },
            "rosters": { "home": [], "away": [] }
        }).encode()
    ))

    page.route("**/api/games/1/set-action", lambda route: route.fulfill(
        status=200,
        body=json.dumps({"message": "Action set"}).encode()
    ))

    # Go to page
    page.goto("http://localhost:5173/game/1", wait_until="domcontentloaded")

    # Force isSwingResultVisible to true to simulate the bug state (leftover from steal)
    page.wait_for_timeout(2000) # Wait for mount
    page.evaluate("window.pinia.state.value.game.isSwingResultVisible = true")

    print("Initial state: isSwingResultVisible set to true manually.")

    # Verify "Swing Away" button is visible
    swing_btn = page.get_by_role("button", name="Swing Away")
    expect(swing_btn).to_be_visible()

    # Click "Swing Away"
    print("Clicking Swing Away...")
    swing_btn.click()

    # Now, if our fix works, isSwingResultVisible should be FALSE.
    # We can verify this by checking the state directly.
    page.wait_for_timeout(500)
    is_visible = page.evaluate("window.pinia.state.value.game.isSwingResultVisible")
    print(f"After click, isSwingResultVisible is: {is_visible}")

    if is_visible == False:
        print("SUCCESS: Visibility was reset to false.")
    else:
        print("FAILURE: Visibility remained true.")

    # Take screenshot to confirm no result box is showing (though we didn't mock the result appearing yet, checking the variable is key)
    page.screenshot(path="apps/frontend/verification/verify_swing_fix.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
