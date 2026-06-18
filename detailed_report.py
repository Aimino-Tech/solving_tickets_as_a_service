#!/usr/bin/env python3
"""Detailed report on pipeline items."""
import json
import os
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime, timezone

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

all_rows = ws.get_all_values()
headers = all_rows[0]
data = all_rows[1:]

col = {
    'content_id': 0, 'product_id': 1, 'action_type': 2, 'target_type': 3,
    'target_url': 4, 'target_author': 5, 'content': 6, 'tactic': 7,
    'schedule': 8, 'last_update': 9, 'approval': 10, 'status': 11,
    'account': 12, 'agent_notes': 13,
}

print("=== 📋 PLANNED items (need approval) ===")
for i, row in enumerate(data):
    status = row[col['status']].strip() if col['status'] < len(row) else ""
    if status == "📋 planned":
        cid = row[col['content_id']].strip() if col['content_id'] < len(row) else ""
        url = row[col['target_url']].strip() if col['target_url'] < len(row) else ""
        author = row[col['target_author']].strip() if col['target_author'] < len(row) else ""
        content = row[col['content']].strip() if col['content'] < len(row) else ""
        account = row[col['account']].strip() if col['account'] < len(row) else ""
        print(f"  Row {i+2}: {cid} | Author={author[:40] if author else 'N/A'}")
        print(f"    URL: {url[:80] if url else 'EMPTY'}")
        print(f"    Account: {account}")
        print(f"    Content: {content[:80] if content else 'EMPTY'}")
        print()

print("=== DRAFT + DRAFT (need approval) ===")
for i, row in enumerate(data):
    status = row[col['status']].strip() if col['status'] < len(row) else ""
    approval = row[col['approval']].strip() if col['approval'] < len(row) else ""
    if status == "Draft" and approval == "Draft":
        cid = row[col['content_id']].strip() if col['content_id'] < len(row) else ""
        url = row[col['target_url']].strip() if col['target_url'] < len(row) else ""
        author = row[col['target_author']].strip() if col['target_author'] < len(row) else ""
        content = row[col['content']].strip() if col['content'] < len(row) else ""
        account = row[col['account']].strip() if col['account'] < len(row) else ""
        print(f"  Row {i+2}: {cid} | Author={author[:40] if author else 'N/A'}")
        print(f"    URL: {url[:80] if url else 'EMPTY'}")
        print(f"    Account: {account}")
        print(f"    Content: {content[:80] if content else 'EMPTY'}")
        print()

print("=== DRAFT + Needs Review (need URL replacement) ===")
for i, row in enumerate(data):
    status = row[col['status']].strip() if col['status'] < len(row) else ""
    approval = row[col['approval']].strip() if col['approval'] < len(row) else ""
    if status == "Draft" and approval == "Needs Review":
        cid = row[col['content_id']].strip() if col['content_id'] < len(row) else ""
        url = row[col['target_url']].strip() if col['target_url'] < len(row) else ""
        author = row[col['target_author']].strip() if col['target_author'] < len(row) else ""
        content = row[col['content']].strip() if col['content'] < len(row) else ""
        account = row[col['account']].strip() if col['account'] < len(row) else ""
        print(f"  Row {i+2}: {cid} | Author={author[:40] if author else 'N/A'}")
        print(f"    URL: {url[:80] if url else 'EMPTY'}")
        print(f"    Content: {content[:80] if content else 'EMPTY'}")
        print()

print("=== BROWSE entries count ===")
browse_items = [r for r in data if 'BROWSE' in (r[col['content_id']] if col['content_id'] < len(r) else "")]
print(f"  Total BROWSE entries: {len(browse_items)}")

print("=== Posted with 'Needs Review' approval (should check) ===")
for i, row in enumerate(data):
    status = row[col['status']].strip() if col['status'] < len(row) else ""
    approval = row[col['approval']].strip() if col['approval'] < len(row) else ""
    if status == "Posted" and approval == "Needs Review":
        cid = row[col['content_id']].strip() if col['content_id'] < len(row) else ""
        url = row[col['target_url']].strip() if col['target_url'] < len(row) else ""
        lu = row[col['last_update']].strip() if col['last_update'] < len(row) else ""
        print(f"  Row {i+2}: {cid} | Last_Update={lu} | {url[:60]}")
