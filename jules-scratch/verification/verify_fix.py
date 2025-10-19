
import json
from playwright.sync_api import sync_playwright

def run(playwright):
    # --- MOCK DATA ---
    # This data simulates the game state just after the 3rd out of the top of the 1st.
    mock_game_data = {
        "game": {
            "game_id": 1, "status": "in_progress", "current_turn_user_id": 0, "home_team_user_id": 1,
            "away_team_user_id": 2
        },
        "series": {"series_type": "exhibition"},
        "gameState": {
            "state_data": {
                "inning": 1,
                "isTopInning": False, # Backend has already flipped to Bottom 1st
                "outs": 0,
                "homeScore": 0,
                "awayScore": 0,
                "bases": {"first": None, "second": None, "third": None},
                "homeTeam": {"userId": 1, "battingOrderPosition": 0},
                "awayTeam": {"userId": 2, "battingOrderPosition": 1}, # Away team is at pos 1
                "isBetweenHalfInningsAway": True, # Inning just ended
                "isBetweenHalfInningsHome": False,
                "homePlayerReadyForNext": False,
                "awayPlayerReadyForNext": True, # Away player (pitcher) is ready first
                "currentAtBat": {
                    "batter": {"card_id": 101, "displayName": "Home Batter #1"},
                    "pitcher": {"card_id": 201, "displayName": "Away Pitcher"},
                    "batterAction": None,
                    "pitcherAction": None,
                },
                "lastCompletedAtBat": {
                    "batter": {"card_id": 103, "displayName": "Away Batter #3 (Last)"},
                    "pitcher": {"card_id": 201, "displayName": "Home Pitcher"}
                }
            }
        },
        "lineups": {
            "home": {
                "battingOrder": [
                    {"player": {"card_id": 101, "displayName": "Home Batter #1"}},
                    {"player": {"card_id": 102, "displayName": "Home Batter #2"}},
                    # ... more batters
                ]
            },
            "away": {
                 "battingOrder": [
                    {"player": {"card_id": 201, "displayName": "Away Batter #1"}},
                    {"player": {"card_id": 202, "displayName": "Away Batter #2"}},
                    {"player": {"card_id": 203, "displayName": "Away Batter #3 (Last)"}},
                    # ... more batters
                ]
            }
        },
        "teams": {
            "home": {"abbreviation": "HOME"}, "away": {"abbreviation": "AWAY"}
        }
        # Other fields can be empty/null for this test
    }


    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()

    # Set up authentication in localStorage
    user_data = json.dumps({"userId": 2}) # We are the away user (pitching)
    context.add_init_script(f"localStorage.setItem('user', '{user_data}');")
    context.add_init_script("localStorage.setItem('token', 'fake_token');")

    page = context.new_page()

    # Intercept the API call and provide our mock data
    def handle_route(route):
        route.fulfill(status=200, body=json.dumps(mock_game_data))

    page.route("**/api/games/1", handle_route)

    # Navigate to the game page
    page.goto("http://localhost:5173/game/1")

    # Wait for the batter's name to be visible to ensure the page has loaded
    # We expect to see "Home Batter #1", NOT "Away Batter #3 (Last)" or "Home Batter #2"
    page.wait_for_selector('text="Home Batter #1"', timeout=5000)

    # Take the screenshot
    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as p:
    run(p)
