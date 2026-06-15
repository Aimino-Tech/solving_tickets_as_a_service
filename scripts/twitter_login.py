#!/usr/bin/env python3
"""Login to Twitter via Chrome CDP."""
import json
import time
import websocket
import urllib.request

# Load credentials
with open('/home/agent/.hermes/twitter_credentials.json') as f:
    creds = json.load(f)

username = creds.get('username', '').lstrip('@')
password = creds.get('password', '')
email = creds.get('email', '')

print(f"Username: @{username}")
print(f"Email: {email[:5]}...")

# Get tabs
req = urllib.request.Request('http://127.0.0.1:9235/json/list')
with urllib.request.urlopen(req, timeout=5) as resp:
    tabs = json.loads(resp.read())

# Find a tab or use the first one
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
cdp('Page.navigate', {'url': 'https://x.com/login'})
time.sleep(5)

# Step 2: Accept cookies if banner appears
print("[2] Checking for cookie banner...")
cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var btn = [...document.querySelectorAll("button")].find(b => 
            b.textContent.includes("Accept all cookies") || 
            b.textContent.includes("Refuse non-essential")
        );
        if (btn) { btn.click(); return "clicked"; }
        return "no banner";
    })()
''', 'returnByValue': True})
time.sleep(2)

# Step 3: Fill username
print("[3] Filling username...")
cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var input = document.querySelector('input[name="text"]') || 
                    document.querySelector('input[autocomplete="username"]');
        if (input) { 
            input.focus(); 
            input.select();
            return "focused"; 
        }
        return "no input found";
    })()
''', 'returnByValue': True})
time.sleep(0.5)

# Use Input.insertText for Twitter React inputs
cdp('Input.insertText', {'text': email or username})
time.sleep(1)

# Step 4: Click Continue
print("[4] Clicking Continue...")
# First find the button coordinates
cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var btn = [...document.querySelectorAll("button")].find(b => {
            var text = b.textContent?.trim();
            return text === "Continue" || text === "Next";
        });
        if (btn) {
            btn.scrollIntoView();
            var rect = btn.getBoundingClientRect();
            window.__loginBtnX = rect.x + rect.width/2;
            window.__loginBtnY = rect.y + rect.height/2;
            return "found at " + window.__loginBtnX + "," + window.__loginBtnY;
        }
        return "no button found";
    })()
''', 'returnByValue': True})
time.sleep(0.5)

# Click at the button coordinates
cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': 956, 'y': 741, 'button': 'left', 'clickCount': 1})
cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': 956, 'y': 741, 'button': 'left', 'clickCount': 1})
time.sleep(5)

# Check if we need to enter password or if there was an error
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var url = window.location.href;
        var bodyText = document.body.innerText.substring(0, 500);
        var hasPassword = !!document.querySelector('input[name="password"]');
        var hasError = bodyText.includes("Sorry") || bodyText.includes("error") || bodyText.includes("not found");
        return JSON.stringify({url: url, hasPassword: hasPassword, hasError: hasError, body: bodyText.substring(0, 300)});
    })()
''', 'returnByValue': True})

if result and result.get('result'):
    status = json.loads(result['result']['result']['value'])
    print(f"  Status: {json.dumps(status, indent=2)}")
    
    if status.get('hasError'):
        print("\n[!] Error detected - may need to try username instead of email")
        # Try with username
        cdp('Page.navigate', {'url': 'https://x.com/login'})
        time.sleep(4)
        cdp('Runtime.evaluate', {'expression': '''
            (function() {
                var input = document.querySelector('input[name="text"]');
                if (input) { input.focus(); input.select(); return "focused"; }
                return "no input";
            })()
        '''})
        time.sleep(0.5)
        cdp('Input.insertText', {'text': username})
        time.sleep(1)
        cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': 956, 'y': 741, 'button': 'left', 'clickCount': 1})
        cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': 956, 'y': 741, 'button': 'left', 'clickCount': 1})
        time.sleep(5)

# Step 5: Fill password
print("[5] Filling password...")
cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var input = document.querySelector('input[name="password"]');
        if (input) { input.focus(); input.select(); return "focused"; }
        return "no password input";
    })()
''', 'returnByValue': True})
time.sleep(0.5)

cdp('Input.insertText', {'text': password})
time.sleep(1)

# Step 6: Click Continue again
print("[6] Clicking Continue (password)...")
cdp('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': 956, 'y': 741, 'button': 'left', 'clickCount': 1})
cdp('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': 956, 'y': 741, 'button': 'left', 'clickCount': 1})
time.sleep(8)

# Step 7: Verify login
print("[7] Verifying login...")
result = cdp('Runtime.evaluate', {'expression': '''
    (function() {
        var title = document.title;
        var url = window.location.href;
        var bodyText = document.body.innerText.substring(0, 500);
        var hasCompose = !!document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
        var hasHandle = bodyText.includes("@Hello374565") || bodyText.includes("Hello374565");
        return JSON.stringify({
            title: title, 
            url: url, 
            hasCompose: hasCompose, 
            hasHandle: hasHandle,
            loggedIn: hasCompose || hasHandle,
            body: bodyText.substring(0, 200)
        });
    })()
''', 'returnByValue': True})

if result and result.get('result'):
    status = json.loads(result['result']['result']['value'])
    print(f"\nFinal status: {json.dumps(status, indent=2)}")
    
    if status.get('loggedIn'):
        print("\n✅ Login successful!")
    else:
        print("\n❌ Login may have failed")
        print(f"Title: {status.get('title')}")
        print(f"URL: {status.get('url')}")

ws.close()
