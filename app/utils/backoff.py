from __future__ import annotations
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb

BACKOFF_SECONDS = [30, 60, 300, 900, 1800, 3600, 14400]


class BackoffTracker:
    def __init__(self, db_path: str = "./workspace/state/orchestrator.duckdb"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn: duckdb.DuckDBPyConnection | None = None

    @property
    def conn(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            self._conn = duckdb.connect(str(self.db_path))
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS backoff_state (
                    id VARCHAR PRIMARY KEY,
                    platform VARCHAR NOT NULL,
                    failures INTEGER DEFAULT 0,
                    last_failure_at TIMESTAMP,
                    next_retry_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def record_failure(self, platform: str, backoff_id: str = None) -> str:
        bid = backoff_id or f"{platform}_{int(time.time())}"
        now_ts = datetime.now(timezone.utc).isoformat()
        try:
            self.conn.execute(
                "INSERT INTO backoff_state (id, platform, failures, last_failure_at, next_retry_at) VALUES (?, ?, 1, ?, ?)",
                [bid, platform, now_ts, now_ts],
            )
        except Exception:
            wait_sec = self.get_wait_seconds(self._get_current_failures(bid) + 1)
            next_retry = datetime.now(timezone.utc).timestamp() + wait_sec
            next_retry_ts = datetime.fromtimestamp(next_retry, tz=timezone.utc).isoformat()
            self.conn.execute(
                "UPDATE backoff_state SET failures = failures + 1, last_failure_at = ?, next_retry_at = ? WHERE id = ?",
                [now_ts, next_retry_ts, bid],
            )
        return bid

    def _get_current_failures(self, backoff_id: str) -> int:
        row = self.conn.execute(
            "SELECT failures FROM backoff_state WHERE id = ?", [backoff_id]
        ).fetchone()
        return row[0] if row else 0
        return bid

    def record_success(self, backoff_id: str) -> None:
        self.conn.execute(
            "UPDATE backoff_state SET failures = 0, next_retry_at = NULL WHERE id = ?",
            [backoff_id],
        )

    def get_wait_seconds(self, failures: int) -> int:
        idx = min(failures, len(BACKOFF_SECONDS)) - 1
        return BACKOFF_SECONDS[max(0, idx)]

    def get_backoff_info(self, platform: str = None) -> list[dict[str, Any]]:
        if platform:
            rows = self.conn.execute(
                "SELECT * FROM backoff_state WHERE platform = ? ORDER BY last_failure_at DESC",
                [platform],
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM backoff_state ORDER BY last_failure_at DESC",
            ).fetchall()
        cols = [d[0] for d in self.conn.execute("DESCRIBE backoff_state").fetchall()]
        return [dict(zip(cols, row)) for row in rows]

    def get_due_retries(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM backoff_state WHERE next_retry_at <= CURRENT_TIMESTAMP AND failures > 0 ORDER BY next_retry_at ASC",
        ).fetchall()
        cols = [d[0] for d in self.conn.execute("DESCRIBE backoff_state").fetchall()]
        return [dict(zip(cols, row)) for row in rows]

    def reset_backoff(self, backoff_id: str) -> None:
        self.conn.execute(
            "UPDATE backoff_state SET failures = 0, next_retry_at = NULL WHERE id = ?",
            [backoff_id],
        )


def wait_with_backoff(failures: int) -> float:
    seconds = BACKOFF_SECONDS[min(failures, len(BACKOFF_SECONDS)) - 1]
    import random
    jitter = random.uniform(0, 0.1 * seconds)
    total = seconds + jitter
    time.sleep(total)
    return total


def format_backoff_summary(backoff_info: list[dict[str, Any]]) -> str:
    lines = ["Backoff Status:"]
    for item in backoff_info:
        lines.append(
            f"  {item['platform']}/{item['id'][:24]}: "
            f"{item['failures']} failures, "
            f"next retry: {item.get('next_retry_at', 'ready')}"
        )
    return "\n".join(lines)


BACKOFF_SEQUENCE_DESCRIPTION = " → ".join(
    f"{s // 60}m" if s >= 60 else f"{s}s"
    for s in BACKOFF_SECONDS
)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Backoff/retry manager")
    sub = parser.add_subparsers(dest="command", required=True)

    p_record_fail = sub.add_parser("record-failure", help="Record a failure")
    p_record_fail.add_argument("--platform", required=True)
    p_record_fail.add_argument("--id")

    p_record_ok = sub.add_parser("record-success", help="Record a success")
    p_record_ok.add_argument("--id", required=True)

    p_info = sub.add_parser("info", help="Get backoff info")
    p_info.add_argument("--platform")

    sub.add_parser("due", help="Get due retries")

    p_wait = sub.add_parser("wait", help="Calculate wait time")
    p_wait.add_argument("--failures", type=int, required=True)

    p_reset = sub.add_parser("reset", help="Reset backoff")
    p_reset.add_argument("--id", required=True)

    sub.add_parser("sequence", help="Show backoff sequence")

    args = parser.parse_args()
    tracker = BackoffTracker()

    if args.command == "record-failure":
        bid = tracker.record_failure(args.platform, args.id)
        info = tracker.get_backoff_info(platform=args.platform)
        print(json.dumps({"backoff_id": bid, "info": info}, indent=2, default=str))
    elif args.command == "record-success":
        tracker.record_success(args.id)
        print(json.dumps({"reset": args.id}))
    elif args.command == "info":
        info = tracker.get_backoff_info(platform=args.platform)
        print(json.dumps(info, indent=2, default=str))
    elif args.command == "due":
        due = tracker.get_due_retries()
        print(json.dumps(due, indent=2, default=str))
    elif args.command == "wait":
        seconds = tracker.get_wait_seconds(args.failures)
        print(json.dumps({"failures": args.failures, "wait_seconds": seconds}))
    elif args.command == "reset":
        tracker.reset_backoff(args.id)
        print(json.dumps({"reset": args.id}))
    elif args.command == "sequence":
        print(json.dumps({"sequence": BACKOFF_SECONDS, "description": BACKOFF_SEQUENCE_DESCRIPTION}))
