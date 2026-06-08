import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.db import EngagementDB
from app.common.config import get_env, get_proxy

ZHIHU_BASE = "https://www.zhihu.com"
ZHIHU_COOKIE = get_env("ZHIHU_COOKIE")
PROXY_URL = get_proxy()

db = EngagementDB()


def _headers():
    return {
        "Cookie": ZHIHU_COOKIE,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.zhihu.com/",
        "x-requested-with": "fetch",
    }


def search_content(keyword, limit=20):
    with httpx.Client(headers=_headers(), timeout=30, follow_redirects=True, proxy=PROXY_URL) as client:
        resp = client.get(f"{ZHIHU_BASE}/api/v4/search_v3",
                          params={"q": keyword, "limit": min(limit, 50), "type": "content"})
        resp.raise_for_status()
        data = resp.json()
        db.log("zhihu", "search", "success", {"keyword": keyword}, "zh_CN")
        return data


def get_hot_topics():
    with httpx.Client(headers=_headers(), timeout=30, follow_redirects=True, proxy=PROXY_URL) as client:
        resp = client.get(f"{ZHIHU_BASE}/api/v3/feed/topstory/hot-lists/total", params={"limit": 50})
        resp.raise_for_status()
        return resp.json()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Zhihu scraper")
    sub = parser.add_subparsers(dest="command", required=True)
    p_search = sub.add_parser("search")
    p_search.add_argument("keyword")
    p_search.add_argument("--limit", type=int, default=20)
    sub.add_parser("hot")
    args = parser.parse_args()
    if args.command == "search":
        print(json.dumps(search_content(args.keyword, args.limit), indent=2, ensure_ascii=False))
    elif args.command == "hot":
        print(json.dumps(get_hot_topics(), indent=2, ensure_ascii=False))
