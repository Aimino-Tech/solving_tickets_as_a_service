import os
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request
import requests

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"
SA_PATH = os.path.expanduser("~/Documents/hermes-agent/service-account-key.json")

creds = Credentials.from_service_account_file(SA_PATH, scopes=[
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
])
creds.refresh(Request())
headers = {"Authorization": f"Bearer {creds.token}"}

# Check how many "Replied" items have NO comment URL
import urllib.parse

range_str = "reddit-campaign!A2:M1200"
encoded_range = urllib.parse.quote(range_str)
url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{encoded_range}"
r = requests.get(url, headers=headers, timeout=30)
data = r.json()

rows = data.get("values", [])

# Count replied items without comment URL
replied_no_url = 0
replied_with_url = 0
total_replied = 0

for row in rows:
    if not row or len(row) < 10:
        continue
    
    status = row[9] if len(row) > 9 else ""
    platform_url = row[3] if len(row) > 3 else ""
    content_id = row[0] if len(row) > 0 else ""
    
    if "Replied" in status:
        total_replied += 1
        # Check if there's a comment URL (not just thread URL)
        # Comment URLs typically have /comments/.../.../.../c/... or similar
        if "comment" in platform_url.lower() or "permalink" in platform_url.lower():
            replied_with_url += 1
        else:
            replied_no_url += 1

print(f"📊 Reply Verification Check")
print(f"{'=' * 60}")
print(f"Total 'Replied' items: {total_replied}")
print(f"  ✅ With comment URL: {replied_with_url}")
print(f"  ❌ Without comment URL: {replied_no_url}")
print(f"\n⚠️  {replied_no_url} items marked as 'Replied' but NO PROOF of actual post!")

# Show some examples without URL
print(f"\n🔍 Examples without comment URL:")
count = 0
for row in rows:
    if not row or len(row) < 10:
        continue
    
    status = row[9] if len(row) > 9 else ""
    platform_url = row[3] if len(row) > 3 else ""
    content_id = row[0] if len(row) > 0 else ""
    profile = row[10] if len(row) > 10 else ""
    
    if "Replied" in status and not ("comment" in platform_url.lower() or "permalink" in platform_url.lower()):
        count += 1
        if count <= 10:
            print(f"  - {content_id}: {platform_url[:80]}...")

if count > 10:
    print(f"  ... and {count - 10} more")
