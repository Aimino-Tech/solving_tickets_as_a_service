"""Run all collectors — entry point for GitHub Actions cron.

Usage::

    # Collect last 24 hours
    python -m marketing.collectors.run_all

    # Collect last 7 days
    COLLECT_DAYS=7 python -m marketing.collectors.run_all
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

from marketing.duckdb_store import DuckDBStore
from marketing.store import CampaignStore

logger = logging.getLogger(__name__)

# Sheet ID for Google Sheets sync (matching cron/hermes_marketing_check.py)
_SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"


def run_all_collectors(days_back: int = 1) -> dict[str, object]:
    """Run all collectors and store results in DuckDB.

    Args:
        days_back: How far back to collect (default 1 day).

    Returns:
        dict with per-collector stats.
    """
    store = DuckDBStore()
    since = datetime.now(timezone.utc) - timedelta(days=days_back)
    stats: dict[str, object] = {}

    # Reddit
    try:
        from marketing.collectors.reddit_collector import RedditCollector

        reddit = RedditCollector(store)
        count = reddit.run_and_store(since)
        stats["reddit"] = {"events": count, "errors": reddit.error_count}
        logger.info("Reddit collector: %d events, %d errors", count, reddit.error_count)
    except Exception as e:
        stats["reddit"] = {"error": str(e)}
        logger.warning("Reddit collector failed: %s", e)

    # GitHub
    try:
        from marketing.collectors.github_collector import GitHubCollector

        github = GitHubCollector(store)
        count = github.run_and_store(since)
        stats["github"] = {"events": count, "errors": github.error_count}
        # Also try traffic data (separate table)
        traffic = github.collect_traffic()
        stats["github_traffic"] = {"records": traffic}
        logger.info("GitHub collector: %d events, %d traffic records", count, traffic)
    except Exception as e:
        stats["github"] = {"error": str(e)}
        logger.warning("GitHub collector failed: %s", e)

    # HackerNews
    try:
        from marketing.collectors.hn_collector import HNCollector

        hn = HNCollector(store)
        count = hn.run_and_store(since)
        stats["hackernews"] = {"events": count, "errors": hn.error_count}
        logger.info("HN collector: %d events", count)
    except Exception as e:
        stats["hackernews"] = {"error": str(e)}
        logger.warning("HN collector failed: %s", e)

    # npm
    try:
        from marketing.collectors.npm_collector import NPMCollector

        npm = NPMCollector(store)
        count = npm.run_and_store(since)
        stats["npm"] = {"events": count, "errors": npm.error_count}
        logger.info("npm collector: %d events", count)
    except Exception as e:
        stats["npm"] = {"error": str(e)}
        logger.warning("npm collector failed: %s", e)

    # Sheet sync — pulls all Google Sheet tabs into CampaignStore
    try:
        from marketing.sheet_sync import SheetSync

        campaign_store = CampaignStore()
        syncer = SheetSync(_SHEET_ID, campaign_store)
        sheet_stats = syncer.import_all_to_store()
        stats["sheets"] = sheet_stats
        logger.info("Sheet sync: %s", sheet_stats)
        campaign_store.close()
    except Exception as e:
        stats["sheets"] = {"error": str(e)}
        logger.warning("Sheet sync failed: %s", e)

    store.close()
    return stats


def main() -> None:
    """CLI entry point."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s: %(message)s",
    )
    days = int(os.environ.get("COLLECT_DAYS", "1"))
    stats = run_all_collectors(days_back=days)
    print(json.dumps(stats, indent=2))
    # Exit with error if any collector failed critically
    failed = any(
        "error" in (v if isinstance(v, dict) else {})
        for v in stats.values()
    )
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
