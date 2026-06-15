#!/usr/bin/env python3
"""Post a single reply to a tweet via Chrome CDP."""
import json
import time
import websocket
import urllib.request

# Get Chrome CDP connection
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

# Reply to @mralimurtaza about MCP as enterprise control pattern
tweet_url = "https://x.com/mralimurtaza/status/2066446569449374012"
reply_text = "This reframing is spot on. MCP as governance layer rather than just integration protocol changes how you architect agent systems. We found the key is mapping tool scopes to agent permissions — keeps the control plane clean while letting agents discover capabilities dynamically."

print(f"\nNavigating to: {tweet_url}")
cdp('Page.navigate', {'url': tweet_url})
time.sleep(8)

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
                    print(f"\nStatus: {json.dumps(status)}")
                    
                    if status.get('posted'):
                        print("✅ Reply posted successfully!")
                    else:
                        print("❌ Reply may not have posted")

ws.close()
