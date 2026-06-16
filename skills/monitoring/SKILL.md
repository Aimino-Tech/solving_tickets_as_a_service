---
name: monitoring
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
---

# Monitoring Skill

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
