import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

DEVTO_API_BASE = "https://dev.to/api"
DEVTO_API_KEY = os.getenv("DEVTO_API_KEY", "")
DEVTO_RATE_LIMIT_DELAY = 3.5


def _headers() -> dict:
    return {"api-key": DEVTO_API_KEY, "Content-Type": "application/json", "Accept": "application/vnd.forem.api-v1+json"}


def _client() -> httpx.Client:
    return httpx.Client(headers=_headers(), timeout=30)


def _log_engagement(platform: str, action: str, status: str, metadata: dict = None):
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
        from indian_engagement_logger import log_event
        log_event(platform=platform, action=action, status=status, metadata=metadata or {})
    except Exception as e:
        print(f"[WARN] Engag. log failed: {e}", file=sys.stderr)



def publish_article(title: str, body_markdown: str, tags: list[str] = None,
                    published: bool = True, series: str = None,
                    canonical_url: str = None, description: str = None,
                    dry_run: bool = False) -> dict:
    data = {
        "article": {
            "title": title,
            "body_markdown": body_markdown,
            "published": published,
            "tags": (tags or [])[:4],
        }
    }
    if series:
        data["article"]["series"] = series
    if canonical_url:
        data["article"]["canonical_url"] = canonical_url
    if description:
        data["article"]["description"] = description

    if dry_run:
        print(f"[DRY_RUN] would post article: {title}")
        return {"id": 0, "title": title, "url": "", "dry_run": True}

    with _client() as client:
        resp = client.post(f"{DEVTO_API_BASE}/articles", json=data)
        if resp.status_code == 429:
            time.sleep(DEVTO_RATE_LIMIT_DELAY)
            resp = client.post(f"{DEVTO_API_BASE}/articles", json=data)
        resp.raise_for_status()
        result = resp.json()
        _log_engagement("devto", "publish_article", "success",
                        {"title": title, "article_id": result.get("id"), "url": result.get("url")})
        return result


def update_article(article_id: int, title: str = None, body_markdown: str = None,
                   tags: list[str] = None, published: bool = None,
                   series: str = None, description: str = None) -> dict:
    data = {"article": {}}
    if title is not None:
        data["article"]["title"] = title
    if body_markdown is not None:
        data["article"]["body_markdown"] = body_markdown
    if tags is not None:
        data["article"]["tags"] = tags[:4]
    if published is not None:
        data["article"]["published"] = published
    if series is not None:
        data["article"]["series"] = series
    if description is not None:
        data["article"]["description"] = description

    with _client() as client:
        resp = client.put(f"{DEVTO_API_BASE}/articles/{article_id}", json=data)
        resp.raise_for_status()
        result = resp.json()
        _log_engagement("devto", "update_article", "success",
                        {"article_id": article_id, "title": result.get("title")})
        return result


def delete_article(article_id: int) -> bool:
    with _client() as client:
        resp = client.delete(f"{DEVTO_API_BASE}/articles/{article_id}")
        if resp.status_code == 404:
            return False
        resp.raise_for_status()
        _log_engagement("devto", "delete_article", "success", {"article_id": article_id})
        return True


def get_article(article_id: int) -> Optional[dict]:
    with _client() as client:
        resp = client.get(f"{DEVTO_API_BASE}/articles/{article_id}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()


def search_articles(query: str, per_page: int = 20) -> list[dict]:
    with _client() as client:
        resp = client.get(f"{DEVTO_API_BASE}/articles/search", params={"per_page": min(per_page, 100)})
        resp.raise_for_status()
        articles = resp.json()
    query_lower = query.lower()
    return [a for a in articles if query_lower in a.get("title", "").lower()
            or query_lower in a.get("description", "").lower()
            or query_lower in " ".join(a.get("tag_list", [])).lower()]


def list_user_articles(per_page: int = 20, page: int = 1) -> list[dict]:
    with _client() as client:
        resp = client.get(f"{DEVTO_API_BASE}/articles/me", params={"per_page": min(per_page, 100), "page": page})
        resp.raise_for_status()
        return resp.json()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Dev.to article publisher")
    sub = parser.add_subparsers(dest="command", required=True)

    p_pub = sub.add_parser("publish", help="Publish a new article")
    p_pub.add_argument("--title", required=True)
    p_pub.add_argument("--body", required=True)
    p_pub.add_argument("--tags", nargs="*", default=[])
    p_pub.add_argument("--no-publish", action="store_false", dest="published")
    p_pub.add_argument("--series")
    p_pub.add_argument("--canonical-url")
    p_pub.add_argument("--description")
    p_pub.add_argument("--dry-run", action="store_true", help="Simulate without posting")

    p_get = sub.add_parser("get", help="Get article by ID")
    p_get.add_argument("id", type=int)

    p_upd = sub.add_parser("update", help="Update article")
    p_upd.add_argument("id", type=int)
    p_upd.add_argument("--title")
    p_upd.add_argument("--body")
    p_upd.add_argument("--tags", nargs="*")
    p_upd.add_argument("--no-publish", action="store_false", dest="published")
    p_upd.add_argument("--series")
    p_upd.add_argument("--description")

    p_del = sub.add_parser("delete", help="Delete article")
    p_del.add_argument("id", type=int)

    p_search = sub.add_parser("search", help="Search articles")
    p_search.add_argument("query")
    p_search.add_argument("--per-page", type=int, default=20)

    p_list = sub.add_parser("list", help="List my articles")
    p_list.add_argument("--per-page", type=int, default=20)
    p_list.add_argument("--page", type=int, default=1)

    p_pf = sub.add_parser("post-file", help="Post article from markdown file")
    p_pf.add_argument("file", help="Path to markdown file")
    p_pf.add_argument("--tags", nargs="*", default=["mcp", "opensource", "html", "ai"])
    p_pf.add_argument("--no-publish", action="store_false", dest="published")
    p_pf.add_argument("--series")
    p_pf.add_argument("--dry-run", action="store_true", help="Simulate without posting")

    args = parser.parse_args()

    if args.command == "publish":
        result = publish_article(
            title=args.title,
            body_markdown=args.body,
            tags=args.tags,
            published=args.published,
            series=args.series,
            canonical_url=args.canonical_url,
            description=args.description,
            dry_run=args.dry_run,
        )
        print(json.dumps(result, indent=2))
    elif args.command == "get":
        article = get_article(args.id)
        if article:
            print(json.dumps(article, indent=2))
        else:
            print(f"Article {args.id} not found", file=sys.stderr)
            sys.exit(1)
    elif args.command == "update":
        kwargs = {}
        for k in ("title", "body", "tags", "series", "description"):
            v = getattr(args, k, None)
            if v is not None:
                kwargs[k if k != "body" else "body_markdown"] = v
        if hasattr(args, "published") and args.published is not None:
            kwargs["published"] = args.published
        result = update_article(args.id, **kwargs)
        print(json.dumps(result, indent=2))
    elif args.command == "delete":
        ok = delete_article(args.id)
        print(json.dumps({"deleted": ok}))
    elif args.command == "search":
        results = search_articles(args.query, per_page=args.per_page)
        print(json.dumps(results, indent=2))
    elif args.command == "post-file":
        body = Path(args.file).read_text(encoding="utf-8")
        title = Path(args.file).stem.replace("-", " ").title()
        for line in body.split("\n"):
            s = line.strip()
            if s.startswith("## ") and not s.startswith("###"):
                title = s[3:].strip()
                break
        if title == Path(args.file).stem.replace("-", " ").title():
            for line in body.split("\n"):
                s = line.strip()
                if s.startswith("# ") and not s.startswith("##"):
                    title = s[2:].strip()
                    break
        result = publish_article(
            title=title,
            body_markdown=body,
            tags=args.tags,
            published=args.published,
            series=args.series,
            dry_run=args.dry_run,
        )
        print(json.dumps(result, indent=2))
    elif args.command == "list":
        articles = list_user_articles(per_page=args.per_page, page=args.page)
        print(json.dumps(articles, indent=2))
