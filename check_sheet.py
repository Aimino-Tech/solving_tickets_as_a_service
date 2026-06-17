import gspread
from datetime import datetime, timezone

sa = gspread.service_account("/home/agent/.config/gspread/service_account.json")
sheet = sa.open_by_key("1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY")
ws = sheet.worksheet("linkedin-campaign")

all_rows = ws.get_all_values()
headers = all_rows[0] if all_rows else []
data_rows = all_rows[1:] if len(all_rows) > 1 else []

print("=== HEADERS ===")
for i, h in enumerate(headers):
    print(f"  Col {i+1} ({chr(64+i+1)}): {h}")

print(f"\n=== DATA ROWS: {len(data_rows)} ===")

# Find posted items for pacing check
posted_items = []
for row in data_rows:
    if len(row) >= 12:
        status = row[10]
        last_update = row[8]
        content_id = row[0]
        if status == "Posted" and last_update:
            posted_items.append({
                "id": content_id,
                "last_update": last_update,
                "idx": all_rows.index(row) + 2  # 1-indexed row (header is row 1)
            })

print("\n=== POSTED ITEMS (for pacing check) ===")
for p in posted_items:
    print(f"  {p['id']}: Last_Update='{p['last_update']}', Row={p['idx']}")

# Find eligible items
print("\n=== ELIGIBLE ITEMS (Draft + Approved + Real URL + Content) ===")
eligible = []
for i, row in enumerate(data_rows):
    if len(row) >= 13:
        content_id = row[0]
        target_url = row[3]
        target_author = row[4]
        content = row[5]
        tactic = row[6]
        approval = row[9]
        status = row[10]
        account = row[11]

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
            print(f"  Row {i+2}: {content_id} | URL: {target_url[:80]}...")
            print(f"    Author: {target_author}")
            print(f"    Content: {content[:100]}...")
            print(f"    Tactic: {tactic}")

if not eligible:
    print("  [NONE FOUND]")

print(f"\n=== SUMMARY ===")
print(f"Total rows: {len(data_rows)}")
print(f"Posted items: {len(posted_items)}")
print(f"Eligible items: {len(eligible)}")

# Check for items that are Draft but not approved
print("\n=== DRAFT ITEMS WITH ISSUES ===")
for i, row in enumerate(data_rows):
    if len(row) >= 12:
        status = row[10]
        approval = row[9]
        content_id = row[0]
        if status == "Draft":
            print(f"  {content_id}: Status=Draft, Approval='{approval}'")

# Output JSON for easy parsing
import json
output = {
    "posted_items": posted_items,
    "eligible_items": eligible,
    "total_rows": len(data_rows)
}
with open("/home/agent/Documents/hermes-agent/sheet_result.json", "w") as f:
    json.dump(output, f, indent=2)
print("\nJSON saved to sheet_result.json")
