"""Quick check of the guerrilla-content-plan sheet for ODW items."""
import os, sys
sys.path.insert(0, '/home/agent/Documents/hermes-agent')
from google.oauth2 import service_account
import gspread

key_path = 'service-account-key.json'
if not os.path.exists(key_path):
    # Try relative to workspace
    key_path = '/home/agent/Documents/hermes-agent/service-account-key.json'

creds = service_account.Credentials.from_service_account_file(
    key_path,
    scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
)
client = gspread.authorize(creds)
sheet = client.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')

# Check available worksheets
worksheets = sheet.worksheets()
print("=== WORKSHEETS ===")
for ws in worksheets:
    print(f"  {ws.title} (gid={ws.id}, rows={ws.row_count}, cols={ws.col_count})")

# Get guerrilla-content-plan
ws = sheet.worksheet('guerrilla-content-plan')
all_rows = ws.get_all_values()
print(f"\n=== guerrilla-content-plan: {len(all_rows)} rows ===")

# Show header
print(f"\nHEADER (row 1): {all_rows[0][:15]}")

# Find ODW items
print("\n=== ODW ITEMS ===")
for i, row in enumerate(all_rows):
    if row[0] and row[0].startswith('ODW'):
        print(f"Row {i+1}: ID={row[0]}, PlatformURL={row[4][:80] if len(row) > 4 and row[4] else 'EMPTY'}, Approval={row[8] if len(row) > 8 else '?'}, Status={row[9] if len(row) > 9 else '?'}, Profile={row[10] if len(row) > 10 else '?'}, Notes={row[11] if len(row) > 11 and row[11] else 'EMPTY'}")
