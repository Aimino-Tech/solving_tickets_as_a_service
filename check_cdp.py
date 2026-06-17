import requests, json

# Check CDP on the Chrome port we found
port = 40839
try:
    r = requests.get(f"http://127.0.0.1:{port}/json", timeout=5)
    targets = r.json()
    print(f"Found {len(targets)} targets on port {port}")
    for t in targets[:5]:
        print(f"  {t.get('type')}: {t.get('url', '')[:80]}")
        ws = t.get('webSocketDebuggerUrl', '')
        if ws:
            print(f"  WS: {ws}")
except Exception as e:
    print(f"Port {port} failed: {e}")

# Also check other potential ports
for p in range(9223, 9230):
    try:
        r = requests.get(f"http://127.0.0.1:{p}/json", timeout=2)
        print(f"Port {p}: {len(r.json())} targets")
    except:
        pass
