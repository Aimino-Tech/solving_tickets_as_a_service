"""Fix old rows 21-27: add icon prefixes to Approval and Status columns."""
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
ws = client.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY').worksheet('guerrilla-content-plan')

# Fix rows 21-27 (ODW002-ODW008) — add icons
today = "2026-05-30"

fixes = {
    21: {'Approval': '✅ Approved', 'Status': '📋 planned', 'Last_Update': today},
    22: {'Approval': '✅ Approved', 'Status': '📋 planned', 'Last_Update': today},
    23: {'Approval': '✅ Approved', 'Status': '📋 planned', 'Last_Update': today},
    24: {'Approval': '✅ Approved', 'Status': '📋 planned', 'Last_Update': today},
    25: {'Approval': '✅ Approved', 'Status': '📋 planned', 'Last_Update': today},
    26: {'Approval': '✅ Approved', 'Status': '📋 planned', 'Last_Update': today},
    27: {'Approval': '✅ Approved', 'Status': '📋 planned', 'Last_Update': today},
}

col_map = {'Approval': 9, 'Status': 10, 'Last_Update': 8}  # 1-indexed

for row_num, updates in fixes.items():
    for col_name, value in updates.items():
        col_idx = col_map[col_name]
        old_val = ws.cell(row_num, col_idx).value
        if old_val != value:
            ws.update_cell(row_num, col_idx, value)
            verified = ws.cell(row_num, col_idx).value
            status = "✓" if verified == value else f"✗ (got '{verified}')"
            print(f"Row {row_num}, {col_name}: '{old_val}' → '{value}' {status}")
        else:
            print(f"Row {row_num}, {col_name}: already correct ✓")

# Also fix row 127's Last_Update
old_lu = ws.cell(127, 8).value
if old_lu != today:
    ws.update_cell(127, 8, today)
    verified = ws.cell(127, 8).value
    status = "✓" if verified == today else f"✗ (got '{verified}')"
    print(f"\nRow 127, Last_Update: '{old_lu}' → '{today}' {status}")
else:
    print(f"\nRow 127, Last_Update: already correct ✓")

print("\nDone!")
