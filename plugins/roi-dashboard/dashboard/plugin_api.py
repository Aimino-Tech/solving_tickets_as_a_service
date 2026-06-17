"""ROI Dashboard plugin — backend API routes.

Mounted at /api/plugins/roi/ by the dashboard plugin system.

Provides marketing ROI analytics: funnel data, campaign performance,
and conversion tracking.

This layer is intentionally thin: every handler is a small wrapper
around the ROI data store. As the data model matures, this will
connect to a proper database; for now it returns computed data from
the campaign tracking system.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

class FunnelData(BaseModel):
    """Marketing funnel stage data."""
    stages: list[str]
    counts: list[int]
    conversion_rates: list[float]
    campaign_id: Optional[str] = None
    funnel_date: Optional[str] = None


class DropoffAnalysis(BaseModel):
    """Computed dropoff analysis between funnel stages."""
    from_stage: str
    to_stage: str
    lost_count: int
    dropoff_rate: float
    is_biggest_drop: bool


class FunnelResponse(BaseModel):
    """Full funnel response with computed fields."""
    stages: list[str]
    counts: list[int]
    conversion_rates: list[float]
    campaign_id: Optional[str] = None
    funnel_date: Optional[str] = None
    overall_conversion_rate: Optional[float] = None
    dropoff_analysis: list[DropoffAnalysis] = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# In-memory data store (placeholder — replace with DB in future waves)
# ---------------------------------------------------------------------------

# Default funnel data for demo/development. In production this will be
# sourced from a database tracking actual campaign events.
_DEFAULT_FUNNEL = {
    "stages": [
        "awareness",
        "engagement",
        "interest",
        "consideration",
        "conversion",
        "retention",
    ],
    "counts": [1200, 850, 420, 180, 65, 22],
    "campaign_id": "ODW001",
    "funnel_date": "2026-06-16",
}


def _compute_conversion_rates(counts: list[int]) -> list[float]:
    """Compute stage-to-stage conversion rates.

    Returns a list of length len(counts) - 1, where each element is the
    ratio of counts[i+1] / counts[i].
    """
    rates = []
    for i in range(len(counts) - 1):
        if counts[i] > 0:
            rates.append(round(counts[i + 1] / counts[i], 3))
        else:
            rates.append(0.0)
    return rates


def _compute_dropoff_analysis(
    stages: list[str],
    counts: list[int],
) -> list[DropoffAnalysis]:
    """Compute dropoff analysis between adjacent stages."""
    if len(stages) < 2 or len(counts) < 2:
        return []

    analyses = []
    max_drop = 0
    max_drop_idx = 0

    for i in range(len(stages) - 1):
        lost = counts[i] - counts[i + 1]
        rate = lost / counts[i] if counts[i] > 0 else 0.0
        analyses.append(DropoffAnalysis(
            from_stage=stages[i],
            to_stage=stages[i + 1],
            lost_count=lost,
            dropoff_rate=round(rate, 3),
            is_biggest_drop=False,
        ))
        if lost > max_drop:
            max_drop = lost
            max_drop_idx = i

    if analyses:
        analyses[max_drop_idx].is_biggest_drop = True

    return analyses


# ---------------------------------------------------------------------------
# GET /funnel
# ---------------------------------------------------------------------------

@router.get("/funnel")
def get_funnel(
    campaign_id: Optional[str] = Query(
        None,
        description="Filter by campaign ID (omit for default/latest)",
    ),
):
    """Return marketing funnel data.

    Returns stage names, counts, computed conversion rates, and optional
    campaign metadata. The frontend's funnel-viz.js renders this as a
    Sankey-style flow diagram.

    When no campaign_id is provided, returns the default demo data.
    In future waves, this will query the campaign tracking database.
    """
    # Placeholder: use default data. Replace with DB lookup.
    data = _DEFAULT_FUNNEL.copy()
    if campaign_id:
        data["campaign_id"] = campaign_id

    stages = data["stages"]
    counts = data["counts"]

    # Validate input
    if len(stages) != len(counts):
        raise HTTPException(
            status_code=500,
            detail="stages and counts length mismatch",
        )

    conversion_rates = _compute_conversion_rates(counts)

    # Overall conversion rate (first stage → last stage)
    overall_rate = None
    if counts and counts[0] > 0:
        overall_rate = round(counts[-1] / counts[0], 3)

    # Dropoff analysis
    dropoff = _compute_dropoff_analysis(stages, counts)

    return FunnelResponse(
        stages=stages,
        counts=counts,
        conversion_rates=conversion_rates,
        campaign_id=data.get("campaign_id"),
        funnel_date=data.get("funnel_date"),
        overall_conversion_rate=overall_rate,
        dropoff_analysis=dropoff,
    )


# ---------------------------------------------------------------------------
# GET /campaigns (placeholder for future wave)
# ---------------------------------------------------------------------------

@router.get("/campaigns")
def list_campaigns():
    """List all campaigns with summary metrics.

    Placeholder endpoint — will be implemented in a future wave.
    """
    return {
        "campaigns": [
            {
                "id": "ODW001",
                "name": "OpenTalk2HTML Launch",
                "status": "active",
                "funnel_entries": 1200,
                "conversions": 65,
                "created_at": "2026-06-01T00:00:00Z",
            }
        ],
        "count": 1,
    }


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@router.get("/health")
def health():
    """Plugin health check."""
    return {"status": "ok", "plugin": "roi-dashboard", "ts": int(time.time())}
