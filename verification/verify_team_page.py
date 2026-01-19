from playwright.sync_api import sync_playwright, Route
import json

def verify_team_page():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Mock API Response for Team History
        def handle_history(route: Route):
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "team": {
                        "team_id": 1,
                        "city": "Test City",
                        "name": "Test Team",
                        "primary_color": "#000000",
                        "secondary_color": "#ffffff",
                        "logo_url": "https://via.placeholder.com/150",
                        "owner_first_name": "Test",
                        "owner_last_name": "Owner"
                    },
                    "identityHistory": [
                        { "name": "Old Identity", "start": "Season 1", "end": "Season 2" },
                        { "name": "Test City Test Team", "start": "Season 3", "end": "Season 3" }
                    ],
                    "accolades": { "spaceships": [], "spoons": [], "submarines": [] },
                    "history": [],
                    "rosters": [
                        {
                            "season": "Season 3",
                            "players": [
                                { "card_id": 1, "displayName": "Ace Pitcher", "position": "SP", "points": 500, "ip": 7, "control": 10 },
                                { "card_id": 2, "displayName": "Setup Man", "position": "RP", "points": 300, "ip": 2, "control": 8 },
                                { "card_id": 3, "displayName": "Closer", "position": "RP", "points": 400, "ip": 1, "control": 9 },
                                { "card_id": 4, "displayName": "Mop Up", "position": "RP", "points": 100, "ip": 1, "control": 5 },
                                { "card_id": 5, "displayName": "Slugger", "position": "1B", "points": 600, "ip": 0, "control": None }
                            ]
                        }
                    ]
                })
            )

        page.route("**/api/teams/1/history", handle_history)

        # 2. Inject Auth Token (Simulate Login)
        page.add_init_script("""
            localStorage.setItem('token', 'fake-token');
            localStorage.setItem('user', JSON.stringify({ userId: 1, team: { team_id: 1 } }));
        """)

        # 3. Navigate to Team Page
        # Assuming frontend is running on 5173
        page.goto("http://localhost:5173/teams/1")

        # 4. Wait for content
        page.wait_for_selector(".identity-history")
        page.wait_for_selector(".matrix-table")

        # 5. Screenshot
        page.screenshot(path="verification/verification.png", full_page=True)
        browser.close()

if __name__ == "__main__":
    verify_team_page()
