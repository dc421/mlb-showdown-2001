from playwright.sync_api import sync_playwright
import json

def verify_draft_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Mock API responses
        page.route('**/api/auth/user', lambda route: route.fulfill(
            status=200,
            content_type='application/json',
            body=json.dumps({'userId': 1, 'team': {'team_id': 1, 'name': 'My Team', 'logo_url': '/logo.png'}})
        ))

        page.route('**/api/draft/seasons', lambda route: route.fulfill(
            status=200,
            content_type='application/json',
            body=json.dumps(['8/4/25 Season'])
        ))

        # Mock State with Random Removals and Draft Order
        page.route('**/api/draft/state**', lambda route: route.fulfill(
            status=200,
            content_type='application/json',
            body=json.dumps({
                'id': 1,
                'season_name': '8/4/25 Season',
                'is_active': True,
                'current_round': 2,
                'current_pick_number': 1,
                'active_team_id': 1,
                'draft_order': [1, 2],
                'history': [
                    {'id': 1, 'round': '1', 'pick_number': 1, 'team_name': 'Team 1', 'player_name': 'P1', 'action': 'PENDING', 'city': 'Fargo'}
                ],
                'randomRemovals': [
                     {'player_name': 'Removed Guy', 'team_name': 'Fargo', 'card_id': 99, 'position': 'SP', 'points': 500}
                ],
                'takenPlayerIds': [],
                'isSeasonOver': False,
                'teams': {
                    '1': 'Team 1',
                    '2': 'Team 2'
                }
            })
        ))

        page.route('**/api/point-sets', lambda route: route.fulfill(status=200, body=json.dumps([])))
        page.route('**/api/players**', lambda route: route.fulfill(status=200, body=json.dumps([])))

        # Set localStorage
        page.goto('http://localhost:5173/')
        page.evaluate('''() => {
            localStorage.setItem('token', 'fake-token');
            localStorage.setItem('user', JSON.stringify({ userId: 1, team: { team_id: 1 } }));
        }''')

        # Navigate to Draft
        page.goto('http://localhost:5173/draft')
        page.wait_for_selector('.draft-table')

        # Screenshot
        page.screenshot(path='verification.png', full_page=True)
        print("Screenshot saved to verification.png")
        browser.close()

if __name__ == "__main__":
    verify_draft_ui()
