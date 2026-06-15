#!/usr/bin/env python3
"""Check Twitter guerrilla campaign status."""
import json
from datetime import datetime, timezone

# Check service account
try:
    with open('/home/agent/.config/gspread/service_account.json') as f:
        data = json.load(f)
    print(f"Service account: {data.get('client_email', 'N/A')}")
except Exception as e:
    print(f"Error reading service account: {e}")

# Check today's posts from sheet
try:
    import gspread
    from google.oauth2.service_account import Credentials
    
    creds = Credentials.from_service_account_file(
        '/home/agent/.config/gspread/service_account.json',
        scopes=['https://www.googleapis.com/auth/spreadsheets']
    )
    gc = gspread.authorize(creds)
    sheet = gc.open_by_key('1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY')
    ws = sheet.worksheet('twitter-campaign')
    
    all_data = ws.get_all_values()
    print(f"\nTotal rows in sheet: {len(all_data)}")
    
    if len(all_data) > 1:
        # Show last few entries
        print("\nLast 5 entries:")
        for row in all_data[-5:]:
            content_id = row[0] if len(row) > 0 else ''
            action_type = row[1] if len(row) > 1 else ''
            target_url = row[3] if len(row) > 3 else ''
            status = row[10] if len(row) > 10 else ''
            last_update = row[8] if len(row) > 8 else ''
            print(f"  {content_id} | {action_type} | {target_url[:50]} | Status: {status} | {last_update}")
        
        # Count today's posts
        today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        today_posts = [row for row in all_data[1:] if len(row) > 8 and today in str(row[8])]
        print(f"\nToday's posts ({today}): {len(today_posts)}")
    else:
        print("\nNo entries in sheet yet")
        
except Exception as e:
    print(f"Error reading sheet: {e}")
