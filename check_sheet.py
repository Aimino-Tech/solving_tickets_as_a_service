#!/usr/bin/env python3
"""Read the Google Sheet using service account credentials."""
import json
import os
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SERVICE_ACCOUNT_PATH = "/home/agent/Documents/hermes-agent/service-account-key.json"
RANGE = "Sheet1"

creds = Credentials.from_service_account_file(
    SERVICE_ACCOUNT_PATH,
    scopes=["https://www.googleapis.com/auth/spreadsheets"]
)

service = build("sheets", "v4", credentials=creds)

# Get all rows
result = service.spreadsheets().values().get(
    spreadsheetId=SHEET_ID,
    range=RANGE
).execute()

values = result.get("values", [])
print(f"Total rows (including header): {len(values)}")
print(f"Headers: {values[0] if values else 'empty'}")

# Find columns
if values:
    header = values[0]
    print(f"\nColumn indices:")
    for i, col in enumerate(header):
        print(f"  {i}: '{col}'")

# Print first 10 data rows
print(f"\nFirst {min(10, len(values))} rows:")
for i, row in enumerate(values[:10]):
    print(f"Row {i}: {row}")
