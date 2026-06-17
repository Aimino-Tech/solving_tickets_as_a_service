"""Marketing alert rules for the monitoring system.

These rules define threshold-based alerts that detect campaign health issues
(engagement decline, zero activity, sync failures, funnel dropoff) using the
existing MetricsStore + AlertEngine infrastructure.

Usage:
    from plugins.monitoring.monitor_store import MetricsStore
    from plugins.monitoring.alert_rules import register_marketing_alerts

    store = MetricsStore()
    count = register_marketing_alerts(store)
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Marketing alert rule definitions
# ---------------------------------------------------------------------------

MARKETING_ALERT_RULES: list[dict[str, Any]] = [
    {
        "name": "engagement_decline",
        "metric_name": "marketing.engagement_rate",
        "condition": "<",
        "threshold": 0.3,  # engagement rate < 30%
        "duration_seconds": 86400,  # sustained over 24h
        "delivery": "telegram",
        "enabled": True,
        "description": "Campaign engagement rate dropped below 30% threshold",
        "severity": "P2",
    },
    {
        "name": "zero_activity_48h",
        "metric_name": "marketing.actions_48h",
        "condition": "==",
        "threshold": 0,
        "duration_seconds": 0,  # immediate check
        "delivery": "telegram",
        "enabled": True,
        "description": "No marketing actions logged in 48 hours",
        "severity": "P1",
    },
    {
        "name": "sheet_sync_failure",
        "metric_name": "marketing.sheet_sync_status",
        "condition": "==",
        "threshold": 0,
        "duration_seconds": 0,
        "delivery": "telegram",
        "enabled": True,
        "description": "Google Sheet sync failed on last attempt",
        "severity": "P1",
    },
    {
        "name": "funnel_dropoff",
        "metric_name": "marketing.funnel_dropoff",
        "condition": ">",
        "threshold": 0.4,  # > 40% drop
        "duration_seconds": 86400,
        "delivery": "telegram",
        "enabled": False,  # disabled by default, opt-in
        "description": "Sustained >40% funnel dropoff detected",
        "severity": "P2",
    },
]


def register_marketing_alerts(store: Any) -> int:
    """Register marketing alert rules into MetricsStore.

    Checks for existing alerts by name before creating duplicates.
    Handles rules that are disabled by default by creating them and then
    disabling via ``update_alert()``.

    Args:
        store: A ``MetricsStore`` instance.

    Returns:
        Number of alert rules registered (excludes pre-existing rules).
    """
    count = 0
    existing_configs = store.get_alert_configs(enabled_only=False)
    existing_names = {a.get("name") for a in existing_configs}

    for rule in MARKETING_ALERT_RULES:
        if rule["name"] in existing_names:
            continue

        # ``create_alert()`` doesn't accept ``enabled``, ``description``, or
        # ``severity`` — filter those out.
        create_kwargs = {
            k: v
            for k, v in rule.items()
            if k not in ("description", "severity", "enabled")
        }
        store.create_alert(**create_kwargs)

        # If the rule is disabled by default, update after creation.
        if not rule.get("enabled", True):
            store.update_alert(rule["name"], enabled=0)

        count += 1

    return count
