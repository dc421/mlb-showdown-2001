import re
from playwright.sync_api import Page, expect, sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Log in
    page.goto("http://localhost:5173/login")
    page.get_by_label("Email").fill("playerone@example.com")
    page.get_by_label("Password").fill("s")
    page.get_by_role("button", name="Login").click()

    # Navigate to game
    page.wait_for_url("http://localhost:5173/dashboard")
    page.goto("http://localhost:5173/game/2")

    # Wait for the linescore to be visible and take a screenshot
    expect(page.locator(".linescore-table")).to_be_visible()
    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)