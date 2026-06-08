#!/usr/bin/env python3
"""Read the guerrilla-content-plan sheet - find rows matching Profile 2 with planned status."""
import json
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SHEET_NAME = "guerrilla-content-plan"
SERVICE_ACCOUNT_PATH = "/home/agent/Documents/hermes-agent/service-account-key.json"

creds = Credentials.from_service_account_file(
    SERVICE_ACCOUNT_PATH,
    scopes=["https://www.googleapis.com/auth/spreadsheets"]
)

service = build("sheets", "v4", credentials=creds)

# Read the data
result = service.spreadsheets().values().get(
    spreadsheetId=SHEET_ID,
    range=f"{SHEET_NAME}!A1:T380"
).execute()

values = result.get("values", [])
print(f"Total rows: {len(values)}")

if not values:
    print("No data!")
    exit()

header = values[0]
print(f"\nHeaders ({len(header)} columns):")
for i, col in enumerate(header):
    print(f"  Col {i}: '{col}'")

# Find column indices for Status, Chrome_Profile, Content, URL, Last_Update
col_map = {}
for i, col in enumerate(header):
    col_lower = col.lower().strip()
    if 'status' in col_lower:
        col_map['status'] = i
    if 'chrome' in col_lower and 'profile' in col_lower:
        col_map['profile'] = i
    if col_lower in ('content', 'comment', 'comment text', 'reply'):
        col_map['content'] = i
    if col_lower in ('url', 'link', 'post url', 'thread url'):
        col_map['url'] = i
    if 'last_update' in col_lower or 'last update' in col_lower or 'updated' in col_lower:
        col_map['last_update'] = i
    if 'thing_id' in col_lower or 'post id' in col_lower or 'id' in col_lower:
        col_map['thing_id'] = i

print(f"\nColumn map: {col_map}")

# Search for Profile 2 rows with planned status
print("\n--- Scanning all rows for Profile 2 + planned status ---")
profile2_items = []
for idx, row in enumerate(values):
    if idx == 0:
        continue  # skip header
    
    profile_val = str(row[col_map.get('profile', 0)]).strip() if col_map.get('profile', 0) < len(row) else ""
    status_val = str(row[col_map.get('status', 0)]).strip() if col_map.get('status', 0) < len(row) else ""
    
    is_profile2 = 'profile 2' in profile_val.lower() or 'slow-guy' in profile_val.lower()
    is_planned = '📋' in status_val or 'planned' in status_val.lower()
    
    if is_profile2 and is_planned:
        profile2_items.append({
            'row_num': idx + 1,  # 1-indexed to match sheet
            'profile': profile_val,
            'status': status_val,
            'content': str(row[col_map.get('content', 0)]).strip() if col_map.get('content', 0) < len(row) else "",
            'url': str(row[col_map.get('url', 0)]).strip() if col_map.get('url', 0) < len(row) else "",
            'thing_id': str(row[col_map.get('thing_id', 0)]).strip() if col_map.get('thing_id', 0) < len(row) else "",
        })
        print(f"  Row {idx+1}: status='{status_val}' profile='{profile_val}' url='{profile2_items[-1]['url'][:80]}...'")

print(f"\nFound {len(profile2_items)} Profile 2 items with planned status")
if profile2_items:
    item = profile2_items[0]
    print(f"\n--- First item (row {item['row_num']}) ---")
    print(f"  Content: {item['content']}")
    print(f"  URL: {item['url']}")
    print(f"  Thing ID: {item['thing_id']}")
    print(f"  Full row data: {values[item['row_num']-1]}")
