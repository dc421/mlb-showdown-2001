import json
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Mock the game data with the problematic structure (game.id instead of game.game_id)
    # but wait, we are testing the frontend code, so the frontend will be running the FIXED code.
    # We want to verify that with the fixed code, it correctly writes to localStorage.

    # Define the mock game data
    game_id = 123
    mock_game = {
        "game_id": game_id,
        "status": "in_progress", # Simulate in progress so buttons show up
        "home_team_user_id": 1,
        "away_team_user_id": 2
    }

    mock_game_state = {
        "game_id": game_id,
        "turn_number": 10,
        "state_data": {
            "inning": 9,
            "isTopInning": False,
            "outs": 0,
            "homeScore": 5,
            "awayScore": 5,
            "bases": {"first": None, "second": None, "third": None},
            "homeTeam": {"userId": 1, "battingOrderPosition": 0},
            "awayTeam": {"userId": 2, "battingOrderPosition": 0},
            "currentAtBat": {
                "batter": {"card_id": 1, "name": "Batter", "image_url": ""},
                "pitcher": {"card_id": 2, "name": "Pitcher", "image_url": ""},
                "batterAction": "swing",
                "pitcherAction": "pitch",
                "pitchRollResult": {"roll": 10},
                "swingRollResult": {"roll": 20, "outcome": "HR"}
            },
            "lastCompletedAtBat": {
                 "outsBeforePlay": 0,
                 "homeScoreBeforePlay": 5,
                 "awayScoreBeforePlay": 5,
                 "basesBeforePlay": {"first": None, "second": None, "third": None}
            }
        }
    }

    # Mock API responses
    page.route(f"**/api/games/{game_id}", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({
            "game": mock_game,
            "gameState": mock_game_state,
            "gameEvents": [],
            "lineups": {
                "home": {"battingOrder": [{"player": {"card_id": 1, "name": "Batter", "image_url": ""}}]},
                "away": {"battingOrder": [{"player": {"card_id": 2, "name": "Pitcher", "image_url": ""}}]}
            },
            "rosters": {"home": [], "away": []},
            "teams": {"home": {"primary_color": "#000000", "secondary_color": "#ffffff"}, "away": {"primary_color": "#000000", "secondary_color": "#ffffff"}}
        }).encode('utf-8')
    ))

    # Mock the swing action to just return success (frontend should then update store)
    page.route(f"**/api/games/{game_id}/swing", lambda route: route.fulfill(status=200))

    # Set user as home player (Offensive)
    page.add_init_script("""
        localStorage.setItem('token', 'fake_token');
        localStorage.setItem('user', JSON.stringify({userId: 1}));
    """)

    # Go to game page
    page.goto(f"http://localhost:5173/game/{game_id}/play")

    # Wait for load
    try:
        page.wait_for_selector(".game-view-container")
    except Exception as e:
        print("Timed out waiting for container. Dumping content...")
        # print(page.content()) # Uncomment if needed, but screenshot is better
        page.screenshot(path="apps/frontend/test-results/error_state.png")
        raise e

    print("Page loaded. Checking initial localStorage state...")
    initial_storage = page.evaluate(f"localStorage.getItem('showdown-game-{game_id}-swing-result-seen')")
    print(f"Initial localStorage key: {initial_storage}")

    # Click "ROLL FOR SWING" (which simulates the user clicking to reveal)
    # This is where the button should be visible because we mocked the state to be ready for reveal
    # but isSwingResultVisible defaults to false.

    # Note: With the fix, clicking this should write to localStorage using game_id.
    roll_button = page.get_by_role("button", name="ROLL FOR SWING")
    if roll_button.is_visible():
        print("Clicking 'ROLL FOR SWING'...")
        roll_button.click()

        # Wait a bit for the action to process
        page.wait_for_timeout(1000)

        # Check localStorage again
        final_storage = page.evaluate(f"localStorage.getItem('showdown-game-{game_id}-swing-result-seen')")
        print(f"Final localStorage key: {final_storage}")

        if final_storage == '"true"' or final_storage == 'true':
            print("SUCCESS: localStorage key was set correctly!")
        else:
            print("FAILURE: localStorage key was NOT set.")

    else:
        print("ERROR: 'ROLL FOR SWING' button not found!")

    page.screenshot(path="apps/frontend/test-results/verification.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
