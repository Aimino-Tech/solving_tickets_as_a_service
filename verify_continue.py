import json, time, requests, urllib.parse, os
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")
CDP_PORT = 9333

# IDs we already checked (first 31 unique URLs)
CHECKED = set()

def get_sheets():
    creds = Credentials.from_service_account_file(SA_PATH, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    creds.refresh(Request())
    return {"Authorization": f"Bearer {creds.token}"}

def get_ws_url(port):
    r = requests.get(f"http://127.0.0.1:{port}/json", timeout=5)
    for t in r.json():
        if t.get("type") == "page":
            return t.get("webSocketDebuggerUrl")
    r2 = requests.get(f"http://127.0.0.1:{port}/json/new?about:blank", timeout=5)
    return r2.json().get("webSocketDebuggerUrl")

def check_via_cdp(ws_url, url, timeout=30):
    try:
        import websocket
        ws = websocket.create_connection(ws_url, timeout=timeout)
        ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                break
        time.sleep(6)
        ws.send(json.dumps({"id": 2, "method": "Runtime.evaluate", "params": {"expression": "document.body.innerText"}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 2:
                break
        text = msg.get("result", {}).get("result", {}).get("value", "")
        ws.close()
        return text
    except Exception:
        return None

def main():
    headers = get_sheets()
    r = requests.get(f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/reddit-campaign!A2:L1200", headers=headers, timeout=30)
    rows = r.json().get("values", [])
    
    items = []
    seen = set()
    for i, row in enumerate(rows):
        if not row or len(row) < 10:
            continue
        content_id = row[0]
        status = row[9] if len(row) > 9 else ""
        platform_url = row[3] if len(row) > 3 else ""
        if "Replied" not in status or "reddit.com" not in platform_url or "Removed" in status:
            continue
        try:
            path = urllib.parse.urlparse(platform_url).path
            if path not in seen:
                seen.add(path)
                items.append({"id": content_id, "url": platform_url, "row": i+2})
        except:
            pass
    
    # Skip first 31 (already checked)
    check_items = items[31:100]
    print(f"Checking {len(check_items)} more unique URLs...")
    
    try:
        ws_url = get_ws_url(CDP_PORT)
    except Exception as e:
        print(f"ERROR: Cannot connect to CDP: {e}")
        return
    
    removed = []
    live = 0
    errors = 0
    
    for idx, item in enumerate(check_items):
        text = check_via_cdp(ws_url, item["url"])
        if text is None:
            errors += 1
            print(f"  [{idx+1}] ERROR: {item['id']}")
            time.sleep(5)
            try:
                ws_url = get_ws_url(CDP_PORT)
            except:
                print("Lost CDP connection, stopping")
                break
            continue
        
        is_removed = False
        for indicator in ["Comment removed by Reddit", "This comment has been removed", "Page not found", "Sorry, this page is no longer available"]:
            if indicator in text:
                is_removed = True
                removed.append({"id": item["id"], "indicator": indicator, "url": item["url"], "row": item["row"]})
                print(f"  [{idx+1}] REMOVED: {item['id']} - {indicator}")
                break
        
        if not is_removed:
            live += 1
            if (idx + 1) % 10 == 0:
                print(f"  [{idx+1}] Progress: {live} live, {len(removed)} removed, {errors} errors")
        
        time.sleep(3)
    
    print(f"\n{'='*60}")
    print(f"BATCH 2 RESULTS: {live} live, {len(removed)} removed, {errors} errors")
    
    if removed:
        print("\nREMOVED COMMENTS FOUND:")
        for c in removed:
            print(f"  {c['id']} (row {c['row']}): {c['indicator']}")

if __name__ == "__main__":
    main()
