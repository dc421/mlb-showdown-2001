import re
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    # --- Test Setup ---
    # Define user credentials and team info
    user1 = {"email": "user1@test.com", "password": "password123"}
    user2 = {"email": "user2@test.com", "password": "password123"}
    team1_name = "Boston True Alrics"
    team2_name = "Detroit Style Pizzas"

    # Define selectors
    dashboard_header = "h1:has-text('Your Dashboard')"
    baseball_diamond = "canvas" # A key element in GameView.vue

    # --- Browser and Page Setup ---
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # --- Helper Functions ---
    def register(user, team_name):
        print(f"Registering {user['email']}...")
        page.goto("http://localhost:5173/register")
        page.get_by_label("Email").fill(user["email"])
        page.get_by_label("Password").fill(user["password"])
        page.get_by_label("First Name").fill("Test")
        page.get_by_label("Last Name").fill("User")
        page.get_by_label("Team").select_option(label=team_name)
        register_button = page.get_by_role("button", name="Register")
        expect(register_button).to_be_enabled(timeout=10000) # Wait for the button to be clickable
        register_button.click()
        expect(page.get_by_text("Registration successful!")).to_be_visible()
        print(f"Registration successful for {user['email']}.")

    def login(user):
        print(f"Logging in as {user['email']}...")
        page.goto("http://localhost:5173/login")
        page.get_by_label("Email").fill(user["email"])
        page.get_by_label("Password").fill(user["password"])
        page.get_by_role("button", name="Login").click()
        expect(page.locator(dashboard_header)).to_be_visible()
        print(f"Login successful for {user['email']}.")

    def create_roster():
        print("Creating roster...")
        page.get_by_role("link", name="Roster Builder").click()
        # Select the first 20 players available
        for i in range(20):
            page.locator('.player-card-grid .player-card').nth(i).get_by_role('button', name='Add').click()
        page.get_by_role("button", name="Save Roster").click()
        expect(page.get_by_text("Roster saved successfully!")).to_be_visible()
        print("Roster created successfully.")
        page.get_by_role("link", name="Dashboard").click()
        expect(page.locator(dashboard_header)).to_be_visible()

    def set_lineup():
        print("Setting lineup...")
        page.get_by_role("button", name=re.compile("Set Lineup")).click()
        expect(page.get_by_text("Set Your Lineup")).to_be_visible()
        # Select the first available pitcher
        page.locator('.pitcher-card').first.click()
        page.get_by_role("button", name="Save Lineup").click()
        print("Lineup set.")

    # --- Main Test Flow ---
    try:
        # 1. Register and set up User 1
        register(user1, team1_name)
        login(user1)
        create_roster()

        # 2. User 1 creates a game
        print("User 1 creating game...")
        page.get_by_role("button", name="Create New Game").click()
        page.get_by_role("button", name="Create Game").click()
        expect(page.get_by_text("waiting for opponent")).to_be_visible()
        game_url = page.url
        print(f"Game created at {game_url}")
        page.get_by_role("button", name="Logout").click()

        # 3. Register and set up User 2
        register(user2, team2_name)
        login(user2)
        create_roster()

        # 4. User 2 joins the game
        print("User 2 joining game...")
        page.get_by_role("button", name=f"vs {team1_name}").click()
        expect(page.get_by_text("Game Setup")).to_be_visible()
        print("User 2 joined successfully.")

        # 5. User 2 sets up the game and their lineup
        page.get_by_role("button", name=team2_name).click() # Choose self as home team
        page.get_by_role("button", name="Confirm Setup & Proceed to Lineups").click()
        set_lineup()
        expect(page.get_by_text("Waiting for opponent to set lineup...")).to_be_visible()
        page.get_by_role("button", name="Logout").click()

        # 6. User 1 logs back in and sets their lineup, starting the game
        login(user1)
        page.goto(game_url) # Go directly to the game
        set_lineup()

        # 7. Verification
        print("Verifying game has loaded...")
        # The ultimate verification: does the game view render?
        expect(page.locator(baseball_diamond)).to_be_visible(timeout=10000)
        print("Game view loaded successfully!")

        # Take a screenshot for visual confirmation
        page.screenshot(path="jules-scratch/verification/verification.png")
        print("Screenshot captured.")

    finally:
        browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)