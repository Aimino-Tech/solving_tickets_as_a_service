from __future__ import annotations
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.common.config import settings
from orchestrator_state import get_repository

REPORT_DIR = Path(__file__).parent.parent / "reports"
REPORT_INTERVAL_HOURS = 24


def _log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", file=sys.stderr)


def fetch_devto_stats(username: str | None = None) -> dict[str, Any]:
    api_key = os.getenv("DEVTO_API_KEY", "")
    if not api_key:
        return {"platform": "devto", "status": "skipped", "note": "No DEVTO_API_KEY"}
    try:
        resp = httpx.get(
            "https://dev.to/api/articles/me",
            headers={"api-key": api_key},
            timeout=30,
        )
        resp.raise_for_status()
        articles = resp.json()
        total_views = sum(a.get("page_views_count", 0) or 0 for a in articles)
        total_comments = sum(a.get("comments_count", 0) or 0 for a in articles)
        total_reactions = sum(a.get("positive_reactions_count", 0) or 0 for a in articles)
        return {
            "platform": "devto",
            "article_count": len(articles),
            "total_views": total_views,
            "total_comments": total_comments,
            "total_reactions": total_reactions,
            "status": "ok",
        }
    except Exception as e:
        return {"platform": "devto", "status": "error", "error": str(e)}


def fetch_reddit_stats(subreddit: str = "developersIndia", query: str = "fast-html-mcp") -> dict[str, Any]:
    try:
        from app.platforms.reddit_ratelimit import (
            call_with_backoff,
            reddit_rate_limiter,
            rotate_user_agent,
            reddit_proxy_pool,
        )

        import praw
        client_id = os.getenv("REDDIT_CLIENT_ID", "")
        if not client_id:
            return {"platform": "reddit", "status": "skipped", "note": "No REDDIT_CLIENT_ID"}

        ua = rotate_user_agent()
        proxy_url = reddit_proxy_pool.get_next_proxy() if reddit_proxy_pool.has_proxies else None

        reddit = praw.Reddit(
            client_id=client_id,
            client_secret=os.getenv("REDDIT_CLIENT_SECRET", ""),
            user_agent=ua,
            username=os.getenv("REDDIT_USERNAME", ""),
            password=os.getenv("REDDIT_PASSWORD", ""),
            requestor_kwargs={"proxy": proxy_url} if proxy_url else {},
        )
        sub = reddit.subreddit(subreddit)

        results = []
        posts = call_with_backoff(
            sub.search, query, limit=25,
            limiter=reddit_rate_limiter,
            operation_id="campaign_report_reddit_search",
        )
        for post in posts:
            results.append({
                "title": post.title,
                "score": post.score,
                "num_comments": post.num_comments,
                "url": f"https://reddit.com{post.permalink}",
                "created_utc": post.created_utc,
            })
        total_score = sum(r["score"] for r in results)
        total_comments = sum(r["num_comments"] for r in results)
        return {"platform": "reddit", "subreddit": subreddit, "post_count": len(results),
                "total_score": total_score, "total_comments": total_comments, "status": "ok"}
    except ImportError:
        return {"platform": "reddit", "status": "skipped", "note": "praw not installed"}
    except Exception as e:
        return {"platform": "reddit", "status": "error", "error": str(e)}


def fetch_x_stats() -> dict[str, Any]:
    bearer = os.getenv("X_BEARER_TOKEN", "")
    if not bearer:
        return {"platform": "x", "status": "skipped", "note": "No X_BEARER_TOKEN"}
    try:
        from common.engagement_loop import get_tweet_metrics
        metrics = get_tweet_metrics()
        return {"platform": "x", "status": "ok", "metrics": metrics}
    except ImportError:
        return {"platform": "x", "status": "skipped", "note": "common.engagement_loop not available"}
    except Exception as e:
        return {"platform": "x", "status": "error", "error": str(e)}


def fetch_campaign_metrics() -> dict[str, Any]:
    repo = get_repository()
    summary = repo.summary(days=14)
    pending = repo.get_pending_engagements()
    leads = repo.get_new_leads()
    return {
        "orchestrator_engagements_7d": summary.get("engagement_counts", []),
        "leads_7d": summary.get("lead_counts", []),
        "pending_engagements": len(pending),
        "new_leads": len(leads),
    }


def build_report(include_platform_stats: bool = True) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    report: dict[str, Any] = {
        "report_generated_at": now.isoformat(),
        "report_window_hours": REPORT_INTERVAL_HOURS,
        "campaign_metrics": fetch_campaign_metrics(),
        "platform_stats": {},
    }

    if include_platform_stats:
        report["platform_stats"]["devto"] = fetch_devto_stats()
        report["platform_stats"]["reddit"] = fetch_reddit_stats()
        report["platform_stats"]["x"] = fetch_x_stats()

    return report


def save_report(report: dict[str, Any]) -> str:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = REPORT_DIR / f"campaign_report_{timestamp}.json"
    path.write_text(json.dumps(report, indent=2))
    _log(f"Report saved to {path}")
    return str(path)


def format_markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# MCP Marketing Factory - Campaign Report",
        f"\n**Generated:** {report['report_generated_at']}",
        f"**Window:** Last {report['report_window_hours']} hours\n",
    ]

    cm = report.get("campaign_metrics", {})
    lines.append("## Campaign Metrics\n")
    lines.append(f"- Pending engagements: {cm.get('pending_engagements', 'N/A')}")
    lines.append(f"- New leads: {cm.get('new_leads', 'N/A')}")
    lines.append(f"- 7-day platform breakdown: {cm.get('orchestrator_engagements_7d', [])}")
    lines.append(f"- 7-day lead sources: {cm.get('leads_7d', [])}")

    ps = report.get("platform_stats", {})
    if ps:
        lines.append("\n## Platform Statistics\n")
        for platform, stats in ps.items():
            status = stats.get("status", "unknown")
            lines.append(f"### {platform.title()} ({status})\n")
            if status == "ok":
                for k, v in stats.items():
                    if k not in ("platform", "status"):
                        lines.append(f"- {k}: {v}")
            elif status == "error":
                lines.append(f"- Error: {stats.get('error', 'unknown')}")
            elif status == "skipped":
                lines.append(f"- Skipped: {stats.get('note', 'no reason')}")
            lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="MCP Marketing Factory - Campaign Report Generator")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("generate", help="Generate full campaign report")
    sub.add_parser("quick", help="Quick summary (campaign metrics only, no platform API calls)")

    args = parser.parse_args()

    if args.command == "generate":
        report = build_report(include_platform_stats=True)
        path = save_report(report)
        print(f"Report: {path}")
        print(format_markdown_report(report))
    elif args.command == "quick":
        report = build_report(include_platform_stats=False)
        print(json.dumps(report, indent=2))
