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

    # Add a delay to allow Vue to render with mock data
    page.wait_for_timeout(2000) # 2 seconds should be enough

    # Take screenshot for debugging
    page.screenshot(path="jules-scratch/verification/debug_mock_render.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)