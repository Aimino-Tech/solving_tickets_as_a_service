import json
import os
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.db import EngagementDB
from app.common.config import get_env, get_proxy

V2EX_API_BASE = "https://www.v2ex.com/api/v2"
V2EX_TOKEN = get_env("V2EX_TOKEN")
PROXY_URL = get_proxy()

db = EngagementDB()


def _headers():
    return {
        "Authorization": f"Bearer {V2EX_TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "openclaw-china-engagement/1.0",
    }


def get_latest_topics(node_name="python", limit=20):
    with httpx.Client(headers=_headers(), timeout=30, proxy=PROXY_URL) as client:
        resp = client.get(f"{V2EX_API_BASE}/nodes/{node_name}/topics",
                          params={"p": 1, "limit": min(limit, 100)})
        resp.raise_for_status()
        data = resp.json()
        db.log("v2ex", "get_topics", "success", {"node": node_name, "count": len(data)}, "zh_CN")
        return data


def create_topic(node_name, title, content, tags=None):
    data = {"node_name": node_name, "title": title, "content": content}
    if tags:
        data["tags"] = tags[:5]
    with httpx.Client(headers=_headers(), timeout=30, proxy=PROXY_URL) as client:
        resp = client.post(f"{V2EX_API_BASE}/topics", json=data)
        if resp.status_code == 429:
            time.sleep(5)
            resp = client.post(f"{V2EX_API_BASE}/topics", json=data)
        resp.raise_for_status()
        result = resp.json()
        db.log("v2ex", "create_topic", "success",
               {"title": title, "topic_id": result.get("id")}, "zh_CN")
        return result


def get_token_info():
    with httpx.Client(headers=_headers(), timeout=30, proxy=PROXY_URL) as client:
        resp = client.get(f"{V2EX_API_BASE}/token")
        resp.raise_for_status()
        return resp.json()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="V2EX API client")
    sub = parser.add_subparsers(dest="command", required=True)
    p_nodes = sub.add_parser("topics", help="List latest topics")
    p_nodes.add_argument("--node", default="python")
    p_nodes.add_argument("--limit", type=int, default=20)
    p_create = sub.add_parser("create", help="Create topic")
    p_create.add_argument("--node", required=True)
    p_create.add_argument("--title", required=True)
    p_create.add_argument("--content", required=True)
    p_create.add_argument("--tags", nargs="*")
    p_token = sub.add_parser("token", help="Check token")
    args = parser.parse_args()

    if args.command == "topics":
        print(json.dumps(get_latest_topics(args.node, args.limit), indent=2, ensure_ascii=False))
    elif args.command == "create":
        print(json.dumps(create_topic(args.node, args.title, args.content, args.tags), indent=2, ensure_ascii=False))
    elif args.command == "token":
        print(json.dumps(get_token_info(), indent=2))
