#!/usr/bin/env python3
"""Verify the sheet update by reading row 133."""
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

# Read row 133
result = service.spreadsheets().values().get(
    spreadsheetId=SHEET_ID,
    range=f"{SHEET_NAME}!A133:M133"
).execute()

row = result.get("values", [])
print(f"Row 133: {row[0] if row else 'empty'}")

# Also check if there are still pending Profile 2 items
result2 = service.spreadsheets().values().get(
    spreadsheetId=SHEET_ID,
    range=f"{SHEET_NAME}!A:M"
).execute()

values = result2.get("values", [])
remaining = 0
for idx, row in enumerate(values):
    if idx == 0:
        continue
    profile_val = str(row[10]).strip() if 10 < len(row) else ""
    status_val = str(row[9]).strip() if 9 < len(row) else ""
    is_profile2 = 'profile 2' in profile_val.lower() or 'slow-guy' in profile_val.lower()
    is_planned = '📋' in status_val or 'planned' in status_val.lower()
    if is_profile2 and is_planned:
        remaining += 1
        print(f"\nStill pending at row {idx+1}: status='{status_val}'")

print(f"\nRemaining Profile 2 items: {remaining}")
