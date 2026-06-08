import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

DB_PATH = os.getenv("INDIAN_ENGAGEMENT_DB", str(Path(__file__).parent.parent / "workspace" / "indian-engagement" / "engagements.duckdb"))
SCHEMA_PATH = Path(__file__).parent.parent / "workspace" / "indian-engagement" / "schema.sql"


def _get_connection():
    os.makedirs(str(Path(DB_PATH).parent), exist_ok=True)
    con = duckdb.connect(str(DB_PATH))
    _ensure_schema(con)
    return con


def _ensure_schema(con):
    if SCHEMA_PATH.exists():
        con.execute(SCHEMA_PATH.read_text())


def log_event(platform: str, action: str, status: str, metadata: dict = None,
              language_tag: str = "en_IN"):
    con = _get_connection()
    try:
        con.execute("""
            INSERT INTO engagements (platform, action, status, language_tag, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            platform,
            action,
            status,
            language_tag,
            json.dumps(metadata or {}),
            datetime.now(timezone.utc).isoformat(),
        ])
    except duckdb.Error as e:
        print(f"Failed to log engagement: {e}", file=sys.stderr)
    finally:
        con.close()


def query_engagements(platform: str = None, action: str = None,
                      since: str = None, limit: int = 50) -> list[dict]:
    con = _get_connection()
    try:
        parts = ["SELECT * FROM engagements WHERE 1=1"]
        params = []
        if platform:
            parts.append("AND platform = ?")
            params.append(platform)
        if action:
            parts.append("AND action = ?")
            params.append(action)
        if since:
            parts.append("AND created_at >= ?")
            params.append(since)
        parts.append("ORDER BY created_at DESC LIMIT ?")
        params.append(limit)
        result = con.execute(" ".join(parts), params).fetchdf()
        return json.loads(result.to_json(orient="records"))
    finally:
        con.close()


def get_stats() -> dict:
    con = _get_connection()
    try:
        total = con.execute("SELECT COUNT(*) FROM engagements").fetchone()[0]
        by_platform = con.execute("""
            SELECT platform, COUNT(*) as count, MAX(created_at) as last_active
            FROM engagements GROUP BY platform ORDER BY count DESC
        """).fetchdf()
        by_status = con.execute("""
            SELECT status, COUNT(*) as count FROM engagements GROUP BY status
        """).fetchdf()
        return {
            "total_engagements": total,
            "by_platform": json.loads(by_platform.to_json(orient="records")),
            "by_status": json.loads(by_status.to_json(orient="records")),
        }
    finally:
        con.close()


def export_csv(output_path: str = None):
    con = _get_connection()
    if output_path is None:
        output_path = str(Path(DB_PATH).parent / "engagements_export.csv")
    try:
        df = con.execute("SELECT * FROM engagements").fetchdf()
        df.to_csv(output_path, index=False)
        return {"exported_to": output_path, "success": True}
    except Exception as e:
        return {"error": str(e), "success": False}
    finally:
        con.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Indian Engagement DuckDB Logger")
    sub = parser.add_subparsers(dest="command", required=True)

    p_log = sub.add_parser("log", help="Log an engagement event")
    p_log.add_argument("--platform", required=True)
    p_log.add_argument("--action", required=True)
    p_log.add_argument("--status", default="success")
    p_log.add_argument("--metadata", default="{}")
    p_log.add_argument("--lang", default="en_IN")

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
