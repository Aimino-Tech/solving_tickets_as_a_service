#!/usr/bin/env python3
"""
Comment Verification via Chrome CDP

Checks if comments are still live by visiting them in Chrome.
Reddit API is blocked — must use Chrome/CDP.

Usage:
    python3 verify_via_chrome.py              # Check all unverified
    python3 verify_via_chrome.py --id ODA000492  # Check specific
"""

import os
import sys
import json
import time
import subprocess
import argparse
from datetime import datetime, timezone
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")
CHROME_MGR = os.path.expanduser("~/.hermes/chrome_session_manager.py")


def get_sheets_client():
    creds = Credentials.from_service_account_file(SA_PATH, scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ])
    creds.refresh(Request())
    headers = {"Authorization": f"Bearer {creds.token}"}
    return creds, headers


def read_sheet_range(headers, sheet_name, cell_range):
    import urllib.parse
    range_str = f"{sheet_name}!{cell_range}"
    encoded_range = urllib.parse.quote(range_str)
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("values", [])


def update_sheet_cell(headers, sheet_name, cell_range, value):
    import urllib.parse
    range_str = f"{sheet_name}!{cell_range}"
    encoded_range = urllib.parse.quote(range_str)
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
    body = {"values": [[value]]}
    r = requests.put(url, headers=headers, json=body,
                     params={"valueInputOption": "USER_ENTERED"}, timeout=30)
    r.raise_for_status()
    return r


def get_chrome_ws_url(profile="xdn2"):
    """Get Chrome WebSocket URL for a profile."""
    port_map = {
        "xdn1": 9223, "xdn2": 9224, "xdn3": 9225,
        "xdn4": 9226, "xdn8": 9228
    }
    port = port_map.get(profile, 9224)
    try:
        r = requests.get(f"http://localhost:{port}/json", timeout=5)
        tabs = r.json()
        # Find a tab or use new tab
        for tab in tabs:
            if tab.get("type") == "page":
                return tab.get("webSocketDebuggerUrl"), port
        # Open new tab
        r2 = requests.get(f"http://localhost:{port}/json/new?about:blank", timeout=5)
        tab = r2.json()
        return tab.get("webSocketDebuggerUrl"), port
    except Exception as e:
        print(f"  ⚠️ Chrome not running on port {port}: {e}")
        return None, port


def check_comment_via_chrome(url, profile="xdn2"):
    """Visit comment URL in Chrome and check if it's visible."""
    ws_url, port = get_chrome_ws_url(profile)
    if not ws_url:
        return {"status": "chrome_not_running", "profile": profile}
    
    try:
        # Use CDP to navigate and check
        # Simple approach: just check if page loads with comment content
        import websocket
        ws = websocket.create_connection(ws_url, timeout=15)
        
        # Navigate to URL
        ws.send(json.dumps({
            "id": 1,
            "method": "Page.navigate",
            "params": {"url": url}
        }))
        result = json.loads(ws.recv())
        
        # Wait for page load
        time.sleep(3)
        
        # Get page content
        ws.send(json.dumps({
            "id": 2,
            "method": "Runtime.evaluate",
            "params": {"expression": "document.body.innerText"}
        }))
        result = json.loads(ws.recv())
        
        page_text = result.get("result", {}).get("result", {}).get("value", "")
        
        ws.close()
        
        # Check for removed indicators
        if "Comment removed by Reddit" in page_text:
            return {"status": "removed", "reason": "removed_by_reddit"}
        elif "This comment has been removed" in page_text:
            return {"status": "removed", "reason": "removed"}
        elif "[deleted]" in page_text or "[removed]" in page_text:
            return {"status": "removed", "reason": "deleted_or_removed"}
        elif "Page not found" in page_text or "404" in page_text:
            return {"status": "not_found"}
        else:
            # Comment appears to be live
            return {"status": "live"}
            
    except ImportError:
        return {"status": "error", "error": "websocket-client not installed"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Comment Verification via Chrome")
    parser.add_argument("--id", type=str, help="Check specific content ID")
    parser.add_argument("--profile", type=str, help="Chrome profile to use")
    parser.add_argument("--dry-run", action="store_true", help="Preview without updating")
    args = parser.parse_args()
    
    print(f"🔍 Comment Verification via Chrome")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # Connect to Sheets
    creds, headers = get_sheets_client()
    
    # Read replied items
    rows = read_sheet_range(headers, "reddit-campaign", "A2:M1200")
    
    items_to_check = []
    for i, row in enumerate(rows):
        if not row or len(row) < 10:
            continue
        
        content_id = row[0] if len(row) > 0 else ""
        status = row[9] if len(row) > 9 else ""
        platform_url = row[3] if len(row) > 3 else ""
        profile = row[10] if len(row) > 10 else ""
        
        if args.id and content_id != args.id:
            continue
        
        if "Replied" not in status:
            continue
        
        if "reddit.com" not in platform_url:
            continue
        
        # Extract profile name
        profile_name = "xdn2"  # default
        if "xdn1" in profile or "Profile 1" in profile:
            profile_name = "xdn1"
        elif "xdn2" in profile or "Profile 2" in profile or "Slow-Guy" in profile:
            profile_name = "xdn2"
        elif "xdn3" in profile or "Profile 3" in profile or "Pro_Shame" in profile:
            profile_name = "xdn3"
        elif "xdn4" in profile or "Profile 4" in profile or "J0llibee" in profile:
            profile_name = "xdn4"
        elif "xdn8" in profile or "Profile 5" in profile or "Love_KCF" in profile:
            profile_name = "xdn8"
        
        if args.profile and profile_name != args.profile:
            continue
        
        items_to_check.append({
            "row": i + 2,
            "id": content_id,
            "url": platform_url,
            "profile": profile_name,
        })
    
    print(f"\n📋 Found {len(items_to_check)} items to check")
    
    if not items_to_check:
        print("Nothing to check.")
        return
    
    # Check each item
    results = {"live": 0, "removed": 0, "error": 0}
    
    for item in items_to_check:
        print(f"\n  Checking {item['id']} (profile: {item['profile']})...", end=" ")
        
        result = check_comment_via_chrome(item["url"], item["profile"])
        
        if result["status"] == "live":
            print("✅ LIVE")
            results["live"] += 1
        elif result["status"] == "removed":
            print(f"❌ REMOVED ({result.get('reason', 'unknown')})")
            results["removed"] += 1
            if not args.dry_run:
                try:
                    update_sheet_cell(headers, "reddit-campaign",
                                    f"J{item['row']}", "❌ Removed by Reddit")
                    print(f"    → Sheet updated")
                except Exception as e:
                    print(f"    → Update error: {e}")
        else:
            print(f"⚠️  {result['status']}")
            results["error"] += 1
        
        time.sleep(2)  # Rate limit
    
    print(f"\n{'=' * 60}")
    print(f"📊 SUMMARY: ✅ {results['live']} live | ❌ {results['removed']} removed | ⚠️ {results['error']} errors")
    
    if results["removed"] > 0:
        print(f"\n⚠️  {results['removed']} comments were REMOVED by Reddit!")
        print(f"  → Review content strategy for these accounts")


if __name__ == "__main__":
    main()
