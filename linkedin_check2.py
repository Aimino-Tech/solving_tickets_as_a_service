#!/usr/bin/env python3
from google.oauth2.service_account import Credentials
import gspread

scope = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
creds = Credentials.from_service_account_file('/home/agent/.config/gspread/service_account.json', scopes=scope)
client = gspread.authorize(creds)

sheet = client.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')
worksheet = sheet.worksheet('linkedin-campaign')
all_records = worksheet.get_all_values()
rows = all_records[1:]

# Find items where Status=✅ Approved to see when last comment was actually posted
print("=== ITEMS WITH Status=✅ Approved AND comment-related type ===")
for i, row in enumerate(rows):
    status = row[11] if len(row) > 11 else ''
    target_type = row[3] if len(row) > 3 else ''
    
    if status == '✅ Approved' and target_type == 'comment':
        content_id = row[0]
        approval = row[10] if len(row) > 10 else ''
        target_url = row[4] if len(row) > 4 else ''
        action = row[2] if len(row) > 2 else ''
        print(f"Row {i+2}: ID={content_id} | Action={action} | Type={target_type} | Approval={approval}")
        print(f"  URL={target_url[:80]}")

print("\n=== CHECKING STATUS column values near bottom ===")
# Check last comments - maybe the Status is different
for i, row in enumerate(rows):
    content_id = row[0]
    status = row[11] if len(row) > 11 else ''
    
    if content_id.startswith('LI') and (status == '✅ Approved' or status == 'Draft' or status == 'Needs Review'):
        action = row[2] if len(row) > 2 else ''
        target_type = row[3] if len(row) > 3 else ''
        approval = row[10] if len(row) > 10 else ''
        
        # Check if this is a recently posted comment
        last_update = row[9] if len(row) > 9 else ''
        print(f"Row {i+2}: ID={content_id} | Status={status} | Type={target_type} | Action={action} | Approval={approval[:30]} | LastUpdate={last_update}")

print("\n=== Finding any item meeting ALL criteria ===")
for i, row in enumerate(rows):
    content_id = row[0]
    status = row[11] if len(row) > 11 else ''
    approval = row[10] if len(row) > 10 else ''
    target_url = row[4] if len(row) > 4 else ''
    content = row[6] if len(row) > 6 else ''
    
    is_draft = (status == 'Draft')
    is_approved = ('Approved' in approval or '✅' in approval)
    has_posts_url = 'linkedin.com/posts/' in target_url
    has_content = len(content.strip()) > 0
    
    if is_draft or is_approved:
        print(f"Row {i+2}: ID={content_id} | Draft={is_draft} | Approved={is_approved} | PostsURL={has_posts_url} | HasContent={has_content}")
