from playwright.sync_api import sync_playwright, expect
import json

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Define a more complete mock game state
    mock_game_state = {
        "game": {"status": "in_progress"},
        "gameState": {
            "state_data": {"inning": 1, "outs": 2, "isTopInning": True, "awayScore": 0, "homeScore": 0}
        },
        "gameEvents": [{"log_message": "--- Top 1st ---"}],
        "batter": None,
        "pitcher": None,
        "lineups": {"home": None, "away": None},
        "rosters": {"home": [], "away": []},
        "teams": {
            "home": {"abbreviation": "BOS"},
            "away": {"abbreviation": "DET"}
        }
    }

    # Intercept the network request for game data
    page.route(
        "**/api/games/123",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(mock_game_state),
        ),
    )

    # 1. Go to the page FIRST to establish origin
    page.goto("http://localhost:5173/game/123")

    # 2. NOW set localStorage
    page.evaluate("""
        () => {
            localStorage.setItem('token', 'fake-token-for-testing');
            localStorage.setItem('user', JSON.stringify({
                userId: 1,
                email: 'test@test.com',
                owner: 'Test User',
                team: {
                    team_id: 1,
                    city: 'Boston',
                    name: 'Red Sox',
                    abbreviation: 'BOS',
                    logo_url: 'https://i.ibb.co/CKmxGGGw/showdown-logo.png'
                }
            }));
        }
    """)

    # 3. Reload the page for auth state to be recognized.
    page.reload()

    # Wait for the OutsDisplay component to be rendered
    expect(page.locator(".outs-display")).to_be_visible()

    # Also wait for the linescore to ensure the whole nav is there
    expect(page.locator(".linescore-table")).to_be_visible()

    # Take a screenshot of the global navigation bar
    page.locator(".global-nav").screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)