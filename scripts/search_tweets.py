#!/usr/bin/env python3
"""Search for MCP protocol tweets using Brave Search API."""
import json
import urllib.request
import urllib.parse
import os

api_key = os.environ.get('BRAVE_SEARCH_API_KEY', '')
if not api_key:
    print("No BRAVE_SEARCH_API_KEY in environment")
    exit(1)

queries = [
    "site:x.com MCP protocol",
    "twitter MCP protocol agent 2026",
    "x.com MCP protocol latest"
]

all_tweets = []
for q in queries:
    try:
        encoded = urllib.parse.quote(q)
        url = f"https://api.search.brave.com/res/v1/web/search?q={encoded}&count=10"
        req = urllib.request.Request(url)
        req.add_header('Accept', 'application/json')
        req.add_header('X-Subscription-Token', api_key)
        
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            results = data.get('web', {}).get('results', [])
            print(f"\nQuery: {q}")
            print(f"Results: {len(results)}")
            for r in results:
                tweet_url = r.get('url', '')
                title = r.get('title', '')
                desc = r.get('description', '')
                if 'x.com' in tweet_url and '/status/' in tweet_url:
                    print(f"  TWEET: {title[:80]}")
                    print(f"  URL: {tweet_url}")
                    print(f"  Desc: {desc[:200]}")
                    all_tweets.append({
                        'url': tweet_url,
                        'title': title,
                        'description': desc
                    })
    except Exception as e:
        print(f"Error with query '{q}': {e}")

print(f"\n\nTotal tweets found: {len(all_tweets)}")
