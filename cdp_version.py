#!/usr/bin/env python3
import urllib.request, json

req = urllib.request.Request('http://localhost:9240/json/version')
resp = urllib.request.urlopen(req, timeout=5)
data = json.loads(resp.read())
print(json.dumps(data, indent=2))
