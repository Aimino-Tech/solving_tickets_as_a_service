import sqlite3
import os

db_path = os.path.expanduser("~/.config/google-chrome/Profile 8/Default/Cookies")
print(f"DB path: {db_path}")
print(f"Exists: {os.path.exists(db_path)}")
print(f"Size: {os.path.getsize(db_path)} bytes")

conn = sqlite3.connect(db_path)
cursor = conn.execute("SELECT name, host_key, LENGTH(encrypted_value), expires_utc FROM cookies WHERE name='li_at'")
rows = cursor.fetchall()
for r in rows:
    print(f"Cookie: {r[0]}, Host: {r[1]}, EncryptedLen: {r[2]}, Expires: {r[3]}")
if not rows:
    print("NO li_at cookie found in Profile 8!")

# Also check all cookie names
cursor2 = conn.execute("SELECT DISTINCT name FROM cookies ORDER BY name")
all_names = [r[0] for r in cursor2.fetchall()]
print(f"\nAll cookie names in Profile 8: {all_names[:20]}...")

conn.close()
