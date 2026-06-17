import gspread
import json
from datetime import datetime, timezone

sa = gspread.service_account("/home/agent/.config/gspread/service_account.json")
sheet = sa.open_by_key("1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY")
ws = sheet.worksheet("linkedin-campaign")

all_rows = ws.get_all_values()
headers = all_rows[0] if all_rows else []
data_rows = all_rows[1:] if len(all_rows) > 1 else []

# ACTUAL column mapping (ProductID at B shifts everything by 1):
# A=ContentID, B=ProductID, C=ActionType, D=TargetType, E=TargetURL,
# F=TargetAuthor, G=Content, H=GuerillaTactic, I=Schedule, J=Last_Update,
# K=Approval, L=Status, M=Account, N=Agent_Notes

print("=== ACTUAL HEADERS ===")
for i, h in enumerate(headers):
    print(f"  Col {i+1} ({chr(64+i+1)}): {h}")

# Find posted items for pacing check
posted_items = []
for i, row in enumerate(data_rows):
    if len(row) >= 13:
        status = row[11]      # L = Status
        last_update = row[9]  # J = Last_Update
        content_id = row[0]   # A
        if status == "Posted" and last_update:
            posted_items.append({
                "id": content_id,
                "last_update": last_update,
                "row_num": i + 2
            })

print("\n=== POSTED ITEMS (for pacing check) ===")
for p in posted_items:
    print(f"  {p['id']}: Last_Update='{p['last_update']}', Row={p['row_num']}")

# Find eligible items
print("\n=== ELIGIBLE ITEMS (Draft + Approved + Real URL + Content) ===")
eligible = []
for i, row in enumerate(data_rows):
    if len(row) >= 14:
        content_id = row[0]    # A
        target_url = row[4]    # E = TargetURL
        target_author = row[5] # F = TargetAuthor
        content = row[6]       # G = Content
        tactic = row[7]        # H
        approval = row[10]     # K = Approval
        status = row[11]       # L = Status
        account = row[12]      # M = Account
        notes = row[13]        # N = Agent_Notes

        is_draft = status == "Draft"
        is_approved = approval in ["✅ Approved", "Approved"]
        has_real_url = "linkedin.com/posts/" in target_url and "activity-12345" not in target_url and "example-" not in target_url
        has_content = content.strip() != ""

        if is_draft and is_approved and has_real_url and has_content:
            eligible.append({
                "row_idx": i + 2,
                "id": content_id,
                "url": target_url,
                "author": target_author,
                "content": content,
                "tactic": tactic,
                "account": account
            })
            print(f"  Row {i+2}: {content_id} | URL: {target_url[:80]}")
            print(f"    Author: {target_author}")
            print(f"    Content: {content[:120]}")
            print(f"    Approval: '{approval}'")

if not eligible:
    print("  [NONE FOUND]")

# Show all Status=Draft items with their approval
print("\n=== ALL DRAFT ITEMS STATUS ===")
draft_items = []
for i, row in enumerate(data_rows):
    if len(row) >= 12:
        status = row[11]   # L
        approval = row[10] # K
        content_id = row[0]
        target_url = row[4] if len(row) > 4 else ""
        if status == "Draft":
            draft_items.append({
                "id": content_id,
                "approval": approval,
                "url": target_url[:60] if target_url else "(empty)",
                "row_num": i + 2
            })
            print(f"  Row {i+2} {content_id}: Approval='{approval}' URL={target_url[:60] if target_url else '(empty)'}")

print(f"\n=== SUMMARY ===")
print(f"Total data rows: {len(data_rows)}")
print(f"Posted items: {len(posted_items)}")
print(f"Draft items: {len(draft_items)}")
print(f"Eligible items: {len(eligible)}")

# Save JSON
output = {
    "posted_items": posted_items,
    "eligible_items": eligible,
    "draft_items": draft_items,
    "total_rows": len(data_rows)
}
with open("/home/agent/Documents/hermes-agent/sheet_result.json", "w") as f:
    json.dump(output, f, indent=2)
