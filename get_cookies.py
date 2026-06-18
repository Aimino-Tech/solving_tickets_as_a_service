#!/usr/bin/env python3
"""Get LinkedIn cookies from Profile 2 and prepare them for injection."""
import sqlite3
import time

cookie_path = '/home/agent/.config/google-chrome/Profile 2/Cookies'
conn = sqlite3.connect(cookie_path)
cursor = conn.cursor()
cursor.execute("SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly FROM cookies WHERE host_key LIKE '%linkedin%'")
rows = cursor.fetchall()
conn.close()

print("LinkedIn cookies in Profile 2:")
for row in rows:
    host_key, name, value, path, expires_utc, is_secure, is_httponly = row
    if name == 'li_at':
        print(f"\n### CRITICAL COOKIE: {name} ###")
        print(f"Domain: {host_key}")
        print(f"Value: {value}")
        print(f"Path: {path}")
        print(f"Secure: {bool(is_secure)}")
        print(f"HttpOnly: {bool(is_httponly)}")
        if expires_utc:
            expires = expires_utc / 1000000 - 11644473600
            print(f"Expires: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(expires))}")
            print(f"Expired: {expires < time.time()}")
    elif name in ('JSESSIONID', 'bcookie', 'bscookie'):
        print(f"\n{name}: {value[:30]}... (domain={host_key})")
    else:
        print(f"  {name} (domain={host_key})")
