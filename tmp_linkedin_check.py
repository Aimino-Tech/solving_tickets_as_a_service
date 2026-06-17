#!/usr/bin/env python3
"""Check LinkedIn campaign sheet for pacing and eligible items."""
import gspread
from datetime import datetime, timezone

gc = gspread.service_account(filename="/home/agent/.config/gspread/service_account.json")
sh = gc.open_by_key("1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY")
ws = sh.worksheet("linkedin-campaign")

# Get all data
all_data = ws.get_all_values()
headers = all_data[0] if all_data else []
data = [row for row in all_data[1:] if any(cell.strip() for cell in row)]

print("=== HEADERS ===")
for i, h in enumerate(headers):
    print(f"  Col {i}: '{h}'")

print(f"\n=== TOTAL ROWS: {len(data)} ===")

# Find last Posted item for pacing
now = datetime.now(timezone.utc)
last_post_time = None
last_post_row = None

print("\n=== ALL ITEMS ===")
for i, row in enumerate(data, start=2):
    content_id = row[0] if len(row) > 0 else ''
    action_type = row[1] if len(row) > 1 else ''
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
    
    print(f"Row {i}: ID={content_id} | Action={action_type} | Status={status} | Approval={approval}")
    print(f"  URL={target_url[:80] if target_url else 'EMPTY'}")
    print(f"  Author={target_author} | Content={content[:60] if content else 'EMPTY'}...")
    print(f"  Last_Update={last_update}")
    print(f"  Notes={notes[:60] if notes else 'EMPTY'}")
    print()
    
    # Track last Posted item
    if status == 'Posted' and last_update:
        try:
            for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S UTC', '%Y-%m-%d %H:%M UTC']:
                try:
                    ts = datetime.strptime(last_update.replace(' UTC', ''), fmt.replace(' UTC', ''))
                    ts = ts.replace(tzinfo=timezone.utc)
                    if last_post_time is None or ts > last_post_time:
                        last_post_time = ts
                        last_post_row = i
                    break
                except:
                    continue
        except:
            pass

print("\n=== PACING CHECK ===")
if last_post_time:
    gap = (now - last_post_time).total_seconds() / 60
    print(f"Last post: Row {last_post_row} at {last_post_time}")
    print(f"Current time: {now}")
    print(f"Gap: {gap:.1f} minutes")
    print(f"Can post: {'YES' if gap >= 15 else 'NO (skip - browse only)'}")
else:
    print("No Posted items found - can post freely")

# Find eligible items
print("\n=== ELIGIBLE ITEMS ===")
eligible = []
for i, row in enumerate(data, start=2):
    status = row[10].strip() if len(row) > 10 else ''
    approval = row[9].strip() if len(row) > 9 else ''
    target_url = row[3].strip() if len(row) > 3 else ''
    content = row[5].strip() if len(row) > 5 else ''
    content_id = row[0].strip() if len(row) > 0 else ''
    
    is_draft = status == 'Draft'
    is_approved = approval in ('✅ Approved', 'Approved')
    has_real_url = 'linkedin.com/posts/' in target_url
    has_content = bool(content)
    not_placeholder = 'activity-12345' not in target_url
    
    if is_draft and is_approved and has_real_url and has_content and not_placeholder:
        eligible.append((i, row))
        print(f"Row {i}: ✅ ELIGIBLE - ID={content_id}, URL={target_url[:80]}")
    elif is_draft:
        reasons = []
        if not is_approved:
            reasons.append(f'Approval={approval}')
        if not has_real_url:
            reasons.append('No real URL')
        if not has_content:
            reasons.append('Empty content')
        if not not_placeholder:
            reasons.append('Placeholder URL')
        print(f"Row {i}: ❌ Draft but BLOCKED by: {', '.join(reasons) if reasons else 'unknown'}")

print(f"\nTotal eligible: {len(eligible)}")
