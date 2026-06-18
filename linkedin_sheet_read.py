#!/usr/bin/env python3
import json
from google.oauth2.service_account import Credentials
import gspread

scope = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
creds = Credentials.from_service_account_file('/home/agent/.config/gspread/service_account.json', scopes=scope)
client = gspread.authorize(creds)

sheet = client.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')
worksheet = sheet.worksheet('linkedin-campaign')
all_records = worksheet.get_all_values()
headers = all_records[0]
rows = all_records[1:]
print('=== HEADERS ===')
for i, h in enumerate(headers):
    print(f'{i}: {h}')
print()
print(f'Total rows: {len(rows)}')
print()
for i, row in enumerate(rows):
    content_id = row[0] if len(row) > 0 else ''
    action = row[1] if len(row) > 1 else ''
    target_type = row[2] if len(row) > 2 else ''
    target_url = row[3] if len(row) > 3 else ''
    target_author = row[4] if len(row) > 4 else ''
    content = row[5] if len(row) > 5 else ''
    tactic = row[6] if len(row) > 6 else ''
    schedule = row[7] if len(row) > 7 else ''
    last_update = row[8] if len(row) > 8 else ''
    approval = row[9] if len(row) > 9 else ''
    status = row[10] if len(row) > 10 else ''
    account = row[11] if len(row) > 11 else ''
    notes = row[12] if len(row) > 12 else ''
    
    print(f'Row {i+2}: ID={content_id} | Action={action} | Type={target_type} | URL={target_url[:100] if target_url else ""}')
    print(f'  Author={target_author} | Status={status} | Approval={approval}')
    print(f'  Content={content[:120] if content else ""}...')
    print(f'  Last_Update={last_update}')
    print()
