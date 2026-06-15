#!/usr/bin/env python3
"""
Comment Verification System

Checks if Reddit/HN comments are still live.
Updates sheet status if comments were removed.

Usage:
    python3 verify_comments.py              # Check all
    python3 verify_comments.py --profile 2  # Check specific profile
    python3 verify_comments.py --id ODA000492  # Check specific comment
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests
import sqlite3

# ── Config ──────────────────────────────────────────────────────────────────
SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")
DB_PATH = os.path.expanduser("~/.hermes/marketing_monitor.db")


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


def check_reddit_comment(comment_url):
    """Check if a Reddit comment is still live."""
    try:
        # Convert to API URL
        api_url = comment_url.replace("www.reddit.com", "api.reddit.com")
        if not api_url.endswith(".json"):
            api_url += ".json"
        
        headers = {"User-Agent": "Mozilla/5.0 (compatible; CommentChecker/1.0)"}
        r = requests.get(api_url, headers=headers, timeout=30)
        
        if r.status_code == 200:
            data = r.json()
            # Check if comment exists
            if data and len(data) > 1:
                comment_data = data[1]["data"]["children"][0]["data"]
                if comment_data.get("body") and not comment_data.get("body").startswith("[removed]"):
                    return {"status": "live", "body": comment_data["body"][:100]}
                else:
                    return {"status": "removed"}
            else:
                return {"status": "not_found"}
        elif r.status_code == 404:
            return {"status": "not_found"}
        else:
            return {"status": "unknown", "code": r.status_code}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def check_hn_comment(comment_url):
    """Check if a Hacker News comment is still live."""
    try:
        # Extract item ID from URL
        if "item?id=" in comment_url:
            item_id = comment_url.split("item?id=")[1].split("&")[0]
        else:
            return {"status": "unknown", "error": "Cannot parse HN URL"}
        
        # HN API
        api_url = f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json"
        r = requests.get(api_url, timeout=30)
        
        if r.status_code == 200:
            data = r.json()
            if data and data.get("text"):
                return {"status": "live", "text": data["text"][:100]}
            else:
                return {"status": "deleted"}
        else:
            return {"status": "not_found"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Comment Verification System")
    parser.add_argument("--profile", type=str, help="Check specific profile only")
    parser.add_argument("--id", type=str, help="Check specific content ID")
    parser.add_argument("--dry-run", action="store_true", help="Preview without updating sheet")
    args = parser.parse_args()
    
    print(f"🔍 Comment Verification System")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # Connect to Sheets
    creds, headers = get_sheets_client()
    
    # Read all replied items
    rows = read_sheet_range(headers, "guerrilla-content-plan", "A2:M1200")
    
    # Filter items to check
    items_to_check = []
    for i, row in enumerate(rows):
        if not row or len(row) < 10:
            continue
        
        content_id = row[0] if len(row) > 0 else ""
        status = row[9] if len(row) > 9 else ""
        platform_url = row[3] if len(row) > 3 else ""
        profile = row[10] if len(row) > 10 else ""
        
        # Filter by ID if specified
        if args.id and content_id != args.id:
            continue
        
        # Filter by profile if specified
        if args.profile and args.profile not in profile:
            continue
        
        # Only check "Replied" items
        if "Replied" not in status:
            continue
        
        # Only check Reddit items (for now)
        if "Reddit" not in platform_url and "reddit.com" not in platform_url:
            continue
        
        items_to_check.append({
            "row": i + 2,  # +2 for header and 0-index
            "id": content_id,
            "url": platform_url,
            "profile": profile,
        })
    
    print(f"\n📋 Found {len(items_to_check)} items to check")
    
    # Check each item
    results = {"live": 0, "removed": 0, "error": 0}
    
    for item in items_to_check:
        print(f"\n  Checking {item['id']}...", end=" ")
        
        # Check comment
        if "reddit.com" in item["url"]:
            result = check_reddit_comment(item["url"])
        elif "news.ycombinator.com" in item["url"]:
            result = check_hn_comment(item["url"])
        else:
            result = {"status": "unknown"}
        
        # Print result
        if result["status"] == "live":
            print("✅ LIVE")
            results["live"] += 1
        elif result["status"] == "removed":
            print("❌ REMOVED")
            results["removed"] += 1
            # Update sheet
            if not args.dry_run:
                try:
                    update_sheet_cell(headers, "guerrilla-content-plan", 
                                    f"J{item['row']}", "❌ Removed by Reddit")
                    print(f"    → Updated sheet to '❌ Removed by Reddit'")
                except Exception as e:
                    print(f"    → Error updating sheet: {e}")
        elif result["status"] == "not_found":
            print("⚠️  NOT FOUND")
            results["error"] += 1
        else:
            print(f"❓ {result['status']}")
            results["error"] += 1
        
        # Rate limit
        time.sleep(1)
    
    # Summary
    print(f"\n{'=' * 60}")
    print(f"📊 VERIFICATION SUMMARY")
    print(f"{'=' * 60}")
    print(f"  ✅ Live: {results['live']}")
    print(f"  ❌ Removed: {results['removed']}")
    print(f"  ⚠️  Error/Unknown: {results['error']}")
    print(f"  📋 Total checked: {len(items_to_check)}")
    
    if results["removed"] > 0:
        print(f"\n⚠️  {results['removed']} comments were removed!")
        print(f"  → Consider adjusting content strategy")
        print(f"  → Check if accounts are flagged")
    
    print(f"\n✅ Verification complete!")


if __name__ == "__main__":
    main()
