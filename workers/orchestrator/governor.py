"""
Background Agent Governor — enforces resource limits for scheduled tasks.

Uses Redis to track running tasks and enforce:
    - max_concurrent: maximum parallel executions across all task types
    - rate_per_minute: maximum executions per task type per minute
    - timeout: automatic release of stuck task slots

The Governor replaces the previous in-memory Map-based tracking with
distributed Redis-backed state, enabling accurate limits across multiple
worker instances.

Configuration (env vars):
    GOV_MAX_CONCURRENT  (default: 5) — max concurrent background tasks
    GOV_RATE_PER_MINUTE (default: 10) — max executions per task/minute
    GOV_SLOT_TTL_S      (default: 600) — slot staleness timeout in seconds

Redis Keys:
    stas:governor:active          — SET of active task run IDs
    stas:governor:rate:{task}     — Sorted Set of timestamps for rate limiting
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

_MAX_CONCURRENT = int(os.getenv("GOV_MAX_CONCURRENT", "5"))
_RATE_PER_MINUTE = int(os.getenv("GOV_RATE_PER_MINUTE", "10"))
_SLOT_TTL_S = int(os.getenv("GOV_SLOT_TTL_S", "600"))
_ACTIVE_KEY = "stas:governor:active"
_RATE_PREFIX = "stas:governor:rate:"
_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
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
        logger.warning("Governor Redis unavailable — %s", exc)
        _REDIS_CLIENT = None
        return None


class Governor:
    """Distributed resource governor for background tasks.

    Tracks active tasks and enforces concurrency and rate limits
    using Redis. Degrades gracefully (allows execution) if Redis
    is unavailable.
    """

    def __init__(
        self,
        max_concurrent: int = _MAX_CONCURRENT,
        rate_per_minute: int = _RATE_PER_MINUTE,
    ) -> None:
        self.max_concurrent = max_concurrent
        self.rate_per_minute = rate_per_minute

    def acquire(self, task_name: str, run_id: str) -> bool:
        """Try to acquire execution permission. Returns True if allowed."""
        client = _get_redis()
        if not client:
            return True

        try:
            self._prune_stale(client)
            current = client.scard(_ACTIVE_KEY) or 0
            if current >= self.max_concurrent:
                logger.info(
                    json.dumps({
                        "event": "governor.concurrent.denied",
                        "task": task_name,
                        "run_id": run_id,
                        "active": current,
                        "max": self.max_concurrent,
                    })
                )
                return False

            member = f"{task_name}:{run_id}"
            if client.sadd(_ACTIVE_KEY, member):
                meta_key = f"{_ACTIVE_KEY}:meta:{member}"
                client.hset(meta_key, mapping={
                    "task": task_name,
                    "run_id": run_id,
                    "acquired_at": str(time.time()),
                })
                client.expire(meta_key, _SLOT_TTL_S + 60)
                client.expire(_ACTIVE_KEY, _SLOT_TTL_S + 120)
                logger.debug(
                    json.dumps({
                        "event": "governor.acquired",
                        "task": task_name,
                        "run_id": run_id,
                        "active": client.scard(_ACTIVE_KEY),
                    })
                )
                return True
            return True
        except Exception as exc:
            logger.error("Governor acquire error — %s", exc)
            return True

    def release(self, task_name: str, run_id: str) -> None:
        """Release execution slot."""
        client = _get_redis()
        if not client:
            return
        try:
            member = f"{task_name}:{run_id}"
            client.srem(_ACTIVE_KEY, member)
            client.delete(f"{_ACTIVE_KEY}:meta:{member}")
        except Exception as exc:
            logger.error("Governor release error — %s", exc)

    def check_rate(self, task_name: str) -> bool:
        """Check if task is within rate limit. Returns True if allowed."""
        client = _get_redis()
        if not client:
            return True
        try:
            now = time.time()
            key = _RATE_PREFIX + task_name
            window_start = now - 60

            pipeline = client.pipeline()
            pipeline.zremrangebyscore(key, 0, window_start)
            pipeline.zcard(key)
            results = pipeline.exec()

            count = results[1] if results and len(results) > 1 else 0
            if isinstance(count, bytes):
                count = int(count)
            count = int(count) if count else 0

            if count >= self.rate_per_minute:
                logger.info(
                    json.dumps({
                        "event": "governor.rate.denied",
                        "task": task_name,
                        "current": count,
                        "max": self.rate_per_minute,
                    })
                )
                return False

            pipeline = client.pipeline()
            pipeline.zadd(key, {str(now): now})
            pipeline.expire(key, 120)
            pipeline.exec()
            return True
        except Exception as exc:
            logger.error("Governor rate check error — %s", exc)
            return True

    def active_count(self) -> int:
        client = _get_redis()
        if not client:
            return 0
        try:
            return client.scard(_ACTIVE_KEY) or 0
        except Exception:
            return 0

    def _prune_stale(self, client: Any) -> None:
        try:
            members = client.smembers(_ACTIVE_KEY) or set()
            now = time.time()
            for member in members:
                meta_key = f"{_ACTIVE_KEY}:meta:{member}"
                raw = client.hget(meta_key, "acquired_at")
                if raw:
                    try:
                        if now - float(raw) > _SLOT_TTL_S:
                            client.srem(_ACTIVE_KEY, member)
                            client.delete(meta_key)
                    except (ValueError, TypeError):
                        client.srem(_ACTIVE_KEY, member)
                        client.delete(meta_key)
        except Exception:
            pass


_governor: Optional[Governor] = None


def get_governor() -> Governor:
    global _governor
    if _governor is None:
        _governor = Governor()
    return _governor
