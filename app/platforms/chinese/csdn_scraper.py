import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.db import EngagementDB
from app.common.config import get_env, get_proxy

CSDN_BASE = "https://blog.csdn.net"
CSDN_COOKIE = get_env("CSDN_COOKIE")
PROXY_URL = get_proxy()

db = EngagementDB()


def _headers():
    return {
        "Cookie": CSDN_COOKIE,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://blog.csdn.net/",
    }


def search_articles(keyword, page=1):
    with httpx.Client(headers=_headers(), timeout=30, follow_redirects=True, proxy=PROXY_URL) as client:
        resp = client.get(f"{CSDN_BASE}/search/article",
                          params={"q": keyword, "t": "blog", "p": page})
        resp.raise_for_status()
        db.log("csdn", "search", "success", {"keyword": keyword}, "zh_CN")
        return resp.text


def check_blog(username):
    with httpx.Client(headers=_headers(), timeout=30, follow_redirects=True, proxy=PROXY_URL) as client:
        resp = client.get(f"{CSDN_BASE}/{username}")
        return {"username": username, "exists": resp.status_code == 200}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="CSDN scraper")
    sub = parser.add_subparsers(dest="command", required=True)
    p_search = sub.add_parser("search")
    p_search.add_argument("keyword")
    p_search.add_argument("--page", type=int, default=1)
    p_check = sub.add_parser("check")
    p_check.add_argument("username")
    args = parser.parse_args()
    if args.command == "search":
        print(search_articles(args.keyword, args.page))
    elif args.command == "check":
        print(json.dumps(check_blog(args.username)))
