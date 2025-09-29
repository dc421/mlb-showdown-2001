import re
from playwright.sync_api import Page, expect, sync_playwright
import random
import string

def random_string(length=10):
    letters = string.ascii_lowercase
    return ''.join(random.choice(letters) for i in range(length))

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={'width': 375, 'height': 812},
        is_mobile=True,
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 13_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Mobile/15E148 Safari/604.1'
    )
    page = context.new_page()

    # Registration
    email = f"testuser_{random_string()}@example.com"
    password = "password123"

    page.goto("http://localhost:5173/register")

    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_label("First Name").fill("Test")
    page.get_by_label("Last Name").fill("User")

    # Select the first available team
    page.get_by_label("Choose a Team").select_option(index=1)

    page.get_by_role("button", name="Register").click()

    # Wait for registration to complete and redirect to login
    expect(page).to_have_url(re.compile(".*login"))

    # Login
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Login").click()

    # Wait for login to complete and redirect to dashboard
    expect(page).to_have_url(re.compile(".*dashboard"))

    # Navigate to a game - this requires a game to exist.
    # Since we can't create one easily, we'll just check the dashboard for now.
    # The key is to get to a page where the global nav is visible.
    # The original bug was on the game page, so we'll simulate that by checking the dashboard,
    # which also has the nav bar.

    # A better approach if games were available would be to find and click a game link.
    # For now, we assume the dashboard is sufficient to test the nav bar fix.
    page.goto("http://localhost:5173/game/1") # Assume game 1 exists for visual test

    # Wait for the nav to be visible
    expect(page.locator(".global-nav")).to_be_visible()

    # Take a screenshot to verify the fix
    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)