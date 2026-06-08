"""Lightweight DuckDB HTTP API for the OpenClaw agent to query client data and track engagement."""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="OpenClaw DuckDB API", docs_url="/docs")

DATA_ROOT = Path(os.getenv("DATA_ROOT", "/data/clients"))
ENGAGEMENT_DB = Path(os.getenv("ENGAGEMENT_DB_PATH", "/data/engagement/engagement.duckdb"))

ENGAGEMENT_SCHEMA = """
CREATE TABLE IF NOT EXISTS engagements (
    id VARCHAR PRIMARY KEY,
    platform VARCHAR NOT NULL,
    engagement_type VARCHAR NOT NULL,
    content TEXT,
    target VARCHAR,
    status VARCHAR NOT NULL DEFAULT 'draft',
    rate_limit_info JSON,
    error_message TEXT,
    approved_by VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP,
    metadata JSON
);

CREATE TABLE IF NOT EXISTS rate_limits (
    platform VARCHAR NOT NULL,
    window_start TIMESTAMP NOT NULL,
    request_count INTEGER DEFAULT 0,
    PRIMARY KEY (platform, window_start)
);
"""


class QueryRequest(BaseModel):
    client: str
    sql: str


class ProfileRequest(BaseModel):
    client: str
    table: str


@app.post("/query")
async def run_query(req: QueryRequest):
    db_path = DATA_ROOT / req.client / f"{req.client}.duckdb"
    if not db_path.parent.exists():
        raise HTTPException(404, f"Client directory not found: {req.client}")
    try:
        con = duckdb.connect(str(db_path))
        result = con.execute(req.sql).fetchdf()
        con.close()
        return JSONResponse(content={"rows": len(result), "data": result.to_dict(orient="records")})
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/profile")
async def profile_table(req: ProfileRequest):
    """Quick data profiling: row count, null rates, type distribution."""
    db_path = DATA_ROOT / req.client / f"{req.client}.duckdb"
    if not db_path.parent.exists():
        raise HTTPException(404, f"Client directory not found: {req.client}")
    try:
        con = duckdb.connect(str(db_path))
        cols = con.execute(f"DESCRIBE {req.table}").fetchdf()
        count = con.execute(f"SELECT COUNT(*) as n FROM {req.table}").fetchone()[0]

        profile = {"table": req.table, "row_count": count, "columns": []}
        for _, row in cols.iterrows():
            col_name = row["column_name"]
            null_count = con.execute(
                f"SELECT COUNT(*) FROM {req.table} WHERE {col_name} IS NULL"
            ).fetchone()[0]
            distinct = con.execute(
                f"SELECT COUNT(DISTINCT {col_name}) FROM {req.table}"
            ).fetchone()[0]
            profile["columns"].append({
                "name": col_name,
                "type": row["column_type"],
                "null_rate": round(null_count / max(count, 1), 4),
                "distinct_count": distinct,
            })
        con.close()
        return JSONResponse(content=profile)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/health")
async def health():
    return {"status": "ok", "duckdb_version": duckdb.__version__}


class LogEngagementRequest(BaseModel):
    platform: str
    engagement_type: str
    content: str
    target: str | None = None
    status: str = "draft"
    metadata: dict[str, Any] = {}


class UpdateEngagementRequest(BaseModel):
    id: str
    status: str
    error_message: str | None = None
    approved_by: str | None = None


class EngagementQueryParams(BaseModel):
    platform: str | None = None
    status: str | None = None
    limit: int = 50


def _get_engagement_conn() -> duckdb.DuckDBPyConnection:
    ENGAGEMENT_DB.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(ENGAGEMENT_DB))
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute(ENGAGEMENT_SCHEMA)
    return con


@app.post("/engagement/log")
async def log_engagement(req: LogEngagementRequest):
    con = _get_engagement_conn()
    try:
        record_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        con.execute(
            """INSERT INTO engagements (id, platform, engagement_type, content, target, status, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [record_id, req.platform, req.engagement_type, req.content, req.target,
             req.status, json.dumps(req.metadata) if req.metadata else None, created_at],
        )
        return JSONResponse(content={
            "id": record_id,
            "platform": req.platform,
            "engagement_type": req.engagement_type,
            "status": req.status,
            "created_at": created_at,
        }, status_code=201)
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        con.close()


@app.post("/engagement/update")
async def update_engagement(req: UpdateEngagementRequest):
    con = _get_engagement_conn()
    try:
        con.execute(
            """UPDATE engagements SET status = ?,
                error_message = COALESCE(?, error_message),
                approved_by = COALESCE(?, approved_by),
                sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
               WHERE id = ?""",
            [req.status, req.error_message, req.approved_by, req.status, req.id],
        )
        if con.execute("SELECT changes()").fetchone()[0] == 0:
            raise HTTPException(404, f"Engagement not found: {req.id}")
        return {"id": req.id, "status": req.status}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        con.close()


@app.get("/engagement/query")
async def query_engagements(
    platform: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50),
):
    con = _get_engagement_conn()
    try:
        clauses = []
        params = []
        if platform:
            clauses.append("platform = ?")
            params.append(platform)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = " AND ".join(clauses) if clauses else "1=1"
        rows = con.execute(
            f"SELECT * FROM engagements WHERE {where} ORDER BY created_at DESC LIMIT ?",
            params + [limit],
        ).fetchall()
        columns = [desc[0] for desc in con.description]
        results = [dict(zip(columns, row)) for row in rows]
        return {"count": len(results), "data": results}
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        con.close()


@app.get("/engagement/summary")
async def engagement_summary(days: int = Query(7)):
    con = _get_engagement_conn()
    try:
        rows = con.execute(
            """SELECT platform, engagement_type, status, COUNT(*) as count,
                      DATE(created_at) as day
               FROM engagements
               WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL ? DAY
               GROUP BY platform, engagement_type, status, DATE(created_at)
               ORDER BY day DESC, platform, engagement_type""",
            [days],
        ).fetchall()
        results = [
            {"platform": r[0], "engagement_type": r[1], "status": r[2],
             "count": r[3], "day": str(r[4])}
            for r in rows
        ]
        return {"days": days, "data": results}
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        con.close()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8642)
