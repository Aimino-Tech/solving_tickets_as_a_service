#!/usr/bin/env python3
"""Post the next pending Reddit comment for Profile 3 (Pro_Shame / xdn3)."""
import json
import re
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SHEET_NAME = "guerrilla-content-plan"
SERVICE_ACCOUNT_PATH = "/home/agent/Documents/hermes-agent/service-account-key.json"

# Token provided by the user for Profile 3
REDDIT_TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6IlNIQTI1NjpzS3dsMnlsV0VtMjVmcXhwTU40cWY4MXE2OWFFdWFyMnpLMUdhVGxjdWNZIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyIiwiZXhwIjoxNzgwODczNjQxLjc3NTY0NiwiaWF0IjoxNzgwNzg3MjQxLjc3NTY0NiwianRpIjoiRUpvVzdEXzBRMUpWSXhmalBEazhtOUNuczlQWG9BIiwiY2lkIjoiMFItV0FNaHVvby1NeVEiLCJsaWQiOiJ0Ml8yZXdodjNvc3V2IiwiYWlkIjoidDJfMmV3aHYzb3N1diIsImF0IjoxLCJsY2EiOjE3Nzk0NDg3OTY4NTAsInNjcCI6ImVKeGtrZEdPdERBSWhkLUZhNV9nZjVVX20wMXRjWWFzTFFhb2szbjdEVm9jazcwN2NENHBIUDlES29xRkRDWlhncW5BQkZnVHJUREJSdVQ5bkxtM2cyaU5lOHRZc1puQ0JGbXdGRHJrbUxHc2lRUW1lSklheXhzbW9JTE55Rnl1dEdOTkxUMFFKcWhjTXJlRkhwYzJvYmtiaTU2ZEdGVzVyRHlvc1ZmbDB0akdGTFlueGpjYnF3MnB1QzZuTWtuTFF2a3NYdlRqTjlXMzl2bXpfU2EwSjhPS3F1bUIzaGxKQ0c0c2ZwaW0zZDlUazU2dEN4YTE5M3FRMnVkNjNLNTkxaXcwTzdlZjZfbHJJeG1YWTJoLUp2dDMxeS1oQTQ4OEx6UHFBRWFzNFVjWmRtUWRfbFVIVUxtZ0pHTUo0dE1JNU1ybDIzOEp0bXZUdjhidEV6OThNLUttTl96V0ROUnpDZUxRcF9IMUd3QUFfXzhRMWVUUiIsInJjaWQiOiJwT3lLREtWbXdidUpTRFQxaVFSc2h0cUJLVElELWlZcnA3cnVsY2JWWkM4IiwiZmxvIjoyfQ.Q5HXALTTKVVEEtjIu-8tJpnphhajAarZcMhbcbdbomLnFNJVFZmv4-aMpogQ4fJ6C5JOh1hTGoXiPFVINAyZ1ywdEHduUryB0Bo5Hgj-a41XDNHRMZRaWGmsYgHBWolkeaMZBPzpMLb6qLxjC0DYMligYHAoEsPXKh7dAQnCsSqa526ACtsx4nfS5G7D1-UiXep2E_MZCR8k7D5YG1Z1jvt2gR0NvTz-ErSqQSCL7Z0nw2__-_hWMlolFv8lBwUARMtL401wltQGeUJaRK_IBPxWOs7AngU-6l3bLeUITFOW-79lcTYMvBrkGOOawhz65TYVzjIBG4m7P8aUNadhug"


def get_sheet_data():
    """Read all rows from the guerrilla-content-plan sheet."""
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_PATH,
        scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    service = build("sheets", "v4", credentials=creds)
    result = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range=f"{SHEET_NAME}!A:M"
    ).execute()
    return result.get("values", [])


def get_reddit_thing_id(url):
    """Extract Reddit thing_id from URL."""
    m = re.search(r'/comments/([a-z0-9]+)/', url)
    if m:
        return f"t3_{m.group(1)}"
    return None


def post_reddit_comment(thing_id, text, token):
    """Post a comment to Reddit via the API."""
    url = "https://oauth.reddit.com/api/comment"
    
    data = urllib.parse.urlencode({
        "thing_id": thing_id,
        "text": text
    }).encode()
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36"
    }
    
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return {"status": resp.status, "body": body}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": e.read().decode(), "error": str(e)}


def update_sheet_status(row_num, status_text):
    """Update the Status and Last_Update columns in the sheet."""
    creds = Credentials.from_service_account_file(
        SERVICE_ACCOUNT_PATH,
        scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    service = build("sheets", "v4", credentials=creds)
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    # Update Status (Col J, index 9)
    status_range = f"{SHEET_NAME}!J{row_num}"
    service.spreadsheets().values().update(
        spreadsheetId=SHEET_ID,
        range=status_range,
        valueInputOption="USER_ENTERED",
        body={"values": [[status_text]]}
    ).execute()
    
    # Update Last_Update (Col H, index 7)
    update_range = f"{SHEET_NAME}!H{row_num}"
    service.spreadsheets().values().update(
        spreadsheetId=SHEET_ID,
        range=update_range,
        valueInputOption="USER_ENTERED",
        body={"values": [[today]]}
    ).execute()
    
    print(f"✓ Sheet row {row_num} updated: Status='{status_text}', Last_Update='{today}'")


def main():
    values = get_sheet_data()
    if not values:
        print("No data found!")
        return
    
    header = values[0]
    print(f"Headers: {header}")
    
    # Find the first Profile 3 item with planned status (lowest row number)
    profile3_items = []
    for idx, row in enumerate(values):
        if idx == 0:
            continue
        
        profile_val = str(row[10]).strip() if 10 < len(row) else ""
        status_val = str(row[9]).strip() if 9 < len(row) else ""
        
        is_profile3 = ('profile 3' in profile_val.lower() or 
                       'xdn3' in profile_val.lower() or 
                       'pro_shame' in profile_val.lower())
        is_planned = '📋' in status_val or 'planned' in status_val.lower()
        
        if is_profile3 and is_planned:
            content = str(row[5]).strip() if 5 < len(row) else ""
            url = str(row[3]).strip() if 3 < len(row) else ""
            profile3_items.append({
                'row_num': idx + 1,
                'content': content,
                'url': url
            })
    
    if not profile3_items:
        print("All Profile 3 done")
        return
    
    item = profile3_items[0]
    print(f"\nPosting comment for row {item['row_num']}")
    print(f"  URL: {item['url']}")
    print(f"  Content: {item['content'][:100]}...")
    
    # Extract thing_id from URL
    thing_id = get_reddit_thing_id(item['url'])
    if not thing_id:
        print(f"✗ Could not extract thing_id from URL: {item['url']}")
        return
    
    print(f"  Thing ID: {thing_id}")
    
    # Post the comment
    print(f"\nPosting to Reddit...")
    result = post_reddit_comment(thing_id, item['content'], REDDIT_TOKEN)
    print(f"  Response status: {result['status']}")
    print(f"  Response body: {result['body'][:500]}")
    
    # Check for true success: HTTP 200 AND {"success": true} in body
    success = False
    is_ratelimited = False
    try:
        body_json = json.loads(result['body']) if result['body'] else {}
        if body_json.get('success') is True:
            success = True
        elif body_json.get('success') is False:
            # Check for rate limit message in jQuery commands
            body_str = result['body']
            if 'RATELIMIT' in body_str or 'Take a break' in body_str:
                is_ratelimited = True
            elif body_json.get('error') == 429:
                is_ratelimited = True
    except json.JSONDecodeError:
        pass
    
    if success:
        print(f"\n✓ Comment posted successfully!")
        update_sheet_status(item['row_num'], "✅ Replied")
    elif is_ratelimited or result['status'] == 429:
        print(f"\n⚠ Rate limited! Will retry next run.")
        # Don't update the sheet - it will retry
    elif 'error' in result:
        print(f"\n✗ Error posting: {result['error']}")
        try:
            body = json.loads(result['body']) if result['body'] else {}
            if body.get('error') == 429:
                print("  (rate limited)")
            else:
                print(f"  Full body: {result['body'][:500]}")
        except json.JSONDecodeError:
            print(f"  Full body: {result['body'][:500]}")


if __name__ == "__main__":
    main()
