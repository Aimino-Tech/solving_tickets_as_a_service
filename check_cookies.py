#!/usr/bin/env python3
import sqlite3, os

# Check if cookies exist in the LinkedIn profile
cookie_path = '/home/agent/.hermes/chrome_profiles/_linkedin_ducnguyen/Default/Cookies'
if os.path.exists(cookie_path):
    try:
        conn = sqlite3.connect(cookie_path)
        cursor = conn.cursor()
        cursor.execute("SELECT host_key, name, has_expires FROM cookies WHERE host_key LIKE '%linkedin.com%' AND name='li_at'")
        rows = cursor.fetchall()
        print(f"li_at cookies found: {len(rows)}")
        for row in rows:
            print(f"  {row}")
        cursor.execute("SELECT host_key, name FROM cookies WHERE host_key LIKE '%linkedin%'")
        all_linkedin = cursor.fetchall()
        print(f"\nAll LinkedIn cookies ({len(all_linkedin)}):")
        for row in all_linkedin:
            print(f"  {row[0]:50s} | {row[1]}")
        conn.close()
    except Exception as e:
        print(f"Error reading cookies: {e}")
else:
    print(f"Cookie file not found at {cookie_path}")

# Also check the main Chrome profile
cookie_path2 = '/home/agent/.config/google-chrome/Default/Cookies'
if os.path.exists(cookie_path2):
    try:
        conn = sqlite3.connect(cookie_path2)
        cursor = conn.cursor()
        cursor.execute("SELECT host_key, name FROM cookies WHERE host_key LIKE '%linkedin%'")
        rows = cursor.fetchall()
        print(f"\nMain profile LinkedIn cookies ({len(rows)}):")
        for row in rows:
            print(f"  {row}")
        conn.close()
    except Exception as e:
        print(f"Error reading main cookies: {e}")

# Check Profile 2
cookie_path3 = '/home/agent/.config/google-chrome/Profile 2/Cookies'
if os.path.exists(cookie_path3):
    try:
        conn = sqlite3.connect(cookie_path3)
        cursor = conn.cursor()
        cursor.execute("SELECT host_key, name FROM cookies WHERE host_key LIKE '%linkedin%'")
        rows = cursor.fetchall()
        print(f"\nProfile 2 LinkedIn cookies ({len(rows)}):")
        for row in rows:
            print(f"  {row}")
        conn.close()
    except Exception as e:
        print(f"Error reading Profile 2 cookies: {e}")
else:
    print(f"Profile 2 cookie file not found")

# Search for credentials in hermes config
print("\n=== Checking for stored app passwords ===")
pw_path = '/home/agent/.hermes/config.yaml'
if os.path.exists(pw_path):
    with open(pw_path) as f:
        content = f.read()
    for line in content.split('\n'):
        if 'password' in line.lower() or 'secret' in line.lower() or 'pass' in line.lower():
            print(f"  Config: {line.strip()[:80]}")
