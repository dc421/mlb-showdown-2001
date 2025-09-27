import re
import time
import os
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    # --- Setup ---
    browser = playwright.chromium.launch(headless=True)
    context1 = browser.new_context(storage_state="state1.json" if os.path.exists("state1.json") else None)
    context2 = browser.new_context(storage_state="state2.json" if os.path.exists("state2.json") else None)
    page1 = context1.new_page()
    page2 = context2.new_page()

    USER1_EMAIL = "user1@test.com"
    USER2_EMAIL = "user2@test.com"
    PASSWORD = "password123"
    BASE_URL = "http://localhost:5173"

    # --- Functions ---
    def register_and_login(page, email, password, team_name):
        print(f"Registering {email}...")
        page.goto(f"{BASE_URL}/register")
        page.get_by_label("Email").fill(email)
        page.get_by_label("Password").fill(password)
        page.get_by_label("First Name").fill("Test")
        page.get_by_label("Last Name").fill("User")
        page.get_by_label("Select Team").select_option(label=team_name)
        page.get_by_role("button", name="Register").click()
        time.sleep(1) # Wait for registration to process

        print(f"Logging in {email}...")
        page.goto(f"{BASE_URL}/login")
        page.get_by_label("Email").fill(email)
        page.get_by_label("Password").fill(password)
        page.get_by_role("button", name="Login").click()
        expect(page.get_by_role("heading", name="Your Games")).to_be_visible(timeout=10000)

    def create_roster(page):
        print("Creating roster...")
        page.goto(f"{BASE_URL}/roster")
        # Wait for cards to load
        expect(page.get_by_text("Albert Pujols")).to_be_visible(timeout=15000)
        # Select 20 players (just click the first 20)
        for i in range(20):
            page.locator(".player-card-grid > div").nth(i).click()
        page.get_by_role("button", name="Save Roster").click()
        expect(page.get_by_text("Roster saved successfully!")).to_be_visible()

    def set_lineup(page):
        print("Setting lineup...")
        # Wait for lineup screen to load
        expect(page.get_by_role("heading", name="Set Your Lineup")).to_be_visible(timeout=15000)

        # Drag and drop players to form a basic lineup
        bench_players = page.locator('.bench-list .player-card-item')
        lineup_slots = page.locator('.lineup-card .player-slot')

        # Assign first 8 players from bench to batting order
        for i in range(9):
             # Check if player is already assigned
            if page.locator(f'[data-testid="lineup-slot-{i+1}"] .player-name').is_visible():
                continue
            bench_players.first.drag_to(lineup_slots.nth(i))

        # Assign a starting pitcher
        pitcher_slot = page.locator('.pitcher-slot')
        bench_pitchers = page.locator('.bench-list .player-card-item', has_text="SP")
        bench_pitchers.first.drag_to(pitcher_slot)

        page.get_by_role("button", name="Save Lineup").click()
        expect(page.get_by_text("Lineup saved successfully.")).to_be_visible()

    # --- Main Script ---
    try:
        # Step 1: Register and create rosters for both users
        register_and_login(page1, USER1_EMAIL, PASSWORD, "Arizona Diamondbacks")
        create_roster(page1)
        context1.storage_state(path="state1.json")

        register_and_login(page2, USER2_EMAIL, PASSWORD, "Atlanta Braves")
        create_roster(page2)
        context2.storage_state(path="state2.json")

        # Step 2: User 1 creates a game
        print("User 1 creating game...")
        page1.goto(f"{BASE_URL}/dashboard")
        page1.get_by_role("button", name="Create New Game").click()
        page1.get_by_label("Choose your roster").select_option(index=1)
        page1.get_by_text("Home").click()
        page1.get_by_text("AL").click()
        page1.get_by_role("button", name="Create Game").click()

        # Extract game ID from URL
        expect(page1).to_have_url(re.compile(r"/game/setup/\d+"))
        game_id = page1.url.split("/")[-1]
        print(f"Game created with ID: {game_id}")

        # Step 3: User 2 joins the game
        print("User 2 joining game...")
        page2.goto(f"{BASE_URL}/dashboard")
        page2.get_by_role("button", name=re.compile("Join Game vs.*")).click()
        page2.get_by_label("Choose your roster").select_option(index=1)
        page2.get_by_role("button", name="Join Game").click()
        expect(page2).to_have_url(re.compile(f"/game/setup/{game_id}"))

        # Step 4: User 1 sets up the game
        print("User 1 setting up game...")
        page1.get_by_role("button", name=re.compile("Roll for Choice")).click()
        time.sleep(1) # wait for roll
        page1.get_by_role("button", name=re.compile("Take Home Team")).click()
        time.sleep(1) # wait for choice
        page1.get_by_role("button", name="Confirm Settings & Start Game").click()

        # Step 5: Both users set lineups
        print("Navigating to set lineup...")
        page1.goto(f"{BASE_URL}/set-lineup/{game_id}")
        set_lineup(page1)

        page2.goto(f"{BASE_URL}/set-lineup/{game_id}")
        set_lineup(page2)

        # Step 6: Go to game and take screenshot
        print("Navigating to game view...")
        page1.goto(f"{BASE_URL}/game/{game_id}")
        expect(page1.get_by_text("Game Log")).to_be_visible(timeout=15000)

        # The inning header should be visible now
        inning_header = page1.locator(".inning-header").first
        expect(inning_header).to_be_visible()

        print("Taking screenshot...")
        page1.screenshot(path="jules-scratch/verification/verification.png")

    finally:
        # --- Teardown ---
        browser.close()

if __name__ == "__main__":
    with sync_playwright() as p:
        run(p)