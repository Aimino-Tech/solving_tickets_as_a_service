#!/usr/bin/env python3
import urllib.request, json

# Check CDP on port 9240
try:
    req = urllib.request.Request('http://localhost:9240/json/version')
    resp = urllib.request.urlopen(req, timeout=5)
    data = json.loads(resp.read())
    print('CDP Status: RUNNING')
    print('UserDataDir:', data.get('UserDataDir',''))
except Exception as e:
    print(f'CDP Error: {e}')
