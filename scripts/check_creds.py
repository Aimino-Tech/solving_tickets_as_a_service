#!/usr/bin/env python3
"""Check for Twitter credentials file."""
import os
import json

cred_path = os.path.expanduser('~/.hermes/twitter_credentials.json')
if os.path.exists(cred_path):
    print(f"Credentials file found: {cred_path}")
    with open(cred_path) as f:
        data = json.load(f)
    print(f"Keys: {list(data.keys())}")
    # Don't print actual values, just structure
    for k in data.keys():
        val = str(data[k])
        print(f"  {k}: {val[:3]}...{val[-3:] if len(val) > 6 else ''}")
else:
    print(f"No credentials file at {cred_path}")
    
    # Check alternative locations
    alt_paths = [
        '~/.hermes/config/twitter_credentials.json',
        '~/Documents/hermes-agent/twitter_credentials.json',
        '~/.config/twitter/credentials.json'
    ]
    for p in alt_paths:
        expanded = os.path.expanduser(p)
        if os.path.exists(expanded):
            print(f"Found at: {expanded}")
