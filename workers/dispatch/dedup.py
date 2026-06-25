"""
Per-issue deduplication with Redis lock and TTL.

Prevents duplicate Celery task execution for the same issue across
worker instances. Uses Redis SET NX EX for atomic lock acquisition
with automatic expiry.

Key format: ``stas:dedup:{issue_id}``
Default TTL: 1 hour (configurable via ``DEDUP_LOCK_TTL`` env var).
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_LOCK_TTL = int(os.getenv("DEDUP_LOCK_TTL", "3600"))
_REDIS_KEY_TPL = "stas:dedup:{issue_id}"


class DedupManager:
    """Redis-based dedup lock manager.

    Each issue maps to a Redis key with NX+EX semantics.  Only the
    first worker to acquire the lock proceeds; subsequent attempts
    are recognized as duplicates and should be ignored.

    Thread-safe via Redis atomicity -- no local locking needed.
    """

    def __init__(self, redis_url: str | None = None) -> None:
        self._redis_url = redis_url or os.getenv(
            "REDIS_URL",
            os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
        )
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            import redis as _redis_mod

            self._client = _redis_mod.from_url(
                self._redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        return self._client

    def acquire(self, issue_id: str, ttl: int = DEFAULT_LOCK_TTL) -> bool:
        key = _REDIS_KEY_TPL.format(issue_id=issue_id)
        try:
            client = self._get_client()
            acquired = client.set(key, "1", nx=True, ex=ttl)
            if acquired:
                logger.debug("Acquired dedup lock issue=%s ttl=%d", issue_id, ttl)
            else:
                logger.debug("Dedup lock already held issue=%s", issue_id)
            return bool(acquired)
        except Exception as exc:
            logger.error("Dedup acquire failed issue=%s error=%s", issue_id, exc)
            return True

    def release(self, issue_id: str) -> None:
        key = _REDIS_KEY_TPL.format(issue_id=issue_id)
        try:
            self._get_client().delete(key)
            logger.debug("Released dedup lock issue=%s", issue_id)
        except Exception as exc:
            logger.warning("Dedup release failed issue=%s error=%s", issue_id, exc)

    def is_locked(self, issue_id: str) -> bool:
        key = _REDIS_KEY_TPL.format(issue_id=issue_id)
        try:
            return self._get_client().exists(key) > 0
        except Exception as exc:
            logger.error("Dedup is_locked failed issue=%s error=%s", issue_id, exc)
            return False

    def clear(self, issue_id: str) -> None:
        return self.release(issue_id)


_manager: DedupManager | None = None


def get_dedup_manager() -> DedupManager:
    global _manager
    if _manager is None:
        _manager = DedupManager()
    return _manager
