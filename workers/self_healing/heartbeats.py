"""
Worker Heartbeat Monitoring — Celery event-based heartbeat tracking.

Sends periodic heartbeats to Redis that are consumed by the TypeScript
WorkerHeartbeatMonitor. Uses the Celery `worker-heartbeat` event and a
periodic task to ensure heartbeats are sent even during long-running tasks.

Configuration (via env vars):
    REDIS_URL — Redis connection string (default: redis://localhost:6379)
    HEARTBEAT_INTERVAL_SECONDS — How often to send heartbeats (default: 15)
    HEARTBEAT_TTL_SECONDS — Redis key TTL (default: 30)
    WORKER_NAME — Unique worker identifier (default: auto-generated)
"""

import json
import logging
import os
import platform
import socket

import redis
from celery import Celery, signals

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "15"))
HEARTBEAT_TTL = int(os.getenv("HEARTBEAT_TTL_SECONDS", "30"))
WORKER_NAME = os.getenv(
    "WORKER_NAME",
    f"{socket.gethostname()}:{os.getpid()}",
)

# ── Redis Connection ───────────────────────────────────────────────────────

_redis_client: "redis.Redis | None" = None


def _get_redis() -> "redis.Redis":
    """Get or create the Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
    return _redis_client


# ── Heartbeat Keys ─────────────────────────────────────────────────────────

HEARTBEAT_PREFIX = "stas:heartbeat:"


def _heartbeat_key() -> str:
    """Get the Redis key for this worker's heartbeat."""
    return f"{HEARTBEAT_PREFIX}{WORKER_NAME}"


def _worker_info_key() -> str:
    """Get the Redis key for this worker's info."""
    return f"{HEARTBEAT_PREFIX}{WORKER_NAME}:info"


# ── Heartbeat Functions ────────────────────────────────────────────────────


def send_heartbeat() -> None:
    """
    Send a heartbeat to Redis.
    Sets the heartbeat key with TTL and stores worker info.
    """
    try:
        r = _get_redis()
        now = int(__import__("time").time() * 1000)

        # Set heartbeat with TTL
        r.set(_heartbeat_key(), str(now), ex=HEARTBEAT_TTL)

        # Set worker info (no TTL — refreshed with heartbeat)
        r.set(
            _worker_info_key(),
            json.dumps({
                "worker_id": WORKER_NAME,
                "hostname": socket.gethostname(),
                "pid": os.getpid(),
                "platform": platform.platform(),
                "python_version": platform.python_version(),
                "started_at": now,
            }),
            ex=HEARTBEAT_TTL,
        )

        logger.debug("Heartbeat sent — worker=%s", WORKER_NAME)
    except Exception as exc:
        logger.warning("Failed to send heartbeat — %s", exc)


def remove_heartbeat() -> None:
    """Remove the heartbeat key (called on worker shutdown)."""
    try:
        r = _get_redis()
        r.delete(_heartbeat_key(), _worker_info_key())
        logger.info("Heartbeat removed — worker=%s", WORKER_NAME)
    except Exception as exc:
        logger.warning("Failed to remove heartbeat — %s", exc)


# ── Celery Signal Handlers ─────────────────────────────────────────────────


def setup_heartbeat_monitor(app: Celery) -> None:
    """
    Connect Celery signals to send heartbeats.
    Call this during Celery worker initialization.

    Args:
        app: The Celery application instance.
    """
    logger.info(
        "Setting up heartbeat monitor — worker=%s interval=%ds ttl=%ds",
        WORKER_NAME,
        HEARTBEAT_INTERVAL,
        HEARTBEAT_TTL,
    )

    @signals.worker_ready.connect
    def on_worker_ready(**kwargs) -> None:  # type: ignore[no-untyped-def]
        """Send initial heartbeat when worker starts."""
        send_heartbeat()
        logger.info(
            "Worker ready — heartbeat sent worker=%s",
            WORKER_NAME,
        )

    @signals.worker_shutdown.connect
    def on_worker_shutdown(**kwargs) -> None:  # type: ignore[no-untyped-def]
        """Clean up heartbeat on shutdown."""
        remove_heartbeat()
        logger.info("Worker shutdown — heartbeat removed")

    @signals.heartbeat_sent.connect
    def on_heartbeat_sent(**kwargs) -> None:  # type: ignore[no-untyped-def]
        """Respond to Celery's built-in heartbeat event."""
        send_heartbeat()

    @signals.task_prerun.connect
    def on_task_prerun(task_id: str, task: "Celery", **kwargs) -> None:  # type: ignore[no-untyped-def]
        """Send heartbeat before a task runs (for long-running tasks)."""
        send_heartbeat()

    @signals.task_postrun.connect
    def on_task_postrun(task_id: str, task: "Celery", **kwargs) -> None:  # type: ignore[no-untyped-def]
        """Send heartbeat after a task completes."""
        send_heartbeat()

    # Register a periodic task to send heartbeats
    # This is needed because Celery's built-in heartbeat is only for
    # connection liveness, not worker liveness.

    @app.task(name="workers.self_healing.heartbeats.periodic_heartbeat")
    def periodic_heartbeat() -> dict:
        """Periodic task to send worker heartbeat."""
        send_heartbeat()
        return {
            "worker": WORKER_NAME,
            "status": "alive",
            "timestamp": __import__("time").time(),
        }

    # Add to beat schedule if beat is configured
    try:
        from celery.schedules import crontab

        if hasattr(app.conf, "beat_schedule"):
            app.conf.beat_schedule["self-healing-heartbeat"] = {
                "task": "workers.self_healing.heartbeats.periodic_heartbeat",
                "schedule": HEARTBEAT_INTERVAL,
                "options": {"queue": "stas.issues.health"},
            }
            logger.debug("Heartbeat periodic task registered")
    except Exception as exc:
        logger.warning("Failed to register heartbeat periodic task — %s", exc)

    logger.info(
        "Heartbeat monitor initialized — worker=%s",
        WORKER_NAME,
    )
