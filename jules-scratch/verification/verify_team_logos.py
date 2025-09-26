import re
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # 1. Register a new user
        page.goto("http://localhost:5173/register")
        page.get_by_label("Email").fill("testuser@example.com")
        page.get_by_label("Password").fill("password123")
        page.get_by_label("Owner First Name").fill("Test")
        page.get_by_label("Owner Last Name").fill("User")

        # Wait for the team options to load
        expect(page.get_by_role("option", name="Atlanta Braves")).to_be_visible()

        page.get_by_label("Select Your Team").select_option(label="Atlanta Braves")
        page.get_by_role("button", name="Create Account & Claim Team").click()

        # Wait for registration to complete and redirect to login
        expect(page).to_have_url(re.compile(".*login"))

        # 2. Log in
        page.get_by_label("Email").fill("testuser@example.com")
        page.get_by_label("Password").fill("password123")
        page.get_by_role("button", name="Login").click()

        # Wait for login to complete and redirect to dashboard
        expect(page).to_have_url(re.compile(".*dashboard"))

        # 3. Create a Roster
        page.get_by_role("button", name="Create Your Roster").click()
        expect(page).to_have_url(re.compile(".*roster-builder"))

        # Add 20 players to the roster
        for i in range(20):
            page.get_by_role("button", name="Add to Roster").first.click()

        page.get_by_role("button", name="Save Roster").click()

        # Wait for roster to save and redirect to dashboard
        expect(page).to_have_url(re.compile(".*dashboard"))

        # 4. Create a Game
        page.get_by_role("button", name="+ Create New Game").click()

        # Wait for the game to be created and the setup page to load
        expect(page).to_have_url(re.compile(".*\/game\/.*\/setup"))

        # 5. Setup the game
        # It needs a second player to join, so I'll just navigate to the dev tool to setup the game state.
        game_id_match = re.search(r"\/game\/(\d+)\/setup", page.url)
        if not game_id_match:
            raise Exception("Could not get game ID from URL")
        game_id = game_id_match.group(1)

        page.goto(f"http://localhost:5173/dev-tool/{game_id}")
        page.get_by_role("button", name="Set Game State").click()

        # 6. Navigate to Game View and take screenshot
        page.goto(f"http://localhost:5173/game/{game_id}")

        # Wait for player cards to be visible
        expect(page.locator(".player-card-container").first).to_be_visible()
        expect(page.locator(".player-card-container").last).to_be_visible()

        page.screenshot(path="jules-scratch/verification/verification.png")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)