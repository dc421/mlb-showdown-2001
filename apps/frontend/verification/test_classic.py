
import os
import json
from playwright.sync_api import sync_playwright, expect

# Constants
FRONTEND_URL = "http://localhost:3000"

def setup_mock_data(page):
    # Mock Classic List
    page.route("**/api/classic/list", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps([{ "id": 1, "name": "Classic 2024", "description": "The big one", "is_active": True }])
    ))

    # Mock Classic State (Wildcard to catch both initial load and specific ID load)
    page.route("**/api/classic/state*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({
            "classic": { "id": 1, "name": "Classic 2024", "description": "The big one", "is_active": True },
            "seeding": [
                { "user_id": 1, "name": "Team A", "city": "City A", "logo_url": "https://via.placeholder.com/50" },
                { "user_id": 2, "name": "Team B", "city": "City B", "logo_url": "https://via.placeholder.com/50" },
                { "user_id": 3, "name": "Team C", "city": "City C", "logo_url": "https://via.placeholder.com/50" },
                { "user_id": 4, "name": "Team D", "city": "City D", "logo_url": "https://via.placeholder.com/50" },
                { "user_id": 5, "name": "Team E", "city": "City E", "logo_url": "https://via.placeholder.com/50" }
            ],
            "series": [],
            "revealed": True,
            "readyCount": 5,
            "rosters": [
                {
                    "user_id": 1,
                    "team": "City A Team A",
                    "players": [
                        { "card_id": "c1", "display_name": "Player One", "assignment": "SP", "points": 500, "position": "SP", "ip": 200 },
                        { "card_id": "c2", "display_name": "Player Two", "assignment": "C", "points": 400, "position": "C" },
                    ]
                },
                {
                    "user_id": 2,
                    "team": "City B Team B",
                    "players": [
                         { "card_id": "c3", "display_name": "Player Three", "assignment": "LF", "points": 600, "position": "LF" }
                    ]
                }
            ]
        })
    ))

    # Mock User Auth (me endpoint)
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({ "userId": 1, "username": "User1", "team": { "id": 1, "name": "Team A" } })
    ))


def test_classic_roster_view():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        # Inject localStorage BEFORE navigation
        context.add_init_script("""
            localStorage.setItem('token', 'fake-token');
            localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'User1' }));
        """)

        page = context.new_page()

        setup_mock_data(page)

        # Navigate to Classic View
        print(f"Navigating to {FRONTEND_URL}/classic")
        page.goto(f"{FRONTEND_URL}/classic")

        # Wait for content
        try:
            expect(page.get_by_text("Showdown Classic")).to_be_visible(timeout=10000)
        except Exception as e:
            print(f"Header not found: {e}")
            page.screenshot(path="/home/jules/verification/debug_fail_header.png")
            raise e

        # Check if rosters are displayed in grid
        try:
            expect(page.get_by_text("City A Team A")).to_be_visible()
            expect(page.get_by_text("City B Team B")).to_be_visible()
        except Exception as e:
             print(f"Team names not found: {e}")
             page.screenshot(path="/home/jules/verification/debug_fail_teams.png")
             raise e

        # Check for specific player in roster table
        expect(page.get_by_text("Player One")).to_be_visible()

        # Check for Total Points row (Footer)
        expect(page.locator("td.total-label").first).to_have_text("Total")

        # Take screenshot
        os.makedirs("/home/jules/verification", exist_ok=True)
        page.screenshot(path="/home/jules/verification/classic_view.png", full_page=True)
        print("Screenshot saved to /home/jules/verification/classic_view.png")

        browser.close()

if __name__ == "__main__":
    test_classic_roster_view()
