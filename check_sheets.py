#!/usr/bin/env python3
"""Get Google Sheet metadata - list all sheets."""
import json
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SERVICE_ACCOUNT_PATH = "/home/agent/Documents/hermes-agent/service-account-key.json"

creds = Credentials.from_service_account_file(
    SERVICE_ACCOUNT_PATH,
    scopes=["https://www.googleapis.com/auth/spreadsheets"]
)

service = build("sheets", "v4", credentials=creds)

# Get spreadsheet metadata
spreadsheet = service.spreadsheets().get(spreadsheetId=SHEET_ID).execute()
print(f"Title: {spreadsheet['properties']['title']}")
print("\nSheets:")
for sheet in spreadsheet['sheets']:
    props = sheet['properties']
    print(f"  - '{props['title']}' (id={props['sheetId']}, rows={props.get('gridProperties', {}).get('rowCount', '?')}, cols={props.get('gridProperties', {}).get('columnCount', '?')})")
