from playwright.sync_api import sync_playwright, expect

def run(playwright):
    iphone_13_pro = playwright.devices['iPhone 13 Pro']
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(**iphone_13_pro)
    page = context.new_page()

    # Go to the absolute root of the application
    page.goto("http://localhost:5173/")

    # Wait a moment for any JS to execute or crash
    page.wait_for_timeout(3000)

    # Take a screenshot to see what's on the page
    page.screenshot(path="jules-scratch/verification/root_page_debug.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)