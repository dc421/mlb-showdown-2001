from playwright.sync_api import sync_playwright, expect
import time

def verify_roster_sort():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 1. Login
        print("Logging in...")
        page.goto("http://localhost:5173/login")

        # Register if needed, or login. Assuming we can register a new user easily or use a default one.
        # Let's try to register a fresh user to avoid conflicts
        timestamp = int(time.time())
        username = f"user_{timestamp}"
        email = f"user_{timestamp}@example.com"
        password = "password123"

        # The link text is "Sign Up" based on LoginView.vue
        page.click("a[href='/register']")

        # Register view fields:
        # Email, Password, Owner First Name, Owner Last Name, Select Your Team
        page.fill("input#email", email)
        page.fill("input#password", password)
        page.fill("input#owner_first_name", f"First_{timestamp}")
        page.fill("input#owner_last_name", f"Last_{timestamp}")

        # Wait for team select to populate
        # It calls authStore.fetchAvailableTeams() on mount.
        # We need to select the first available team.
        page.wait_for_selector("select#team_id option:not([disabled])")

        # Select second option (first is disabled)
        page.select_option("select#team_id", index=1)

        page.click("button:has-text('Create Account & Claim Team')")

        # Wait for navigation to dashboard
        expect(page).to_have_url("http://localhost:5173/dashboard")
        print("Logged in successfully.")

        # 2. Go to Roster Builder
        print("Navigating to Roster Builder...")
        page.goto("http://localhost:5173/roster-builder?type=classic")

        # 3. Add players
        print("Adding players...")

        # Filter by SP
        page.select_option("select[title='Filter by Position']", "SP")
        time.sleep(1) # Wait for filter

        # Add 3 SPs
        sp_rows = page.locator(".available-players-section .player-row").all()
        print(f"Found {len(sp_rows)} SPs")

        added_sps = []
        for i in range(min(3, len(sp_rows))):
            row = page.locator(".available-players-section .player-row").nth(0)
            text = row.inner_text()

            # Parsing points from ".player-actions .points-label" -> "600 pts"
            points_el = row.locator(".points-label")
            points_str = points_el.inner_text().replace(" pts", "")
            points = int(points_str)

            # Parsing name from ".player-info .player-name" -> "Name (SP)"
            name_el = row.locator(".player-name")
            name_full = name_el.inner_text() # "Name (SP)"
            name = name_full.split(" (")[0]

            print(f"Adding SP: {name} ({points})")
            added_sps.append({"name": name, "points": points})

            row.locator(".add-btn").click()
            time.sleep(0.5)

        # Filter by RP
        page.select_option("select[title='Filter by Position']", "RP")
        time.sleep(1)

        # Add 3 RPs
        rp_rows = page.locator(".available-players-section .player-row").all()
        added_rps = []
        for i in range(min(3, len(rp_rows))):
            row = page.locator(".available-players-section .player-row").nth(0)

            points_el = row.locator(".points-label")
            points_str = points_el.inner_text().replace(" pts", "")
            points = int(points_str)

            name_el = row.locator(".player-name")
            name_full = name_el.inner_text()
            name = name_full.split(" (")[0]

            print(f"Adding RP: {name} ({points})")
            added_rps.append({"name": name, "points": points})

            row.locator(".add-btn").click()
            time.sleep(0.5)

        # Add Bench players (Position players)
        # Filter by C (Catcher) to get some bench players
        page.select_option("select[title='Filter by Position']", "C")
        time.sleep(1)

        # We need to fill the lineup spot first if we want them on bench, OR just hope addPlayer logic handles it.
        # addPlayer logic:
        # if lineup[pos] is empty, fill it. Else bench.
        # So we need to add more players than lineup spots for that position.
        # But wait, logic iterates preferred order: 'C', 'SS', '2B', '3B', 'CF', 'LF', 'RF', '1B', 'DH'
        # If I add a Catcher, it goes to C. If I add another Catcher, C is taken, does it replace?
        # No: "if (!roster.value.lineup[pos] && ...) ... placed=true; break;"
        # If !placed -> bench.push(player).
        # So adding 2 Catchers will put 1 in C, 1 in Bench.

        c_rows = page.locator(".available-players-section .player-row").all()
        added_bench = []
        # Add 3 Catchers
        for i in range(min(3, len(c_rows))):
             row = page.locator(".available-players-section .player-row").nth(0)

             points_el = row.locator(".points-label")
             points_str = points_el.inner_text().replace(" pts", "")
             points = int(points_str)

             name_el = row.locator(".player-name")
             name_full = name_el.inner_text()
             name = name_full.split(" (")[0]

             print(f"Adding C: {name} ({points})")
             # First one goes to lineup, others to bench.
             # We can check assignment later.

             row.locator(".add-btn").click()
             time.sleep(0.5)

        # 4. Verify Order
        print("Verifying order...")

        # Verify SPs (First .bench-area in .staff-area)
        # We need to be careful about selector.
        # .staff-area > strong:text('Starting Pitchers') + .bench-area
        # But CSS sibling combinators in playwright?
        # Better: .staff-area .bench-area (nth=0 is SP, nth=1 is RP)

        sp_container = page.locator(".staff-area .bench-area").nth(0)
        sp_rows_roster = sp_container.locator(".player-row").all()

        print(f"Roster SP count: {len(sp_rows_roster)}")

        current_points = 10000
        for row in sp_rows_roster:
             points_el = row.locator(".points-label")
             points = int(points_el.inner_text().replace(" pts", ""))
             print(f"SP Roster Point: {points}")
             if points > current_points:
                 print(f"FAILURE: SPs not sorted descending! {points} > {current_points}")
                 raise Exception("SPs not sorted descending")
             current_points = points

        # Verify RPs (Second .bench-area in .staff-area)
        rp_container = page.locator(".staff-area .bench-area").nth(1)
        rp_rows_roster = rp_container.locator(".player-row").all()

        print(f"Roster RP count: {len(rp_rows_roster)}")

        current_points = 10000
        for row in rp_rows_roster:
             points_el = row.locator(".points-label")
             points = int(points_el.inner_text().replace(" pts", ""))
             print(f"RP Roster Point: {points}")
             if points > current_points:
                 print(f"FAILURE: RPs not sorted descending! {points} > {current_points}")
                 raise Exception("RPs not sorted descending")
             current_points = points

        # Verify Bench (Third .bench-area in .staff-area)
        bench_container = page.locator(".staff-area .bench-area").nth(2)
        bench_rows_roster = bench_container.locator(".player-row").all()

        print(f"Roster Bench count: {len(bench_rows_roster)}")
        # Should be at least 2 if we added 3 Catchers (1 in lineup)

        current_points = 10000
        for row in bench_rows_roster:
             points_el = row.locator(".points-label")
             points = int(points_el.inner_text().replace(" pts", ""))
             print(f"Bench Roster Point: {points}")
             if points > current_points:
                 print(f"FAILURE: Bench not sorted descending! {points} > {current_points}")
                 raise Exception("Bench not sorted descending")
             current_points = points

        # Screenshot
        page.screenshot(path="/home/jules/verification/roster_sort.png")
        print("Verification successful!")

        browser.close()

if __name__ == "__main__":
    verify_roster_sort()
