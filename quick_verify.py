#!/usr/bin/env python3
import os, json, time, urllib.parse
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")

ACCOUNTS = ["CommentAwkward3993", "Slow-Guy-Chiu", "Pro_Shame", "J0llibee_yummy", "Love-KCF", "Love_KCF", "Reddit-General"]

def get_sheets_client():
    creds = Credentials.from_service_account_file(SA_PATH, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    creds.refresh(Request())
    return {"Authorization": f"Bearer {creds.token}"}

def check_comment_json(url):
    if "www.reddit.com" in url:
        url = url.replace("www.reddit.com", "old.reddit.com")
    if not url.endswith(".json"):
        url = url.rstrip("/") + "/.json"
    h = {"User-Agent": "Mozilla/5.0"}
    try:
        r = requests.get(url, headers=h, timeout=15)
        if r.status_code in (404, 403):
            return {"status": str(r.status_code)}
        r.raise_for_status()
        data = r.json()
        if not isinstance(data, list) or len(data) < 2:
            return {"status": "no_data"}
        comments = data[1].get("data", {}).get("children", [])
        for c in comments:
            if c.get("kind") == "t1":
                d = c.get("data", {})
                author = d.get("author", "")
                body = d.get("body", "")
                if any(a in author for a in ACCOUNTS):
                    return {"status": "found", "author": author, "body": body[:200]}
        return {"status": "not_found_in_comments"}
    except Exception as e:
        return {"status": "error", "error": str(e)[:80]}

def main():
    headers = get_sheets_client()
    r = requests.get(f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/reddit-campaign!A2:L1200", headers=headers, timeout=30)
    r.raise_for_status()
    rows = r.json().get("values", [])
    
    items = []
    for i, row in enumerate(rows):
        if not row or len(row) < 10:
            continue
        status = row[9] if len(row) > 9 else ""
        platform_url = row[3] if len(row) > 3 else ""
        if "Replied" not in status or "reddit.com" not in platform_url or "Removed" in status:
            continue
        items.append({"row": i+2, "id": row[0], "url": platform_url})
    
    seen = set()
    unique = []
    for item in items:
        try:
            p = urllib.parse.urlparse(item["url"]).path
            if p not in seen:
                seen.add(p)
                unique.append(item)
        except:
            pass
    
    check = unique[:30]
    print(f"Checking {len(check)} unique URLs...")
    
    removed = []
    live = 0
    errors = 0
    
    for item in check:
        result = check_comment_json(item["url"])
        if result["status"] == "found":
            body = result.get("body", "")
            author = result.get("author", "")
            if "[removed]" in body.lower() or "[deleted]" in body.lower():
                removed.append({"id": item["id"], "author": author, "body": body[:100]})
                print(f"  REMOVED: {item['id']} by {author}")
            else:
                live += 1
                print(f"  LIVE: {item['id']} by {author}")
        elif result["status"] in ("404", "403"):
            errors += 1
            print(f"  {result['status']}: {item['id']}")
        else:
            live += 1
        time.sleep(1)
    
    print(f"\nRESULTS: {live} live, {len(removed)} removed, {errors} errors")
    if removed:
        print("REMOVED COMMENTS:")
        for c in removed:
            print(f"  {c['id']} ({c['author']}): {c['body'][:80]}")

if __name__ == "__main__":
    main()
