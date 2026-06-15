"""Get full content of all approved ODW items for today's execution plan."""
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

all_rows = ws.get_all_values()
headers = ws.row_values(1)

# Use rows 121-150 (the newer, expanded set with icons)
print("=== FULL ODW CONTENTS (rows 121-150) ===\n")
for i, row in enumerate(all_rows):
    row_num = i + 1
    if row_num < 121 or row_num > 150:
        continue
    if not row[0] or not row[0].startswith('ODW'):
        continue
    
    cid = row[0]
    url = row[3] if len(row) > 3 else ''
    profile = row[10] if len(row) > 10 else ''
    approval = row[8] if len(row) > 8 else ''
    status = row[9] if len(row) > 9 else ''
    content = row[5] if len(row) > 5 else ''
    tactic = row[4] if len(row) > 4 else ''
    
    print(f"--- {cid} | {profile} | {approval} | {status} ---")
    print(f"Tactic: {tactic}")
    print(f"URL: {url}")
    print(f"Content: {content}")
    print()
