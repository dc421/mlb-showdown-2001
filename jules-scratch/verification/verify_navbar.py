from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Set viewport to a mobile size
    page.set_viewport_size({"width": 375, "height": 812})

    # Go to registration page
    page.goto("http://localhost:5174/register")
    page.wait_for_load_state("networkidle")

    # Wait for the team options to be loaded
    page.wait_for_selector('select[id="team_id"] option[value="3"]')

    # Register a new user
    page.get_by_label("Email").fill("test@test.com")
    page.get_by_label("Password").fill("password")
    page.get_by_label("Owner First Name").fill("Test")
    page.get_by_label("Owner Last Name").fill("User")
    page.get_by_label("Select Your Team").select_option(label="New York Colossus")
    page.get_by_role("button", name="Create Account & Claim Team").click()

    # Wait for redirection to login page
    page.wait_for_url("**/login")

    # Login with the new user
    page.get_by_label("Email").fill("test@test.com")
    page.get_by_label("Password").fill("password")
    page.get_by_role("button", name="Login").click()
    page.wait_for_url("**/dashboard")

    # Go to game page
    print("Navigating to game page...")
    page.goto("http://localhost:5174/game/1")

    # Wait for the nav bar to be visible
    print("Waiting for global nav to be visible...")
    page.wait_for_selector(".global-nav")

    # Take a screenshot
    print("Taking screenshot...")
    page.screenshot(path="jules-scratch/verification/verification.png")
    print("Screenshot saved to jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
