#!/usr/bin/env python3
from google.oauth2.service_account import Credentials
import gspread
from datetime import datetime, timezone

scope = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
creds = Credentials.from_service_account_file('/home/agent/.config/gspread/service_account.json', scopes=scope)
client = gspread.authorize(creds)

sheet = client.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')
worksheet = sheet.worksheet('linkedin-campaign')
all_records = worksheet.get_all_values()
headers = all_records[0]
rows = all_records[1:]

print("=== ALL DRAFT ITEMS ===")
for i, row in enumerate(rows):
    content_id = row[0]
    status = row[11] if len(row) > 11 else ''
    approval = row[10] if len(row) > 10 else ''
    target_url = row[4] if len(row) > 4 else ''
    content = row[6] if len(row) > 6 else ''
    author = row[5] if len(row) > 5 else ''
    
    if status == 'Draft':
        print(f"Row {i+2}: ID={content_id}")
        print(f"  URL={target_url}")
        print(f"  Author={author}")
        print(f"  Approval='{approval}'")
        print(f"  Content starts: '{content[:150]}'")
        print(f"  Content length: {len(content)}")
        print(f"  HasPostsInURL: {'linkedin.com/posts/' in target_url}")
        print(f"  IsRealLinkedIn: {'linkedin.com' in target_url}")
        print(f"  HasApprovedMark: {'Approved' in approval or '✅' in approval}")
        print()

# Also find the last posted comment - check Status = ✅ Approved and ActionType = comment
print("=== LAST POSTED COMMENTS (Status=✅ Approved, Action=comment) ===")
for i, row in enumerate(rows):
    content_id = row[0]
    status = row[11] if len(row) > 11 else ''
    action = row[2] if len(row) > 2 else ''
    last_update = row[9] if len(row) > 9 else ''
    approval = row[10] if len(row) > 10 else ''
    
    if status == '✅ Approved' and 'comment' in action.lower():
        print(f"Row {i+2}: ID={content_id} | Approval={approval} | LastUpdate={last_update}")

# Check last browse session
print("\n=== LAST BROWSE SESSION ===")
# Find the last browse entry with content
for i, row in enumerate(reversed(rows)):
    content_id = row[0]
    action = row[2] if len(row) > 2 else ''
    if 'BROWSE' in content_id or 'browse' in content_id.lower() or 'browse' in action.lower():
        last_update = row[9] if len(row) > 9 else ''
        print(f"Row {len(rows)-i+1}: ID={content_id} | LastUpdate={last_update} | Action={action}")
