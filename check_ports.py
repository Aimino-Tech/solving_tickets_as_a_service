import requests

ports = [9241, 38957]
for port in ports:
    try:
        r = requests.get(f"http://127.0.0.1:{port}/json", timeout=3)
        targets = r.json()
        print(f"Port {port}: {len(targets)} targets")
        for t in targets[:3]:
            print(f"  {t.get('type')}: {t.get('url', '')[:100]}")
    except Exception as e:
        print(f"Port {port}: {e}")
