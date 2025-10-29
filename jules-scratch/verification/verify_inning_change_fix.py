
import json
from playwright.sync_api import sync_playwright, Page, expect
import sys

def run_verification(page: Page):
    """
    This script verifies that both the game log and the linescore correctly
    display the state of the PREVIOUS inning when the game is awaiting a
    pitcher substitution.
    """
    # 1. Set up authentication in localStorage.
    page.context.add_init_script("""
        localStorage.setItem('token', 'test-token');
        localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'test-user' }));
    """)

    # 2. Mock API response for a game state awaiting a pitcher for the Top of the 2nd.
    # The server has already advanced the inning to 2. The frontend must roll this back.
    mock_game_data = {
        "game": {"id": 1, "home_team_user_id": 2, "away_team_user_id": 1, "status": "in_progress"},
        "series": {"series_type": "exhibition"},
        "gameState": {
            "state_data": {
                "inning": 2, # Server state is already in the next inning
                "isTopInning": True,
                "outs": 0,
                "homeScore": 1,
                "awayScore": 0,
                "bases": {"first": None, "second": None, "third": None},
                "isBetweenHalfInningsAway": False, # Flags are reset for the new inning
                "isBetweenHalfInningsHome": True,
                "awaiting_lineup_change": True, # This triggers the "Awaiting Pitcher" UI
                "currentAwayPitcher": None, # Null pitcher forces substitution for the away team
                "currentHomePitcher": {"card_id": 101, "name": "Fake Pitcher", "display_name": "Fake Pitcher", "image_url": ""},
                "homeDefensiveRatings": {"catcherArm": 0, "infieldDefense": 0, "outfieldDefense": 0},
                "awayDefensiveRatings": {"catcherArm": 0, "infieldDefense": 0, "outfieldDefense": 0},
                "homeTeam": {"userId": 2, "battingOrderPosition": 3, "used_player_ids": []},
                "awayTeam": {"userId": 1, "battingOrderPosition": 0, "used_player_ids": []},
                "lastCompletedAtBat": {
                    "batter": {"card_id": 99, "name": "Last Batter", "display_name": "Last Batter", "image_url": ""},
                    "pitcher": {"card_id": 101, "name": "Fake Pitcher", "display_name": "Fake Pitcher", "image_url": ""},
                    "outsBeforePlay": 2, "basesBeforePlay": {}, "homeScoreBeforePlay": 0, "awayScoreBeforePlay": 0
                },
                "currentAtBat": { # The new at-bat for the 2nd inning
                    "batter": {"card_id": 200, "name": "New Batter", "display_name": "New Batter", "image_url": ""},
                    "pitcher": None,
                    "outsBeforePlay": 0, "basesBeforePlay": {}, "homeScoreBeforePlay": 1, "awayScoreBeforePlay": 0
                }
            }
        },
        "gameEvents": [
            {"event_type": "game_event", "log_message": "A single scores a run. (Score: 1-0)"},
            {"event_type": "game_event", "log_message": "Final player strikes out. <strong>Outs: 3</strong>"}
        ],
        "teams": {"away": {"abbreviation": "AWAY"}, "home": {"abbreviation": "HOME"}},
        "batter": {"card_id": 200, "name": "New Batter", "display_name": "New Batter", "image_url": ""},
        "pitcher": None,
        "lineups": {
            "home": {"battingOrder": [{"player": {"card_id": i, "image_url": ""}, "position": "P"} for i in range(9)]},
            "away": {"battingOrder": [{"player": {"card_id": i + 9, "image_url": ""}, "position": "DH"} for i in range(9)]}
        },
        "rosters": {"home": [], "away": []},
    }

    # 3. Intercept the API call.
    page.route("**/api/games/1", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps(mock_game_data)
    ))

    # 4. Navigate to the game page.
    page.goto("http://localhost:5176/game/1", wait_until="domcontentloaded")

    try:
        # 5. VERIFY GAME LOG: Assert the final out of the 1st inning is visible.
        game_log = page.locator(".game-log")
        game_log.wait_for(state="attached", timeout=10000)
        final_out_event = game_log.locator("div").last
        expect(final_out_event).to_contain_text("Outs: 3")

        # 6. VERIFY LINESCORE: Assert the linescore still highlights the 1st inning.
        first_inning_header = page.locator(".linescore-table thead th").nth(1)
        expect(first_inning_header).to_have_class("current-inning")

        second_inning_header = page.locator(".linescore-table thead th").nth(2)
        expect(second_inning_header).not_to_have_class("current-inning")

        # 7. Take a screenshot for visual verification.
        page.screenshot(path="jules-scratch/verification/verification.png")
        print("Verification screenshot captured successfully.")

    except Exception as e:
        page.screenshot(path="jules-scratch/verification/error.png")
        print(f"An error occurred during verification: {e}")
        sys.exit(1)

# Main execution block
if __name__ == "__main__":
    with sync_playwright() as p:
        # Re-create the verification directory in case it was deleted
        import os
        os.makedirs("jules-scratch/verification", exist_ok=True)

        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            run_verification(page)
            print("Verification script executed successfully.")
        finally:
            browser.close()
