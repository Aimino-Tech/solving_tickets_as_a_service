"""
ROI Dashboard plugin — backend API routes.

Mounted at /api/plugins/roi-dashboard/ by the Hermes dashboard plugin system.
Returns JSON data from the DuckDB analytics store + SQLite CampaignStore.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from marketing.duckdb_store import DuckDBStore
from marketing.store import CampaignStore
from marketing.roi_arch import ROIAnalyticsEngine, ROIAnalyticsConfig

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_duckdb() -> DuckDBStore:
    return DuckDBStore()


def _get_store() -> CampaignStore:
    return CampaignStore()


# ── Response models ──────────────────────────────────────────────────────────


class KPIsResponse(BaseModel):
    total_reach: int
    total_engagement: int
    avg_sentiment: float
    campaign_count: int
    platform_count: int
    reach_change: float
    engagement_change: float


class PlatformBreakdown(BaseModel):
    platform: str
    post_count: int
    comment_count: int
    total_score: int
    avg_sentiment: float
    last_activity: str


class FunnelStage(BaseModel):
    stage: str
    count: int


class CampaignSummary(BaseModel):
    id: str
    name: str
    product: str
    status: str
    reach: int
    roi: float


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/health")
async def health() -> dict:
    """Quick health check — verifies DB is reachable."""
    try:
        db = _get_duckdb()
        row = db.query("SELECT count(*) as c FROM raw_events")
        count = row[0]["c"] if row else 0
        return {"ok": True, "raw_events": count}
    except Exception as exc:
        logger.warning("ROI plugin health check failed: %s", exc)
        return {"ok": False, "error": str(exc)}


@router.get("/kpis")
async def kpis(days: int = Query(30, ge=1, le=365)) -> KPIsResponse:
    """Top-level KPI metrics for the dashboard overview."""
    db = _get_duckdb()
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    prev_start = start - timedelta(days=days)

    def _count_range(s: datetime, e: datetime) -> dict:
        rows = db.query(
            "SELECT "
            "  COALESCE(SUM(score), 0) as reach, "
            "  COUNT(*) as engagement, "
            "  COALESCE(AVG(s.compound), 0.0) as sentiment "
            "FROM raw_events r "
            "LEFT JOIN sentiment_scores s ON r.id = s.raw_event_id "
            "WHERE r.occurred_at >= ? AND r.occurred_at < ?",
            params=[s.isoformat(), e.isoformat()],
        )
        return rows[0] if rows else {"reach": 0, "engagement": 0, "sentiment": 0.0}

    current = _count_range(start, end)
    previous = _count_range(prev_start, start)

    campaigns = _get_store().list_campaigns()
    platforms = db.query(
        "SELECT COUNT(DISTINCT platform) as c FROM raw_events "
        "WHERE occurred_at >= ?",
        params=[start.isoformat()],
    )
    platform_count = platforms[0]["c"] if platforms else 0

    def _pct_change(curr: float, prev: float) -> float:
        if prev == 0:
            return 0.0
        return round((curr - prev) / prev * 100, 1)

    return KPIsResponse(
        total_reach=int(current["reach"]),
        total_engagement=int(current["engagement"]),
        avg_sentiment=round(float(current["sentiment"]), 3),
        campaign_count=len(campaigns),
        platform_count=int(platform_count),
        reach_change=_pct_change(float(current["reach"]), float(previous["reach"])),
        engagement_change=_pct_change(
            float(current["engagement"]), float(previous["engagement"])
        ),
    )


@router.get("/platforms")
async def platform_breakdown(days: int = Query(30, ge=1, le=365)) -> list[PlatformBreakdown]:
    """Per-platform engagement breakdown."""
    db = _get_duckdb()
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    rows = db.query(
        "SELECT "
        "  r.platform, "
        "  COUNT(*) as post_count, "
        "  COALESCE(SUM(r.score), 0) as total_score, "
        "  COALESCE(AVG(s.compound), 0.0) as avg_sentiment, "
        "  MAX(r.occurred_at) as last_activity "
        "FROM raw_events r "
        "LEFT JOIN sentiment_scores s ON r.id = s.raw_event_id "
        "WHERE r.occurred_at >= ? "
        "GROUP BY r.platform "
        "ORDER BY total_score DESC",
        params=[start.isoformat()],
    )

    results = []
    for r in rows:
        results.append(
            PlatformBreakdown(
                platform=r["platform"],
                post_count=int(r["post_count"]),
                comment_count=0,
                total_score=int(r["total_score"]),
                avg_sentiment=round(float(r["avg_sentiment"]), 3),
                last_activity=str(r["last_activity"] or ""),
            )
        )
    return results


@router.get("/funnel")
async def funnel_days(days: int = Query(30, ge=1, le=365)) -> list[FunnelStage]:
    """Funnel stage counts from the DuckDB raw_events."""
    try:
        db = _get_duckdb()
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)
        rows = db.query(
            "SELECT COALESCE(event_type, 'awareness') as stage, COUNT(*) as cnt "
            "FROM raw_events "
            "WHERE occurred_at >= ? AND occurred_at < ? "
            "GROUP BY stage ORDER BY cnt DESC",
            (start.isoformat(), end.isoformat()),
        )
    except Exception:
        rows = []

    stages = {"awareness": 0, "engagement": 0, "interest": 0,
              "consideration": 0, "conversion": 0, "retention": 0}
    for row in rows:
        stage = str(row["stage"]).lower()
        if stage in stages:
            stages[stage] = int(row["cnt"])

    return [FunnelStage(stage=s, count=c) for s, c in stages.items()]


@router.get("/campaigns")
async def campaigns() -> list[CampaignSummary]:
    """List campaigns with reach + ROI estimates."""
    store = _get_store()
    db = _get_duckdb()

    try:
        engine = ROIAnalyticsEngine(config=ROIAnalyticsConfig())
    except Exception:
        engine = ROIAnalyticsEngine()

    summaries = []
    for c in store.list_campaigns():
        row = db.query(
            "SELECT COALESCE(SUM(score), 0) as reach FROM raw_events "
            "WHERE campaign_name = ?",
            params=[c["name"]],
        )
        reach = int(row[0]["reach"]) if row else 0
        try:
            roi_data = engine.estimate_roi(c["id"], store)
            roi_val = float(roi_data.get("roi_estimated", 0.0))
        except Exception:
            roi_val = 0.0

        summaries.append(
            CampaignSummary(
                id=c["id"],
                name=c["name"],
                product=c.get("product", ""),
                status=c.get("status", "draft"),
                reach=reach,
                roi=round(roi_val, 2),
            )
        )
    return summaries


@router.get("/grafana")
async def grafana_links() -> dict:
    """Return Grafana dashboard links (if Grafana is reachable)."""
    import urllib.request
    import json as j

    grafana_base = "http://localhost:3000"
    dashboards = {
        "roi-overview": "Marketing ROI — Overview",
        "funnel": "Marketing Funnel",
        "platform-engagement": "Platform Engagement",
        "sentiment": "Sentiment Analysis",
        "github-npm-traffic": "GitHub & npm Traffic",
    }

    # Quick reachability check
    grafana_running = False
    try:
        urllib.request.urlopen(f"{grafana_base}/api/health", timeout=2)
        grafana_running = True
    except Exception:
        pass

    return {
        "running": grafana_running,
        "base_url": grafana_base,
        "dashboards": [
            {"id": k, "label": v, "url": f"{grafana_base}/d/{k}/{v.lower().replace(' ', '-')}"}
            for k, v in dashboards.items()
        ],
    }
