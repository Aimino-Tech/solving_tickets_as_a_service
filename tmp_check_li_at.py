#!/usr/bin/env python3
"""Check for li_at session cookie specifically."""
import sqlite3, os

def check_li_at(profile_path):
    cookie_db = os.path.join(profile_path, 'Cookies')
    if not os.path.exists(cookie_db):
        return None
    try:
        conn = sqlite3.connect(f'file:{cookie_db}?mode=ro&immutable=1', uri=True)
        cur = conn.cursor()
        cur.execute("SELECT name, host_key, expires_utc FROM cookies WHERE host_key LIKE '%linkedin%' AND name='li_at' LIMIT 1")
        row = cur.fetchone()
        conn.close()
        return row
    except:
        return None

for profile_num in [2, 8]:
    path = f'/home/agent/.config/google-chrome/Profile {profile_num}'
    result = check_li_at(path)
    if result:
        print(f"Profile {profile_num}: li_at found! expires_utc={result[2]}")
    else:
        print(f"Profile {profile_num}: No li_at cookie")
