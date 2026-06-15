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

# Check Public-marketplaces for OT2H references
import urllib.parse
range_str = "Public-marketplaces!A1:G30"
encoded_range = urllib.parse.quote(range_str)
url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
r = requests.get(url, headers=headers, timeout=30)
data = r.json()

rows = data.get("values", [])
print("=== Public-marketplaces - OT2H/OpenTalk2HTML References ===\n")

for i, row in enumerate(rows[1:], 1):
    if not row:
        continue
    
    notes = row[6] if len(row) > 6 else ""
    platform = row[0] if len(row) > 0 else ""
    status = row[3] if len(row) > 3 else ""
    
    # Find OT2H references
    if "OpenTalk2HTML" in notes or "OpenTalk2HTML" in str(row):
        print(f"Row {i}: {platform}")
        print(f"  Status: {status}")
        print(f"  Notes: {notes}")
        print()

# Also check project-overview for OT2H
range_str2 = "project-overview!A2:L10"
encoded_range2 = urllib.parse.quote(range_str2)
url2 = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range2}"
r2 = requests.get(url2, headers=headers, timeout=30)
data2 = r2.json()

rows2 = data2.get("values", [])
print("\n=== project-overview - OpenTalk2HTML ===\n")
for row in rows2:
    if row and "OpenTalk2HTML" in str(row):
        print(row)
