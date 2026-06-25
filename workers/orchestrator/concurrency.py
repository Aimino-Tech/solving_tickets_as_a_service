"""
AgentConcurrencyLimiter — limits concurrent agent executions via Redis.

Uses a Redis SET to track active agent slots. Prevents overwhelming
the OpenCode backend when many issues are processed simultaneously.

Configuration:
    AGENT_MAX_CONCURRENT (env var, default 3) — max concurrent agents.
    AGENT_CONCURRENCY_TIMEOUT_S (env var, default 600) — slot staleness timeout.
"""

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

_MAX_CONCURRENT = int(os.getenv("AGENT_MAX_CONCURRENT", "3"))
_SLOT_TIMEOUT_S = int(os.getenv("AGENT_CONCURRENCY_TIMEOUT_S", "600"))
_REDIS_KEY = "stas:agent:active_slots"
_SLOT_PREFIX = "stas:agent:slot:"

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod
        url = os.getenv("REDIS_URL", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Concurrency limiter Redis unavailable — %s", exc)
        _REDIS_CLIENT = None
        return None


class AgentConcurrencyLimiter:
    """Limits concurrent agent executions.

    Uses a Redis SET to track active issue IDs. When the set reaches
    ``max_concurrent``, ``acquire()`` returns ``False``.

    Usage::

        limiter = AgentConcurrencyLimiter(max_concurrent=3)
        if limiter.acquire("issue-42"):
            try:
                ... run agent ...
            finally:
                limiter.release("issue-42")
    """

    def __init__(self, max_concurrent: int = _MAX_CONCURRENT) -> None:
        self.max_concurrent = max_concurrent

    def acquire(self, issue_id: str) -> bool:
        """Try to acquire a concurrency slot. Returns True if acquired."""
        client = _get_redis()
        if not client:
            return True  # degrade gracefully

        try:
            self._prune_stale(client)
            member = _SLOT_PREFIX + issue_id
            current = client.scard(_REDIS_KEY) or 0
            if current >= self.max_concurrent:
                logger.info(json.dumps({"event": "concurrency.denied", "issue_id": issue_id, "active": current, "max": self.max_concurrent}))
                return False

            if client.sadd(_REDIS_KEY, member):
                meta_key = f"{member}:meta"
                client.hset(meta_key, mapping={"issue_id": issue_id, "acquired_at": str(time.time())})
                client.expire(meta_key, _SLOT_TIMEOUT_S + 60)
                logger.info(json.dumps({"event": "concurrency.acquired", "issue_id": issue_id, "active": client.scard(_REDIS_KEY), "max": self.max_concurrent}))
                return True
            return True  # already held
        except Exception as exc:
            logger.error(json.dumps({"event": "concurrency.error", "error": str(exc)}))
            return True

    def release(self, issue_id: str) -> None:
        """Release the concurrency slot."""
        client = _get_redis()
        if not client:
            return
        try:
            member = _SLOT_PREFIX + issue_id
            client.srem(_REDIS_KEY, member)
            client.delete(f"{member}:meta")
        except Exception as exc:
            logger.error(json.dumps({"event": "concurrency.release_error", "error": str(exc)}))

    def active_count(self) -> int:
        client = _get_redis()
        if not client:
            return 0
        try:
            return client.scard(_REDIS_KEY) or 0
        except Exception:
            return 0

    def _prune_stale(self, client: Any) -> None:
        """Remove slots that have exceeded the timeout."""
        try:
            members = client.smembers(_REDIS_KEY) or set()
            now = time.time()
            for member in members:
                meta_key = f"{member}:meta"
                raw = client.hget(meta_key, "acquired_at")
                if raw:
                    try:
                        if now - float(raw) > _SLOT_TIMEOUT_S:
                            client.srem(_REDIS_KEY, member)
                            client.delete(meta_key)
                    except (ValueError, TypeError):
                        client.srem(_REDIS_KEY, member)
                        client.delete(meta_key)
        except Exception:
            pass

# ---------------------------------------------------------------------------
# Module-level convenience instance
# ---------------------------------------------------------------------------

_limiter: Optional[AgentConcurrencyLimiter] = None


def get_limiter() -> AgentConcurrencyLimiter:
    """Return a shared ``AgentConcurrencyLimiter`` singleton."""
    global _limiter
    if _limiter is None:
        _limiter = AgentConcurrencyLimiter()
    return _limiter
