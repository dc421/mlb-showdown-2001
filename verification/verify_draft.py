from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Define mock data
    draft_state = {
        "season_name": "Season 2025",
        "current_round": 0,
        "current_pick_number": 1,
        "active_team_id": None,
        "history": [],
        "takenPlayerIds": [],
        "is_active": False,
        "isSeasonOver": True
    }

    # Mock API routes
    page.route("**/api/draft/state*", lambda route: route.fulfill(json=draft_state))
    page.route("**/api/draft/seasons", lambda route: route.fulfill(json=["Season 2025", "Season 2024"]))
    page.route("**/api/point-sets", lambda route: route.fulfill(json=[{"point_set_id": 1, "name": "Upcoming Season"}]))
    page.route("**/api/cards/player*", lambda route: route.fulfill(json=[])) # Mock empty player list for now

    # Mock Auth and Point Sets (needed for onMounted)
    page.add_init_script("""
        localStorage.setItem('user', JSON.stringify({ userId: 1, username: 'TestUser', team: { team_id: 1, name: 'Test Team', city: 'Test City', logo_url: 'http://example.com/logo.png', primary_color: '#000000', secondary_color: '#ffffff' } }));
        localStorage.setItem('token', 'fake-token');
    """)

    try:
        page.goto("http://localhost:5173/draft")
        page.wait_for_selector(".draft-container")

        # Take screenshot
        page.screenshot(path="verification/draft_view.png")
        print("Screenshot saved to verification/draft_view.png")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
