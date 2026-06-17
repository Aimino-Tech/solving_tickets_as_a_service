import json, time, requests

CDP_PORT = 9241
CHECK_URLS = [
    ("OT011", "https://old.reddit.com/r/selfhosted/comments/1b16q4j/"),
    ("O01", "https://old.reddit.com/r/rust/comments/1tol41p/"),
    ("OC05", "https://www.reddit.com/r/MCP/comments/1tjif5k/"),
]

def get_ws_url(port):
    r = requests.get(f"http://127.0.0.1:{port}/json", timeout=5)
    for t in r.json():
        if t.get("type") == "page":
            return t.get("webSocketDebuggerUrl")
    # Open new tab
    r2 = requests.get(f"http://127.0.0.1:{port}/json/new?about:blank", timeout=5)
    return r2.json().get("webSocketDebuggerUrl")

def check_comment_via_cdp(ws_url, url, content_id):
    try:
        import websocket
        ws = websocket.create_connection(ws_url, timeout=20)
        
        # Navigate
        ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}))
        # Wait for response
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                break
        
        time.sleep(5)
        
        # Get page text
        ws.send(json.dumps({"id": 2, "method": "Runtime.evaluate", "params": {"expression": "document.body.innerText"}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 2:
                break
        
        page_text = msg.get("result", {}).get("result", {}).get("value", "")
        ws.close()
        
        # Check for removal indicators
        indicators = [
            "Comment removed by Reddit",
            "This comment has been removed",
            "[deleted]",
            "[removed]",
            "Page not found",
            "Sorry, this page is no longer available",
        ]
        
        for indicator in indicators:
            if indicator in page_text:
                return {"status": "removed", "indicator": indicator, "snippet": page_text[:300]}
        
        # Check if our comments are visible
        accounts = ["CommentAwkward3993", "Slow-Guy-Chiu", "Pro_Shame", "J0llibee_yummy", "Love-KCF"]
        found = [a for a in accounts if a in page_text]
        
        return {"status": "live", "found_accounts": found, "text_len": len(page_text)}
    except ImportError:
        return {"status": "error", "error": "websocket-client not installed"}
    except Exception as e:
        return {"status": "error", "error": str(e)[:100]}

ws_url = get_ws_url(CDP_PORT)
print(f"WebSocket URL: {ws_url}")

if not ws_url:
    print("ERROR: No WebSocket URL")
else:
    for content_id, url in CHECK_URLS:
        print(f"\nChecking {content_id}: {url[:70]}...")
        result = check_comment_via_cdp(ws_url, url, content_id)
        print(f"  Status: {result['status']}")
        if result['status'] == 'removed':
            print(f"  Indicator: {result.get('indicator')}")
            print(f"  Snippet: {result.get('snippet', '')[:200]}")
        elif result['status'] == 'live':
            print(f"  Found accounts: {result.get('found_accounts', [])}")
        elif result['status'] == 'error':
            print(f"  Error: {result.get('error')}")
        time.sleep(2)
