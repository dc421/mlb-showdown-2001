import re
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    # Set a mobile viewport
    iphone_13_pro = playwright.devices['iPhone 13 Pro']
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(**iphone_13_pro)
    page = context.new_page()

    # Listen for all console events and print them
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.type}: {msg.text}"))

    # Navigate directly to the game view
    print("--- Navigating to http://localhost:5173/game/1 ---")
    try:
        page.goto("http://localhost:5173/game/1", timeout=15000)
        print("--- Navigation complete ---")
    except Exception as e:
        print(f"!!! Navigation failed: {e}")
        browser.close()
        return

    # Wait for a key element that is unique to the GameView to ensure it's loaded
    print("--- Waiting for element 'Luis Gonzalez' ---")
    try:
        expect(page.get_by_text("Luis Gonzalez", exact=True)).to_be_visible(timeout=10000)
        print("--- Element found! Taking screenshot. ---")
        page.screenshot(path="jules-scratch/verification/final_mobile_layout.png")
    except Exception as e:
        print(f"!!! Could not find element: {e}")
        print("--- Taking error screenshot. ---")
        page.screenshot(path="jules-scratch/verification/error_screenshot.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)