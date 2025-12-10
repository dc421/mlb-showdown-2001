
import asyncio
from playwright.async_api import async_playwright
import json

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()

        # Set localStorage for authentication
        await context.add_init_script("""
            localStorage.setItem('token', 'fake-token');
            localStorage.setItem('user', JSON.stringify({ userId: '1', username: 'testuser' }));
        """)

        page = await context.new_page()

        # Mock API calls
        await page.route("**/api/auth/point-sets", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps([
                {"id": 1, "name": "Standard"}
            ])
        ))

        # Mock League Data
        league_data = [
            {
                "team_id": 1,
                "full_display_name": "Test Team",
                "owner": "Test Owner",
                "logo_url": "/images/logo.png",
                "roster": [
                    {"card_id": 1, "assignment": "C", "displayName": "Player 1", "points": 100},
                    {"card_id": 2, "assignment": "1B", "displayName": "Player 2", "points": 200},
                    {"card_id": 3, "assignment": "PITCHING_STAFF", "displayPosition": "SP", "displayName": "Pitcher 1", "points": 150}
                ]
            }
        ]

        await page.route("**/api/league?point_set_id=1", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(league_data)
        ))

        # Add route for ANY API call to avoid 404s/timeouts waiting for calls I didn't mock
        await page.route("**/api/**", lambda route: route.continue_())

        await page.goto("http://localhost:5173/league")

        # Debug: check if we are on login page
        print(f"Current URL: {page.url}")

        # Inject state into Pinia
        # We need to do this carefully.
        # The app might be initializing.
        await page.wait_for_timeout(1000)

        await page.evaluate("""
            if (window.pinia && window.pinia.state.value.auth) {
                const authStore = window.pinia.state.value.auth;
                authStore.selectedPointSetId = 1;
            }
        """)

        # Reload to ensure component mounts with the selectedPointSetId
        await page.reload()

        # Wait for either loading to disappear or team block to appear
        try:
            await page.wait_for_selector(".team-block", timeout=10000)
        except Exception as e:
            print("Timeout waiting for .team-block")
            # print page content for debugging
            print(await page.content())
            await browser.close()
            return

        # Verification steps

        # 1. Check Points Cell Color and Alignment
        points_cell = page.locator(".points-cell").first
        color = await points_cell.evaluate("el => getComputedStyle(el).color")
        align = await points_cell.evaluate("el => getComputedStyle(el).textAlign")

        print(f"Points Cell Color: {color}")
        print(f"Points Cell Align: {align}")

        # 2. Check Header Alignment
        # The 3rd th is Points
        points_header = page.locator(".roster-table th").nth(2)
        header_align = await points_header.evaluate("el => getComputedStyle(el).textAlign")
        print(f"Points Header Align: {header_align}")

        # 3. Check for Total Points
        content = await page.content()
        if "Total Points" in content:
            print("Total Points found")
        else:
            print("Total Points NOT found")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
