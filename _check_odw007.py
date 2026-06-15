"""Check ODW007 full content in sheet."""
import os, sys
sys.path.insert(0, '/home/agent/Documents/hermes-agent')
from google.oauth2 import service_account
import gspread

key_path = '/home/agent/Documents/hermes-agent/service-account-key.json'
creds = service_account.Credentials.from_service_account_file(
    key_path,
    scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
)
client = gspread.authorize(creds)
ws = client.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY').worksheet('reddit-campaign')

# Get ODW007 rows - full content (check both row 26 and row 127)
all_rows = ws.get_all_values()
for i, row in enumerate(all_rows):
    if row[0] == 'ODW007':
        print(f'=== Row {i+1} ===')
        for j, header in enumerate(ws.row_values(1)):
            val = row[j] if j < len(row) else ''
            # Truncate long content
            if len(val) > 300:
                val = val[:300] + '... [truncated]'
            print(f'  {header}: {val}')
        print()

# Also check the old rows 21-27 vs 121+ for duplicates
print("\n=== DUPLICATE CHECK: Rows 21-27 vs 121+ ===")
print("Old rows (21-27):")
for row in all_rows[20:27]:
    print(f"  {row[0]}: PlatformURL={row[3][:50] if len(row)>3 and row[3] else 'EMPTY'}, Status={row[9] if len(row)>9 else '?'}")

print("\nNew rows (120-150):")
for row in all_rows[119:150]:
    if row[0] and row[0].startswith('ODW'):
        print(f"  {row[0]}: PlatformURL={row[3][:50] if len(row)>3 and row[3] else 'EMPTY'}, Status={row[9] if len(row)>9 else '?'}")
