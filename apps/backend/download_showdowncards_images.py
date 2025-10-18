import os
import psycopg2
import requests
from dotenv import load_dotenv

# Load database credentials from your .env file
load_dotenv()

# --- The formulas you discovered ---
BASE_SET_OFFSET = 692  # So that card #1 maps to image ID 693
PENNANT_RUN_OFFSET = 1229 # So that card #1 maps to image ID 1230
IMAGE_DIR = "card_images_showdowncards"

def get_db_connection():
    """Establishes a connection to the PostgreSQL database."""
    conn = psycopg2.connect(
        dbname=os.getenv('DB_DATABASE'),
        user=os.getenv('DB_USER'),
        password=os.getenv('DB_PASSWORD'),
        host=os.getenv('DB_HOST'),
        port=os.getenv('DB_PORT')
    )
    return conn

def download_image(url, file_path):
    """Downloads an image from a URL and saves it to a file."""
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()  # Raise an exception for bad status codes
        with open(file_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error downloading {url}: {e}")
        return False

def main():
    """Fetches card data, generates image URLs, and downloads the images."""
    # Create the directory if it doesn't exist
    if not os.path.exists(IMAGE_DIR):
        os.makedirs(IMAGE_DIR)

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Get all players
        cur.execute("SELECT card_id, set_name, card_number FROM cards_player")
        players = cur.fetchall()

        total_players = len(players)
        print(f"Found {total_players} players. Starting image download...")
        download_count = 0

        for i, player in enumerate(players):
            card_id, set_name, card_number = player
            image_id = 0

            if set_name == 'Base':
                image_id = BASE_SET_OFFSET + card_number
            elif set_name == 'PR':
                image_id = PENNANT_RUN_OFFSET + card_number

            if image_id > 0:
                image_url = f"https://showdowncards.com/images/product/{image_id}.jpg"
                file_name = f"{card_id}_sc.jpg"
                file_path = os.path.join(IMAGE_DIR, file_name)

                # Check if the image already exists
                if not os.path.exists(file_path):
                    if download_image(image_url, file_path):
                        download_count += 1
                else:
                    # If it exists, we can still count it as "processed"
                    pass

            # Print progress
            print(f"\rProgress: {i + 1}/{total_players} cards processed.", end="")

        print(f"\n\nSuccessfully downloaded {download_count} new images.")
        print(f"All images are located in the '{IMAGE_DIR}' directory.")

    except (Exception, psycopg2.DatabaseError) as error:
        print(f"An error occurred: {error}")
    finally:
        if conn is not None:
            cur.close()
            conn.close()

if __name__ == "__main__":
    main()