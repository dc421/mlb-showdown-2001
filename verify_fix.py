
import json
from playwright.sync_api import sync_playwright

def test_fix():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"ERROR: {err}"))

        # Mock Game Data
        def handle_game(route):
            print(f"Intercepted: {route.request.url}")

            # Inject auth
            try:
                page.evaluate("""
                    if (window.pinia) {
                        const auth = window.pinia.state.value.auth;
                        auth.user = { userId: 2, username: 'AwayPlayer' };
                        auth.token = 'fake-token';
                        console.log("AUTH INJECTED");
                    }
                """)
            except:
                pass

            route.fulfill(json={
                "game": {
                    "game_id": 123,
                    "home_team_user_id": 1,
                    "away_team_user_id": 2,
                    "status": "in_progress",
                    "series_type": "exhibition",
                    "current_turn_user_id": 2 # Simulate it's my turn to allow Steal UI
                },
                "gameState": {
                    "state_data": {
                        "inning": 2,
                        "isTopInning": True,
                        "outs": 0,
                        "homePlayerReadyForNext": True,
                        "awayPlayerReadyForNext": False,
                        "homeTeam": { "userId": 1, "team_id": 1 },
                        "awayTeam": { "userId": 2, "team_id": 2 },
                        "inningEndedOnCaughtStealing": True,

                        "currentAtBat": {
                            "batterId": 99,
                            "pitcherId": 88,
                            "outsBeforePlay": 0,
                            "basesBeforePlay": {},
                            "pitcherAction": None,
                            "batterAction": None
                        },
                        "lastCompletedAtBat": {
                            "batterId": 55,
                            "outsBeforePlay": 1,
                            "basesBeforePlay": { "1": { "id": 10, "name": "Runner" }, "3": { "id": 11, "name": "Runner3" } }
                        },
                        "pendingStealAttempt": {
                            "runner": { "id": 10, "name": "Runner" },
                            "throwToBase": 3,
                            "outcome": None,
                            "runnerTeamId": 1
                        },
                        "lastStealResult": None,
                        "bases": { "1": { "id": 10, "name": "Runner" }, "3": { "id": 11, "name": "Runner3" } }
                    }
                },
                "gameEvents": [],
                "batter": { "id": 99, "display_name": "Next Batter", "card_id": 999 },
                "pitcher": { "id": 88, "display_name": "Next Pitcher", "card_id": 888 },
                "teams": { "home": { "id": 1, "name": "Home" }, "away": { "id": 2, "name": "Away" } },
                "lineups": { "home": [], "away": [] },
                "rosters": { "home": [], "away": [] }
            })

        page.route("**/api/games/123", handle_game)
        page.route("**/api/games/123/setup", lambda r: r.fulfill(json={}))
        page.route("**/api/games/123/my-lineup", lambda r: r.fulfill(json={"hasLineup": True}))
        page.route("**/api/league/user/*", lambda r: r.fulfill(json={}))
        page.route("**/*.png", lambda r: r.fulfill(status=200, body=b""))
        page.route("**/*.jpg", lambda r: r.fulfill(status=200, body=b""))

        # Pre-set localStorage
        page.add_init_script("""
            localStorage.setItem('user', JSON.stringify({ userId: 2, username: 'AwayPlayer' }));
            localStorage.setItem('token', 'fake-token');
        """)

        # Now navigate to game
        print("Navigating to game page...")
        page.goto("http://localhost:5173/game/123")

        try:
            page.wait_for_selector(".game-view-container", timeout=5000)
            print("Game container loaded.")
        except:
            print("Timed out waiting for .game-view-container")

        # Capture state
        page.screenshot(path="verification_fix_final.png")

        # Assertions
        content = page.content()
        if "Waiting for swing" in content:
            print("FAILURE: 'Waiting for swing' is visible.")
        else:
            print("SUCCESS: 'Waiting for swing' is hidden.")

        if "ROLL FOR THROW" in content:
             print("SUCCESS: ROLL FOR THROW found.")
        elif "Steal" in content:
             print("SUCCESS: Steal text found.")
        else:
             print("FAILURE: ROLL FOR THROW/Steal not found.")

        browser.close()

if __name__ == "__main__":
    test_fix()
