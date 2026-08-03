"""
Worker Heartbeat Monitoring — checks Celery ``worker-heartbeat`` events.

If a worker's heartbeat is missing for >=60 seconds, it is marked **dead** and
the module triggers cleanup via :func:`~workers.orchestrator.cleanup.revoke_dead_worker_tasks`.

Architecture
------------
    - A background daemon thread subscribes to Celery monitor events via
      ``celery.events.state`` / ``celery.app.control.events()``.
    - Each worker's ``last_seen`` timestamp is stored in Redis (SET with TTL).
    - A periodic check (every 15s) scans workers that have not reported in 60s.
    - Dead workers are reported to the alerting system and their tasks are revoked.

Redis Keys
----------
    ``syntaro:heartbeat:{worker_hostname}`` — string value = ISO timestamp of last heartbeat.
    ``syntaro:heartbeat:dead_workers`` — SET of dead worker hostnames (for cleanup tracking).

Configuration (env vars)
------------------------
    ``WORKER_HEARTBEAT_TIMEOUT_S``  (default: 60) — seconds without heartbeat before dead.
    ``WORKER_HEARTBEAT_CHECK_INTERVAL_S`` (default: 15) — how often the checker runs.
"""

from __future__ import annotations

import json
import logging
import os
import calendar
import time
import threading
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_HEARTBEAT_TIMEOUT_S = int(os.getenv("WORKER_HEARTBEAT_TIMEOUT_S", "60"))
_CHECK_INTERVAL_S = int(os.getenv("WORKER_HEARTBEAT_CHECK_INTERVAL_S", "15"))
_REDIS_HB_PREFIX = "syntaro:heartbeat:"
_REDIS_DEAD_KEY = "syntaro:heartbeat:dead_workers"

# ---------------------------------------------------------------------------
# Redis client (lazy, shared)
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    """Lazy-init Redis client (reuses the same pattern as ``concurrency.py``)."""
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        url = os.getenv(
            "REDIS_URL",
            os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
        )
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Heartbeat monitor - Redis unavailable: %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Heartbeat recording (called from Celery event receiver)
# ---------------------------------------------------------------------------


def record_heartbeat(worker_hostname: str) -> None:
    """Record a worker heartbeat timestamp in Redis.

    Args:
        worker_hostname: The Celery worker's hostname (e.g. ``worker1@hostname``).
    """
    client = _get_redis()
    if not client:
        return

    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    key = _REDIS_HB_PREFIX + worker_hostname
    try:
        client.set(key, now_iso)
        client.expire(key, _HEARTBEAT_TIMEOUT_S + 30)  # buffer
    except Exception as exc:
        logger.debug("Failed to record heartbeat for %s - %s", worker_hostname, exc)


def get_last_heartbeat(worker_hostname: str) -> Optional[str]:
    """Get the last heartbeat timestamp for a worker.

    Returns:
        ISO-formatted timestamp string, or ``None`` if never recorded.
    """
    client = _get_redis()
    if not client:
        return None
    try:
        val = client.get(_REDIS_HB_PREFIX + worker_hostname)
        return val if val else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Dead worker detection
# ---------------------------------------------------------------------------


def _parse_heartbeat_ts(ts_str: Optional[str]) -> Optional[float]:
    """Parse an ISO timestamp string to a float (seconds since epoch).
    
    Uses calendar.timegm to interpret the timestamp as UTC, which is
    how all heartbeat timestamps are stored (UTC/GMT).
    """
    if not ts_str:
        return None
    try:
        if "." in ts_str:
            return calendar.timegm(time.strptime(ts_str.split(".")[0], "%Y-%m-%dT%H:%M:%S"))
        return calendar.timegm(time.strptime(ts_str, "%Y-%m-%dT%H:%M:%SZ"))
    except (ValueError, TypeError, OSError):
        return None


def find_dead_workers() -> list[dict[str, Any]]:
    """Scan all tracked workers and return those whose heartbeat is stale.

    Returns:
        A list of dicts with keys ``hostname``, ``last_seen``, ``seconds_since_heartbeat``.
    """
    client = _get_redis()
    if not client:
        return []

    dead: list[dict[str, Any]] = []
    now = time.time()

    try:
        cursor = 0
        while True:
            cursor, keys = client.scan(cursor, match=_REDIS_HB_PREFIX + "*")
            for key in keys:
                hostname = key[len(_REDIS_HB_PREFIX):]
                raw_ts = client.get(key)
                ts = _parse_heartbeat_ts(raw_ts)
                if ts is None:
                    continue
                elapsed = now - ts
                if elapsed > _HEARTBEAT_TIMEOUT_S:
                    dead.append({
                        "hostname": hostname,
                        "last_seen": raw_ts or "unknown",
                        "seconds_since_heartbeat": round(elapsed, 1),
                    })
            if cursor == 0:
                break
    except Exception as exc:
        logger.error("Failed to scan for dead workers - %s", exc)

    return dead


# ---------------------------------------------------------------------------
# Mark / unmark dead workers
# ---------------------------------------------------------------------------


def mark_worker_dead(worker_hostname: str) -> None:
    """Mark a worker as dead in Redis."""
    client = _get_redis()
    if not client:
        return

    try:
        client.sadd(_REDIS_DEAD_KEY, worker_hostname)
        client.expire(_REDIS_DEAD_KEY, 86400)  # 24h TTL for audit trail

        logger.warning(
            json.dumps({
                "event": "heartbeat.worker_dead",
                "worker": worker_hostname,
            })
        )
    except Exception as exc:
        logger.error("Failed to mark worker %s as dead - %s", worker_hostname, exc)


def unmark_worker_dead(worker_hostname: str) -> None:
    """Remove a worker from the dead set (e.g. it came back)."""
    client = _get_redis()
    if not client:
        return

    try:
        client.srem(_REDIS_DEAD_KEY, worker_hostname)
    except Exception as exc:
        logger.debug("Failed to unmark worker %s - %s", worker_hostname, exc)


def is_worker_dead(worker_hostname: str) -> bool:
    """Check if a worker has been marked as dead."""
    client = _get_redis()
    if not client:
        return False
    try:
        return bool(client.sismember(_REDIS_DEAD_KEY, worker_hostname))
    except Exception:
        return False


def get_dead_workers() -> list[str]:
    """Return the list of currently-dead worker hostnames."""
    client = _get_redis()
    if not client:
        return []
    try:
        return list(client.smembers(_REDIS_DEAD_KEY) or set())
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Heartbeat monitoring thread
# ---------------------------------------------------------------------------

_running = False
_thread: Optional[threading.Thread] = None


def _check_worker_heartbeats() -> None:
    """Periodic check: find dead workers -> revoke tasks -> alert."""
    from workers.orchestrator.cleanup import revoke_dead_worker_tasks
    from workers.metrics import record_gauge, record_counter

    dead = find_dead_workers()
    for worker_info in dead:
        hostname = worker_info["hostname"]
        if not is_worker_dead(hostname):
            mark_worker_dead(hostname)
            # Revoke all tasks assigned to this dead worker
            try:
                revoked = revoke_dead_worker_tasks(hostname)
                logger.warning(
                    json.dumps({
                        "event": "heartbeat.cleanup_executed",
                        "worker": hostname,
                        "tasks_revoked": revoked,
                    })
                )
                record_counter("celery_heartbeat_cleanup_total", revoked, worker=hostname)
            except Exception as exc:
                logger.error("Failed to revoke tasks for dead worker %s - %s", hostname, exc)

        record_gauge(
            "celery_worker_liveness",
            0,
            worker=hostname,
            hostname=hostname,
        )

    # Record gauge for total dead workers
    dead_count = len(dead)
    record_gauge("celery_dead_workers_total", dead_count)

    if dead_count > 0:
        logger.warning(
            json.dumps({
                "event": "heartbeat.dead_workers_found",
                "count": dead_count,
                "workers": [w["hostname"] for w in dead],
            })
        )


def _heartbeat_loop() -> None:
    """Run the periodic heartbeat checker."""
    global _running
    logger.info(
        "Heartbeat monitor started - timeout=%ds check_interval=%ds",
        _HEARTBEAT_TIMEOUT_S,
        _CHECK_INTERVAL_S,
    )
    while _running:
        try:
            _check_worker_heartbeats()
        except Exception as exc:
            logger.error("Heartbeat check failed - %s", exc)
        time.sleep(_CHECK_INTERVAL_S)


def start_heartbeat_monitor() -> None:
    """Start the background heartbeat monitoring thread.

    Idempotent - safe to call multiple times.
    """
    global _running, _thread
    if _running:
        return
    _running = True
    _thread = threading.Thread(target=_heartbeat_loop, daemon=True, name="heartbeat-monitor")
    _thread.start()
    logger.info("Heartbeat monitor thread started")


def stop_heartbeat_monitor() -> None:
    """Stop the background heartbeat monitoring thread."""
    global _running
    _running = False
    logger.info("Heartbeat monitor thread stopped")


# ---------------------------------------------------------------------------
# Celery event receiver for worker heartbeats
# ---------------------------------------------------------------------------


def on_worker_heartbeat(event: dict[str, Any]) -> None:
    """Celery event handler for ``worker-heartbeat`` events.

    Callback signature compatible with ``celery.events.EventReceiver``.
    The event dict includes keys like ``hostname``, ``timestamp``, ``pid``,
    ``active``, ``processed``, ``loadavg``, etc.
    """
    hostname = event.get("hostname", "")
    if not hostname:
        return
    record_heartbeat(hostname)

    # If a previously-dead worker heartbeats again, unmark it
    if is_worker_dead(hostname):
        unmark_worker_dead(hostname)
        logger.info(
            json.dumps({
                "event": "heartbeat.worker_recovered",
                "worker": hostname,
            })
        )


def on_worker_online(event: dict[str, Any]) -> None:
    """Celery event handler for ``worker-online`` events."""
    hostname = event.get("hostname", "")
    if hostname:
        record_heartbeat(hostname)
        unmark_worker_dead(hostname)
        logger.info("Worker online: %s", hostname)


def on_worker_offline(event: dict[str, Any]) -> None:
    """Celery event handler for ``worker-offline`` events."""
    hostname = event.get("hostname", "")
    if hostname:
        mark_worker_dead(hostname)
        from workers.orchestrator.cleanup import revoke_dead_worker_tasks
        try:
            revoke_dead_worker_tasks(hostname)
        except Exception:
            pass
        logger.warning("Worker offline: %s", hostname)
