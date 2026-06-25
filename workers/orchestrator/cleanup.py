"""
Dead Worker Cleanup — revokes all tasks assigned to dead workers.

Uses Celery's ``app.control.inspect()`` to list active and reserved tasks
per worker, then calls ``app.control.revoke()`` for all task IDs associated
with a given dead worker.

Design
------
    1. ``inspect_active()`` checks the worker's active tasks.
    2. ``inspect_reserved()`` checks the worker's reserved (queued) tasks.
    3. ``revoke_dead_worker_tasks(hostname)`` aggregates both and revokes them.
    4. Revocation is done with ``terminate=True`` to force-kill running tasks.

Configuration (env vars)
------------------------
    ``CLEANUP_TERMINATE_TASKS`` (default: ``true``) — whether to send SIGTERM
        to running tasks when revoking.
    ``CLEANUP_REVOKE_RESERVED`` (default: ``true``) — whether to revoke
        reserved (not-yet-started) tasks as well.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

from celery import current_app

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TERMINATE = os.getenv("CLEANUP_TERMINATE_TASKS", "true").lower() == "true"
_REVOKE_RESERVED = os.getenv("CLEANUP_REVOKE_RESERVED", "true").lower() == "true"


def get_worker_active_tasks(worker_hostname: str) -> list[dict[str, Any]]:
    """Get all active (currently running) tasks for a specific worker.

    Args:
        worker_hostname: The Celery worker hostname (e.g. ``worker1@hostname``).

    Returns:
        A list of task info dicts, each with keys like ``id``, ``name``,
        ``args``, ``kwargs``, ``time_start``, etc.
    """
    try:
        i = current_app.control.inspect([worker_hostname])
        active = i.active() or {}
        return active.get(worker_hostname, [])
    except Exception as exc:
        logger.error(
            "Failed to inspect active tasks for worker %s - %s",
            worker_hostname, exc,
        )
        return []


def get_worker_reserved_tasks(worker_hostname: str) -> list[dict[str, Any]]:
    """Get all reserved (queued but not started) tasks for a specific worker.

    Args:
        worker_hostname: The Celery worker hostname.

    Returns:
        A list of task info dicts.
    """
    if not _REVOKE_RESERVED:
        return []
    try:
        i = current_app.control.inspect([worker_hostname])
        reserved = i.reserved() or {}
        return reserved.get(worker_hostname, [])
    except Exception as exc:
        logger.error(
            "Failed to inspect reserved tasks for worker %s - %s",
            worker_hostname, exc,
        )
        return []


def revoke_dead_worker_tasks(worker_hostname: str) -> int:
    """Revoke all tasks (active + reserved) associated with a dead worker.

    Args:
        worker_hostname: The dead worker's hostname.

    Returns:
        The number of tasks revoked.
    """
    active_tasks = get_worker_active_tasks(worker_hostname)
    reserved_tasks = get_worker_reserved_tasks(worker_hostname)
    all_tasks = active_tasks + reserved_tasks

    if not all_tasks:
        logger.info(
            json.dumps({
                "event": "cleanup.no_tasks_to_revoke",
                "worker": worker_hostname,
            })
        )
        return 0

    task_ids: list[str] = []
    task_names: list[str] = []
    for task in all_tasks:
        tid = task.get("id")
        if tid:
            task_ids.append(tid)
            task_names.append(task.get("name", "unknown"))

    try:
        current_app.control.revoke(task_ids, terminate=_TERMINATE, signal="SIGTERM")
        logger.warning(
            json.dumps({
                "event": "cleanup.tasks_revoked",
                "worker": worker_hostname,
                "count": len(task_ids),
                "task_ids": task_ids,
                "task_names": task_names,
                "terminate": _TERMINATE,
            })
        )
    except Exception as exc:
        logger.error(
            "Failed to revoke %d tasks for worker %s - %s",
            len(task_ids), worker_hostname, exc,
        )
        return 0

    # Update metrics
    try:
        from workers.metrics import record_counter
        record_counter("celery_cleanup_revoked_total", len(task_ids), worker=worker_hostname)
    except ImportError:
        pass

    return len(task_ids)


def cleanup_all_dead_workers() -> dict[str, int]:
    """Find all dead workers and revoke their tasks.

    Uses the heartbeat module to identify dead workers, then revokes
    tasks for each one.

    Returns:
        A dict mapping worker hostname -> number of tasks revoked.
    """
    from workers.orchestrator.heartbeat import get_dead_workers

    dead_workers = get_dead_workers()
    results: dict[str, int] = {}

    for worker in dead_workers:
        count = revoke_dead_worker_tasks(worker)
        results[worker] = count

    if results:
        logger.info(
            json.dumps({
                "event": "cleanup.all_dead_workers",
                "results": results,
                "total": sum(results.values()),
            })
        )

    return results
