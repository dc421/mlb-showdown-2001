from playwright.sync_api import sync_playwright, Page, expect

def verify_simple(page: Page):
    try:
        # Navigate directly to an image URL
        response = page.goto("http://localhost:3001/images/1.jpg")

        # Check if the response was successful
        assert response.status == 200
        assert response.headers["content-type"] == "image/jpeg"

        # Take a screenshot
        page.screenshot(path="jules-scratch/verification/verification.png")
    except Exception as e:
        page.screenshot(path="jules-scratch/verification/error.png")
        raise e

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        verify_simple(page)
        browser.close()

if __name__ == "__main__":
    main()