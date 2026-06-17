import requests, json

port = 9333
try:
    r = requests.get(f"http://127.0.0.1:{port}/json", timeout=5)
    targets = r.json()
    print(f"Found {len(targets)} targets on port {port}")
    for t in targets:
        ws = t.get("webSocketDebuggerUrl", "")
        print(f"  {t.get('type')}: {t.get('url', '')[:60]}")
        print(f"  WS: {ws}")
except Exception as e:
    print(f"Connection failed: {e}")

# Try websocket
ws_url = None
try:
    r = requests.get(f"http://127.0.0.1:{port}/json", timeout=5)
    for t in r.json():
        if t.get("type") == "page":
            ws_url = t.get("webSocketDebuggerUrl")
            break
except:
    pass

if ws_url:
    print(f"\nTrying websocket connection to: {ws_url}")
    try:
        import websocket
        ws = websocket.create_connection(ws_url, timeout=10)
        print("Connected!")
        
        # Navigate to a simple test page
        ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": "https://example.com"}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                print(f"Navigate response: {msg}")
                break
        
        import time
        time.sleep(2)
        
        ws.send(json.dumps({"id": 2, "method": "Runtime.evaluate", "params": {"expression": "document.title"}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 2:
                print(f"Eval response: {msg.get('result', {}).get('result', {})}")
                break
        
        ws.close()
    except Exception as e:
        print(f"Websocket error: {e}")
