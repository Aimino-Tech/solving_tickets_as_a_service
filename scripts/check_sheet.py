#!/usr/bin/env python3
"""Check sheet for recent Twitter replies."""
import gspread
from google.oauth2.service_account import Credentials

creds = Credentials.from_service_account_file(
    '/home/agent/.config/gspread/service_account.json',
    scopes=['https://www.googleapis.com/auth/spreadsheets']
)
gc = gspread.authorize(creds)
sheet = gc.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')
ws = sheet.worksheet('twitter-campaign')

all_data = ws.get_all_values()
print(f"Total rows: {len(all_data)}")

# Get all replied authors
replied_authors = set()
for row in all_data[1:]:
    if len(row) > 4 and row[4]:
        replied_authors.add(row[4].lower())

print(f"\nAlready replied to ({len(replied_authors)}):")
for author in sorted(replied_authors):
    print(f"  {author}")

# Show last 5 entries
print(f"\nLast 5 entries:")
for row in all_data[-5:]:
    content_id = row[0] if len(row) > 0 else ''
    target_url = row[3] if len(row) > 3 else ''
    author = row[4] if len(row) > 4 else ''
    status = row[10] if len(row) > 10 else ''
    print(f"  {content_id} | {author} | {target_url[:50]} | {status}")
