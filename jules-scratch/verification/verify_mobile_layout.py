import json
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    # --- DUMMY AUTH DATA ---
    # This mimics the data stored in localStorage by the real auth store
    user = {
        "userId": 1,
        "email": "jules@test.com",
        "team": {
            "team_id": 1,
            "abbreviation": "BOS",
            "logo_url": "/images/logos/red_sox.png"
        }
    }
    # The token doesn't have to be valid, it just needs to exist
    token = "dummy-token"

    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()

    # --- SET UP AUTH BEFORE NAVIGATION ---
    # Go to the base URL to establish a context for localStorage
    page = context.new_page()
    page.goto("http://localhost:5173/")

    # Set the localStorage items for the correct origin
    page.evaluate(f"""
        localStorage.setItem('token', '{token}');
        localStorage.setItem('user', '{json.dumps(user)}');
    """)

    # --- NAVIGATE TO THE DEV TOOL ---
    # Now navigate to the dev tool page for an existing game
    # The auth state is already set, so we should bypass the login
    page.goto("http://localhost:5173/dev-tool/1")

    # --- SET UP GAME STATE ---
    # Click buttons to get the game into a playable state
    # Use locators that are robust (e.g., get_by_role)
    reset_button = page.get_by_role("button", name="Reset Game")
    start_button = page.get_by_role("button", name="Start Game")

    # Wait for the buttons to be ready and click them
    expect(reset_button).to_be_enabled()
    reset_button.click()
    expect(start_button).to_be_enabled()
    start_button.click()

    # --- NAVIGATE TO THE GAME AND TAKE SCREENSHOT ---
    # Now that the game is set up, go to the actual game view
    page.goto("http://localhost:5173/game/1")

    # Set viewport to a typical mobile size to test the responsive layout
    page.set_viewport_size({"width": 375, "height": 812})

    # Wait for a key element to be visible to ensure the page has loaded
    # The baseball diamond is a good indicator
    expect(page.locator('.baseball-diamond')).to_be_visible()

    # Take a screenshot for visual verification
    page.screenshot(path="jules-scratch/verification/mobile_layout_fix.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)