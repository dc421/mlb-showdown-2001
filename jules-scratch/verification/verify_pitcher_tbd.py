
import json
from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        # Set up authentication
        auth_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidXNlcjFAZXhhbXBsZS5jb20iLCJvd25lciI6IkpvaG4gRG9lIiwidGVhbSI6eyJ0ZWFtX2lkIjoxLCJ1c2VyX2lkIjoxLCJjaXR5IjoiQWRlbGFudG8iLCJuYW1lIjoiQWRlbGJlcnRzIiwiYWJicmV2aWF0aW9uIjoiQURMIiwiZGlzcGxheV9mb3JtYXQiOiJ7Y2l0eX0ge25hbWV9IiwibG9nb191cmwiOiIvaW1hZ2VzL2xvZ29zL0FsbGlnYXRvcnMucG5nIiwicHJpbWFyeV9jb2xvciI6IiMwMDQzNzciLCJzZWNvbmRhcnlfY29xvciI6IiNFNDczMjUiLCJ0ZXJ0aWFyeV9jb2xvciI6IiNGRkZGRkYifSwiaWF0IjoxNzE2ODk0ODk3LCJleHAiOjE3MTk0ODY4OTd9"
        user_info = { "userId": 1 }
        context.add_init_script(f"""
            window.localStorage.setItem('token', '{auth_token}');
            window.localStorage.setItem('user', '{json.dumps(user_info)}');
        """)

        page = context.new_page()

        # Add a listener for console messages
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        # Mock the game data response to ensure a null pitcher
        mock_game_data = {
            "game": {
                "game_id": 1,
                "status": "in_progress",
                "home_team_user_id": 1,
                "away_team_user_id": 2, # Added this missing property
                "current_turn_user_id": 1
            },
            "gameState": {
                "state_data": {
                    "inning": 1,
                    "isTopInning": False,
                    "homeTeam": { "userId": 1, "battingOrderPosition": 0, "used_player_ids": [] },
                    "awayTeam": { "userId": 2, "battingOrderPosition": 0, "used_player_ids": [] },
                    "currentHomePitcher": None,
                    "currentAwayPitcher": { "card_id": 100, "name": "Fake Away Pitcher", "display_name": "Fake Away Pitcher", "control": 5, "ip": 9, "points": 100, "fielding_ratings": {} },
                    "awaitingPitcherSelection": True,
                    "homeDefensiveRatings": {"catcherArm": 0, "infieldDefense": 0, "outfieldDefense": 0},
                    "awayDefensiveRatings": {"catcherArm": 0, "infieldDefense": 0, "outfieldDefense": 0},
                    "bases": {"first": None, "second": None, "third": None},
                    "lastCompletedAtBat": {
                        "batter": {"card_id": 999, "name": "Last Batter", "display_name": "Last Batter", "speed": "B"},
                        "pitcher": {"card_id": 888, "name": "Last Pitcher", "display_name": "Last Pitcher"},
                        "pitcherAction": "pitch", "batterAction": "swing",
                        "pitchRollResult": {"roll": 10, "advantage": "batter"},
                        "swingRollResult": {"roll": 15, "outcome": "1B"},
                        "basesBeforePlay": {"first": None, "second": None, "third": None},
                        "outsBeforePlay": 0,
                        "awayScoreBeforePlay": 0,
                        "homeScoreBeforePlay": 0
                    },
                    "currentAtBat": {
                        "batter": {"card_id": 200, "name": "Current Batter", "display_name": "Current Batter", "on_base": 10, "speed": "A", "chart_data": {}, "fielding_ratings": {}},
                        "pitcher": None,
                        "pitcherAction": None, "batterAction": None,
                        "pitchRollResult": None, "swingRollResult": None,
                        "basesBeforePlay": {"first": None, "second": None, "third": None},
                        "outsBeforePlay": 0
                    }
                }
            },
            "gameEvents": [],
            "pitcher": None,
            "batter": { "card_id": 200, "name": "Current Batter", "display_name": "Current Batter" },
            "lineups": {
                "home": {
                    "battingOrder": [{"player": {"card_id": i, "display_name": f"Player {i}"}, "position": "P", "card_id": i} for i in range(1, 10)],
                    "startingPitcher": None
                },
                "away": {
                    "battingOrder": [{"player": {"card_id": i, "display_name": f"Player {i}"}, "position": "P", "card_id": i} for i in range(10, 19)],
                    "startingPitcher": { "card_id": 100, "name": "Fake Away Pitcher", "display_name": "Fake Away Pitcher" }
                }
            },
            "rosters": { "home": [], "away": [] },
            "teams": {
                "home": { "city": "Home Team", "logo_url": "", "primary_color": "#000000", "secondary_color": "#FFFFFF", "abbreviation": "HME" },
                "away": { "city": "Away Team", "logo_url": "", "primary_color": "#CCCCCC", "secondary_color": "#000000", "abbreviation": "AWY" }
            }
        }

        page.route("**/api/games/1", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(mock_game_data)
        ))
        page.route("**/images/**", lambda route: route.fulfill(status=204))

        page.goto("http://localhost:5173/game/1")

        page.wait_for_selector(".lineup-panel")
        lineup_panel = page.locator(".lineup-panel").first
        lineup_panel.screenshot(path="jules-scratch/verification/verification.png")

        browser.close()

if __name__ == "__main__":
    run_verification()
