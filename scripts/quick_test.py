#!/usr/bin/env python3
"""Quick test - navigate to tweet and check reply button."""
import json
import time
import websocket
import urllib.request

req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"Connecting to: {ws_url}")

ws = websocket.create_connection(ws_url, timeout=15,
    origin="http://127.0.0.1:9235",
    header=["Origin: http://127.0.0.1:9235"])

def cdp(method, params=None, timeout=10):
    msg_id = int(time.time() * 1000) % 100000
    msg = {'id': msg_id, 'method': method}
    if params:
        msg['params'] = params
    ws.send(json.dumps(msg))
    start = time.time()
    while time.time() - start < timeout:
        try:
            ws.settimeout(2)
            r = json.loads(ws.recv())
            if r.get('id') == msg_id:
                return r
        except:
            pass
    return None

# Navigate to tweet
print("Navigating to tweet...")
cdp('Page.navigate', {'url': 'https://x.com/mralimurtaza/status/2066446569449374012'})
time.sleep(6)

# Check page
result = cdp('Runtime.evaluate', {'expression': 'document.title'})
if result:
    print(f"Title: {result.get('result', {}).get('result', {}).get('value', '')}")

# Check for reply button
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var reply = document.querySelector('[data-testid="reply"]');
        return reply ? "reply button found" : "no reply button";
    })()
'''})
if result:
    print(f"Reply: {result.get('result', {}).get('result', {}).get('value', '')}")

ws.close()
print("Done")
