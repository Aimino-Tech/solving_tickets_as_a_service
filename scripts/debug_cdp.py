#!/usr/bin/env python3
"""Debug CDP connection and page state."""
import json
import time
import websocket
import urllib.request

# Get all tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

print(f"Found {len(tabs)} tabs:", flush=True)
for i, tab in enumerate(tabs):
    print(f"  {i}: {tab.get('url', '')[:80]}", flush=True)
    print(f"     Title: {tab.get('title', '')[:50]}", flush=True)

# Try each tab
for i, tab in enumerate(tabs):
    ws_url = tab.get('webSocketDebuggerUrl')
    if not ws_url:
        continue
    
    print(f"\nTrying tab {i}: {ws_url[:60]}...", flush=True)
    
    try:
        ws = websocket.create_connection(ws_url, timeout=10,
            origin="http://127.0.0.1:9235",
            header=["Origin: http://127.0.0.1:9235"])
        
        msg_id = int(time.time() * 1000) % 100000
        msg = {'id': msg_id, 'method': 'Runtime.evaluate', 'params': {'expression': 'document.title + " | " + window.location.href'}}
        ws.send(json.dumps(msg))
        
        start = time.time()
        while time.time() - start < 5:
            try:
                ws.settimeout(1)
                r = json.loads(ws.recv())
                if r.get('id') == msg_id:
                    value = r.get('result', {}).get('result', {}).get('value', '')
                    print(f"  Result: {value[:100]}", flush=True)
                    break
            except:
                pass
        
        ws.close()
    except Exception as e:
        print(f"  Error: {e}", flush=True)
