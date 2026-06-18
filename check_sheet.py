#!/usr/bin/env python3
"""Check the LinkedIn campaign sheet for pacing and eligible items."""
import json
import os
from datetime import datetime, timezone

# Google Sheets API
import gspread
from oauth2client.service_account import ServiceAccountCredentials

SERVICE_ACCOUNT = "/home/agent/.config/gspread/service_account.json"
SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"

scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]
creds = ServiceAccountCredentials.from_json_keyfile_name(SERVICE_ACCOUNT, scope)
client = gspread.authorize(creds)
sheet = client.open_by_key(SHEET_ID)
ws = sheet.worksheet("linkedin-campaign")

# Get all records
all_rows = ws.get_all_values()
headers = all_rows[0]
data = all_rows[1:]

print(f"Headers ({len(headers)}): {headers}")
print(f"Total rows: {len(data)}")
print(f"Sheet grid dimensions: {ws.row_count} rows x {ws.col_count} cols")

# Column mapping (0-indexed) per the updated reference:
# A=0 ContentID, B=1 ProductID, C=2 ActionType, D=3 TargetType, 
# E=4 TargetURL, F=5 TargetAuthor, G=6 Content, H=7 GuerillaTactic,
# I=8 Schedule, J=9 Last_Update, K=10 Approval, L=11 Status,
# M=12 Account, N=13 Agent_Notes, O=14 Human_Notes, P=15 Engagement

col = {
    'content_id': 0,
    'product_id': 1,
    'action_type': 2,
    'target_type': 3,
    'target_url': 4,
    'target_author': 5,
    'content': 6,
    'tactic': 7,
    'schedule': 8,
    'last_update': 9,
    'approval': 10,
    'status': 11,
    'account': 12,
    'agent_notes': 13,
    'human_notes': 14,
    'engagement': 15,
}

# Print column mapping verification
for key, idx in col.items():
    if idx < len(headers):
        print(f"  Col {idx}: {key} -> header='{headers[idx]}'")
    else:
        print(f"  Col {idx}: {key} -> OUT OF RANGE (only {len(headers)} columns)")

print()

# Check all status/approval combinations
status_counts = {}
for i, row in enumerate(data):
    status = row[col['status']].strip() if col['status'] < len(row) else ""
    approval = row[col['approval']].strip() if col['approval'] < len(row) else ""
    url = row[col['target_url']].strip() if col['target_url'] < len(row) else ""
    content = row[col['content']].strip() if col['content'] < len(row) else ""
    content_id = row[col['content_id']].strip() if col['content_id'] < len(row) else ""
    
    key = f"Status='{status}' Approval='{approval}'"
    status_counts[key] = status_counts.get(key, 0) + 1

print("Status x Approval combinations:")
for key, count in sorted(status_counts.items()):
    print(f"  {key}: {count}")

print()

# Find last posted timestamp for pacing
print("=== Posted Items (Last_Update timestamps) ===")
last_posted = None
for i, row in enumerate(data):
    status = row[col['status']].strip() if col['status'] < len(row) else ""
    lu = row[col['last_update']].strip() if col['last_update'] < len(row) else ""
    content_id = row[col['content_id']].strip() if col['content_id'] < len(row) else ""
    if status == "Posted" and lu:
        print(f"  Row {i+2}: {content_id} | Last_Update={lu}")
        last_posted = lu

print(f"\nMost recent posted timestamp: {last_posted}")

# Find eligible items
print("\n=== Eligible Items (Draft + Approved + Real URL + Content) ===")
eligible = []
for i, row in enumerate(data):
    if len(row) < 12:
        continue
    status = row[col['status']].strip()
    approval = row[col['approval']].strip()
    url = row[col['target_url']].strip()
    content = row[col['content']].strip()
    content_id = row[col['content_id']].strip()
    author = row[col['target_author']].strip() if col['target_author'] < len(row) else ""
    action = row[col['action_type']].strip() if col['action_type'] < len(row) else ""
    account = row[col['account']].strip() if col['account'] < len(row) else ""

    # Check eligibility
    is_draft = status == "Draft"
    is_approved = approval in ["✅ Approved", "Approved"]
    has_real_url = "linkedin.com/posts/" in url and "activity-12345" not in url and "example-" not in url
    has_content = len(content) > 0

    if is_draft and is_approved and has_real_url and has_content:
        eligible.append({
            'row': i + 2,  # 1-indexed + header
            'content_id': content_id,
            'url': url,
            'author': author,
            'content': content,
            'account': account,
            'action': action,
        })
        print(f"  Row {i+2}: {content_id} | {author} | {url[:80]}...")
        print(f"    Content: {content[:100]}...")
        print(f"    Account: {account}")
        print()

if not eligible:
    print("  No eligible items found!")
    # Show items that are Draft but not approved etc.
    print("\n=== Near-miss items ===")
    for i, row in enumerate(data):
        if len(row) < 12:
            continue
        status = row[col['status']].strip()
        approval = row[col['approval']].strip()
        url = row[col['target_url']].strip()
        content = row[col['content']].strip()
        content_id = row[col['content_id']].strip()
        
        if status == "Draft" and url and "linkedin.com/posts/" in url:
            print(f"  Row {i+2}: {content_id} | Approval='{approval}' | Status='{status}' | URL={url[:60]}...")

print(f"\nTotal eligible items: {len(eligible)}")

# Output as JSON for parsing
result = {
    "last_posted": last_posted,
    "eligible_count": len(eligible),
    "eligible": eligible,
    "rows_total": len(data),
}
print(f"\nJSON_OUTPUT:{json.dumps(result)}")
