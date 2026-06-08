import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.db import get_repository
from app.common.models import EngagementRecord

REDNOTE_API_BASE = os.getenv("REDNOTE_API_BASE", "")
REDNOTE_COOKIE = os.getenv("REDNOTE_COOKIE", "")
REPLY_TEMPLATES: list[str] = [
    "\u611f\u8c22\u60a8\u7684\u8bc4\u8bba\uff01\u5982\u679c\u60a8\u5bf9MCP\u5de5\u5177\u611f\u5174\u8da3\uff0c\u6b22\u8fce\u67e5\u770b\u6211\u4eec\u7684\u5f00\u6e90\u9879\u76ee\u3002",
    "\u5f88\u9ad8\u5174\u770b\u5230\u60a8\u7684\u53cd\u9988\uff0c\u6211\u4eec\u4f1a\u7ee7\u7eed\u4f18\u5316MCP\u751f\u6001\u5de5\u5177\u3002",
]


def fetch_comments(since_id: str | None = None, limit: int = 20) -> list[dict]:
    if not REDNOTE_API_BASE:
        print("REDNOTE_API_BASE not configured — returning empty", file=sys.stderr)
        return []
    print(f"[rednote_auto_reply] Would fetch up to {limit} comments since {since_id or 'beginning'}", file=sys.stderr)
    return []


def auto_reply(dry_run: bool = False, limit: int = 20) -> dict:
    comments = fetch_comments(limit=limit)
    if not comments:
        _log_run(0, dry_run)
        return {"status": "noop", "reason": "no new comments or API not configured", "replied": 0}
    replied = 0
    for comment in comments:
        digest = hashlib.md5(comment.get("id", "").encode()).hexdigest()
        template = REPLY_TEMPLATES[int(digest, 16) % len(REPLY_TEMPLATES)]
        if dry_run:
            print(f"[DRY RUN] Would reply to comment {comment.get('id')}: {template}", file=sys.stderr)
        else:
            print(f"[rednote_auto_reply] Replying to comment {comment.get('id')}", file=sys.stderr)
        replied += 1
    _log_run(replied, dry_run)
    return {"status": "ok" if not dry_run else "dry_run", "replied": replied}


def _log_run(replied_count: int, dry_run: bool):
    repo = get_repository()
    record = EngagementRecord(
        platform="rednote",
        engagement_type="auto_reply",
        content=json.dumps({"replied": replied_count, "dry_run": dry_run}, ensure_ascii=False),
        status="dry_run" if dry_run else "completed",
        metadata={"source": "cron", "dry_run": dry_run},
    )
    try:
        repo.log_engagement(record)
    except Exception as e:
        print(f"Failed to log rednote run: {e}", file=sys.stderr)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Rednote comment auto-reply cron job")
    parser.add_argument("--dry-run", action="store_true", help="Preview replies without sending")
    parser.add_argument("--limit", type=int, default=20, help="Max comments to fetch")
    args = parser.parse_args()
    result = auto_reply(dry_run=args.dry_run, limit=args.limit)
    print(json.dumps(result, indent=2))
