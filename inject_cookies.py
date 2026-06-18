#!/usr/bin/env python3
"""Inject LinkedIn cookies from Profile 2 into the CDP session on port 9240."""
import sqlite3
import json
import urllib.request
import time

# Step 1: Extract cookies from Profile 2
cookie_path = '/home/agent/.config/google-chrome/Profile 2/Cookies'
conn = sqlite3.connect(cookie_path)
cursor = conn.cursor()
cursor.execute("SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly, has_expires, is_persistent FROM cookies WHERE host_key LIKE '%linkedin%'")
rows = cursor.fetchall()
conn.close()

cookies = []
for row in rows:
    host_key, name, value, path, expires_utc, is_secure, is_httponly, has_expires, is_persistent = row
    
    # Convert Chrome timestamp (microseconds since 1601-01-01) to seconds since epoch
    if has_expires and expires_utc:
        expires = expires_utc / 1000000 - 11644473600
    else:
        expires = None
    
    cookie = {
        'name': name,
        'value': value,
        'domain': host_key,
        'path': path or '/',
        'secure': bool(is_secure),
        'httpOnly': bool(is_httponly),
        'sameSite': 'Lax',
    }
    if expires and expires > time.time():
        cookie['expires'] = int(expires)
    
    cookies.append(cookie)

print(f"Found {len(cookies)} LinkedIn cookies in Profile 2")

# Step 2: Set cookies in CDP session
for c in cookies:
    data = json.dumps({
        'id': 1,
        'method': 'Network.setCookie',
        'params': {
            'name': c['name'],
            'value': c['value'],
            'domain': c['domain'],
            'path': c['path'],
            'secure': c['secure'],
            'httpOnly': c['httpOnly'],
            'sameSite': c.get('sameSite', 'Lax'),
        }
    }).encode()
    
    req = urllib.request.Request(
        'http://localhost:9240/json/network.setCookie',  # wrong endpoint
        data=data,
        headers={'Content-Type': 'application/json'}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=3)
        print(f"  Set {c['name']}: HTTP {resp.status}")
    except Exception as e:
        # Try websocket - need a different approach
        pass

print("\nTrying via WebSocket...")
# Need to use Playwright or direct WebSocket to set cookies

# Alternative: Use browser_console to set cookies via JavaScript
print("Cookies ready to inject via CDP JS evaluation")
for c in cookies:
    if c['name'] in ('li_at', 'JSESSIONID', 'bcookie', 'bscookie'):
        print(f"  {c['name']}: {c['value'][:20]}... (domain={c['domain']})")
