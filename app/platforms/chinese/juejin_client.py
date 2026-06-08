import json
import os
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.db import EngagementDB
from app.common.config import get_env, get_proxy

JUEJIN_API_BASE = "https://api.juejin.cn"
JUEJIN_COOKIE = get_env("JUEJIN_COOKIE")
PROXY_URL = get_proxy()

db = EngagementDB()


def _headers():
    return {
        "Cookie": JUEJIN_COOKIE,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; openclaw/1.0)",
    }


def search_articles(keyword, cursor="0", limit=20):
    with httpx.Client(headers=_headers(), timeout=30, proxy=PROXY_URL) as client:
        resp = client.post(f"{JUEJIN_API_BASE}/search_api/v1/search",
                           json={"key_word": keyword, "cursor": cursor, "limit": min(limit, 50)})
        resp.raise_for_status()
        data = resp.json()
        db.log("juejin", "search", "success", {"keyword": keyword}, "zh_CN")
        return data


def create_article(title, content, tags=None, category_id="1"):
    data = {
        "title": title,
        "content": content,
        "category_id": category_id,
        "tag_ids": (tags or ["6809640408797167623"])[:3],
        "brief": content[:100],
        "is_markdown": 1,
    }
    with httpx.Client(headers=_headers(), timeout=30, proxy=PROXY_URL) as client:
        resp = client.post(f"{JUEJIN_API_BASE}/content_api/v1/article/create", json=data)
        if resp.status_code == 429:
            time.sleep(5)
            resp = client.post(f"{JUEJIN_API_BASE}/content_api/v1/article/create", json=data)
        resp.raise_for_status()
        result = resp.json()
        db.log("juejin", "create_article", "success",
               {"title": title, "id": result.get("data", {}).get("article_id")}, "zh_CN")
        return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Juejin API client")
    sub = parser.add_subparsers(dest="command", required=True)
    p_search = sub.add_parser("search")
    p_search.add_argument("keyword")
    p_search.add_argument("--limit", type=int, default=20)
    p_create = sub.add_parser("create")
    p_create.add_argument("--title", required=True)
    p_create.add_argument("--content", required=True)
    p_create.add_argument("--tags", nargs="*")
    args = parser.parse_args()
    if args.command == "search":
        print(json.dumps(search_articles(args.keyword, limit=args.limit), indent=2, ensure_ascii=False))
    elif args.command == "create":
        print(json.dumps(create_article(args.title, args.content, args.tags), indent=2, ensure_ascii=False))
