import json
import time
from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.set_default_timeout(60000)

    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

    context.add_init_script("""
        localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoiZHVtbXlAZHVtbXkuY29tIiwib3duZXIiOiJEdW1teSBVc2VyIiwidGVhbSI6eyJ0ZWFtX2lkIjoxLCJjaXR5IjoiQW5haGVpbSIsIm5hbWUiOiJBbmdlbHMiLCJhYmJyZXZpYXRpb24iOiJBTkEiLCJsZWFndWUiOiJhbGVhZ3VlIiwicHJpbWFyeV9jb2xvciI6IiNiYTAwMjAifX0.mock_token');
        localStorage.setItem('user', JSON.stringify({"userId":1,"email":"dummy@dummy.com","owner":"Dummy User","team":{"team_id":1,"city":"Anaheim","name":"Angels","abbreviation":"ANA","league":"aleague","primary_color":"#ba0020"}}));
    """)

    with open('jules-scratch/verification/game_state.json', 'r') as f:
        mock_game_state = json.load(f)

    def handle_route(route):
        if route.request.method == 'GET' and 'api/games/1' in route.request.url:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(mock_game_state).encode())
        else:
            route.fulfill(status=200, body='{}')

    page.route("**/api/games/*", handle_route)

    try:
        page.goto("http://localhost:5173/game/1")
        page.wait_for_selector('.lineup-header')

        anaheim_lineup_panel = page.locator('.lineup-panel', has_text='Anaheim Lineup')
        header_sub_icon = anaheim_lineup_panel.locator('.sub-icon').first
        header_sub_icon.click()

        page.wait_for_selector(".lineup-item .sub-icon.visible")

        # Use a more specific selector
        mike_trout_item = page.locator("li.lineup-item:has-text('1. Mike Trout (CF)')")
        mike_trout_item.locator('.sub-icon.visible').click()

        shohei_ohtani_item = page.locator("li.lineup-item:has-text('2. Shohei Ohtani (P)')")
        shohei_ohtani_item.locator('.sub-icon.visible').click()

        time.sleep(1)
        page.screenshot(path="jules-scratch/verification/swap_successful.png")

        # Reload the page with an invalid state
        mock_game_state['gameState']['state_data']['awaiting_lineup_change'] = True
        mock_game_state['gameState']['state_data']['lineup_validation_errors'] = ['Mike Trout is not eligible to play C']
        for player in mock_game_state['lineups']['home']['battingOrder']:
            if player['player']['name'] == 'Mike Trout':
                player['position'] = 'C'
                break

        page.reload()
        page.wait_for_selector('.invalid-position')

        expect(page.locator('.lineup-panel', has_text="Anaheim Lineup").locator('.invalid-position')).to_contain_text("Mike Trout")

        page.screenshot(path="jules-scratch/verification/invalid_lineup.png")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error_screenshot.png")
    finally:
        context.close()
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
