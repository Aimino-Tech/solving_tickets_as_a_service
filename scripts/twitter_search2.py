#!/usr/bin/env python3
"""Navigate Chrome to Twitter search and extract tweets - with proper origin."""
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

# Connect with proper origin
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

# Navigate to Twitter search
print("Navigating to Twitter search...")
result = send_cmd("Page.navigate", {
    "url": "https://x.com/search?q=MCP+protocol&src=typed_query&f=live"
}, 1)
print(f"Navigate result: {result.get('result', {}).get('frameId', 'OK')}")

# Wait for page to load
time.sleep(10)

# Get page content
print("Getting page content...")
result = send_cmd("Runtime.evaluate", {
    "expression": """
        (function() {
            var tweets = [];
            var articles = document.querySelectorAll('article[data-testid="tweet"]');
            if (articles.length === 0) {
                articles = document.querySelectorAll('[data-testid="tweet"]');
            }
            if (articles.length === 0) {
                return JSON.stringify({
                    error: 'No tweets found',
                    bodyText: document.body ? document.body.innerText.substring(0, 3000) : 'No body',
                    url: window.location.href
                });
            }
            articles.forEach(function(article, i) {
                if (i >= 10) return;
                var textEl = article.querySelector('[data-testid="tweetText"]');
                var text = textEl ? textEl.innerText : '';
                var userLinks = article.querySelectorAll('a[role="link"]');
                var user = '';
                var tweetUrl = '';
                userLinks.forEach(function(link) {
                    var href = link.href || '';
                    if (href.match(/\\/[^\\/]+$/) && !href.includes('/status/')) {
                        var span = link.querySelector('span');
                        if (span) user = span.innerText;
                    }
                    if (href.includes('/status/')) {
                        tweetUrl = href;
                    }
                });
                var timeEl = article.querySelector('time');
                var time = timeEl ? timeEl.getAttribute('datetime') : '';
                var metrics = article.querySelectorAll('[data-testid$="count"]');
                var likes = '';
                metrics.forEach(function(m) {
                    var label = m.getAttribute('aria-label') || '';
                    if (label.includes('like')) likes = label;
                });
                tweets.push({
                    text: text.substring(0, 500),
                    user: user,
                    time: time,
                    url: tweetUrl,
                    likes: likes
                });
            });
            return JSON.stringify({tweets: tweets, url: window.location.href, count: articles.length});
        })()
    """,
    "returnByValue": True
}, 2)

response_text = result.get('result', {}).get('result', {}).get('value', '')
print(f"\nResponse: {response_text[:5000]}")

ws.close()
