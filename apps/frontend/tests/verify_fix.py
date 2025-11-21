
import time
from playwright.sync_api import sync_playwright

def verify_roll_for_swing_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        context.add_init_script("""
            localStorage.setItem('user', JSON.stringify({ userId: '1', username: 'player1' }));
            localStorage.setItem('token', 'fake-token');
            localStorage.removeItem('showdown-game-1-swing-result-seen');
            window.socket = { connect: () => {}, emit: () => {}, on: () => {}, off: () => {}, disconnect: () => {} };
        """)

        page = context.new_page()

        mock_game_data = {
            "game": {
                "id": "1",
                "home_team_user_id": "1",
                "away_team_user_id": "2",
                "status": "completed",
                "game_in_series": 1,
                "series_id": 1
            },
            "gameState": {
                "state_data": {
                    "inning": 9,
                    "isTopInning": False,
                    "outs": 0,
                    "homeScore": 1,
                    "awayScore": 0,
                    "bases": {"first": None, "second": None, "third": None},
                    "currentAtBat": {
                        "batterAction": "swing",
                        "pitcherAction": "pitch",
                        "pitchRollResult": {"roll": 10, "advantage": "batter"},
                        "swingRollResult": {"roll": 20, "outcome": "Single"},
                        "batter": {"card_id": "batter", "name": "Batter", "image_url": ""},
                        "pitcher": {"card_id": "pitcher", "name": "Pitcher", "image_url": "", "control": 5},
                        "basesBeforePlay": {"first": None, "second": None, "third": {"runner": "Runner"}},
                        "outsBeforePlay": 0,
                        "homeScoreBeforePlay": 0,
                        "awayScoreBeforePlay": 0
                    },
                    "lastCompletedAtBat": {
                        "batterAction": "swing",
                        "pitcherAction": "pitch",
                        "pitchRollResult": {"roll": 10, "advantage": "batter"},
                        "swingRollResult": {"roll": 20, "outcome": "Single"},
                        "batter": {"card_id": "batter", "name": "Batter", "image_url": ""},
                        "pitcher": {"card_id": "pitcher", "name": "Pitcher", "image_url": "", "control": 5},
                        "basesBeforePlay": {"first": None, "second": None, "third": {"runner": "Runner"}},
                        "outsBeforePlay": 0,
                        "homeScoreBeforePlay": 0,
                        "awayScoreBeforePlay": 0
                    },
                    "homeDefensiveRatings": {},
                    "awayDefensiveRatings": {},
                    "awaiting_lineup_change": False,
                    "isBetweenHalfInningsAway": False,
                    "isBetweenHalfInningsHome": False,
                    "awayPlayerReadyForNext": False,
                    "homePlayerReadyForNext": False,
                    "defensivePlayerWentSecond": False,
                    "pendingStealAttempt": None,
                    "homeTeam": { "team_id": 1, "abbreviation": "HOME", "primary_color": "#000000", "secondary_color": "#FFFFFF", "city": "City", "logo_url": "url", "userId": "1" },
                    "awayTeam": { "team_id": 2, "abbreviation": "AWAY", "primary_color": "#000000", "secondary_color": "#FFFFFF", "city": "City", "logo_url": "url", "userId": "2" }
                }
            },
            "gameEvents": [],
            "lineups": {"home": {"battingOrder": []}, "away": {"battingOrder": []}},
            "rosters": {"home": [], "away": []},
            "teams": {
                "home": {"team_id": 1, "abbreviation": "HOME", "primary_color": "#000000", "secondary_color": "#FFFFFF", "city": "City", "logo_url": "url", "userId": "1"},
                "away": {"team_id": 2, "abbreviation": "AWAY", "primary_color": "#000000", "secondary_color": "#FFFFFF", "city": "City", "logo_url": "url", "userId": "2"}
            }
        }

        import json
        page.route("**/api/games/1", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(mock_game_data).encode("utf-8")
        ))

        # Mock images/fonts to prevent timeouts
        page.route("**/*.{png,jpg,jpeg,svg,woff,woff2,ttf}", lambda route: route.fulfill(status=200, body=b""))

        page.goto("http://localhost:5173/game/1", wait_until="domcontentloaded")

        try:
            page.wait_for_selector("text=ROLL FOR SWING", timeout=5000)
            print("SUCCESS: 'ROLL FOR SWING' button found!")
        except Exception as e:
            print(f"FAILURE: 'ROLL FOR SWING' button not found. {e}")

        screenshot_path = "/home/jules/verification/walkoff_button_visible.png"
        # Disable animations to avoid waiting for fonts
        page.screenshot(path=screenshot_path, animations="disabled")
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    verify_roll_for_swing_button()
