---
name: monitoring
<<<<<<< HEAD
description: Query and interpret monitoring metrics and alerts.
version: "1.0.0"
author: "Hermes Agent"
platforms: [linux, macos]
metadata:
  hermes:
    tags: [monitoring, metrics, alerts, dashboard, observability]
    category: devops
    related_skills: []
    config: {}
=======
description: Query metrics and manage alerts from the monitoring store.
metadata:
  version: 1.0.0
  tags:
    - monitoring
    - metrics
    - alerts
  category: devops
>>>>>>> 2437ffe (auto: daily commit 2026-06-16 21:00:01)
---

# Monitoring Skill

<<<<<<< HEAD
Query and interpret monitoring metrics and alerts from the Hermes MetricsStore. Provides real-time visibility into gateway state, memory usage, cron jobs, disk usage, and alert configurations through conversational agent tools.

## When to Use

- User asks "what's the gateway health?"
- User asks "show me memory trends"
- User asks "are there any active alerts?"
- User asks "how many cron jobs are failing?"
- User asks "generate a status report"
- User asks "what metrics are being tracked?"

## Prerequisites

- MetricsStore must have data (collect-metrics.py should run periodically via cron)
- `monitoring` toolset must be enabled (`hermes tools` → enable monitoring)
- The tools `monitoring_query_metrics` and `monitoring_list_alerts` must be available

## Procedure

### Check gateway health

1. Call `monitoring_query_metrics` with `names=["gateway.state", "gateway.active_agents"]`, `aggregation="latest"`
2. Interpret the state value: 0=starting, 1=running, 2=stopped, 3=failed
3. Report the gateway status and active agent count

### Review memory trends

1. Call `monitoring_query_metrics` with `names=["memory.rss_mb"]`, `since_minutes=1440`, `aggregation="avg"`
2. Call `monitoring_query_metrics` with `names=["memory.rss_mb"]`, `aggregation="latest"`
3. Compare average vs latest to spot trends

### List active alerts

1. Call `monitoring_list_alerts`
2. Filter to enabled alerts and report which are firing
3. Note the last fired time for each alert

### Generate status report

1. Call `monitoring_query_metrics` with `aggregation="latest"` (all metrics)
2. Call `monitoring_list_alerts`
3. Format as a structured report with sections for gateway, memory, cron, disk, and alerts

## Quick Reference

| Tool | Purpose |
|------|---------|
| `monitoring_query_metrics` | Query values by name, time range, aggregation |
| `monitoring_list_alerts` | List all alert configurations |

## Pitfalls

- Gateway state values are numeric (0=starting, 1=running, 2=stopped, 3=failed). Map them to human-readable strings
- If no metrics exist yet, `monitoring_query_metrics` returns an empty `metrics` object
- Disk usage metrics require `shutil.disk_usage` which may not work in all environments
- Alerts with a cooldown period (5 min default) will not re-fire until the cooldown expires

## Verification

```bash
# Tools are registered
python -c "from plugins.monitoring import register; print('tools registered')"

# Skill loads
hermes skills list | grep monitoring && echo "SKILL LOADED"
```
=======
Query metrics, review trends, and manage threshold-based alerts from the Hermes monitoring store. The store collects numeric metric points with timestamps and tag metadata, and supports configurable alert rules that fire when a metric crosses a threshold.

## When to Use

- Check agent health metrics (active sessions, tool call rates, error counts)
- Review memory usage or gateway throughput trends
- List configured alert rules and their last-fired timestamps
- Get a summary of all recently recorded metric values

## How to Use

- `monitoring_query_metrics` — Query one or more metric names. Returns latest values or aggregations (avg, min, max, sum, count) over a look-back window. Omit `names` to get a full summary of all metrics.
- `monitoring_list_alerts` — List all alert configurations or only enabled ones. Each alert shows the metric it watches, the threshold condition, and when it last fired.

## Workflows

### Check gateway health

```
monitoring_query_metrics(
    names=["gateway.active_sessions", "gateway.tool_calls_per_min"],
    since_minutes=30,
)
```

### Review memory trends

```
monitoring_query_metrics(
    names=["memory.turn_count", "memory.recall_latency_ms"],
    since_minutes=1440,
    aggregation="avg",
)
```

### List active alerts

```
monitoring_list_alerts(enabled_only=True)
```

### Query recent metrics

```
monitoring_query_metrics(
    names=[],
    since_minutes=60,
)
```

## Pitfalls

- Metrics are only as recent as the last collection — if no data was recorded in the requested window, queries return empty results.
- Aggregations over a large time window with `count` may be misleading if the metric collection interval is irregular.
- The monitoring store uses its own SQLite database inside the HERMES_HOME directory, separate from the session store.

## Verification

Call `monitoring_query_metrics` with no arguments to confirm the store returns a summary dict with `metrics` and `alert_configs` keys. If the store is empty, call `monitoring_list_alerts` to verify the alerts table is accessible.
>>>>>>> 2437ffe (auto: daily commit 2026-06-16 21:00:01)
