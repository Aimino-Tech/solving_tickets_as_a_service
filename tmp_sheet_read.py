import gspread
import json
from datetime import datetime, timezone, timedelta

# Connect to Google Sheets
gc = gspread.service_account(filename='/home/agent/.config/gspread/service_account.json')
sheet = gc.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')
ws = sheet.worksheet('linkedin-campaign')

# Get all rows
data = ws.get_all_values()
if not data:
    print("EMPTY SHEET")
    exit()

headers = data[0]
print(f"Headers: {headers}")
print(f"Total rows (including header): {len(data)}")
print()

# Find last posted comment
last_posted_time = None
last_posted_row = None
for i, row in enumerate(data[1:], start=2):  # row 2+ (1-indexed)
    status = row[10] if len(row) > 10 else ""  # K=Status (0-indexed=10)
    last_update = row[8] if len(row) > 8 else ""  # I=Last_Update (0-indexed=8)
    if status.strip() == "Posted" and last_update.strip():
        try:
            # Try to parse the timestamp
            t = datetime.strptime(last_update.strip(), "%Y-%m-%d %H:%M:%S")
            t = t.replace(tzinfo=timezone.utc)
            if last_posted_time is None or t > last_posted_time:
                last_posted_time = t
                last_posted_row = i
        except:
            pass

now = datetime.now(timezone.utc)
if last_posted_time:
    gap = (now - last_posted_time).total_seconds() / 60
    print(f"Last posted: Row {last_posted_row} at {last_posted_time}")
    print(f"Current time: {now}")
    print(f"Gap: {gap:.1f} minutes")
    if gap < 15:
        print(f"\nPAUSE: Gap is {gap:.1f} min (< 15 min). Skip posting, browse only.")
    else:
        print(f"\nPROCEED: Gap is {gap:.1f} min (>= 15 min). Can post.")
else:
    print("No posted items found yet.")
    print("PROCEED: First post, no pacing constraint.")

print()
print("=== ELIGIBLE ITEMS (Draft + Approved + Real URL) ===")
eligible = []
for i, row in enumerate(data[1:], start=2):
    content_id = row[0] if len(row) > 0 else ""  # A
    action_type = row[1] if len(row) > 1 else ""  # B
    target_type = row[2] if len(row) > 2 else ""  # C
    target_url = row[3] if len(row) > 3 else ""  # D
    target_author = row[4] if len(row) > 4 else ""  # E
    content = row[5] if len(row) > 5 else ""  # F
    tactic = row[6] if len(row) > 6 else ""  # G
    schedule = row[7] if len(row) > 7 else ""  # H
    last_update = row[8] if len(row) > 8 else ""  # I
    approval = row[9] if len(row) > 9 else ""  # J
    status = row[10] if len(row) > 10 else ""  # K
    account = row[11] if len(row) > 11 else ""  # L
    agent_notes = row[12] if len(row) > 12 else ""  # M
    
    status_ok = status.strip() == "Draft"
    approval_ok = approval.strip() in ("✅ Approved", "Approved")
    url_ok = "linkedin.com/posts/" in target_url and "activity-12345" not in target_url
    content_ok = content.strip() != ""
    
    if status_ok and approval_ok and url_ok and content_ok:
        print(f"Row {i}: ID={content_id}, Author={target_author}, URL={target_url[:80]}...")
        print(f"  Approval: {approval}, Status: {status}")
        print(f"  Content preview: {content[:120]}...")
        print()
        eligible.append({
            'row': i,
            'content_id': content_id,
            'target_url': target_url,
            'target_author': target_author,
            'content': content,
            'tactic': tactic,
            'account': account
        })

print(f"\nTotal eligible items: {len(eligible)}")

# Show all statuses for debugging
print("\n=== ALL ROWS STATUS ===")
for i, row in enumerate(data[1:], start=2):
    content_id = row[0] if len(row) > 0 else ""
    status = row[10] if len(row) > 10 else ""
    approval = row[9] if len(row) > 9 else ""
    url = row[3] if len(row) > 3 else ""
    print(f"Row {i}: ID={content_id}, Status={status}, Approval={approval}, URL={url[:60]}")
