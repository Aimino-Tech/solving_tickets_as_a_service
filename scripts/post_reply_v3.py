#!/usr/bin/env python3
"""Post reply via Chrome CDP - with better timing."""
import json
import time
import websocket
import urllib.request

# Get tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

ws_url = tabs[0]['webSocketDebuggerUrl']
print(f"Connecting to: {ws_url}", flush=True)

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
    while time.time() - start < 8:
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
print(f"Navigating to: {tweet_url}", flush=True)
cdp('Page.navigate', {'url': tweet_url})

# Wait longer for page load
print("Waiting for page to load...", flush=True)
time.sleep(10)

# Check page
result = cdp('Runtime.evaluate', {'expression': 'document.title'})
if result:
    title = result.get('result', {}).get('result', {}).get('value', '')
    print(f"Title: {title}", flush=True)
else:
    print("Failed to get title", flush=True)

# Check URL
result = cdp('Runtime.evaluate', {'expression': 'window.location.href'})
if result:
    url = result.get('result', {}).get('result', {}).get('value', '')
    print(f"URL: {url}", flush=True)

# Check for reply button
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
        print(f"Clicking reply at ({x}, {y})...", flush=True)
        cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        time.sleep(3)
        
        # Check for textarea
        result = cdp('Runtime.evaluate', {'expression': '''
            (function() {
                var ta = document.querySelector('[data-testid="tweetTextarea_0"]');
                return ta ? "found" : "not found";
            })()
        '''})
        if result:
            print(f"Textarea: {result.get('result', {}).get('result', {}).get('value', '')}", flush=True)
        
        # Focus textarea
        cdp('Runtime.evaluate', {'expression': '''
            (function() {
                var ta = document.querySelector('[data-testid="tweetTextarea_0"]');
                if (ta) ta.focus();
            })()
        '''})
        time.sleep(0.5)
        
        # Type reply
        reply_text = "This reframing is spot on. MCP as governance layer rather than just integration protocol changes how you architect agent systems."
        print(f"Typing reply...", flush=True)
        cdp('Input.insertText', {'text': reply_text})
        time.sleep(1)
        
        # Find and click post button
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
                
                print(f"Clicking post...", flush=True)
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
                    print(f"Status: {status}", flush=True)
                    if status.get('empty'):
                        print("✅ Reply posted!", flush=True)
                    else:
                        print("❌ Reply may not have posted", flush=True)
    else:
        print("❌ No reply button found", flush=True)

ws.close()
print("Done", flush=True)
