import re
import json
from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()

    # Auth
    user = { "userId": 1, "team_id": 1 }
    token = "fake_token_for_testing"
    context.add_init_script(f"""
        window.localStorage.setItem('token', '{token}');
        window.localStorage.setItem('user', '{json.dumps(user)}');
    """)

    page = context.new_page()

    # A more robust mock based on memory of GameView's fragility
    mock_game_data = {
        "game": {
            "game_id": 1,
            "status": "in_progress",
            "current_turn_user_id": 1,
            "home_team_user_id": 2,
            "away_team_user_id": 1,
            "game_in_series": 1,
            "series_id": 1,
        },
        "series": {"home_wins": 0, "away_wins": 0},
        "gameState": {
            "turn_number": 10,
            "state_data": {
                "inning": 3,
                "isTopInning": True,
                "awayScore": 1,
                "homeScore": 1,
                "outs": 1,
                "bases": {
                    "first": None,
                    "second": None,
                    "third": { "card_id": 101, "display_name": "Fast Runner", "speed": "A", "image_url":"" }
                },
                "awayTeam": { "userId": 1, "battingOrderPosition": 0, "used_player_ids": [] },
                "homeTeam": { "userId": 2, "battingOrderPosition": 0, "used_player_ids": [] },
                "homeDefensiveRatings": {"infieldDefense": 5},
                "awayDefensiveRatings": {"infieldDefense": 5},
                "isBetweenHalfInningsAway": False,
                "isBetweenHalfInningsHome": False,
                "lastCompletedAtBat": {
                    "batter": {"card_id": 99, "display_name": "Previous Batter", "image_url":""},
                    "pitcher": {"card_id": 200, "display_name": "Pitcher", "image_url":""}
                },
                "currentAtBat": {
                    "infieldIn": True,
                    "batter": { "card_id": 100, "display_name": "Hitter", "image_url":"" },
                    "pitcher": { "card_id": 200, "display_name": "Pitcher", "image_url":"" },
                    "pitcherAction": "pitch",
                    "batterAction": "swing",
                },
                "currentPlay": {
                    "type": "INFIELD_IN_CHOICE",
                    "payload": {
                        "batter": { "card_id": 100, "display_name": "Hitter" },
                        "runnerOnThird": { "card_id": 101, "display_name": "Fast Runner", "speed": "A" }
                    }
                }
            }
        },
        "gameEvents": [],
        "batter": { "card_id": 100, "display_name": "Hitter", "image_url":"" },
        "pitcher": { "card_id": 200, "display_name": "Pitcher", "image_url":"" },
        "lineups": {
            "home": { "battingOrder": [{"player": {"card_id": i, "display_name": f"Player {i}"}} for i in range(201, 210)], "startingPitcher": {"card_id": 200, "display_name": "Pitcher"} },
            "away": { "battingOrder": [{"player": {"card_id": i, "display_name": f"Player {i}"}} for i in range(101, 110)], "startingPitcher": {"card_id": 100, "display_name": "Hitter"} }
        },
        "rosters": { "home": [], "away": [] },
        "teams": {
            "home": { "abbreviation": "BOS", "primary_color": "#BD3039", "secondary_color": "#0C2340", "logo_url": "" },
            "away": { "abbreviation": "NYY", "primary_color": "#003087", "secondary_color": "#E4002C", "logo_url": "" }
        }
    }

    page.route("**/api/games/1", lambda route: route.fulfill(status=200, json=mock_game_data))
    page.route("**/api/point-sets", lambda route: route.fulfill(status=200, json=[]))

    page.goto("http://localhost:5176/game/1", wait_until="domcontentloaded")

    expect(page.get_by_role("heading", name="Infield In Play")).to_be_visible(timeout=10000)
    expect(page.get_by_role("button", name="Send Runner Home")).to_be_visible()
    expect(page.get_by_role("button", name="Hold Runner")).to_be_visible()

    page.screenshot(path="jules-scratch/verification/infield-in-choice.png")

    browser.close()

with sync_playwright() as p:
    run(p)

print("Verification script finished and screenshot taken.")
