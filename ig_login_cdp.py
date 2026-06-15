#!/usr/bin/env python3
"""
Instagram/Threads Login via Chrome CDP
Uses the actual Chrome profile, not browserbase.
"""

import json
import time
import requests
import websocket

# Chrome xdn2 port
PORT = 9224

def get_ws_url():
    """Get WebSocket URL from Chrome."""
    r = requests.get(f"http://localhost:{PORT}/json", timeout=5)
    tabs = r.json()
    for tab in tabs:
        if tab.get("type") == "page":
            return tab.get("webSocketDebuggerUrl")
    # Open new tab
    r2 = requests.get(f"http://localhost:{PORT}/json/new?about:blank", timeout=5)
    tab = r2.json()
    return tab.get("webSocketDebuggerUrl")

def navigate_and_login():
    ws_url = get_ws_url()
    if not ws_url:
        print("❌ Chrome not running")
        return
    
    print(f"✅ Connected to Chrome: {ws_url}")
    ws = websocket.create_connection(ws_url, timeout=30)
    
    # Navigate to Instagram
    ws.send(json.dumps({
        "id": 1,
        "method": "Page.navigate",
        "params": {"url": "https://www.instagram.com/accounts/login/"}
    }))
    result = json.loads(ws.recv())
    print(f"📝 Navigating to Instagram...")
    
    # Wait for page load
    time.sleep(5)
    
    # Get page content
    ws.send(json.dumps({
        "id": 2,
        "method": "Runtime.evaluate",
        "params": {"expression": "document.title"}
    }))
    result = json.loads(ws.recv())
    title = result.get("result", {}).get("result", {}).get("value", "")
    print(f"📄 Page title: {title}")
    
    # Fill email field
    ws.send(json.dumps({
        "id": 3,
        "method": "Runtime.evaluate",
        "params": {
            "expression": """
                const inputs = document.querySelectorAll('input');
                if (inputs.length >= 2) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inputs[0], 'xdn1@aimino.de');
                    inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
                    setter.call(inputs[1], 'vGa2/CSk?9CEMeL');
                    inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
                    'filled ' + inputs.length + ' inputs';
                } else {
                    'only ' + inputs.length + ' inputs';
                }
            """
        }
    }))
    result = json.loads(ws.recv())
    print(f"📝 Fill result: {result.get('result', {}).get('result', {}).get('value', '')}")
    
    time.sleep(1)
    
    # Click login button
    ws.send(json.dumps({
        "id": 4,
        "method": "Runtime.evaluate",
        "params": {
            "expression": """
                const btn = document.querySelector('button[type="submit"], button:not([disabled])');
                if (btn) {
                    btn.click();
                    'clicked: ' + btn.textContent;
                } else {
                    'no button found';
                }
            """
        }
    }))
    result = json.loads(ws.recv())
    print(f"🖱️ Click result: {result.get('result', {}).get('result', {}).get('value', '')}")
    
    # Wait for response
    time.sleep(5)
    
    # Check result
    ws.send(json.dumps({
        "id": 5,
        "method": "Runtime.evaluate",
        "params": {"expression": "document.title + ' | ' + window.location.href"}
    }))
    result = json.loads(ws.recv())
    print(f"📄 After login: {result.get('result', {}).get('result', {}).get('value', '')}")
    
    ws.close()

if __name__ == "__main__":
    navigate_and_login()
