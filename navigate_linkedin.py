import json
import websocket
import time
import urllib.request

# Get the page ID
pages_raw = urllib.request.urlopen("http://127.0.0.1:9240/json/list").read()
pages = json.loads(pages_raw)
page_id = pages[0]["id"]
ws_url = f"ws://127.0.0.1:9240/devtools/page/{page_id}"

print(f"Connecting to page: {page_id}")
ws = websocket.create_connection(ws_url, timeout=10)

# Navigate to LinkedIn feed
cmd = json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": "https://www.linkedin.com/feed/"}})
ws.send(cmd)
result = ws.recv()
print(f"Navigate result: {result[:200]}")

# Wait for page to load
time.sleep(5)

# Get page title
cmd = json.dumps({"id": 2, "method": "Runtime.evaluate", "params": {"expression": "document.title"}})
ws.send(cmd)
result = ws.recv()
print(f"Page title: {result[:200]}")

# Check if we're logged in
cmd = json.dumps({"id": 3, "method": "Runtime.evaluate", "params": {"expression": "document.querySelector('.feed-identity-module') ? 'logged_in' : document.querySelector('.auth-wall') ? 'login_page' : 'unknown'"}})
ws.send(cmd)
result = ws.recv()
print(f"Login status: {result[:200]}")

ws.close()
