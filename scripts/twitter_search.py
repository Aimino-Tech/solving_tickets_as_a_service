#!/usr/bin/env python3
"""Navigate Chrome to Twitter search and extract tweets."""
import json
import urllib.request
import time
import websocket
import ssl

# Get tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"Connecting to: {ws_url}")

ws = websocket.create_connection(ws_url, timeout=30)

def send_cmd(method, params=None, cmd_id=1):
    msg = {"id": cmd_id, "method": method}
    if params:
        msg["params"] = params
    ws.send(json.dumps(msg))
    while True:
        result = json.loads(ws.recv())
        if result.get("id") == cmd_id:
            return result
        # Skip events

# Navigate to Twitter search for MCP protocol
print("Navigating to Twitter search...")
result = send_cmd("Page.navigate", {
    "url": "https://x.com/search?q=MCP+protocol&src=typed_query&f=live"
}, 1)
print(f"Navigate result: {result.get('result', {}).get('frameId', 'OK')}")

# Wait for page to load
time.sleep(8)

# Get page content
print("Getting page content...")
result = send_cmd("Runtime.evaluate", {
    "expression": """
        (function() {
            var tweets = [];
            // Try to find tweet articles
            var articles = document.querySelectorAll('article[data-testid="tweet"]');
            if (articles.length === 0) {
                // Try alternative selectors
                articles = document.querySelectorAll('[data-testid="tweet"]');
            }
            if (articles.length === 0) {
                // Try getting any text content
                return JSON.stringify({
                    error: 'No tweets found',
                    bodyText: document.body ? document.body.innerText.substring(0, 2000) : 'No body',
                    url: window.location.href
                });
            }
            articles.forEach(function(article, i) {
                if (i >= 10) return; // limit to 10 tweets
                var textEl = article.querySelector('[data-testid="tweetText"]');
                var text = textEl ? textEl.innerText : '';
                var userEl = article.querySelector('a[role="link"] > div > div > span');
                var user = userEl ? userEl.innerText : '';
                var timeEl = article.querySelector('time');
                var time = timeEl ? timeEl.getAttribute('datetime') : '';
                var href = article.querySelector('a[href*="/status/"]');
                var tweetUrl = href ? href.href : '';
                tweets.push({
                    text: text.substring(0, 500),
                    user: user,
                    time: time,
                    url: tweetUrl
                });
            });
            return JSON.stringify({tweets: tweets, url: window.location.href});
        })()
    """,
    "returnByValue": True
}, 2)

response_text = result.get('result', {}).get('result', {}).get('value', '')
print(f"\nResponse: {response_text[:3000]}")

ws.close()
