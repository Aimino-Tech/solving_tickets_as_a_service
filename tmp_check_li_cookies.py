#!/usr/bin/env python3
"""Check LinkedIn Chrome profiles and cookies."""
import sqlite3, os, glob

def check_linkedin_cookies(profile_path):
    cookie_db = os.path.join(profile_path, 'Cookies')
    if not os.path.exists(cookie_db):
        return []
    try:
        conn = sqlite3.connect(f'file:{cookie_db}?mode=ro&immutable=1', uri=True)
        cur = conn.cursor()
        cur.execute("SELECT name, host_key FROM cookies WHERE host_key LIKE '%linkedin%' LIMIT 5")
        rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"  Error: {e}")
        return []

# Check numbered profiles
print('=== Numbered Chrome Profiles ===')
for i in range(1, 12):
    if i == 1:
        path = '/home/agent/.config/google-chrome/Default'
    else:
        path = f'/home/agent/.config/google-chrome/Profile {i}'
    cookies = check_linkedin_cookies(path)
    if cookies:
        names = [f'{r[0]}@{r[1]}' for r in cookies]
        print(f'  Profile {i}: {names}')
    else:
        print(f'  Profile {i}: No LinkedIn cookies')

# Check Hermes profiles
print()
print('=== Hermes Chrome Profiles ===')
for d in sorted(glob.glob('/home/agent/.hermes/chrome_profiles/_linkedin_*')):
    cookies = check_linkedin_cookies(d)
    name = os.path.basename(d)
    if cookies:
        names = [f'{r[0]}@{r[1]}' for r in cookies]
        print(f'  {name}: {names}')
    else:
        print(f'  {name}: No LinkedIn cookies')
