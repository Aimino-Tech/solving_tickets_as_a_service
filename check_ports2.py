import requests

for port in range(9220, 9230):
    try:
        r = requests.get(f"http://127.0.0.1:{port}/json", timeout=2)
        targets = r.json()
        print(f"Port {port}: {len(targets)} targets")
        for t in targets[:2]:
            print(f"  {t.get('type')}: {t.get('url', '')[:80]}")
    except:
        pass

# Check other ports too
for port in [40839, 38957, 9241]:
    try:
        r = requests.get(f"http://127.0.0.1:{port}/json", timeout=2)
        targets = r.json()
        print(f"Port {port}: {len(targets)} targets")
    except:
        print(f"Port {port}: not available")
