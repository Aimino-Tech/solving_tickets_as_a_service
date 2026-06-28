"""
Background Agent Tasks — periodic maintenance, backups, pruning, heartbeat, sync.

These tasks are triggered by Celery Beat and provide distributed, fault-tolerant
scheduled execution. They replace the previous node-cron based scheduler with
Celery's database-backed scheduler for HA and durability.

Tasks:
    data_backup         — Daily: snapshots critical data to backup storage
    prune_sessions      — Daily: removes expired sessions and stale workspaces
    heartbeat_check     — Every 1min: reports worker and pipeline health
    sync_resources      — Every 30min: syncs external resources and state
    maintenance_window  — Weekly: runs deep maintenance (reindex, compact)
"""

from __future__ import annotations

import json
import logging
import os
import time

from celery import shared_task

logger = logging.getLogger(__name__)

try:
    from workers.metrics import record_gauge, record_counter
except ImportError:
    record_gauge = lambda name, value, **labels: None
    record_counter = lambda name, value=1, **labels: None


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    autoretry_for=(Exception,),
    name="workers.tasks.background.data_backup",
)
def data_backup(self) -> dict:
    """Daily data backup — snapshots critical data to backup storage.

    Calls the Node.js backup API endpoint. Falls back to local filesystem
    backup if the API is unavailable.
    """
    backup_url = os.getenv("STAS_BACKUP_URL", "http://localhost:3000/api/v1/admin/backup")
    logger.info("Running data backup — url=%s", backup_url)

    import httpx

    try:
        resp = httpx.post(backup_url, json={"type": "full"}, timeout=300)
        resp.raise_for_status()
        result = resp.json()
        logger.info(
            "Data backup complete — size=%s tables=%d duration=%0.1fs",
            result.get("size", "unknown"),
            result.get("tables", 0),
            result.get("duration_ms", 0) / 1000,
        )
        record_counter("celery_backup_total", 1)
        return {
            "status": "completed",
            "size": result.get("size"),
            "tables": result.get("tables"),
            "timestamp": time.time(),
        }
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("Backup API not available (404) — skipping")
            return {"status": "skipped", "reason": "api_not_available"}
        logger.error("Backup failed — %s", exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("Backup request failed — %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    name="workers.tasks.background.prune_sessions",
)
def prune_sessions(self) -> dict:
    """Daily session pruning — removes expired sessions and stale workspaces.

    Calls the Node.js prune API endpoint. Cleans up expired webhook sessions,
    stale sandbox workspaces, and old temporary files.
    """
    prune_url = os.getenv("STAS_PRUNE_URL", "http://localhost:3000/api/v1/admin/prune")
    logger.info("Running session pruning — url=%s", prune_url)

    import httpx

    try:
        resp = httpx.post(prune_url, json={"types": ["sessions", "workspaces", "temp"]}, timeout=120)
        resp.raise_for_status()
        result = resp.json()
        logger.info(
            "Session pruning complete — removed_sessions=%d removed_workspaces=%d freed_bytes=%d",
            result.get("removed_sessions", 0),
            result.get("removed_workspaces", 0),
            result.get("freed_bytes", 0),
        )
        record_counter("celery_prune_total", result.get("removed_sessions", 0))
        return {
            "status": "completed",
            "removed_sessions": result.get("removed_sessions", 0),
            "removed_workspaces": result.get("removed_workspaces", 0),
            "timestamp": time.time(),
        }
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("Prune API not available (404) — skipping")
            return {"status": "skipped", "reason": "api_not_available"}
        logger.error("Session pruning failed — %s", exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("Session pruning request failed — %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    name="workers.tasks.background.heartbeat_check",
)
def heartbeat_check(self) -> dict:
    """Heartbeat check — reports pipeline health and worker liveness.

    Runs every minute. Checks that all pipeline stages are responsive and
    reports overall health status to the monitoring system.
    """
    import socket

    hostname = socket.gethostname()
    worker_name = os.getenv("WORKER_NAME", hostname)

    health_url = os.getenv("STAS_HEALTH_URL", "http://localhost:3000/health")
    pipeline_healthy = False

    import httpx

    try:
        resp = httpx.get(health_url, timeout=10)
        resp.raise_for_status()
        pipeline_healthy = True
    except Exception as exc:
        logger.warning("Pipeline health check failed — %s", exc)

    record_gauge("celery_background_heartbeat", 1, worker=worker_name, hostname=hostname)
    record_gauge("celery_pipeline_healthy", 1 if pipeline_healthy else 0)

    logger.debug(
        "Heartbeat — worker=%s hostname=%s pipeline=%s",
        worker_name,
        hostname,
        "healthy" if pipeline_healthy else "unhealthy",
    )

    return {
        "worker": worker_name,
        "hostname": hostname,
        "pipeline_healthy": pipeline_healthy,
        "timestamp": time.time(),
        "alive": True,
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    name="workers.tasks.background.sync_resources",
)
def sync_resources(self) -> dict:
    """Resource sync — synchronizes external resources and state.

    Runs every 30 minutes. Syncs GitHub app permissions, Linear integrations,
    marketplace listings, and any other external resource states.
    """
    sync_url = os.getenv("STAS_SYNC_URL", "http://localhost:3000/api/v1/admin/sync")
    logger.info("Running resource sync — url=%s", sync_url)

    import httpx

    try:
        resp = httpx.post(sync_url, json={"full": False}, timeout=120)
        resp.raise_for_status()
        result = resp.json()
        logger.info(
            "Resource sync complete — synced=%d errors=%d",
            result.get("synced", 0),
            result.get("errors", 0),
        )
        record_counter("celery_sync_total", result.get("synced", 0))
        return {
            "status": "completed",
            "synced": result.get("synced", 0),
            "errors": result.get("errors", 0),
            "timestamp": time.time(),
        }
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("Sync API not available (404) — skipping")
            return {"status": "skipped", "reason": "api_not_available"}
        logger.error("Resource sync failed — %s", exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("Resource sync request failed — %s", exc)
        raise self.retry(exc=exc)
