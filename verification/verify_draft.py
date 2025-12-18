from playwright.sync_api import sync_playwright

def verify_draft_page():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use localstorage to simulate login
        context = browser.new_context(
            storage_state={
                "origins": [
                    {
                        "origin": "http://localhost:5173",
                        "localStorage": [
                            {"name": "token", "value": "fake-token"},
                            {"name": "user", "value": '{"userId": 1, "username": "testuser", "team": {"team_id": 1, "name": "My Team"}}'}
                        ]
                    }
                ]
            }
        )
        page = context.new_page()

        # Mocks
        page.route("**/api/auth/verify", lambda route: route.fulfill(status=200, body='{"user": {"userId": 1, "username": "testuser"}}'))
        page.route("**/api/draft/seasons", lambda route: route.fulfill(status=200, body='["Season 2024", "Season 2023"]'))

        # Mock draft state with history having null action
        draft_state = {
            "season_name": "Season 2024",
            "is_active": False,
            "current_round": 6,
            "history": [
                {
                    "id": 1,
                    "timestamp": "2024-10-10T10:00:00Z",
                    "team_name": "Test Team",
                    "action": None, # This should not crash the page now
                    "player_name": "Test Player",
                    "round": "Round 1"
                },
                 {
                    "id": 2,
                    "timestamp": "2024-10-10T10:05:00Z",
                    "team_name": "Test Team 2",
                    "action": "ADDED",
                    "player_name": "Test Player 2",
                    "round": "Round 1"
                }
            ],
             "isSeasonOver": False
        }

        page.route("**/api/draft/state*", lambda route: route.fulfill(status=200, body=str(draft_state).replace("'", '"').replace("False", "false").replace("True", "true").replace("None", "null")))
        page.route("**/api/teams/my-roster", lambda route: route.fulfill(status=200, body='{"roster": []}'))
        page.route("**/api/league/point-sets", lambda route: route.fulfill(status=200, body='[]'))


        # Navigate
        try:
            page.goto("http://localhost:5173/draft")
            page.wait_for_selector(".history-section")
            page.screenshot(path="verification/draft_verification.png")
            print("Screenshot taken")
        except Exception as e:
            print(f"Error: {e}")
            # print page content
            print(page.content())
        finally:
            browser.close()

if __name__ == "__main__":
    verify_draft_page()
