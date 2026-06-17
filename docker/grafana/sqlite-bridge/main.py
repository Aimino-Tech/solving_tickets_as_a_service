"""
Marketing SQLite Bridge — Grafana Simple JSON Datasource Backend
================================================================

Reads the Hermes marketing ``campaigns.db`` (SQLite) and exposes its data
as REST endpoints consumable by Grafana's built-in Simple JSON datasource.

Endpoints
---------
- GET  /                 — Grafana datasource "test" probe
- POST /search           — List available tables/metrics
- POST /query            — Execute SQL and return time-series or table data
- GET  /health           — Bridge health check
- POST /annotations      — Return annotation events for Grafana

This is a **direct SQLite reader** — no DuckDB required. It mirrors the
DuckDB plugin's interface so dashboards can use either datasource.

Grafana Simple JSON datasource docs:
  https://grafana.com/docs/plugins/grafana-simple-json-datasource/
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

# ── Config ───────────────────────────────────────────────────────────────────

DB_PATH = os.environ.get("DB_PATH", "/data/marketing/campaigns.db")
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").upper()

logger = logging.getLogger("marketing-bridge")

# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Marketing SQLite Bridge",
    version="1.0.0",
    description="Grafana Simple JSON datasource backend for Hermes marketing data.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Database helpers ─────────────────────────────────────────────────────────


def _get_conn() -> sqlite3.Connection:
    """Return a read-only SQLite connection."""
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _query(sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    """Execute *sql* with *params*, return list of dicts."""
    conn = _get_conn()
    try:
        cur = conn.execute(sql, params or [])
        return [dict(row) for row in cur.fetchall()]
    except sqlite3.Error as exc:
        logger.error("SQL error: %s -- %s", exc, sql[:200])
        raise
    finally:
        conn.close()


# ── Datasource metadata ──────────────────────────────────────────────────────

TABLE_METADATA: dict[str, dict[str, str]] = {
    "campaigns": {"description": "Marketing campaigns", "time_column": "created_at"},
    "actions": {"description": "Campaign actions (posts, comments, etc.)", "time_column": "timestamp"},
    "accounts": {"description": "Platform accounts", "time_column": "created_at"},
    "metrics": {"description": "GitHub/npm metric snapshots", "time_column": "collected_at"},
    "funnel_events": {"description": "Marketing funnel events", "time_column": "occurred_at"},
    "engagement_snapshots": {"description": "Per-platform engagement snapshots", "time_column": "snapshot_date"},
    "campaign_performance": {"description": "Computed campaign performance summaries", "time_column": "computed_at"},
    "ai_recommendations": {"description": "AI-generated optimization recommendations", "time_column": "created_at"},
    "cron_job_log": {"description": "Cron job execution history", "time_column": "started_at"},
}

# ── Endpoints ────────────────────────────────────────────────────────────────


@app.get("/")
async def root() -> dict[str, str]:
    """Grafana datasource probe — must return 200."""
    return {"status": "ok", "database": DB_PATH}


@app.get("/health")
async def health() -> dict[str, Any]:
    """Health check — verifies DB is readable."""
    try:
        rows = _query("SELECT COUNT(*) AS cnt FROM campaigns")
        count = rows[0]["cnt"] if rows else 0
        return {
            "status": "healthy",
            "database": DB_PATH,
            "exists": os.path.isfile(DB_PATH),
            "campaign_count": count,
        }
    except Exception as exc:
        return {
            "status": "unhealthy",
            "database": DB_PATH,
            "error": str(exc),
        }


@app.post("/search")
async def search() -> list[dict[str, str]]:
    """Return available tables — used by Grafana for autocomplete."""
    return [
        {"text": name, "value": name, **meta}
        for name, meta in TABLE_METADATA.items()
    ]


@app.post("/query")
async def query(request: Request) -> list[dict[str, Any]]:
    """
    Execute a query and return results.

    Supports two Grafana Simple JSON formats:
      - ``format: "time_series"`` — returns TimeSeries array
      - ``format: "table"`` (default) — returns Table array

    Request body (Grafana Simple JSON standard):
    ```json
    {
      "targets": [{"target": "SELECT ...", "refId": "A", "type": "table"}],
      "range": {"from": "2024-01-01T00:00:00Z", "to": "2024-12-31T23:59:59Z"},
      "intervalMs": 86400000,
      "maxDataPoints": 100
    }
    ```
    """
    body = await request.json()
    targets: list[dict] = body.get("targets", [])
    time_range = body.get("range", {})
    date_from = time_range.get("from", "")
    date_to = time_range.get("to", "")

    results: list[dict[str, Any]] = []

    for target in targets:
        raw_sql: str = target.get("target", "")
        ref_id: str = target.get("refId", "A")
        fmt: str = target.get("type", "table")

        if not raw_sql.strip():
            continue

        # Resolve Grafana template variables
        sql = _resolve_templates(raw_sql, date_from, date_to)

        try:
            rows = _query(sql)
        except sqlite3.Error as exc:
            results.append({
                "target": ref_id,
                "datapoints": [],
                "error": str(exc),
            })
            continue

        if fmt == "time_series" and rows:
            results.append(_rows_to_timeseries(rows, ref_id))
        else:
            results.append(_rows_to_table(rows, ref_id))

    return results


def _resolve_templates(sql: str, date_from: str, date_to: str) -> str:
    """Replace Grafana Simple JSON template variables with SQL values."""
    replacements = {
        "$__timeFilter": "1=1",
        "$__timeFrom": f"'{date_from}'" if date_from else "'1970-01-01'",
        "$__timeTo": f"'{date_to}'" if date_to else "'2099-12-31'",
    }
    # Replace $__timeFilter(column) with "column >= t1 AND column <= t2"
    import re

    def _replace_time_filter(m: re.Match) -> str:
        col = m.group(1)
        if date_from and date_to:
            return f"{col} >= '{date_from}' AND {col} <= '{date_to}'"
        return "1=1"

    sql = re.sub(r'\$__timeFilter\((\w+)\)', _replace_time_filter, sql)

    for key, val in replacements.items():
        sql = sql.replace(key, val)

    return sql


def _rows_to_timeseries(
    rows: list[dict[str, Any]],
    ref_id: str,
) -> dict[str, Any]:
    """
    Convert query result to Simple JSON TimeSeries format.

    Expects rows with a ``time`` column and one or more numeric value columns.
    """
    series_map: dict[str, list[list[float | int]]] = {}

    for row in rows:
        # Parse time — expect ISO string or epoch
        raw_time = row.get("time", "")
        if isinstance(raw_time, (int, float)):
            epoch_ms = int(raw_time)
        else:
            try:
                dt = datetime.fromisoformat(str(raw_time).replace("Z", "+00:00"))
                epoch_ms = int(dt.timestamp() * 1000)
            except (ValueError, TypeError):
                epoch_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        for key, val in row.items():
            if key == "time" or val is None:
                continue
            try:
                num_val = float(val)
            except (ValueError, TypeError):
                continue
            if key not in series_map:
                series_map[key] = []
            series_map[key].append([num_val, epoch_ms])

    # Build the response
    result: list[dict[str, Any]] = []
    for name, points in series_map.items():
        result.append({
            "target": name,
            "datapoints": points,
        })

    # If only one series, use refId as target
    if len(result) == 1:
        result[0]["target"] = ref_id

    return {"target": ref_id, "datapoints": result[0]["datapoints"]} if result else {"target": ref_id, "datapoints": []}


def _rows_to_table(
    rows: list[dict[str, Any]],
    ref_id: str,
) -> dict[str, Any]:
    """Convert query result to Simple JSON Table format."""
    if not rows:
        return {
            "target": ref_id,
            "columns": [],
            "rows": [],
            "type": "table",
        }

    columns = [{"text": col, "type": "number" if isinstance(rows[0][col], (int, float)) else "string"} for col in rows[0]]
    data_rows = [[row[col] for col in rows[0]] for row in rows]

    return {
        "target": ref_id,
        "columns": columns,
        "rows": data_rows,
        "type": "table",
    }


@app.post("/annotations")
async def annotations(request: Request) -> list[dict[str, Any]]:
    """
    Return annotation events — campaign status changes, metric milestones.

    Request body (Grafana Simple JSON standard):
    ```json
    {
      "range": {"from": "...", "to": "..."},
      "annotation": {"query": "campaigns"}
    }
    ```
    """
    body = await request.json()
    annotation = body.get("annotation", {})
    query = annotation.get("query", "campaigns")

    if query == "campaigns":
        return _get_campaign_annotations(body.get("range", {}))
    if query == "metrics":
        return _get_metric_annotations(body.get("range", {}))

    return []


def _get_campaign_annotations(time_range: dict) -> list[dict[str, Any]]:
    """Return campaign creation events as annotations."""
    date_from = time_range.get("from", "")
    date_to = time_range.get("to", "")

    sql = "SELECT id, name, created_at, status FROM campaigns WHERE 1=1"
    params: list[Any] = []
    if date_from:
        sql += " AND created_at >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND created_at <= ?"
        params.append(date_to)
    sql += " ORDER BY created_at ASC"

    rows = _query(sql, params)
    annotations_out: list[dict[str, Any]] = []
    for row in rows:
        annotations_out.append({
            "annotation": "Campaign Created",
            "time": int(datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")).timestamp() * 1000),
            "title": row["name"],
            "tags": ["campaign", row.get("status", "unknown")],
        })
    return annotations_out


def _get_metric_annotations(time_range: dict) -> list[dict[str, Any]]:
    """Return metric milestone events as annotations."""
    date_from = time_range.get("from", "")
    date_to = time_range.get("to", "")

    sql = "SELECT collected_at, github_stars, npm_downloads FROM metrics WHERE 1=1"
    params: list[Any] = []
    if date_from:
        sql += " AND collected_at >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND collected_at <= ?"
        params.append(date_to)
    sql += " ORDER BY collected_at ASC"

    rows = _query(sql, params)
    annotations_out: list[dict[str, Any]] = []
    for row in rows:
        stars = row.get("github_stars", 0)
        downloads = row.get("npm_downloads", 0)
        annotations_out.append({
            "annotation": "Metric Snapshot",
            "time": int(
                datetime.fromisoformat(row["collected_at"].replace("Z", "+00:00")).timestamp() * 1000
            ),
            "title": f"Stars: {stars} | Downloads: {downloads}",
            "tags": ["metrics"],
        })
    return annotations_out


# ── Entrypoint ───────────────────────────────────────────────────────────────


def main() -> None:
    """Run the bridge server."""
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL, logging.INFO),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    logger.info(
        "Starting Marketing SQLite Bridge on %s:%s (db=%s)",
        HOST, PORT, DB_PATH,
    )
    uvicorn.run(app, host=HOST, port=PORT, log_level=LOG_LEVEL.lower())


if __name__ == "__main__":
    main()
