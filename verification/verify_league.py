from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Enable logging
    page.on("console", lambda msg: print(f"Console: {msg.text}"))
    page.on("pageerror", lambda err: print(f"Page Error: {err}"))
    page.on("request", lambda req: print(f"Request: {req.url}"))

    # Set Auth Token
    page.add_init_script("""
        localStorage.setItem('token', 'fake-token');
        localStorage.setItem('user', JSON.stringify({id: 1, name: 'Jules', role: 'admin'}));
    """)

    # Mock API calls
    page.route("**/api/league/seasons", lambda route: route.fulfill(
        status=200, body='["Fall 2025", "Spring 2025"]', headers={"content-type": "application/json"}
    ))

    all_time_summary = {
        "standings": [{"team_id": 1, "name": "Boston", "wins": 100, "losses": 50, "winPctDisplay": ".667", "avgFinish": "2.5", "spaceships": 2, "spoons": 0, "spaceshipAppearances": 3, "spoonAppearances": 0, "logo_url": "https://placehold.co/40x40"}],
        "recentResults": []
    }
    fall_summary = {
         "standings": [{"team_id": 1, "name": "Boston", "wins": 10, "losses": 5, "winPctDisplay": ".667", "logo_url": "https://placehold.co/40x40"}],
        "recentResults": [{"id": 1, "round": "Golden Spaceship", "winner": "Boston", "score": "4-1", "loser": "NY", "winner_name": "Boston", "loser_name": "New York"}]
    }

    def handle_summary(route):
        if "all-time" in route.request.url: route.fulfill(json=all_time_summary)
        else: route.fulfill(json=fall_summary)

    page.route("**/api/league/season-summary*", handle_summary)

    roster_data = [
        {"team_id": 1, "full_display_name": "Boston", "logo_url": "https://placehold.co/40x40", "owner": "Jules", "roster": [{"card_id": "1", "name": "Very Long Player Name Test", "displayName": "Very Long Player Name Test", "position": "SP", "displayPosition": "SP", "assignment": "PITCHING_STAFF", "points": 100, "ip": "200"}]},
        {"team_id": 2, "full_display_name": "New York", "logo_url": "https://placehold.co/40x40", "owner": "User2", "roster": [{"card_id": "2", "name": "Other SP", "displayName": "Other SP", "position": "SP", "displayPosition": "SP", "assignment": "PITCHING_STAFF", "points": 90, "ip": "180"}]}
    ]

    def handle_league(route):
        if "all-time" in route.request.url: route.fulfill(json=[])
        else: route.fulfill(json=roster_data)

    page.route("**/api/league?**", handle_league)
    page.route("**/api/league/matrix**", lambda route: route.fulfill(json=[]))
    page.route("**/api/point-sets", lambda route: route.fulfill(json=[{"point_set_id": 1, "name": "Standard"}]))
    page.route("**/api/games", lambda route: route.fulfill(json=[])) # Dashboard fetches games
    page.route("**/api/games/open", lambda route: route.fulfill(json=[]))

    # Start Test
    print("Navigating to Home...")
    page.goto("http://localhost:5173/")

    # Wait for navigation
    page.wait_for_timeout(1000)
    print(f"Current URL: {page.url}")

    print("Navigating to League page...")
    page.goto("http://localhost:5173/league")

    # Wait for loading to vanish
    expect(page.locator(".loading")).not_to_be_visible()

    # 1. Check Postseason Header
    try:
        expect(page.locator("h3", has_text="POSTSEASON")).to_be_visible()
    except Exception as e:
        page.screenshot(path="verification/failed_postseason.png")
        print("Failed to find POSTSEASON header. Screenshot saved.")
        raise e

    # 2. Check Long Name Shrink
    page.wait_for_selector(".roster-table")
    long_name = page.locator(".name-cell", has_text="Very Long Player Name Test")
    classes = long_name.get_attribute("class")
    if "text-shrink" not in classes: print(f"FAILED: text-shrink class missing. Found: {classes}")
    else: print("PASSED: text-shrink class present.")

    # 3. Hover Highlighting
    long_name.hover()
    team2_sp = page.locator(".team-block").nth(1).locator(".player-row").first
    page.wait_for_timeout(500)
    t2_classes = team2_sp.get_attribute("class")
    if "highlight-slot" not in t2_classes: print(f"FAILED: highlight-slot missing on Team 2. Found: {t2_classes}")
    else: print("PASSED: highlight-slot present on Team 2.")

    # 4. Check All-Time Columns
    page.select_option("select", "all-time")
    page.wait_for_timeout(1000)
    expect(page.locator("th", has_text="Avg Fin")).to_be_visible()
    expect(page.locator(".roster-table")).not_to_be_visible()

    page.screenshot(path="verification/verification.png")
    browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
