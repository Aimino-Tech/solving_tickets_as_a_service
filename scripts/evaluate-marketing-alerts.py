#!/usr/bin/env python3
"""Evaluate marketing alerts and feed metrics into MetricsStore.

Called by cron: every 1m
WakeAgent: true (generates NL alert when alerts fire)

Steps:
    1. Collect current marketing metrics from CampaignStore + ROIAnalyticsEngine
    2. Record them into MetricsStore
    3. Evaluate alert rules via AlertEngine
    4. Print JSON result (including wakeAgent flag for cron)
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Path resolution — find the project root so imports work from cron
# ---------------------------------------------------------------------------

_script = Path(__file__).resolve().parent
_candidates = [
    _script.parent,                               # scripts/.. = repo root
    Path.cwd(),                                     # wherever cron runs from
    Path.home() / ".hermes" / "src",                # editable install
]
for _p in _candidates:
    if (_p / "plugins" / "monitoring" / "monitor_store.py").exists():
        if str(_p) not in sys.path:
            sys.path.insert(0, str(_p))
        break


def collect_marketing_metrics() -> dict:
    """Collect current marketing metrics and write to MetricsStore.

    Iterates active campaigns, checks for recent actions, computes average
    engagement rate, and records 4 metrics:

    - ``marketing.engagement_rate`` — average engagement/awareness ratio
    - ``marketing.actions_24h`` — 1.0 if any actions in last 24h, else 0.0
    - ``marketing.actions_48h`` — 1.0 if any actions in last 48h, else 0.0
    - ``marketing.sheet_sync_status`` — 1.0 (script running implies health)

    Returns:
        Dict with ``metrics_recorded`` count.
    """
    from marketing.roi_arch import ROIAnalyticsEngine
    from marketing.store import CampaignStore
    from plugins.monitoring.monitor_store import MetricsStore

    store = CampaignStore()
    mstore = MetricsStore()
    engine = ROIAnalyticsEngine()

    campaigns = store.list_campaigns(status="active")
    now = datetime.now(timezone.utc)
    since_24h = (now - timedelta(hours=24)).isoformat()
    since_48h = (now - timedelta(hours=48)).isoformat()

    has_activity_24h = False
    has_activity_48h = False
    total_engagement_rate = 0.0
    campaign_count = 0

    for campaign in campaigns:
        actions_24h = store.get_actions(campaign["id"], since=since_24h)
        actions_48h = store.get_actions(campaign["id"], since=since_48h)

        if actions_24h:
            has_activity_24h = True
        if actions_48h:
            has_activity_48h = True

        # Engagement rate from analytics
        try:
            metrics = engine.compute_engagement_metrics(campaign["id"], store)
            if metrics and metrics["total_signals"] > 0:
                total_engagement_rate += metrics["engagement_rate"]
                campaign_count += 1
        except Exception:
            pass

    # Record metrics
    avg_engagement = total_engagement_rate / campaign_count if campaign_count > 0 else 0.0
    mstore.record(
        "marketing.engagement_rate",
        avg_engagement,
        tags={"type": "campaign_avg"},
    )
    mstore.record(
        "marketing.actions_24h",
        1.0 if has_activity_24h else 0.0,
        tags={"type": "has_activity"},
    )
    mstore.record(
        "marketing.actions_48h",
        1.0 if has_activity_48h else 0.0,
        tags={"type": "has_activity"},
    )
    mstore.record(
        "marketing.sheet_sync_status",
        1.0,
        tags={"type": "sync"},
    )

    return {"metrics_recorded": 4}


def evaluate_and_alert() -> list[dict]:
    """Evaluate marketing alerts and return the list of fired alerts.

    Returns:
        List of fired alert dicts (empty when no alerts fire).
    """
    from plugins.monitoring.alert_engine import AlertEngine
    from plugins.monitoring.monitor_store import MetricsStore

    mstore = MetricsStore()
    engine = AlertEngine(store=mstore)

    fired = engine.safe_evaluate()
    return fired


def main() -> None:
    collect_marketing_metrics()
    fired = evaluate_and_alert()

    result: dict = {
        "action": "evaluate-marketing-alerts",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "alerts_fired": len(fired),
    }

    if fired:
        result["alerts"] = [
            {
                "name": a["name"],
                "value": a.get("current_value"),
                "threshold": a.get("threshold"),
            }
            for a in fired
        ]
        # WakeAgent so the cron agent generates a NL alert message
        result["wakeAgent"] = True
    else:
        result["wakeAgent"] = False

    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
