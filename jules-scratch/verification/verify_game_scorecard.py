from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch()
    context = browser.new_context()
    page = context.new_page()

    # Go directly to the verification page
    page.goto("http://localhost:5173/verify")

    # Wait for the game scorecard to be visible
    game_card = page.locator(".game-scorecard").first
    expect(game_card).to_be_visible()

    # Take a screenshot of the game scorecard
    game_card.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)