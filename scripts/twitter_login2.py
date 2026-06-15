#!/usr/bin/env python3
"""Login to Twitter via Chrome CDP - improved version."""
import json
import time
import websocket
import urllib.request

# Load credentials
with open('/home/agent/.hermes/twitter_credentials.json') as f:
    creds = json.load(f)

email = creds.get('email', '')
password = creds.get('password', '')
username = creds.get('username', '').lstrip('@')

print(f"Email: {email}")
print(f"Username: @{username}")

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

# Step 1: Navigate to login
print("\n[1] Navigating to login page...")
cdp('Page.navigate', {'url': 'https://x.com/i/flow/login'})
time.sleep(6)

# Step 2: Check current state
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var inputs = document.querySelectorAll('input');
        var inputInfo = [];
        inputs.forEach(function(input) {
            inputInfo.push({
                name: input.name,
                type: input.type,
                autocomplete: input.autocomplete,
                placeholder: input.placeholder
            });
        });
        var buttons = document.querySelectorAll('button');
        var btnTexts = [];
        buttons.forEach(function(b) {
            btnTexts.push(b.textContent.trim().substring(0, 30));
        });
        return JSON.stringify({inputs: inputInfo, buttons: btnTexts, url: window.location.href});
    })()
''', 'returnByValue': True})

if result and result.get('result'):
    state = json.loads(result['result']['result']['value'])
    print(f"Page state: {json.dumps(state, indent=2)}")

# Step 3: Try to find and fill the username input
print("\n[2] Looking for username input...")
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        // Try multiple selectors
        var input = document.querySelector('input[autocomplete="username"]') ||
                    document.querySelector('input[name="text"]') ||
                    document.querySelector('input[data-testid="ocfEnterTextTextInput"]') ||
                    document.querySelector('input[type="text"]');
        if (input) {
            input.focus();
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return "found: " + input.name + " / " + input.autocomplete;
        }
        return "no input found";
    })()
''', 'returnByValue': True})

if result and result.get('result'):
    print(f"  Result: {result['result']['result']['value']}")

# Step 4: Use Input.insertText to type username
print("\n[3] Typing email...")
cdp('Input.insertText', {'text': email})
time.sleep(1)

# Verify input was filled
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var input = document.querySelector('input[autocomplete="username"]') ||
                    document.querySelector('input[name="text"]');
        return input ? "value: " + input.value.substring(0, 10) + "..." : "no input";
    })()
''', 'returnByValue': True})
if result and result.get('result'):
    print(f"  Verify: {result['result']['result']['value']}")

# Step 5: Find and click the Continue button
print("\n[4] Looking for Continue button...")
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var btns = [...document.querySelectorAll('button')];
        var continueBtn = btns.find(b => {
            var text = b.textContent.trim();
            var rect = b.getBoundingClientRect();
            return (text === 'Continue' || text === 'Next') && rect.width > 0 && rect.height > 0;
        });
        if (continueBtn) {
            var rect = continueBtn.getBoundingClientRect();
            window.__btnX = Math.round(rect.x + rect.width/2);
            window.__btnY = Math.round(rect.y + rect.height/2);
            return "found at (" + window.__btnX + ", " + window.__btnY + ")";
        }
        return "no continue button found";
    })()
''', 'returnByValue': True})

if result and result.get('result'):
    btn_info = result['result']['result']['value']
    print(f"  Button: {btn_info}")
    
    if "found at" in btn_info:
        # Extract coordinates
        coords = btn_info.split("(")[1].split(")")[0].split(", ")
        x = int(coords[0])
        y = int(coords[1])
        
        # Click the button
        print(f"  Clicking at ({x}, {y})...")
        cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        time.sleep(5)

# Step 6: Check if password field appeared
print("\n[5] Checking for password field...")
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var pwInput = document.querySelector('input[name="password"]');
        var url = window.location.href;
        var bodyText = document.body.innerText.substring(0, 300);
        return JSON.stringify({
            hasPassword: !!pwInput,
            url: url,
            body: bodyText
        });
    })()
''', 'returnByValue': True})

if result and result.get('result'):
    state = json.loads(result['result']['result']['value'])
    print(f"  State: {json.dumps(state, indent=2)}")
    
    if state.get('hasPassword'):
        # Step 7: Fill password
        print("\n[6] Filling password...")
        cdp('Runtime.evaluate', {'expression': '''
            (function() {
                var input = document.querySelector('input[name="password"]');
                if (input) { input.focus(); return "focused"; }
                return "no password input";
            })()
        '''})
        time.sleep(0.5)
        
        cdp('Input.insertText', {'text': password})
        time.sleep(1)
        
        # Step 8: Click Continue again
        print("\n[7] Clicking Continue (password)...")
        result = cdp('Runtime.evaluate', {'expression': '''
            (function() {
                var btns = [...document.querySelectorAll('button')];
                var continueBtn = btns.find(b => {
                    var text = b.textContent.trim();
                    var rect = b.getBoundingClientRect();
                    return (text === 'Continue' || text === 'Log in') && rect.width > 0;
                });
                if (continueBtn) {
                    var rect = continueBtn.getBoundingClientRect();
                    window.__btnX = Math.round(rect.x + rect.width/2);
                    window.__btnY = Math.round(rect.y + rect.height/2);
                    return "found at (" + window.__btnX + ", " + window.__btnY + ")";
                }
                return "no button found";
            })()
        '''})
        
        if result and result.get('result'):
            btn_info = result['result']['result']['value']
            print(f"  Button: {btn_info}")
            
            if "found at" in btn_info:
                coords = btn_info.split("(")[1].split(")")[0].split(", ")
                x = int(coords[0])
                y = int(coords[1])
                
                cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
                cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
                time.sleep(8)

# Step 9: Verify login
print("\n[8] Verifying login...")
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var title = document.title;
        var url = window.location.href;
        var hasCompose = !!document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
        var bodyText = document.body.innerText.substring(0, 200);
        return JSON.stringify({
            title: title,
            url: url,
            hasCompose: hasCompose,
            loggedIn: hasCompose || title.includes('Home'),
            body: bodyText
        });
    })()
''', 'returnByValue': True})

if result and result.get('result'):
    status = json.loads(result['result']['result']['value'])
    print(f"\nFinal: {json.dumps(status, indent=2)}")
    
    if status.get('loggedIn'):
        print("\n✅ LOGIN SUCCESSFUL!")
    else:
        print("\n❌ Login may have failed")
        print(f"Title: {status.get('title')}")
        print(f"URL: {status.get('url')}")

ws.close()
