#!/usr/bin/env python3
"""Post reply to @mralimurtaza's tweet."""
import json
import time
import websocket
import urllib.request

# Get tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"Connecting to: {ws_url[:60]}...", flush=True)

ws = websocket.create_connection(ws_url, timeout=15,
    origin="http://127.0.0.1:9235",
    header=["Origin: http://127.0.0.1:9235"])
print("Connected!", flush=True)

def cdp(method, params=None):
    msg_id = int(time.time() * 1000) % 100000
    msg = {'id': msg_id, 'method': method}
    if params:
        msg['params'] = params
    ws.send(json.dumps(msg))
    start = time.time()
    while time.time() - start < 10:
        try:
            ws.settimeout(1)
            r = json.loads(ws.recv())
            if r.get('id') == msg_id:
                return r
        except:
            pass
    return None

# Navigate to tweet
tweet_url = "https://x.com/mralimurtaza/status/2066446569449374012"
print(f"\nNavigating to: {tweet_url}", flush=True)
cdp('Page.navigate', {'url': tweet_url})
time.sleep(8)

# Check page
result = cdp('Runtime.evaluate', {'expression': 'document.title'})
if result:
    title = result.get('result', {}).get('result', {}).get('value', '')
    print(f"Title: {title}", flush=True)

# Find and click reply button
print("\nLooking for reply button...", flush=True)
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var reply = document.querySelector('[data-testid="reply"]');
        if (reply) {
            var rect = reply.getBoundingClientRect();
            return JSON.stringify({found: true, x: rect.x + rect.width/2, y: rect.y + rect.height/2});
        }
        return JSON.stringify({found: false});
    })()
'''})

if result:
    data = json.loads(result.get('result', {}).get('result', {}).get('value', '{}'))
    print(f"Reply button: {data}", flush=True)
    
    if data.get('found'):
        x = int(data['x'])
        y = int(data['y'])
        
        # Click reply button
        print(f"\nClicking reply at ({x}, {y})...", flush=True)
        cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        time.sleep(3)
        
        # Focus textarea
        print("Focusing textarea...", flush=True)
        cdp('Runtime.evaluate', {'expression': '''
            (function() {
                var ta = document.querySelector('[data-testid="tweetTextarea_0"]');
                if (ta) { ta.focus(); return "focused"; }
                return "not found";
            })()
        '''})
        time.sleep(0.5)
        
        # Type reply
        reply_text = "This reframing is spot on. MCP as governance layer rather than just integration protocol changes how you architect agent systems."
        print(f"\nTyping reply ({len(reply_text)} chars)...", flush=True)
        cdp('Input.insertText', {'text': reply_text})
        time.sleep(1)
        
        # Find and click post button
        print("Looking for post button...", flush=True)
        result = cdp('Runtime.evaluate', {'expression': '''
            (function() {
                var btn = document.querySelector('[data-testid="tweetButton"]');
                if (btn) {
                    var rect = btn.getBoundingClientRect();
                    return JSON.stringify({found: true, x: rect.x + rect.width/2, y: rect.y + rect.height/2});
                }
                return JSON.stringify({found: false});
            })()
        '''})
        
        if result:
            data = json.loads(result.get('result', {}).get('result', {}).get('value', '{}'))
            print(f"Post button: {data}", flush=True)
            
            if data.get('found'):
                x = int(data['x'])
                y = int(data['y'])
                
                print(f"\nClicking post at ({x}, {y})...", flush=True)
                cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
                cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
                time.sleep(5)
                
                # Verify
                result = cdp('Runtime.evaluate', {'expression': '''
                    (function() {
                        var ta = document.querySelector('[data-testid="tweetTextarea_0"]');
                        return JSON.stringify({empty: !ta || ta.innerText.trim() === '', url: window.location.href});
                    })()
                '''})
                if result:
                    status = json.loads(result.get('result', {}).get('result', {}).get('value', '{}'))
                    print(f"\nStatus: {status}", flush=True)
                    if status.get('empty'):
                        print("✅ Reply posted successfully!", flush=True)
                    else:
                        print("❌ Reply may not have posted", flush=True)
    else:
        print("❌ No reply button found", flush=True)

ws.close()
print("\nDone", flush=True)
