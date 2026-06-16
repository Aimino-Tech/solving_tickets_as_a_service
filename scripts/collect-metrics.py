"""Periodic metrics collection script for Hermes Agent monitoring.

Reads gateway status, agent memory, cron jobs, and disk usage,
then records all values into the MetricsStore.

Output: {"metrics_recorded": N, "errors": [], "wakeAgent": false}

Usage:
    python scripts/collect-metrics.py
"""
import json
import os
import re
import shutil
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from gateway.status import read_runtime_status
from cron.jobs import load_jobs
from hermes_constants import get_hermes_home
from plugins.monitoring.monitor_store import MetricsStore


def collect_gateway_metrics() -> list[dict]:
    points = []
    try:
        status = read_runtime_status()
        if status is None:
            points.append({"name": "gateway.state", "value": 0, "tags": {"state": "offline"}})
            points.append({"name": "gateway.active_agents", "value": 0})
            return points

        state_str = status.get("gateway_state", "unknown")
        state_map = {"starting": 0, "running": 1, "stopped": 2, "startup_failed": 3}
        state_val = state_map.get(state_str, -1)
        points.append({"name": "gateway.state", "value": state_val, "tags": {"state": state_str}})

        platforms = status.get("platforms", {})
        points.append({"name": "gateway.platforms_total", "value": len(platforms)})
        errors = sum(1 for p in platforms.values() if p.get("state") != "connected")
        points.append({"name": "gateway.platforms_error", "value": errors})

        active_agents = 0
        try:
            active_agents = int(status.get("active_agents", 0))
        except (ValueError, TypeError):
            pass
        points.append({"name": "gateway.active_agents", "value": active_agents})
    except Exception:
        points.append({"name": "gateway.state", "value": 0, "tags": {"state": "error"}})
    return points


def collect_memory_metrics() -> list[dict]:
    points = []
    try:
        log_path = get_hermes_home() / "logs" / "agent.log"
        if not log_path.exists():
            return points

        rss_mb = None
        threads = None
        for line in reversed(log_path.read_text(encoding="utf-8", errors="replace").splitlines()):
            if "[MEMORY]" not in line:
                continue
            m = re.search(r"rss=([\d.]+)", line)
            if m and rss_mb is None:
                rss_mb = float(m.group(1))
            t = re.search(r"threads=(\d+)", line)
            if t and threads is None:
                threads = int(t.group(1))
            if rss_mb is not None and threads is not None:
                break

        if rss_mb is not None:
            points.append({"name": "memory.rss_mb", "value": rss_mb})
        if threads is not None:
            points.append({"name": "memory.threads", "value": threads})

        try:
            import psutil
            proc = psutil.Process()
            mem = proc.memory_info()
            points.append({"name": "memory.rss_bytes", "value": mem.rss})
            points.append({"name": "memory.vms_bytes", "value": mem.vms})
            points.append({"name": "memory.cpu_percent", "value": proc.cpu_percent(interval=0.1)})
        except ImportError:
            pass
    except Exception:
        pass
    return points


def collect_cron_metrics() -> list[dict]:
    points = []
    try:
        jobs = load_jobs()
        enabled = sum(1 for j in jobs if j.get("enabled", True))
        error = sum(1 for j in jobs if j.get("error_count", 0) > 0)
        points.append({"name": "cron.jobs_total", "value": len(jobs)})
        points.append({"name": "cron.jobs_enabled", "value": enabled})
        points.append({"name": "cron.jobs_error", "value": error})

        last_run = None
        for j in jobs:
            lr = j.get("last_run_at")
            if lr and (last_run is None or lr > last_run):
                last_run = lr
        if last_run:
            points.append({"name": "cron.last_run_ago_seconds", "value": last_run})
    except Exception:
        pass
    return points


def collect_disk_metrics() -> list[dict]:
    points = []
    try:
        hermes_home = get_hermes_home()
        usage = shutil.disk_usage(hermes_home)
        points.append({"name": "disk.hermes_home_total_gb", "value": round(usage.total / (1024**3), 2)})
        points.append({"name": "disk.hermes_home_used_gb", "value": round(usage.used / (1024**3), 2)})
        points.append({"name": "disk.hermes_home_free_gb", "value": round(usage.free / (1024**3), 2)})
        points.append({"name": "disk.hermes_home_used_pct", "value": round(usage.used / usage.total * 100, 1)})
    except Exception:
        pass
    return points


def main() -> None:
    ts = datetime.now(timezone.utc).isoformat()
    store = MetricsStore()

    all_points = []
    all_points.extend(collect_gateway_metrics())
    all_points.extend(collect_memory_metrics())
    all_points.extend(collect_cron_metrics())
    all_points.extend(collect_disk_metrics())

    errors = []
    for p in all_points:
        p["recorded_at"] = ts

    try:
        store.record_batch(all_points)
        recorded = len(all_points)
    except Exception as exc:
        recorded = 0
        errors.append(str(exc))
        for p in all_points:
            try:
                store.record(p["name"], p["value"], recorded_at=ts, tags=p.get("tags"))
                recorded += 1
            except Exception:
                pass

    output = {"metrics_recorded": recorded, "errors": errors, "wakeAgent": False}
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
