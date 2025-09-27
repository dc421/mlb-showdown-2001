from playwright.sync_api import sync_playwright

def run(playwright):
    iphone_13_pro = playwright.devices['iPhone 13 Pro']
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(**iphone_13_pro)
    page = context.new_page()

    try:
        # Navigate directly to the game view, with a longer timeout
        page.goto("http://localhost:5173/game/1", timeout=20000, wait_until='domcontentloaded')
        # Give it a generous moment to render anything at all
        page.wait_for_timeout(5000)
        page.screenshot(path="jules-scratch/verification/final_screenshot.png")
    except Exception as e:
        print(f"Final attempt failed: {e}")
        # If it fails, take a screenshot of whatever is there
        page.screenshot(path="jules-scratch/verification/final_error_screenshot.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)