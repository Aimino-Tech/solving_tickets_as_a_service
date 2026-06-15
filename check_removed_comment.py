import os
import json
import requests

# Check the thread to see what happened
thread_url = "https://www.reddit.com/r/ClaudeAI/comments/1sihiyk/best_skillspluginsmcps_for_parsing_large_pdf/"

# Use Reddit API to check
headers = {"User-Agent": "Mozilla/5.0 (compatible; MarketingBot/1.0)"}

# Try to get the thread
try:
    # Convert to API URL
    api_url = thread_url.replace("www.reddit.com", "api.reddit.com").replace("/comments/", "/comments/") + ".json"
    r = requests.get(api_url, headers=headers, timeout=30)
    
    if r.status_code == 200:
        data = r.json()
        print("=== Thread Data ===")
        print(json.dumps(data[0]["data"]["children"][0]["data"], indent=2)[:2000])
    else:
        print(f"API returned status {r.status_code}")
except Exception as e:
    print(f"Error: {e}")

# Also check the specific comment from Slow-Guy-Chiu
print("\n\n=== Checking comment status ===")
# The comment might have been removed but still exist in our records
# Let's check what we have in the sheet
