from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
from app.tracking import tracker

STATE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS orchestrator_state (
    key VARCHAR PRIMARY KEY,
    value JSON,
    updated_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS engagement_history (
    id VARCHAR PRIMARY KEY,
    platform VARCHAR NOT NULL,
    action VARCHAR NOT NULL,
    target_url VARCHAR,
    content_preview VARCHAR(200),
    score INTEGER,
    status VARCHAR NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT current_timestamp,
    decided_at TIMESTAMP,
    approved_by VARCHAR,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS leads (
    id VARCHAR PRIMARY KEY,
    platform VARCHAR NOT NULL,
    source_url VARCHAR,
    author_name VARCHAR,
    author_handle VARCHAR,
    content_snippet VARCHAR(500),
    relevance_score INTEGER DEFAULT 0,
    sentiment VARCHAR DEFAULT 'neutral',
    opportunity_score INTEGER DEFAULT 0,
    urgency VARCHAR DEFAULT 'batch',
    status VARCHAR DEFAULT 'new',
    created_at TIMESTAMP DEFAULT current_timestamp,
    engaged_at TIMESTAMP,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_engagement_platform ON engagement_history(platform);
CREATE INDEX IF NOT EXISTS idx_engagement_status ON engagement_history(status);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(relevance_score DESC);

CREATE TABLE IF NOT EXISTS campaign_state (
    campaign VARCHAR NOT NULL,
    day INTEGER NOT NULL,
    task_key VARCHAR NOT NULL,
    task_status VARCHAR DEFAULT 'pending',
    platform VARCHAR,
    content_file VARCHAR,
    completed_at TIMESTAMP,
    notes TEXT,
    PRIMARY KEY (campaign, day, task_key)
);

CREATE TABLE IF NOT EXISTS campaign_metrics (
    id VARCHAR PRIMARY KEY,
    campaign VARCHAR NOT NULL,
    collected_at TIMESTAMP DEFAULT current_timestamp,
    github_stars INTEGER,
    npm_weekly_downloads INTEGER,
    raw_data JSON
);
"""


class OrchestratorRepository:
    def __init__(self, db_path: str = "./workspace/state/orchestrator.duckdb"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn: duckdb.DuckDBPyConnection | None = None

    @property
    def conn(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            self._conn = duckdb.connect(str(self.db_path))
            for stmt in STATE_SCHEMA_SQL.split(";"):
                s = stmt.strip()
                if s:
                    self._conn.execute(s + ";")
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def get_state(self, key: str) -> Any | None:
        row = self.conn.execute(
            "SELECT value FROM orchestrator_state WHERE key = ?", [key]
        ).fetchone()
        if row:
            return json.loads(row[0])
        return None

    def set_state(self, key: str, value: Any) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            """INSERT INTO orchestrator_state (key, value, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = ?""",
            [key, json.dumps(value), now, json.dumps(value), now],
        )

    def log_engagement(self, platform: str, action: str, target_url: str = None,
                       content_preview: str = None, score: int = 0,
                       status: str = "pending") -> str:
        eid = str(uuid.uuid4())
        self.conn.execute(
            """INSERT INTO engagement_history
               (id, platform, action, target_url, content_preview, score, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
            [eid, platform, action, target_url, (content_preview or "")[:200], score, status],
        )
        tracker.track_engagement(platform, action, target_url, content_preview, score, status)
        return eid

    def update_engagement(self, eid: str, status: str = None,
                          approved_by: str = None, notes: str = None) -> None:
        parts = []
        params = []
        if status:
            parts.append("status = ?")
            params.append(status)
            parts.append("decided_at = CURRENT_TIMESTAMP")
        if approved_by:
            parts.append("approved_by = ?")
            params.append(approved_by)
        if notes:
            parts.append("notes = ?")
            params.append(notes)
        if parts:
            params.append(eid)
            self.conn.execute(
                f"UPDATE engagement_history SET {', '.join(parts)} WHERE id = ?",
                params,
            )

    def add_lead(self, platform: str, source_url: str = None,
                 author_name: str = None, author_handle: str = None,
                 content_snippet: str = None,
                 relevance_score: int = 0, sentiment: str = "neutral",
                 opportunity_score: int = 0, urgency: str = "batch") -> str:
        lid = str(uuid.uuid4())
        self.conn.execute(
            """INSERT INTO leads
               (id, platform, source_url, author_name, author_handle, content_snippet,
                relevance_score, sentiment, opportunity_score, urgency, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', CURRENT_TIMESTAMP)""",
            [lid, platform, source_url, author_name, author_handle,
             (content_snippet or "")[:500], relevance_score, sentiment,
             opportunity_score, urgency],
        )
        tracker.track_lead(platform, source_url, author_name, author_handle,
                           content_snippet, relevance_score, sentiment,
                           opportunity_score, urgency)
        return lid

    def get_pending_engagements(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """SELECT * FROM engagement_history
               WHERE status = 'pending' ORDER BY score DESC, created_at ASC LIMIT ?""",
            [limit],
        ).fetchall()
        cols = [d[0] for d in self.conn.execute("DESCRIBE engagement_history").fetchall()]
        return [dict(zip(cols, row)) for row in rows]

    def get_new_leads(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """SELECT * FROM leads
               WHERE status = 'new' ORDER BY opportunity_score DESC, created_at ASC LIMIT ?""",
            [limit],
        ).fetchall()
        cols = [d[0] for d in self.conn.execute("DESCRIBE leads").fetchall()]
        return [dict(zip(cols, row)) for row in rows]

    def update_lead(self, lid: str, status: str = None,
                    relevance_score: int = None, sentiment: str = None,
                    opportunity_score: int = None) -> None:
        parts = []
        params = []
        if status:
            parts.append("status = ?")
            params.append(status)
            if status in ("engaged", "converted"):
                parts.append("engaged_at = CURRENT_TIMESTAMP")
        if relevance_score is not None:
            parts.append("relevance_score = ?")
            params.append(relevance_score)
        if sentiment:
            parts.append("sentiment = ?")
            params.append(sentiment)
        if opportunity_score is not None:
            parts.append("opportunity_score = ?")
            params.append(opportunity_score)
        if parts:
            params.append(lid)
            self.conn.execute(
                f"UPDATE leads SET {', '.join(parts)} WHERE id = ?",
                params,
            )

    def summary(self, days: int = 7) -> dict[str, Any]:
        engaged = self.conn.execute(
            """SELECT platform, status, COUNT(*) as count
               FROM engagement_history
               WHERE created_at >= CURRENT_TIMESTAMP - (? * INTERVAL '1' DAY)
               GROUP BY platform, status ORDER BY platform""",
            [days],
        ).fetchall()
        lead_stats = self.conn.execute(
            """SELECT platform, status, COUNT(*) as count
               FROM leads WHERE created_at >= CURRENT_TIMESTAMP - (? * INTERVAL '1' DAY)
               GROUP BY platform, status ORDER BY platform""",
            [days],
        ).fetchall()
        return {
            "engagement_counts": [{"platform": r[0], "status": r[1], "count": r[2]} for r in engaged],
            "lead_counts": [{"platform": r[0], "status": r[1], "count": r[2]} for r in lead_stats],
        }


    def log_campaign_task(self, campaign: str, day: int, task_key: str,
                           platform: str = None, content_file: str = None) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            """INSERT INTO campaign_state (campaign, day, task_key, task_status, platform, content_file, completed_at)
               VALUES (?, ?, ?, 'completed', ?, ?, ?)
               ON CONFLICT (campaign, day, task_key)
               DO UPDATE SET task_status = 'completed', completed_at = ?""",
            [campaign, day, task_key, platform, content_file, now, now],
        )
        tracker.track_campaign_task(campaign, day, task_key, platform, content_file)

    def get_campaign_tasks(self, campaign: str, day: int = None) -> list[dict[str, Any]]:
        if day is not None:
            rows = self.conn.execute(
                """SELECT campaign, day, task_key, task_status, platform, content_file,
                          completed_at, notes
                   FROM campaign_state
                   WHERE campaign = ? AND day = ?
                   ORDER BY task_key""",
                [campaign, day],
            ).fetchall()
        else:
            rows = self.conn.execute(
                """SELECT campaign, day, task_key, task_status, platform, content_file,
                          completed_at, notes
                   FROM campaign_state
                   WHERE campaign = ?
                   ORDER BY day, task_key""",
                [campaign],
            ).fetchall()
        cols = ["campaign", "day", "task_key", "task_status", "platform", "content_file",
                "completed_at", "notes"]
        return [dict(zip(cols, row)) for row in rows]

    def log_campaign_metrics(self, campaign: str, github_stars: int = None,
                              npm_downloads: int = None, raw_data: dict = None) -> str:
        mid = str(uuid.uuid4())
        self.conn.execute(
            """INSERT INTO campaign_metrics (id, campaign, github_stars, npm_weekly_downloads, raw_data)
               VALUES (?, ?, ?, ?, ?)""",
            [mid, campaign, github_stars, npm_downloads, json.dumps(raw_data) if raw_data else None],
        )
        tracker.track_metrics(campaign, github_stars, npm_downloads, raw_data)
        return mid

    def get_campaign_metrics(self, campaign: str, limit: int = 30) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """SELECT id, collected_at, github_stars, npm_weekly_downloads, raw_data
               FROM campaign_metrics
               WHERE campaign = ?
               ORDER BY collected_at DESC
               LIMIT ?""",
            [campaign, limit],
        ).fetchall()
        cols = ["id", "collected_at", "github_stars", "npm_weekly_downloads", "raw_data"]
        return [dict(zip(cols, [str(c) if hasattr(c, 'isoformat') else c for c in row])) for row in rows]


_repo: OrchestratorRepository | None = None


def get_repository(db_path: str | None = None) -> OrchestratorRepository:
    global _repo
    if _repo is None:
        _repo = OrchestratorRepository(db_path or "./workspace/state/orchestrator.duckdb")
    return _repo


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Orchestrator state manager")
    sub = parser.add_subparsers(dest="command", required=True)

    p_state = sub.add_parser("get-state", help="Get orchestrator state")
    p_state.add_argument("key")

    p_set = sub.add_parser("set-state", help="Set orchestrator state")
    p_set.add_argument("key")
    p_set.add_argument("value")

    sub.add_parser("pending", help="List pending engagements")
    sub.add_parser("leads", help="List new leads")

    p_summary = sub.add_parser("summary", help="Get summary stats")
    p_summary.add_argument("--days", type=int, default=7)

    p_engage = sub.add_parser("log-engagement", help="Log an engagement")
    p_engage.add_argument("--platform", required=True)
    p_engage.add_argument("--action", required=True)
    p_engage.add_argument("--target-url")
    p_engage.add_argument("--content-preview")
    p_engage.add_argument("--score", type=int, default=0)
    p_engage.add_argument("--status", default="pending")

    p_lead = sub.add_parser("add-lead", help="Add a lead")
    p_lead.add_argument("--platform", required=True)
    p_lead.add_argument("--source-url")
    p_lead.add_argument("--author-name")
    p_lead.add_argument("--author-handle")
    p_lead.add_argument("--content-snippet")
    p_lead.add_argument("--relevance-score", type=int, default=0)
    p_lead.add_argument("--sentiment", default="neutral")
    p_lead.add_argument("--opportunity-score", type=int, default=0)
    p_lead.add_argument("--urgency", default="batch")

    args = parser.parse_args()
    repo = get_repository()

    if args.command == "get-state":
        val = repo.get_state(args.key)
        print(json.dumps({"key": args.key, "value": val}))
    elif args.command == "set-state":
        repo.set_state(args.key, json.loads(args.value))
        print(json.dumps({"set": args.key}))
    elif args.command == "pending":
        items = repo.get_pending_engagements()
        print(json.dumps(items, indent=2, default=str))
    elif args.command == "leads":
        items = repo.get_new_leads()
        print(json.dumps(items, indent=2, default=str))
    elif args.command == "summary":
        print(json.dumps(repo.summary(days=args.days), indent=2))
    elif args.command == "log-engagement":
        eid = repo.log_engagement(args.platform, args.action, args.target_url,
                                  args.content_preview, args.score, args.status)
        print(json.dumps({"engagement_id": eid}))
    elif args.command == "add-lead":
        lid = repo.add_lead(args.platform, args.source_url, args.author_name,
                            args.author_handle, args.content_snippet,
                            args.relevance_score, args.sentiment,
                            args.opportunity_score, args.urgency)
        print(json.dumps({"lead_id": lid}))
