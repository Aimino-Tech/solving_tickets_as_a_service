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

# Check Public-marketplaces for ALL entries with OpenTalk2HTML or OT2H
import urllib.parse
range_str = "Public-marketplaces!A1:G30"
encoded_range = urllib.parse.quote(range_str)
url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
r = requests.get(url, headers=headers, timeout=30)
data = r.json()

rows = data.get("values", [])
print("=== ALL Public-marketplaces Entries ===\n")
for i, row in enumerate(rows[1:], 1):
    if not row:
        continue
    platform = row[0] if len(row) > 0 else ""
    url = row[1] if len(row) > 1 else ""
    github = row[2] if len(row) > 2 else ""
    status = row[3] if len(row) > 3 else ""
    notes = row[6] if len(row) > 6 else ""
    
    # Show all entries
    print(f"Row {i}: {platform}")
    print(f"  GitHub: {github[:60]}...")
    print(f"  Status: {status}")
    print()

# Check project-overview for both products
print("\n=== project-overview ===\n")
range_str2 = "project-overview!A2:L10"
encoded_range2 = urllib.parse.quote(range_str2)
url2 = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range2}"
r2 = requests.get(url2, headers=headers, timeout=30)
data2 = r2.json()

rows2 = data2.get("values", [])
for row in rows2:
    if row and row[0]:
        print(f"Product: {row[0]}")
        print(f"  Name: {row[1] if len(row) > 1 else ''}")
        print(f"  Repo: {row[2] if len(row) > 2 else ''}")
        print()
