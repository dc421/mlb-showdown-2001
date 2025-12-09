
import json
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1200, 'height': 800})
    page = context.new_page()

    # Capture console logs
    page.on("console", lambda msg: print(f"Console: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"Page Error: {exc}"))

    # Block images to prevent noise
    page.route("**/*.jpg", lambda route: route.fulfill(status=200, body=b""))
    page.route("**/*.png", lambda route: route.fulfill(status=200, body=b""))
    page.route("**/*.jpeg", lambda route: route.fulfill(status=200, body=b""))

    # Mock game data
    game_id = "123"

    # Mock user authentication
    page.add_init_script("""
        localStorage.setItem('token', 'mock-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'Player1' }));
    """)

    # Mock API responses
    # Mocking generic game fetch
    page.route("**/api/games/123", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({
            "game": {
                "id": 123,
                "home_team_user_id": 1,
                "away_team_user_id": 2,
                "status": "in_progress",
                "current_turn_user_id": 1,
                "game_in_series": 1,
                "series_id": 1,
                "use_dh": True
            },
            "gameState": {
                "inning": 1,
                "isTopInning": True,
                "outs": 0,
                "homeScore": 0,
                "awayScore": 0,
                "bases": {
                    "first": { "card_id": "runnerA", "name": "Runner A", "speed": "15" },
                    "second": { "card_id": "runnerB", "name": "Runner B", "speed": "12" },
                    "third": None
                },
                "currentAtBat": {
                    "batter": { "card_id": "batter1", "name": "Batter", "image_url": "" },
                    "pitcher": { "card_id": "pitcher1", "name": "Pitcher", "control": 10 },
                    "pitcherAction": "pitch",
                    "batterAction": "swing",
                    "pitchRollResult": { "roll": 10 },
                    "swingRollResult": { "roll": 15, "outcome": "1B" }
                },
                "currentPlay": {
                    "type": "ADVANCE",
                    "payload": {
                        "decisions": [
                            { "runner": { "card_id": "runnerA", "name": "Runner A", "speed": "15" }, "from": 1 },
                            { "runner": { "card_id": "runnerB", "name": "Runner B", "speed": "12" }, "from": 2 }
                        ],
                        "hitType": "1B",
                        "choices": { "1": True, "2": True }
                    }
                },
                "homeTeam": { "userId": 1, "battingOrderPosition": 0 },
                "awayTeam": { "userId": 2, "battingOrderPosition": 0 },
                "homeDefensiveRatings": { "outfieldDefense": 2 },
                "awayDefensiveRatings": { "outfieldDefense": 2 }
            },
            "teams": {
                "home": { "team_id": 1, "userId": 1, "name": "Home Team", "abbreviation": "HOM", "primary_color": "#0000FF", "secondary_color": "#FFFFFF" },
                "away": { "team_id": 2, "userId": 2, "name": "Away Team", "abbreviation": "AWY", "primary_color": "#FF0000", "secondary_color": "#FFFFFF" }
            },
             "lineups": {
                "home": { "battingOrder": [{"player": {"card_id": "batter1", "name": "Batter"}, "position": "DH"}]},
                "away": { "battingOrder": [{"player": {"card_id": "batter2", "name": "Batter2"}, "position": "DH"}]}
             },
             "rosters": {
                "home": [{"card_id": "pitcher1", "name": "Pitcher", "control": 10}],
                "away": [{"card_id": "batter2", "name": "Batter2", "control": None}]
             }
        })
    ))

    try:
        page.goto("http://localhost:5173/game/123", timeout=30000, wait_until="domcontentloaded")

        # Wait for the game view container to appear
        page.wait_for_selector(".game-view-container", timeout=10000)

        # Wait specifically for the runner decisions group to appear
        page.wait_for_selector(".runner-decisions-group", timeout=10000)

        # Take a screenshot
        page.screenshot(path="verification/roll_info_check.png")
        print("Screenshot taken.")

    except Exception as e:
        print(f"Error: {e}")
        try:
            page.screenshot(path="verification/error_state.png")
            print("Error state screenshot taken.")
            print("Page content:")
            print(page.content())
        except:
            pass

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
