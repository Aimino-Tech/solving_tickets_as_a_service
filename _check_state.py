"""Verify ODW007 thread and check today's approved + status/icon cleanup needed."""
import os, sys
sys.path.insert(0, '/home/agent/Documents/hermes-agent')
from google.oauth2 import service_account
import gspread
from datetime import datetime, timezone

# Get today's date
today_utc = datetime.now(timezone.utc).strftime('%Y-%m-%d')
print(f"Today UTC: {today_utc}")

key_path = '/home/agent/Documents/hermes-agent/service-account-key.json'
creds = service_account.Credentials.from_service_account_file(
    key_path,
    scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
)
client = gspread.authorize(creds)
ws = client.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY').worksheet('guerrilla-content-plan')

all_rows = ws.get_all_values()
headers = ws.row_values(1)

# Show index mapping
print("\n=== COLUMN INDEX MAP ===")
for i, h in enumerate(headers):
    print(f"  {i}: {h}")

# Check all columns for ODW007 (full un-truncated)
print("\n=== ODW007 FULL DATA ===")
for i, row in enumerate(all_rows):
    if row[0] == 'ODW007':
        print(f"\n--- Row {i+1} ---")
        for j, h in enumerate(headers):
            val = row[j] if j < len(row) else ''
            print(f"  [{j}] {h}: {val}")

# List APPROVED items with Status=planned (ready for execution today)
print(f"\n=== APPROVED & PLANNED (ready to post) ===")
for i, row in enumerate(all_rows):
    if not row[0]:
        continue
    approval = row[8] if len(row) > 8 else ''
    status = row[9] if len(row) > 9 else ''
    # Match both with and without icon prefixes
    is_approved = approval.strip() in ['✅ Approved', 'Approved']
    is_planned = status.strip() in ['📋 planned', 'planned']
    if is_approved and is_planned:
        profile = row[10] if len(row) > 10 else ''
        url = row[3] if len(row) > 3 else ''
        print(f"  {row[0]}: Profile={profile}, URL={url[:70]}")

# Count icons consistency
print("\n=== ICON CONSISTENCY CHECK ===")
no_icon_approval = []
no_icon_status = []
for i, row in enumerate(all_rows):
    if row[0] and row[0].startswith('ODW'):
        approval = row[8] if len(row) > 8 else ''
        status = row[9] if len(row) > 9 else ''
        if approval in ['Approved', 'Draft', 'Awaiting Thread']:
            no_icon_approval.append(f"  Row {i+1}: {row[0]} - Approval='{approval}'")
        if status in ['planned', 'pending', 'Draft']:
            no_icon_status.append(f"  Row {i+1}: {row[0]} - Status='{status}'")

if no_icon_approval:
    print("Rows without icon in Approval:")
    for r in no_icon_approval:
        print(r)
else:
    print("All ODW items have icons in Approval ✓")

if no_icon_status:
    print("\nRows without icon in Status:")
    for r in no_icon_status:
        print(r)
else:
    print("All ODW items have icons in Status ✓")
