import re
from playwright.sync_api import sync_playwright, Page, expect

def verify_images(page: Page):
    # Listen for console messages
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))

    # Mock the API response
    page.route(
        re.compile(r"/api/games/(\d+)"),
        lambda route, request: route.fulfill(
            status=200,
            json={
                "game": {
                    "game_id": 1, "status": "in_progress", "home_team_user_id": 2, "away_team_user_id": 1,
                    "current_turn_user_id": 1
                },
                "series": {"series_type": "exhibition", "home_wins": 0, "away_wins": 0, "series_home_user_id": 2},
                "gameState": {
                    "state_data": {
                        "inning": 1, "isTopInning": True, "awayScore": 0, "homeScore": 0, "outs": 0,
                        "bases": {"first": None, "second": None, "third": None},
                        "currentAtBat": {
                            "batter": {
                                "card_id": 1, "name": "Regular Player", "image_url": "/images/1.jpg", "display_name": "Regular Player", "fielding_ratings": {}, "chart_data": {}
                            },
                            "pitcher": {
                                "card_id": -2, "name": "Replacement Pitcher", "image_url": "/images/replacement.jpg", "display_name": "Replacement Pitcher", "control": 0, "ip": 1, "fielding_ratings": {}, "chart_data": {}
                            }
                        },
                        "homeTeam": {"userId": 2, "battingOrderPosition": 0, "used_player_ids": []},
                        "awayTeam": {"userId": 1, "battingOrderPosition": 0, "used_player_ids": []},
                        "homeDefensiveRatings": {}, "awayDefensiveRatings": {}, "pitcherStats": {}, "used_player_ids": []
                    }
                },
                "gameEvents": [],
                "lineups": {
                    "home": {"battingOrder": [], "startingPitcher": {}},
                    "away": {"battingOrder": [], "startingPitcher": {}}
                },
                 "rosters": {"home": [], "away": []},
                 "teams": {
                    "home": {"team_id": 2, "city": "Home", "name": "Team", "logo_url": ""},
                    "away": {"team_id": 1, "city": "Away", "name": "Team", "logo_url": ""}
                 }
            }
        )
    )

    try:
        # Navigate to the game page
        page.goto("http://localhost:5173/game/1")

        # Expect the regular player's image to be visible
        regular_player_image = page.locator('img[alt="Regular Player"]')
        expect(regular_player_image).to_be_visible()
        expect(regular_player_image).to_have_attribute("src", "/images/1.jpg")

        # Expect the replacement pitcher's image to be visible
        replacement_pitcher_image = page.locator('img[alt="Replacement Pitcher"]')
        expect(replacement_pitcher_image).to_be_visible()
        expect(replacement_pitcher_image).to_have_attribute("src", "/images/replacement.jpg")

        # Take a screenshot for visual confirmation
        page.screenshot(path="jules-scratch/verification/verification.png", animations="disabled")
    except Exception as e:
        page.screenshot(path="jules-scratch/verification/error.png", animations="disabled")
        raise e

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        # Use add_init_script to set up the store before the page loads
        context.add_init_script("""
            window.localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidGVzdEB0ZXN0LmNvbSIsIm93bmVyIjoiVGVzdCBVc2VyIiwidGVhbSI6eyJ0ZWFtX2lkIjoxfSwiaWF0IjoxNjE2MjYyMjIyfQ.C_G9-9m3aJ4a-5j4Z-X_j9a-3j4Z-X_j9a-3j4Z-X_j');
            window.localStorage.setItem('user', '{"userId":1,"email":"test@test.com","owner":"Test User","team":{"team_id":1}}');
        """)
        page = context.new_page()
        verify_images(page)
        browser.close()

if __name__ == "__main__":
    main()