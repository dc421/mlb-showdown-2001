from playwright.sync_api import sync_playwright
import json

def run(playwright):
    browser = playwright.chromium.launch()
    # Create a new context. This is where we can inject scripts or cookies if needed.
    context = browser.new_context()

    # 1. Set up authentication in localStorage.
    # We use context.add_init_script to ensure this runs before any page scripts.
    context.add_init_script("""
        localStorage.setItem('token', 'test-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'DefenseUser' }));
    """)

    page = context.new_page()

    # 2. Mock the game data API response.
    # This mocks the state where pendingStealAttempt is missing but currentPlay is STEAL_ATTEMPT (single steal).
    mock_game_data = {
      "game": { "id": 1, "home_team_user_id": 1, "away_team_user_id": 2, "game_in_series": 1, "series_id": 1, "home_team_id": 1, "away_team_id": 2, "current_turn_user_id": 1 },
      "series": { "series_type": 'exhibition' },
      "gameState": {
        "state_data": {
          "inning": 1, "isTopInning": True, "outs": 0, "homeScore": 0, "awayScore": 0,
          "bases": { "first": { "card_id": 200, "displayName": "Speedy Runner", "name": "Speedy Runner" }, "second": None, "third": None },
          "isBetweenHalfInningsAway": False, "isBetweenHalfInningsHome": False,
          "homeDefensiveRatings": { "catcherArm": 0, "infieldDefense": 0, "outfieldDefense": 0 },
          "awayDefensiveRatings": { "catcherArm": 0, "infieldDefense": 0, "outfieldDefense": 0 },
          "homeTeam": { "userId": 1, "battingOrderPosition": 0, "used_player_ids": [] },
          "awayTeam": { "userId": 2, "battingOrderPosition": 0, "used_player_ids": [] },
          "currentAtBat": {
            "batter": { "card_id": 201, "name": "Away Batter" }, "pitcher": { "card_id": 101, "name": "Home Pitcher" },
            "basesBeforePlay": { "first": { "card_id": 200, "displayName": "Speedy Runner" } }, "outsBeforePlay": 0, "homeScoreBeforePlay": 0, "awayScoreBeforePlay": 0,
            "batterAction": "swing", "pitcherAction": "pitch"
          },
          "lastCompletedAtBat": None,
          "currentPlay": {
              "type": "STEAL_ATTEMPT",
              "payload": {
                  "decisions": { "1": True },
                  "batterPlayerId": 201
              }
          },
          "pendingStealAttempt": None,
          "lastStealResult": None,
          "awayPlayerReadyForNext": True,
          "homePlayerReadyForNext": False,
        }
      },
      "gameEvents": [],
      "teams": { "away": { "abbreviation": 'AWAY', "city": 'Away', "logo_url": '' }, "home": { "abbreviation": 'HOME', "city": 'Home', "logo_url": '' } },
      "batter": { "card_id": 201, "name": 'Away Batter', "image_url": '' },
      "pitcher": { "card_id": 101, "name": 'Home Pitcher', "image_url": '' },
      "lineups": {
        "home": { "battingOrder": [{ "player": { "card_id": 100 + i, "displayName": f"H{i}", "position": "1B" }, "position": "1B" } for i in range(9)] },
        "away": { "battingOrder": [{ "player": { "card_id": 200 + i, "displayName": f"A{i}", "position": "1B" }, "position": "1B" } for i in range(9)] }
      },
      "rosters": { "home": [], "away": [] },
    }

    page.route('**/api/games/1', lambda route: route.fulfill(
        status=200,
        content_type='application/json',
        body=json.dumps(mock_game_data)
    ))

    page.route('**/api/point-sets', lambda route: route.fulfill(
        status=200,
        content_type='application/json',
        body=json.dumps([])
    ))

    # Mock images to avoid timeouts
    page.route('**/images/*', lambda route: route.fulfill(
        status=200,
        content_type='image/jpeg',
        body=b''
    ))

    # 3. Navigate to the page
    print("Navigating to game page...")
    page.goto("http://localhost:5173/game/1")

    # 4. Wait for the key elements to appear
    # We expect the "ROLL FOR THROW" button to be visible if our fix worked.
    print("Waiting for ROLL FOR THROW button...")
    try:
        # Wait for either the correct button OR the incorrect one (for debugging)
        # We want to confirm "ROLL FOR THROW" is there.
        page.wait_for_selector("button:has-text('ROLL FOR THROW')", timeout=5000)
        print("Success: 'ROLL FOR THROW' button found!")
    except:
        print("Error: 'ROLL FOR THROW' button NOT found.")
        # Check if the "Throw to 2nd" button is there instead (indicating failure)
        if page.is_visible("button:has-text('Throw to 2nd')"):
            print("Failure: Found 'Throw to 2nd' button instead (Double Steal UI).")
        else:
            print("Failure: Neither button found. UI might be stuck.")

    # 5. Take a screenshot
    screenshot_path = "apps/frontend/verification/steal_ui_fix.png"
    page.screenshot(path=screenshot_path)
    print(f"Screenshot saved to {screenshot_path}")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
