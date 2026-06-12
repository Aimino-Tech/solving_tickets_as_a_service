from __future__ import annotations
import json
import logging
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

logger = logging.getLogger(__name__)


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
        from app.platforms.reddit_auth import get_reddit_client
        client_id = os.getenv("REDDIT_CLIENT_ID", "")
        if not client_id:
            return {"platform": "reddit", "status": "skipped", "note": "No REDDIT_CLIENT_ID"}
        reddit = get_reddit_client()
        sub = reddit.subreddit(subreddit)
        results = []
        for post in sub.search(query, limit=25):
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


def write_report_to_sheets(
    report: dict[str, Any],
    spreadsheet_id: str | None = None,
) -> bool:
    """Write a campaign report row to Google Sheets using safe write utilities.

    Uses the ``safe_append_row`` helper from ``app.tracking.sheet_content_writer``
    to ensure content exceeding the 50 000 character cell limit is truncated
    rather than causing a write error.

    Args:
        report: The report dict (from ``build_report`` or similar).
        spreadsheet_id: Optional override for the target spreadsheet ID.

    Returns:
        True if the write succeeded, False otherwise.
    """
    try:
        from app.tracking.sheet_content_writer import safe_append_row, validate_content_length
        from app.tracking.sheets_backend import GoogleSheetsBackend, MAX_CELL_LENGTH, UNIFIED_HEADERS
    except ImportError as exc:
        logger.warning("[campaign_report] Cannot write to sheets: %s", exc)
        return False

    backend = GoogleSheetsBackend()
    if not backend.ensure_ready():
        logger.warning("[campaign_report] Google Sheets backend not ready")
        return False

    ws = backend._ws
    if ws is None:
        return False

    # Build a flat row from the report dict aligned to UNIFIED_HEADERS.
    row: list[str] = []
    for header in UNIFIED_HEADERS[:-1]:  # exclude content_overflow
        if header == "id":
            row.append(f"report-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}")
        elif header == "type":
            row.append("campaign_report")
        elif header == "timestamp":
            row.append(report.get("report_generated_at", datetime.now(timezone.utc).isoformat()))
        elif header == "campaign":
            row.append("campaign_report")
        elif header == "status":
            row.append("ok")
        elif header == "raw_data":
            row.append(json.dumps(report, default=str))
        elif header == "phases":
            row.append("")
        else:
            row.append("")

    # Validate content lengths before writing
    over_limit = validate_content_length({"raw_data": row[UNIFIED_HEADERS.index("raw_data")]})
    if over_limit:
        field_name, actual_len = over_limit[0]
        logger.warning(
            "[campaign_report] %s exceeds cell limit (%d > %d chars) — will be truncated",
            field_name,
            actual_len,
            MAX_CELL_LENGTH,
        )

    safe_append_row(ws, row)
    _log("Campaign report written to Google Sheets")
    return True


def write_markdown_to_sheets(
    markdown: str,
    sheet_title: str = "Campaign Report",
) -> bool:
    """Write a markdown report to a Google Sheet using safe content writer.

    Uses ``write_large_content`` to handle markdown strings that may exceed
    the 50 000 character cell limit by splitting content across cells.

    Args:
        markdown: The markdown report string.
        sheet_title: Title for the worksheet cell prefix.

    Returns:
        True if the write succeeded, False otherwise.
    """
    try:
        from app.tracking.sheet_content_writer import write_large_content
        from app.tracking.sheets_backend import GoogleSheetsBackend
    except ImportError as exc:
        logger.warning("[campaign_report] Cannot write markdown to sheets: %s", exc)
        return False

    backend = GoogleSheetsBackend()
    if not backend.ensure_ready():
        logger.warning("[campaign_report] Google Sheets backend not ready")
        return False

    ws = backend._ws
    if ws is None:
        return False

    # Prepend a label so the sheet row is self-describing
    content = f"[{sheet_title} — {datetime.now(timezone.utc).isoformat()}]\n\n{markdown}"

    cells_written = write_large_content(ws, content)
    _log(f"Markdown report written to Google Sheets ({cells_written} cells)")
    return True


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
