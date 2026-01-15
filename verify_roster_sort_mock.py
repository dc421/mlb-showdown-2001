from playwright.sync_api import sync_playwright, expect
import time

def verify_roster_sort():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Mock API responses
        # 1. Mock Login/Auth
        page.route("**/api/auth/me", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"user_id": 1, "username": "testuser", "team": {"team_id": 1, "name": "Test Team"}, "permissions": []}'
        ))

        # Mock Login endpoint
        page.route("**/api/login", lambda route: route.fulfill(
             status=200,
             content_type="application/json",
             body='{"token": "fake.eyJ1c2VyX2lkIjoxLCJ1c2VybmFtZSI6InRlc3R1c2VyIiwidGVhbSI6eyJ0ZWFtX2lkIjoxLCJuYW1lIjoiVGVzdCBUZWFtIn19.fake"}'
        ))

        # 2. Mock Point Sets
        page.route("**/api/point-sets", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='[{"point_set_id": 1, "name": "Original Pts"}]'
        ))

        # 3. Mock Players
        players = []
        # SPs
        players.append({"card_id": "sp1", "name": "Ace Pitcher", "displayName": "Ace Pitcher (SP)", "displayPosition": "SP", "points": 600, "control": 5})
        players.append({"card_id": "sp2", "name": "Mid Pitcher", "displayName": "Mid Pitcher (SP)", "displayPosition": "SP", "points": 400, "control": 4})
        players.append({"card_id": "sp3", "name": "Low Pitcher", "displayName": "Low Pitcher (SP)", "displayPosition": "SP", "points": 200, "control": 3})
        # RPs
        players.append({"card_id": "rp1", "name": "Closer", "displayName": "Closer (RP)", "displayPosition": "RP", "points": 350, "control": 6})
        players.append({"card_id": "rp2", "name": "Setup", "displayName": "Setup (RP)", "displayPosition": "RP", "points": 250, "control": 5})
        players.append({"card_id": "rp3", "name": "Mopup", "displayName": "Mopup (RP)", "displayPosition": "RP", "points": 150, "control": 3})

        # Lineup Fillers
        # Use distinct names to avoid selector collision
        lineup_map = {
            "C": "Pos Catcher",
            "SS": "Pos Shortstop",
            "2B": "Pos SecondBase",
            "3B": "Pos ThirdBase",
            "CF": "Pos CenterField",
            "LF": "Pos LeftField",
            "RF": "Pos RightField",
            "1B": "Pos FirstBase",
            "DH": "Pos DesigHit"
        }

        for pos, name in lineup_map.items():
             players.append({
                 "card_id": f"lineup_{pos}",
                 "name": name,
                 "displayName": f"{name} ({pos})",
                 "displayPosition": pos,
                 "points": 10,
                 "control": None,
                 "fielding_ratings": {pos: 5}
             })

        # Bench Players (High points to distinguish)
        players.append({"card_id": "b1", "name": "Bench High", "displayName": "Bench High (C)", "displayPosition": "C", "points": 300, "control": None, "fielding_ratings": {"C": 5}})
        players.append({"card_id": "b2", "name": "Bench Low", "displayName": "Bench Low (C)", "displayPosition": "C", "points": 100, "control": None, "fielding_ratings": {"C": 4}})

        import json
        page.route("**/api/cards/player*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(players)
        ))

        # Mock Draft State
        page.route("**/api/draft/state", lambda route: route.fulfill(
             status=200,
             content_type="application/json",
             body='{"is_active": false}'
        ))

        # Mock Classic Eligibility
        page.route("**/api/classic/eligibility", lambda route: route.fulfill(
             status=200,
             content_type="application/json",
             body='{"ineligibleIds": []}'
        ))

        # Mock My Roster (Empty initially)
        page.route("**/api/my-roster*", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"cards": []}'
        ))

        # Perform Login
        print("Performing login...")
        page.goto("http://localhost:5173/login")
        page.fill("input#email", "test@example.com")
        page.fill("input#password", "password")
        page.click("button[type='submit']")

        # Wait for redirect to dashboard
        expect(page).to_have_url("http://localhost:5173/dashboard")
        print("Logged in.")

        # Go to Roster Builder
        print("Navigating to Roster Builder...")
        page.goto("http://localhost:5173/roster-builder?type=classic")

        # Wait for players to load
        page.wait_for_selector(".available-players-section .player-row")

        def add_by_name(name):
             print(f"Adding {name}...")
             locator = page.locator(f".available-players-section .player-row:has-text('{name}') .add-btn")
             if locator.count() == 0:
                 print(f"ERROR: Could not find {name} in available list")
                 return
             locator.click()
             page.locator(f".available-players-section .player-row:has-text('{name}')").wait_for(state="hidden", timeout=2000)
             print(f"Added {name}.")

        # Add SPs
        print("Adding SPs in mixed order...")
        page.select_option("select[title='Filter by Position']", "SP")
        time.sleep(1)
        add_by_name("Low Pitcher")
        add_by_name("Ace Pitcher")
        add_by_name("Mid Pitcher")

        # Add RPs
        page.select_option("select[title='Filter by Position']", "RP")
        time.sleep(1)
        print("Adding RPs in mixed order...")
        add_by_name("Mopup")
        add_by_name("Closer")
        add_by_name("Setup")

        # Fill Lineup
        print("Filling Lineup...")
        page.select_option("select[title='Filter by Position']", "ALL")
        time.sleep(1)
        page.fill("input.search-input", "Pos ")
        time.sleep(0.5)

        for pos, name in lineup_map.items():
             add_by_name(name)

        # Add Bench Players
        print("Adding Bench Players...")
        page.fill("input.search-input", "Bench")
        time.sleep(0.5)
        # Add Low first (100), then High (300) to verify sort
        add_by_name("Bench Low")
        add_by_name("Bench High")

        # Verify Roster Sort
        print("Verifying Roster Sort...")

        # SPs
        sp_container = page.locator(".staff-area .bench-area").nth(0)
        sp_points = [int(el.inner_text().replace(" pts", "")) for el in sp_container.locator(".points-label").all()]
        print(f"SP Points: {sp_points}")
        if sp_points != [600, 400, 200]:
             raise Exception(f"SPs not sorted! Expected [600, 400, 200], got {sp_points}")

        # RPs
        rp_container = page.locator(".staff-area .bench-area").nth(1)
        rp_points = [int(el.inner_text().replace(" pts", "")) for el in rp_container.locator(".points-label").all()]
        print(f"RP Points: {rp_points}")
        if rp_points != [350, 250, 150]:
             raise Exception(f"RPs not sorted! Expected [350, 250, 150], got {rp_points}")

        # Bench
        bench_container = page.locator(".staff-area .bench-area").nth(2)
        bench_points = [int(el.inner_text().replace(" pts", "")) for el in bench_container.locator(".points-label").all()]
        print(f"Bench Points: {bench_points}")
        if bench_points != [300, 100]:
             raise Exception(f"Bench not sorted! Expected [300, 100], got {bench_points}")

        page.screenshot(path="/home/jules/verification/roster_sort.png")
        print("Verification successful!")

        browser.close()

if __name__ == "__main__":
    verify_roster_sort()
