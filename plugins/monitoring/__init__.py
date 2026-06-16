"""Monitoring plugin — agent tools + alert engine for conversational metric queries."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_TOOLSET = "monitoring"


def _get_store():
    from .monitor_store import MetricsStore
    return MetricsStore()


def _handle_query_metrics(args: dict, **kw) -> str:
    names = args.get("names")
    since_minutes = args.get("since_minutes", 60)
    aggregation = args.get("aggregation", "latest")
    store = _get_store()
    since = datetime.now(timezone.utc).timestamp() - since_minutes * 60
    since_iso = datetime.fromtimestamp(since, tz=timezone.utc).isoformat()

    if names:
        result = {}
        for n in names:
            if aggregation == "latest":
                v = store.query_latest(n)
                result[n] = v
            else:
                v = store.query_aggregate(n, since_iso, agg=aggregation)
                result[n] = v
    else:
        all_names = store.list_metric_names()
        result = {}
        for n in all_names:
            if aggregation == "latest":
                v = store.query_latest(n)
                result[n] = v
            else:
                v = store.query_aggregate(n, since_iso, agg=aggregation)
                result[n] = v
    return json.dumps({"metrics": result, "count": len(result), "aggregation": aggregation})


def _handle_list_alerts(args: dict, **kw) -> str:
    store = _get_store()
    configs = store.get_alert_configs()
    return json.dumps({"alerts": configs, "count": len(configs)})


_QUERY_METRICS_SCHEMA = {
    "name": "monitoring_query_metrics",
    "description": "Query monitoring metrics from the metrics store by name, time range, and aggregation",
    "parameters": {
        "type": "object",
        "properties": {
            "names": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Metric names to query (omit for all)",
            },
            "since_minutes": {
                "type": "integer",
                "description": "Look-back window in minutes (default 60)",
            },
            "aggregation": {
                "type": "string",
                "enum": ["avg", "min", "max", "sum", "count", "latest"],
                "description": "Aggregation function",
            },
        },
    },
}

_LIST_ALERTS_SCHEMA = {
    "name": "monitoring_list_alerts",
    "description": "List configured alert rules and their firing status",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}


def register(ctx) -> None:
    ctx.register_tool(
        name="monitoring_query_metrics",
        toolset=_TOOLSET,
        schema=_QUERY_METRICS_SCHEMA,
        handler=_handle_query_metrics,
        emoji="\U0001f4ca",
    )
    ctx.register_tool(
        name="monitoring_list_alerts",
        toolset=_TOOLSET,
        schema=_LIST_ALERTS_SCHEMA,
        handler=_handle_list_alerts,
        emoji="\U0001f514",
    )
    ctx.register_command(
        "monitoring",
        handler=_handle_monitoring_slash,
        description="Query monitoring metrics and alerts",
    )


def _handle_monitoring_slash(raw_args: str) -> str:
    argv = raw_args.strip().split()
    if not argv or argv[0] in {"help", "-h", "--help"}:
        return _HELP_TEXT
    sub = argv[0]
    if sub == "status":
        try:
            store = _get_store()
            names = store.list_metric_names()
            latest = {}
            for n in names:
                v = store.query_latest(n)
                if v:
                    latest[n] = v
            return json.dumps({
                "metrics_count": len(names),
                "latest": {k: v["value"] for k, v in latest.items()},
            }, indent=2)
        except Exception as exc:
            return f"Error: {exc}"
    if sub == "metrics":
        try:
            store = _get_store()
            names = store.list_metric_names()
            return "\n".join(f"  {n}" for n in names) if names else "No metrics recorded yet."
        except Exception as exc:
            return f"Error: {exc}"
    return f"Unknown subcommand: {sub}\n\n{_HELP_TEXT}"


_HELP_TEXT = """\
/monitoring — Monitoring dashboard and metrics

Subcommands:
  status         Show monitoring system status + latest values
  metrics        List all tracked metric names
  help           Show this help

Agent tools:
  monitoring_query_metrics   Query metric values by name, time range, aggregation
  monitoring_list_alerts     List configured alert rules
"""
