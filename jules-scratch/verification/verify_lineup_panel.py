from playwright.sync_api import sync_playwright, expect
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Use a unique email for registration
    unique_email = f"testuser_{int(time.time())}@example.com"

    # Register a new user
    page.goto("http://localhost:5173/register")
    page.get_by_label("Email").fill(unique_email)
    page.get_by_label("Password").fill("password")
    page.get_by_label("Owner First Name").fill("Test")
    page.get_by_label("Owner Last Name").fill("User")

    # Select the first available team
    team_select = page.get_by_label("Select Your Team")
    # Wait for the options to be populated by the API call by checking the second option
    expect(team_select.locator("option").nth(1)).to_be_enabled(timeout=10000)
    team_select.select_option(index=1)

    page.get_by_role("button", name="Create Account & Claim Team").click()

    # Wait for navigation to the dashboard
    expect(page).to_have_url("http://localhost:5173/dashboard", timeout=10000)

    # Create a roster
    page.get_by_role("button", name="Create Your Roster").click()
    expect(page).to_have_url("http://localhost:5173/roster-builder", timeout=10000)
    page.get_by_role("button", name="Save Roster").click()

    # Wait for navigation back to the dashboard
    expect(page).to_have_url("http://localhost:5173/dashboard", timeout=10000)

    # Create a new game
    page.get_by_role("button", name="+ Create New Game").click()

    # Wait for navigation to the game setup page and get the game ID
    expect(page).to_have_url(lambda url: "/game/" in url and "/setup" in url, timeout=10000)
    game_id = page.url.split("/")[4]

    # Use dev tool to set up game state
    page.goto(f"http://localhost:5173/dev-tool/{game_id}")
    page.get_by_role("button", name="Set Game State").click()

    # Navigate to the game view
    page.goto(f"http://localhost:5173/game/{game_id}")

    # Wait for the lineup panel to be visible
    lineup_panel = page.locator(".lineup-panel").first
    expect(lineup_panel).to_be_visible(timeout=10000)

    # Activate substitution mode
    sub_toggle_button = page.locator(".lineup-header .sub-icon").first
    expect(sub_toggle_button).to_be_visible()
    sub_toggle_button.click()

    # Take a screenshot with substitution mode active
    page.screenshot(path="jules-scratch/verification/lineup_sub_mode_active.png")

    # Deactivate substitution mode
    sub_toggle_button.click()

    # Take a screenshot with substitution mode inactive
    page.screenshot(path="jules-scratch/verification/lineup_sub_mode_inactive.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)