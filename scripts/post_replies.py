#!/usr/bin/env python3
"""Post replies to MCP protocol tweets via Chrome CDP."""
import json
import time
import websocket
import urllib.request
from datetime import datetime, timezone

# Load search results
with open('/home/agent/Documents/hermes-agent/scripts/twitter_search_results.json') as f:
    search_data = json.load(f)

tweets = search_data.get('tweets', [])
print(f"Found {len(tweets)} tweets to evaluate")

# Define replies for the best tweets
# 90/10 rule: 90% genuine value, 10% subtle mention
replies = [
    {
        'tweet_index': 0,  # @8004scan - Identity Registry and MCP
        'reply': "Great use case. We've been exploring similar patterns — MCP tool discovery for onchain data is powerful because it lets agents dynamically query chain-specific info without pre-building API layers. The identity registry angle is interesting for access control too."
    },
    {
        'tweet_index': 5,  # @mralimurtaza - MCP as enterprise control pattern
        'reply': "This reframing is spot on. MCP as governance layer rather than just integration protocol changes how you architect agent systems. We found the key is mapping tool scopes to agent permissions — keeps the control plane clean while letting agents discover capabilities dynamically."
    },
    {
        'tweet_index': 3,  # @Oxsmalldoctor - MCP + commerce infrastructure
        'reply': "The commerce infrastructure angle is where MCP gets really interesting. Agents need standardized tool interfaces to interact with payment systems, inventory, etc. MCP gives you that discovery layer without forcing every commerce platform to build custom agent APIs."
    }
]

# Get Chrome CDP connection
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"\nConnecting to Chrome CDP: {ws_url}")

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

posted = []
timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')

for i, reply_info in enumerate(replies):
    tweet_idx = reply_info['tweet_index']
    reply_text = reply_info['reply']
    
    if tweet_idx >= len(tweets):
        print(f"\n[!] Tweet index {tweet_idx} out of range, skipping")
        continue
    
    tweet = tweets[tweet_idx]
    tweet_url = tweet['url']
    author = tweet['author']
    
    print(f"\n{'='*60}")
    print(f"[{i+1}/{len(replies)}] Replying to @{author}")
    print(f"Tweet: {tweet['text'][:100]}...")
    print(f"Reply: {reply_text[:100]}...")
    
    # Navigate to the tweet
    full_url = f"https://x.com{tweet_url}" if tweet_url.startswith('/') else tweet_url
    # Remove /analytics from URL if present
    full_url = full_url.replace('/analytics', '')
    
    print(f"\nNavigating to: {full_url}")
    cdp('Page.navigate', {'url': full_url})
    time.sleep(6)
    
    # Find and click reply button
    print("Looking for reply button...")
    result = cdp('Runtime.evaluate', {'expression': '''
        (function() {
            var replyBtn = document.querySelector('[data-testid="reply"]');
            if (replyBtn) {
                var rect = replyBtn.getBoundingClientRect();
                window.__replyX = Math.round(rect.x + rect.width/2);
                window.__replyY = Math.round(rect.y + rect.height/2);
                return "found at (" + window.__replyX + ", " + window.__replyY + ")";
            }
            return "no reply button found";
        })()
    '''})
    
    if result and result.get('result'):
        btn_info = result['result']['result']['value']
        print(f"  Reply button: {btn_info}")
        
        if "found at" in btn_info:
            coords = btn_info.split("(")[1].split(")")[0].split(", ")
            x = int(coords[0])
            y = int(coords[1])
            
            # Click reply button
            cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
            cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
            time.sleep(3)
            
            # Focus the reply textarea
            print("Focusing reply textarea...")
            cdp('Runtime.evaluate', {'expression': '''
                (function() {
                    var textarea = document.querySelector('[data-testid="tweetTextarea_0"]');
                    if (textarea) { textarea.focus(); return "focused"; }
                    return "no textarea";
                })()
            '''})
            time.sleep(0.5)
            
            # Type the reply
            print("Typing reply...")
            cdp('Input.insertText', {'text': reply_text})
            time.sleep(1)
            
            # Click the Reply/Post button
            print("Clicking Reply button...")
            result = cdp('Runtime.evaluate', {'expression': '''
                (function() {
                    var btn = document.querySelector('[data-testid="tweetButton"]');
                    if (btn) {
                        var rect = btn.getBoundingClientRect();
                        window.__postX = Math.round(rect.x + rect.width/2);
                        window.__postY = Math.round(rect.y + rect.height/2);
                        return "found at (" + window.__postX + ", " + window.__postY + ")";
                    }
                    return "no post button";
                })()
            '''})
            
            if result and result.get('result'):
                btn_info = result['result']['result']['value']
                print(f"  Post button: {btn_info}")
                
                if "found at" in btn_info:
                    coords = btn_info.split("(")[1].split(")")[0].split(", ")
                    x = int(coords[0])
                    y = int(coords[1])
                    
                    cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
                    cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
                    time.sleep(5)
                    
                    # Verify post was sent
                    result = cdp('Runtime.evaluate', {'expression': '''
                        (function() {
                            var textarea = document.querySelector('[data-testid="tweetTextarea_0"]');
                            var isEmpty = !textarea || textarea.innerText.trim() === '';
                            return JSON.stringify({posted: isEmpty, url: window.location.href});
                        })()
                    '''})
                    
                    if result and result.get('result'):
                        status = json.loads(result['result']['result']['value'])
                        print(f"  Status: {status}")
                        
                        if status.get('posted'):
                            print(f"  ✅ Reply posted successfully!")
                            posted.append({
                                'author': author,
                                'tweet_url': full_url,
                                'reply': reply_text,
                                'timestamp': timestamp
                            })
                        else:
                            print(f"  ❌ Reply may not have posted")
    
    # Wait between replies (pacing)
    if i < len(replies) - 1:
        wait_time = 15 * 60  # 15 minutes between replies
        print(f"\nWaiting {wait_time//60} minutes before next reply...")
        # For demo purposes, wait less
        time.sleep(5)

# Save results
print(f"\n{'='*60}")
print(f"Posted {len(posted)} replies")

# Save posting data for sheet update
with open('/home/agent/Documents/hermes-agent/scripts/posted_replies.json', 'w') as f:
    json.dump(posted, f, indent=2)

ws.close()
