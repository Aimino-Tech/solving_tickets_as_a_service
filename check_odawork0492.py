import os
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")

creds = Credentials.from_service_account_file(SA_PATH, scopes=[
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
])
creds.refresh(Request())
headers = {"Authorization": f"Bearer {creds.token}"}

# Find ODA000492
import urllib.parse

# First, find which row it's in
range_str = "reddit-campaign!A2:A1200"
encoded_range = urllib.parse.quote(range_str)
url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
r = requests.get(url, headers=headers, timeout=30)
data = r.json()

rows = data.get("values", [])
target_row = None
for i, row in enumerate(rows):
    if row and row[0] == "ODA000492":
        target_row = i + 2  # +2 because we started from row 2
        break

if target_row:
    print(f"Found ODA000492 at row {target_row}")
    
    # Read full row
    range_str = f"reddit-campaign!A{target_row}:M{target_row}"
    encoded_range = urllib.parse.quote(range_str)
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
    r = requests.get(url, headers=headers, timeout=30)
    data = r.json()
    
    row = data.get("values", [[]])[0]
    
    headers_list = ["ContentID", "ActionType", "Platform", "PlatformURL", "GuerillaTactic", 
                    "Content", "Schedule", "Last_Update", "Approval", "Status", 
                    "Chrome_Profile", "Agent's Notes", "Human's Notes"]
    
    print("\n=== ODA000492 Full Data ===")
    for i, h in enumerate(headers_list):
        val = row[i] if i < len(row) else ""
        print(f"  {h}: {val}")
else:
    print("ODA000492 not found in sheet")
