import re
from playwright.sync_api import sync_playwright, Page, expect

def verify_layout(page: Page):
    """
    This script verifies the responsive layout changes for the game view.
    It registers a new user, logs in, navigates to the game page,
    and captures screenshots for both desktop and mobile viewports.
    """
    # 1. Navigate to the registration page
    page.goto("http://localhost:5173/register")

    # 2. Register a new user
    import time
    timestamp = int(time.time())
    email = f"user_{timestamp}@example.com"
    password = "password123"

    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_label("Owner First Name").fill("Test")
    page.get_by_label("Owner Last Name").fill("User")

    # NEW STRATEGY: Wait for the dropdown to be populated by the API call.
    # We locate the select element and wait for its second option to be visible.
    # The first option is the disabled placeholder, so the second one is the first real team.
    team_select = page.get_by_label("Select Your Team")
    expect(team_select.locator("option").nth(1)).to_be_visible(timeout=10000)

    # Now that we know the options are loaded, we can select one.
    team_select.select_option(index=1)

    page.get_by_role("button", name="Create Account & Claim Team").click()

    # Wait for the redirection to the login page after successful registration
    expect(page).to_have_url(re.compile(".*login"), timeout=10000)

    # 3. Log in
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Login").click()

    # Wait for successful login and navigation to the dashboard
    expect(page).to_have_url(re.compile(".*dashboard"), timeout=10000)

    # 4. Navigate to a game page
    # The database isn't seeded with games, so this page will likely show a "Loading..."
    # or "Game not found" message. This is okay, as we only need to verify the layout
    # of the surrounding components, which should still render.
    page.goto("http://localhost:5173/game/1")

    # Wait for a key element of the game view to be present to ensure the page has loaded
    expect(page.locator(".game-view-container")).to_be_visible(timeout=15000)

    # 5. Take desktop screenshot
    page.set_viewport_size({"width": 1280, "height": 800})
    page.screenshot(path="jules-scratch/verification/desktop_layout.png")

    # 6. Take mobile screenshot
    page.set_viewport_size({"width": 375, "height": 667})
    page.screenshot(path="jules-scratch/verification/mobile_layout.png")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        verify_layout(page)
        browser.close()

if __name__ == "__main__":
    main()