#!/usr/bin/env python3
"""Search for MCP protocol tweets via Chrome CDP."""
import json
import time
import websocket
import urllib.request

# Get tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"Connecting to: {ws_url}")

ws = websocket.create_connection(ws_url, timeout=30,
    origin="http://127.0.0.1:9235",
    header=["Origin: http://127.0.0.1:9235"])

msg_id = [0]

def cdp(method, params=None):
    msg_id[0] += 1
    msg = {'id': msg_id[0], 'method': method}
    if params:
        msg['params'] = params
    ws.send(json.dumps(msg))
    time.sleep(0.5)
    for _ in range(30):
        try:
            r = json.loads(ws.recv())
            if r.get('id') == msg_id[0]:
                return r
        except:
            pass
    return None

# Navigate to search
print("[1] Navigating to search...")
cdp('Page.navigate', {'url': 'https://x.com/search?q=MCP+protocol&src=typed_query&f=live'})
time.sleep(8)

# Extract tweets
print("[2] Extracting tweets...")
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var articles = document.querySelectorAll('article[data-testid="tweet"]');
        var tweets = [];
        articles.forEach(function(article, i) {
            if (i >= 15) return;
            
            // Get tweet text
            var textEl = article.querySelector('[data-testid="tweetText"]');
            var text = textEl ? textEl.innerText : '';
            
            // Get author info
            var userLinks = article.querySelectorAll('a[role="link"]');
            var author = '';
            var tweetUrl = '';
            var tweetId = '';
            
            userLinks.forEach(function(link) {
                var href = link.getAttribute('href') || '';
                if (href.match(/\/[^\/]+$/) && !href.includes('/status/') && !href.includes('/i/')) {
                    var span = link.querySelector('span');
                    if (span && !author) author = span.innerText;
                }
                if (href.includes('/status/')) {
                    tweetUrl = href;
                    var parts = href.split('/status/');
                    if (parts[1]) tweetId = parts[1].split('/')[0];
                }
            });
            
            // Get time
            var timeEl = article.querySelector('time');
            var time = timeEl ? timeEl.getAttribute('datetime') : '';
            
            // Get engagement metrics
            var likeBtn = article.querySelector('[data-testid="like"] span');
            var retweetBtn = article.querySelector('[data-testid="retweet"] span');
            var replyBtn = article.querySelector('[data-testid="reply"] span');
            
            var likes = likeBtn ? likeBtn.innerText : '0';
            var retweets = retweetBtn ? retweetBtn.innerText : '0';
            var replies = replyBtn ? replyBtn.innerText : '0';
            
            if (text && author) {
                tweets.push({
                    author: author,
                    text: text.substring(0, 500),
                    url: tweetUrl,
                    id: tweetId,
                    time: time,
                    likes: likes,
                    retweets: retweets,
                    replies: replies
                });
            }
        });
        return JSON.stringify({tweets: tweets, count: articles.length, url: window.location.href});
    })()
''', 'returnByValue': True})

if result and result.get('result'):
    data = json.loads(result['result']['result']['value'])
    print(f"\nFound {len(data.get('tweets', []))} tweets")
    print(f"URL: {data.get('url')}")
    
    for i, tweet in enumerate(data.get('tweets', []), 1):
        print(f"\n--- Tweet {i} ---")
        print(f"Author: {tweet['author']}")
        print(f"Text: {tweet['text'][:200]}...")
        print(f"URL: {tweet['url']}")
        print(f"Time: {tweet['time']}")
        print(f"Likes: {tweet['likes']} | RT: {tweet['retweets']} | Replies: {tweet['replies']}")
    
    # Save to file for later use
    with open('/home/agent/Documents/hermes-agent/scripts/twitter_search_results.json', 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\nResults saved to twitter_search_results.json")

ws.close()
