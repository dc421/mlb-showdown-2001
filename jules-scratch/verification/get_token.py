import requests
import os

def get_token():
    try:
        response = requests.get("http://localhost:3001/api/dev/get-token/1")
        response.raise_for_status()  # Raise an exception for bad status codes
        token = response.json().get("token")
        if token:
            print(token)
        else:
            print("Token not found in response.")
    except requests.exceptions.RequestException as e:
        print(f"Error fetching token: {e}")

if __name__ == "__main__":
    get_token()