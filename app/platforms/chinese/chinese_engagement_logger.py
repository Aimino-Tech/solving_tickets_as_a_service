import json
import os
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.db import get_repository
from app.common.models import EngagementRecord


def _get_db_path():
    return os.getenv(
        "ENGAGEMENT_DB_PATH",
        str(Path(__file__).parent.parent / "workspace" / "engagement" / "engagement.duckdb"),
    )


def log_event(platform: str, action: str, status: str, metadata: dict = None,
              language_tag: str = "zh_CN"):
    repo = get_repository(_get_db_path())
    record = EngagementRecord(
        platform=platform,
        engagement_type=action,
        content=json.dumps(metadata or {}, ensure_ascii=False),
        status=status,
        metadata={"language_tag": language_tag, **(metadata or {})},
    )
    try:
        repo.log_engagement(record)
    except duckdb.Error as e:
        print(f"Failed to log engagement: {e}", file=sys.stderr)


def query_engagements(platform: str = None, action: str = None,
                      since: str = None, limit: int = 50) -> list[dict]:
    repo = get_repository(_get_db_path())
    try:
        parts = ["SELECT * FROM engagements WHERE 1=1"]
        params = []
        if platform:
            parts.append("AND platform = ?")
            params.append(platform)
        if action:
            parts.append("AND engagement_type = ?")
            params.append(action)
        if since:
            parts.append("AND created_at >= ?")
            params.append(since)
        parts.append("ORDER BY created_at DESC LIMIT ?")
        params.append(limit)
        result = repo.conn.execute(" ".join(parts), params).fetchdf()
        return json.loads(result.to_json(orient="records"))
    except Exception as e:
        print(f"Failed to query engagements: {e}", file=sys.stderr)
        return []


def get_stats() -> dict:
    repo = get_repository(_get_db_path())
    try:
        total = repo.conn.execute("SELECT COUNT(*) FROM engagements").fetchone()[0]
        by_platform = repo.conn.execute("""
            SELECT platform, COUNT(*) as count, MAX(created_at) as last_active
            FROM engagements GROUP BY platform ORDER BY count DESC
        """).fetchdf()
        by_status = repo.conn.execute("""
            SELECT status, COUNT(*) as count FROM engagements GROUP BY status
        """).fetchdf()
        return {
            "total_engagements": total,
            "by_platform": json.loads(by_platform.to_json(orient="records")),
            "by_status": json.loads(by_status.to_json(orient="records")),
        }
    except Exception as e:
        print(f"Failed to get stats: {e}", file=sys.stderr)
        return {"total_engagements": 0, "by_platform": [], "by_status": []}


def export_csv(output_path: str = None):
    repo = get_repository(_get_db_path())
    if output_path is None:
        output_path = str(Path(_get_db_path()).parent / "engagements_export.csv")
    try:
        df = repo.conn.execute("SELECT * FROM engagements").fetchdf()
        df.to_csv(output_path, index=False)
        return {"exported_to": output_path, "success": True}
    except Exception as e:
        print(f"Failed to export CSV: {e}", file=sys.stderr)
        return {"error": str(e), "success": False}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Chinese Engagement DuckDB Logger")
    sub = parser.add_subparsers(dest="command", required=True)

    p_log = sub.add_parser("log", help="Log an engagement event")
    p_log.add_argument("--platform", required=True)
    p_log.add_argument("--action", required=True)
    p_log.add_argument("--status", default="success")
    p_log.add_argument("--metadata", default="{}")
    p_log.add_argument("--lang", default="zh_CN")

    p_query = sub.add_parser("query", help="Query engagement records")
    p_query.add_argument("--platform")
    p_query.add_argument("--action")
    p_query.add_argument("--since")
    p_query.add_argument("--limit", type=int, default=50)

    sub.add_parser("stats", help="Get engagement statistics")

    p_export = sub.add_parser("export", help="Export engagements to CSV")
    p_export.add_argument("--output")

    args = parser.parse_args()

    if args.command == "log":
        log_event(args.platform, args.action, args.status,
                  json.loads(args.metadata), args.lang)
        print(json.dumps({"logged": True, "platform": args.platform, "action": args.action}))
    elif args.command == "query":
        results = query_engagements(platform=args.platform, action=args.action,
                                    since=args.since, limit=args.limit)
        print(json.dumps(results, indent=2))
    elif args.command == "stats":
        print(json.dumps(get_stats(), indent=2))
    elif args.command == "export":
        print(json.dumps(export_csv(args.output)))
