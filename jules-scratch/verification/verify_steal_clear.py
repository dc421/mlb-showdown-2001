
import json
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()

    # Set up authentication in localStorage
    context.add_init_script("""
        localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoiYUBhLmNvbSIsIm93bmVyIjoiYSBhIiwidGVhbSI6eyJ0ZWFtX2lkIjoxLCJjaXR5IjoiQW5haGVpbSIsIm5hbWUiOiJBbmdlbHMiLCJkaXNwbGF5X2Zvcm1hdCI6IntjaXR5fSB7bmFtZX0iLCJsb2dvX3VybCI6IiIsInVzZXJfaWQiOjEsInByaW1hcnlfY29yIjoiI2JkMDAyNiIsInNlY29uZF9jb2xvciI6IiMwMDMyNjEiLCJhYmJyZXZpYXRpb24iOiJBTkEifSwiaWF0IjoxNzI4NDM4NjM2LCJleHAiOjE3MzEwMzA2MzZ9.m932-a5K-zPY4-y03-3A-y3-Y-y-Y');
        localStorage.setItem('user', JSON.stringify({"userId":1,"email":"a@a.com","owner":"a a","team":{"team_id":1,"city":"Anaheim","name":"Angels","display_format":"{city} {name}","logo_url":"","user_id":1,"primary_color":"#bd0026","secondary_color":"#003261","abbreviation":"ANA"}}));
    """)

    page = context.new_page()

    # Listen for all console events and print them
    page.on("console", lambda msg: print(f"Browser console: {msg.text}"))

    # Mock the API response for the game state
    mock_game_data = {
        "game": {"game_id": 1, "status": "in_progress", "current_turn_user_id": 2, "home_team_user_id": 1, "away_team_user_id": 2},
        "gameState": {
            "state_data": {
                "inning": 1, "isTopInning": True, "awayScore": 0, "homeScore": 0, "outs": 0,
                "bases": {"first": None, "second": None, "third": None},
                "stealAttemptDetails": {"roll": 10, "defense": 5, "target": 15, "outcome": "SAFE", "penalty": 0, "throwToBase": 2, "runnerName": "Player A"},
                "homeTeam": {"userId": 1, "battingOrderPosition": 0, "used_player_ids": []},
                "awayTeam": {"userId": 2, "battingOrderPosition": 0, "used_player_ids": []},
                "currentAtBat": {"batter": {"card_id": 1, "name": "Batter"}, "pitcher": {"card_id": 2, "name": "Pitcher"}, "pitcherAction": None, "batterAction": None, "pitchRollResult": None, "swingRollResult": None, "basesBeforePlay": {}, "outsBeforePlay": 0},
                "lastCompletedAtBat": {"batter": {"card_id": 1, "name": "Batter"}, "pitcher": {"card_id": 2, "name": "Pitcher"}},
                "homeDefensiveRatings": {"catcherArm": 0, "infieldDefense": 0, "outfieldDefense": 0},
                "awayDefensiveRatings": {"catcherArm": 0, "infieldDefense": 0, "outfieldDefense": 0},
                "isBetweenHalfInningsAway": False,
                "isBetweenHalfInningsHome": False,
                "awayPlayerReadyForNext": False,
                "homePlayerReadyForNext": False,
                "currentPlay": None,
                "pitcherStats": {},
            }
        },
        "gameEvents": [],
        "lineups": {
            "home": {"battingOrder": [{"player": {"card_id": 1}}], "startingPitcher": {"card_id": 2}},
            "away": {"battingOrder": [{"player": {"card_id": 3}}], "startingPitcher": {"card_id": 4}}
        },
        "rosters": {"home": [], "away": []},
        "teams": {"home": {"abbreviation": "HOME"}, "away": {"abbreviation": "AWAY"}}
    }

    page.route("**/api/games/1", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(mock_game_data)
    ))

    # Mock the pitch action
    page.route("**/api/games/1/pitch", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"message": "Pitch action complete."})
    ))


    page.goto("http://localhost:5173/game/1")

    # The steal result box should be visible initially
    steal_result_box = page.locator(".throw-roll-result")
    expect(steal_result_box).to_be_visible()

    # The defensive player is user 1, the offensive player is user 2.
    # The current turn is user 2 (offensive), so we need to switch it to the defensive player.
    page.evaluate('() => { window.pinia.state.value.game.game.current_turn_user_id = 1; }')


    # Click the pitch button
    pitch_button = page.get_by_role("button", name="ROLL FOR PITCH")
    pitch_button.click()

    # Take a screenshot to show the result
    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as p:
    run(p)
