"""
AgentConcurrencyLimiter --- limits the number of concurrently running agents.

Uses Redis to track active agent slots across workers.  Designed to prevent
overwhelming the OpenCode backend or the host machine.

Configuration:
    ``AGENT_MAX_CONCURRENT`` (env var, default 3) --- maximum concurrent agents.
    ``AGENT_CONCURRENCY_TIMEOUT_S`` (env var, default 600) --- max time a slot
    can be held before it's considered stale and eligible for reclamation.
"""

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_CONCURRENT = int(os.getenv("AGENT_MAX_CONCURRENT", "3"))
_SLOT_TIMEOUT_S = int(os.getenv("AGENT_CONCURRENCY_TIMEOUT_S", "600"))
_REDIS_KEY = "stas:agent:active_slots"
_REDIS_SLOT_PREFIX = "stas:agent:slot:"


# ---------------------------------------------------------------------------
# Redis client (lazy)
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    """Lazy-init Redis client."""
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
        logger.warning("AgentConcurrencyLimiter Redis unavailable --- %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# AgentConcurrencyLimiter
# ---------------------------------------------------------------------------

class AgentConcurrencyLimiter:
    """Limits the number of concurrently running agent processes.

    Uses a Redis SET to track active issue IDs.  When the set size reaches
    ``_MAX_CONCURRENT``, new agents are denied a slot until one is released.

    Usage::

        limiter = AgentConcurrencyLimiter()
        if limiter.acquire("issue-42"):
            try:
                # ... run agent ...
                pass
            finally:
                limiter.release("issue-42")
        else:
            logger.info("Concurrency limit reached, queuing")
    """

    def __init__(self, max_concurrent: int = _MAX_CONCURRENT) -> None:
        self.max_concurrent = max_concurrent

    # ------------------------------------------------------------------
    # Acquire
    # ------------------------------------------------------------------

    def acquire(self, issue_id: str) -> bool:
        """Try to acquire a concurrency slot for ``issue_id``.

        Returns:
            True if a slot was acquired (caller may proceed).
            False if the limit is reached (caller should queue/retry).
        """
        client = _get_redis()
        if not client:
            # Redis unavailable: allow (degrade gracefully in dev)
            logger.warning("Redis unavailable --- allowing agent slot (degraded)")
            return True

        try:
            # -- Prune stale slots ------------------------
            self._prune_stale_slots(client)

            # -- Check current count ----------------------
            current = client.scard(_REDIS_KEY)
            if current is not None and current >= self.max_concurrent:
                logger.info(
                    json.dumps({
                        "event": "concurrency.slot_denied",
                        "issue_id": issue_id,
                        "active_slots": current,
                        "max_concurrent": self.max_concurrent,
                    })
                )
                return False

            # -- Acquire slot -----------------------------
            member = _REDIS_SLOT_PREFIX + issue_id
            added = client.sadd(_REDIS_KEY, member)
            if added:
                # Store metadata for staleness checks
                slot_meta_key = f"{member}:meta"
                client.hset(slot_meta_key, mapping={
                    "issue_id": issue_id,
                    "acquired_at": str(time.time()),
                    "ttl": str(_SLOT_TIMEOUT_S),
                })
                client.expire(slot_meta_key, _SLOT_TIMEOUT_S + 60)

                current_after = client.scard(_REDIS_KEY)
                logger.info(
                    json.dumps({
                        "event": "concurrency.slot_acquired",
                        "issue_id": issue_id,
                        "active_slots": current_after,
                        "max_concurrent": self.max_concurrent,
                    })
                )
                return True

            # Already present (duplicate acquire)
            logger.warning(
                json.dumps({
                    "event": "concurrency.slot_already_held",
                    "issue_id": issue_id,
                })
            )
            return True

        except Exception as exc:
            logger.error(
                json.dumps({
                    "event": "concurrency.acquire_error",
                    "issue_id": issue_id,
                    "error": str(exc),
                })
            )
            # Degrade gracefully: allow
            return True

    # ------------------------------------------------------------------
    # Release
    # ------------------------------------------------------------------

    def release(self, issue_id: str) -> None:
        """Release the concurrency slot held by ``issue_id``."""
        client = _get_redis()
        if not client:
            return

        try:
            member = _REDIS_SLOT_PREFIX + issue_id
            removed = client.srem(_REDIS_KEY, member)
            if removed:
                # Clean up metadata
                slot_meta_key = f"{member}:meta"
                client.delete(slot_meta_key)

                current = client.scard(_REDIS_KEY)
                logger.info(
                    json.dumps({
                        "event": "concurrency.slot_released",
                        "issue_id": issue_id,
                        "active_slots_remaining": current,
                    })
                )
            else:
                logger.debug(
                    "concurrency.slot_not_held issue_id=%s", issue_id
                )
        except Exception as exc:
            logger.error(
                json.dumps({
                    "event": "concurrency.release_error",
                    "issue_id": issue_id,
                    "error": str(exc),
                })
            )

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def active_count(self) -> int:
        """Return the number of currently active agent slots."""
        client = _get_redis()
        if not client:
            return 0
        try:
            count = client.scard(_REDIS_KEY)
            return count if count is not None else 0
        except Exception:
            return 0

    def is_acquired(self, issue_id: str) -> bool:
        """Check if ``issue_id`` currently holds a slot."""
        client = _get_redis()
        if not client:
            return False
        try:
            member = _REDIS_SLOT_PREFIX + issue_id
            return bool(client.sismember(_REDIS_KEY, member))
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _prune_stale_slots(self, client: Any) -> None:
        """Remove slots that have exceeded the timeout.

        This prevents dead slots from permanently blocking the concurrency
        limit when a worker crashes without releasing its slot.
        """
        try:
            members = client.smembers(_REDIS_KEY)
            now = time.time()
            for member in members or set():
                slot_meta_key = f"{member}:meta"
                raw = client.hget(slot_meta_key, "acquired_at")
                if raw:
                    try:
                        acquired_at = float(raw)
                        if now - acquired_at > _SLOT_TIMEOUT_S:
                            client.srem(_REDIS_KEY, member)
                            client.delete(slot_meta_key)
                            logger.warning(
                                json.dumps({
                                    "event": "concurrency.slot_stale_pruned",
                                    "member": member,
                                    "age_s": round(now - acquired_at, 1),
                                })
                            )
                    except (ValueError, TypeError):
                        # Corrupt metadata --- remove
                        client.srem(_REDIS_KEY, member)
                        client.delete(slot_meta_key)
        except Exception as exc:
            logger.debug("Failed to prune stale slots --- %s", exc)


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
