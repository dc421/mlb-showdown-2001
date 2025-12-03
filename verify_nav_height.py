import time
from playwright.sync_api import sync_playwright

def verify_nav_height():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800}) # Desktop size
        page = context.new_page()

        page.add_init_script("""
            localStorage.setItem('token', 'mock-token');
            localStorage.setItem('user', JSON.stringify({
                userId: 1,
                username: 'TestUser',
                team: { logo_url: 'http://example.com/logo.png' }
            }));
        """)

        # Mock API calls
        page.route("**/api/games", lambda route: route.fulfill(json=[]))
        page.route("**/api/games/open", lambda route: route.fulfill(json=[]))
        page.route("**/api/point-sets", lambda route: route.fulfill(json=[]))
        page.route("**/api/my-roster", lambda route: route.fulfill(json={}))
        # Mock team logos if they are requested
        page.route("**/*.png", lambda route: route.fulfill(status=404))

        # Test Game View
        page.route("**/api/games/1", lambda route: route.fulfill(json={
            "game": {
                "id": 1,
                "home_team_user_id": 1,
                "away_team_user_id": 2,
                "use_dh": True
            },
            "gameState": {
                "inning": 1,
                "outs": 0,
                "isTopInning": True,
                "score": { "home": 0, "away": 0 },
                "bases": [None, None, None],
                "currentAtBat": { "batter": { "id": 1 }, "pitcher": { "id": 2 } },
                "lastCompletedAtBat": None
            },
            "state_data": {
                 "inning": 1
            }
        }))

        page.route("**/api/games/1/logs", lambda route: route.fulfill(json=[
            {"log_message": "Play ball!", "created_at": "2023-01-01T00:00:00Z"},
            {"log_message": "Top of the 1st inning", "created_at": "2023-01-01T00:00:01Z"}
        ]))

        print("Navigating to game 1...")
        page.goto("http://localhost:5173/game/1")

        page.wait_for_timeout(2000)

        linescore_count = page.locator(".linescore-table").count()
        print(f"Linescore present: {linescore_count > 0}")

        if linescore_count > 0:
            linescore_height = page.evaluate("document.querySelector('.linescore-table').offsetHeight")
            print(f"Linescore Height: {linescore_height}px")

        initial_game_height = page.evaluate("document.querySelector('.global-nav').offsetHeight")
        print(f"Initial Game Nav Height: {initial_game_height}px")

        browser.close()

if __name__ == "__main__":
    verify_nav_height()
