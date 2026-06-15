#!/usr/bin/env python3
"""Navigate Chrome to x.com and check login status."""
import json
import urllib.request
import time
import websocket

# Get tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"Connecting to: {ws_url}")

ws = websocket.create_connection(ws_url, timeout=30, 
    origin="http://127.0.0.1:9235",
    header=["Origin: http://127.0.0.1:9235"])

def send_cmd(method, params=None, cmd_id=1):
    msg = {"id": cmd_id, "method": method}
    if params:
        msg["params"] = params
    ws.send(json.dumps(msg))
    while True:
        result = json.loads(ws.recv())
        if result.get("id") == cmd_id:
            return result

# Navigate to x.com
print("Navigating to x.com...")
result = send_cmd("Page.navigate", {
    "url": "https://x.com"
}, 1)
print(f"Navigate result: {result.get('result', {}).get('frameId', 'OK')}")

time.sleep(8)

# Check current URL and login status
result = send_cmd("Runtime.evaluate", {
    "expression": """
        (function() {
            return JSON.stringify({
                url: window.location.href,
                title: document.title,
                hasLoginButton: !!document.querySelector('[data-testid="loginButton"]'),
                hasCompose: !!document.querySelector('[data-testid="SideNav_NewTweet_Button"]'),
                bodyText: document.body ? document.body.innerText.substring(0, 1000) : 'No body'
            });
        })()
    """,
    "returnByValue": True
}, 2)

response = result.get('result', {}).get('result', {}).get('value', '')
print(f"\nResponse: {response}")

ws.close()
