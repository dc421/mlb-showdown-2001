import re
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    # Set a mobile viewport
    iphone_13_pro = playwright.devices['iPhone 13 Pro']
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(**iphone_13_pro)
    page = context.new_page()

    # Navigate directly to the game view
    page.goto("http://localhost:5173/game/1")

    # Wait for a key element that is unique to the GameView to ensure it's loaded
    # The presence of the player card for the mock batter is a good indicator.
    expect(page.get_by_text("Luis Gonzalez", exact=True)).to_be_visible(timeout=15000)

    # Also wait for the pitcher to be visible
    expect(page.get_by_text("Randy Johnson", exact=True)).to_be_visible(timeout=15000)

    # Take the final screenshot
    page.screenshot(path="jules-scratch/verification/final_mobile_layout.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)