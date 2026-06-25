"""
Runaway agent limits — timeout, turn, cost caps with Redis TTL locks.

This module provides the ``LimitManager`` class, which adds a lock-based
enforcement layer on top of the raw state tracking in ``guard.py``.

Design
------
Each check (timeout, turn, cost-cap) acquires a Redis-backed TTL lock to
prevent concurrent breach handling from racing — if two Celery workers
simultaneously detect a cost limit breach, only one executes the stop-and-
label action while the other observes the lock and returns cleanly.

Locks expire after their configured TTL (from ``config.py``), so a crashed
worker won't permanently block future enforcement.

Key schema (Redis)::

    stas:lock:timeout:<task_id>    → epoch-seconds of lock acquisition
    stas:lock:turn:<session_id>    → integer turn counter (set on lock)
    stas:lock:costcap:<task_id>    → 1 (locked) / 0 (unlocked)
    stas:counter:turn:<session_id> → turn number (ephemeral, TTL-managed)

Usage::

    from workers.runaway.limits import LimitManager

    lm = LimitManager()

    # Timeout lock
    locked = lm.acquire_timeout_lock("task-abc", ttl=60)
    lm.release_timeout_lock("task-abc")

    # Turn tracking
    turn = lm.increment_turn("sess-xyz")
    if turn > lm.max_turns:
        lm.auto_kill("sess-xyz", reason="max_turns_exceeded")

    # Cost cap
    if lm.is_cost_capped("task-abc", current_cost=12.0, max_cost=10.0):
        lm.trigger_cost_kill("task-abc")
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

from workers.runaway.config import get_runaway_config

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants (with env overrides)
# ---------------------------------------------------------------------------

DEFAULT_MAX_TURNS: int = int(os.getenv("STAS_RUNAWAY_MAX_TURNS", "25"))
"""Maximum number of LLM-tool-call turns per session before auto-kill."""

DEFAULT_TURN_TIMEOUT_SECONDS: int = int(
    os.getenv("STAS_RUNAWAY_TURN_TIMEOUT_SECONDS", "120")
)
"""Maximum wall-clock seconds for a single turn before it is considered stuck."""

# ---------------------------------------------------------------------------
# Redis key prefixes (internal)
# ---------------------------------------------------------------------------

_PREFIX_LOCK_TIMEOUT = "stas:lock:timeout:"
_PREFIX_LOCK_TURN = "stas:lock:turn:"
_PREFIX_LOCK_COSTCAP = "stas:lock:costcap:"
_PREFIX_COUNTER_TURN = "stas:counter:turn:"


# ---------------------------------------------------------------------------
# LimitManager
# ---------------------------------------------------------------------------


class LimitManager:
    """Lock-based limit enforcement for runaway agent protection.

    Thread-safe via Redis ``SET NX`` semantics.  Falls back to a local
    in-memory dict when Redis is unavailable.
    """

    def __init__(
        self,
        redis_client: Any = None,
        max_turns: int = DEFAULT_MAX_TURNS,
        redis_enabled: bool = True,
    ) -> None:
        self._max_turns = max_turns
        self._redis_enabled = redis_enabled
        self._cfg = get_runaway_config()

        if redis_client is not None:
            self._redis: Any = redis_client
        elif not redis_enabled:
            self._redis = None
        else:
            self._redis = self._lazy_redis()

        # In-memory fallback for local-only mode
        self._local: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Redis helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _lazy_redis() -> Optional[Any]:
        """Initialise a Redis client from the default URL."""
        try:
            import redis as _redis_mod

            url = os.getenv(
                "REDIS_URL",
                os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
            )
            client = _redis_mod.from_url(url, decode_responses=True)
            client.ping()
            return client
        except Exception:
            logger.warning("Redis unavailable — LimitManager using local fallback")
            return None

    def _set_nx(self, key: str, value: str, ttl: int) -> bool:
        """Atomically set *key* = *value* with TTL only if *key* does not exist.

        Returns ``True`` if the lock was acquired, ``False`` otherwise.
        """
        if self._redis is not None:
            try:
                return bool(self._redis.set(key, value, nx=True, ex=ttl))
            except Exception:
                pass
        # Local fallback
        if key not in self._local:
            self._local[key] = value
            return True
        return False

    def _delete(self, key: str) -> None:
        """Delete a key."""
        if self._redis is not None:
            try:
                self._redis.delete(key)
            except Exception:
                pass
        self._local.pop(key, None)

    def _get(self, key: str) -> str | None:
        """Return the value at *key*, or ``None``."""
        if self._redis is not None:
            try:
                val: str | None = self._redis.get(key)
                if val is not None:
                    return val
            except Exception:
                pass
        return self._local.get(key)

    def _incr(self, key: str, ttl: int) -> int:
        """Increment a counter and set its TTL.

        Returns the new value (1-based after first call).
        """
        if self._redis is not None:
            try:
                val: int = self._redis.incr(key)
                self._redis.expire(key, ttl)
                return val
            except Exception:
                pass
        # Local fallback
        current = int(self._local.get(key, "0"))
        new_val = current + 1
        self._local[key] = str(new_val)
        return new_val

    # ------------------------------------------------------------------
    # Timeout lock
    # ------------------------------------------------------------------

    def acquire_timeout_lock(self, task_id: str, ttl: int | None = None) -> bool:
        """Acquire an exclusive timeout-handling lock for *task_id*.

        Only one worker should emit the timeout event and label the issue.
        Returns ``True`` if *this* caller acquired the lock.

        *ttl* defaults to ``config.redis.task_ttl_seconds`` (7200).
        """
        effective_ttl = ttl if ttl is not None else self._cfg["redis"]["task_ttl_seconds"]
        key = f"{_PREFIX_LOCK_TIMEOUT}{task_id}"
        acquired = self._set_nx(key, str(int(time.time())), effective_ttl)
        if acquired:
            logger.debug("Acquired timeout lock — task_id=%s", task_id)
        return acquired

    def release_timeout_lock(self, task_id: str) -> None:
        """Release the timeout lock for *task_id*."""
        self._delete(f"{_PREFIX_LOCK_TIMEOUT}{task_id}")

    def is_timeout_locked(self, task_id: str) -> bool:
        """Check whether a timeout lock currently exists for *task_id*."""
        return self._get(f"{_PREFIX_LOCK_TIMEOUT}{task_id}") is not None

    # ------------------------------------------------------------------
    # Turn tracking
    # ------------------------------------------------------------------

    @property
    def max_turns(self) -> int:
        """Maximum allowed LLM-tool-call turns before auto-kill."""
        return self._max_turns

    def increment_turn(self, session_id: str, ttl: int | None = None) -> int:
        """Increment the turn counter for *session_id*.

        Returns the new turn number (1-based).  Once the counter exceeds
        ``max_turns`` the caller should invoke ``auto_kill()``.

        *ttl* defaults to ``config.redis.turn_lock_ttl_seconds`` (3600).
        """
        effective_ttl = ttl if ttl is not None else self._cfg["redis"]["turn_lock_ttl_seconds"]
        key = f"{_PREFIX_COUNTER_TURN}{session_id}"
        return self._incr(key, effective_ttl)

    def get_turn_count(self, session_id: str) -> int:
        """Return the current turn count for *session_id* (0 if unknown)."""
        val = self._get(f"{_PREFIX_COUNTER_TURN}{session_id}")
        return int(val) if val else 0

    def reset_turns(self, session_id: str) -> None:
        """Reset the turn counter for *session_id*."""
        self._delete(f"{_PREFIX_COUNTER_TURN}{session_id}")

    def check_turn_limit(
        self, session_id: str, context: str = ""
    ) -> tuple[bool, str]:
        """Check whether *session_id* has exceeded ``max_turns``.

        Returns ``(exceeded: bool, reason: str)``.
        """
        current = self.get_turn_count(session_id)
        if current >= self._max_turns:
            reason = (
                f"Session {session_id} exceeded max turns "
                f"({current} >= {self._max_turns})"
            )
            if context:
                reason = f"{reason} — {context}"
            logger.warning("Runaway turn limit — %s", reason)
            return True, reason
        return False, ""

    # ------------------------------------------------------------------
    # Cost cap lock
    # ------------------------------------------------------------------

    def is_cost_capped(
        self, task_id: str, current_cost: float, max_cost: float
    ) -> bool:
        """Return ``True`` if *current_cost* exceeds *max_cost*.

        This is a pure check — it does *not* acquire the kill lock.  Use
        ``trigger_cost_kill()`` to atomically execute the stop action.
        """
        return current_cost > max_cost

    def acquire_cost_kill_lock(self, task_id: str, ttl: int | None = None) -> bool:
        """Acquire a lock ensuring cost-kill runs only once per task.

        Returns ``True`` if *this* caller should perform the kill action.

        *ttl* defaults to ``config.redis.cost_cap_ttl_seconds`` (86400).
        """
        effective_ttl = ttl if ttl is not None else self._cfg["redis"]["cost_cap_ttl_seconds"]
        key = f"{_PREFIX_LOCK_COSTCAP}{task_id}"
        return self._set_nx(key, "1", effective_ttl)

    def release_cost_kill_lock(self, task_id: str) -> None:
        """Release the cost-kill lock for *task_id*."""
        self._delete(f"{_PREFIX_LOCK_COSTCAP}{task_id}")

    def trigger_cost_kill(self, task_id: str, reason: str = "") -> bool:
        """Atomically mark *task_id* as cost-capped and return kill signal.

        Returns ``True`` if *this* caller acquired the kill lock and should
        proceed with stopping the task.
        """
        if not self.acquire_cost_kill_lock(task_id):
            # Another worker already claimed the kill
            return False
        logger.warning(
            "Cost kill triggered — task_id=%s reason=%s",
            task_id,
            reason or "cost_cap_exceeded",
        )
        return True

    # ------------------------------------------------------------------
    # Auto-kill
    # ------------------------------------------------------------------

    def auto_kill(self, session_id: str, reason: str = "") -> dict[str, Any]:
        """Record an auto-kill event and return structured kill metadata.

        This is a pure-logging / metadata method — the actual task
        termination is handled upstream by ``guard.check_all()`` + the
        Celery middleware (``middleware.py``).
        """
        kill_record = {
            "session_id": session_id,
            "reason": reason or "auto_kill",
            "turn_count": self.get_turn_count(session_id),
            "timestamp_iso": _now_iso(),
        }
        logger.warning(
            "Auto-kill record — session_id=%s reason=%s turn_count=%d",
            session_id,
            kill_record["reason"],
            kill_record["turn_count"],
        )
        return kill_record

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def cleanup_session(self, session_id: str) -> None:
        """Remove all tracking state for *session_id*."""
        self._delete(f"{_PREFIX_COUNTER_TURN}{session_id}")
        self._delete(f"{_PREFIX_LOCK_TURN}{session_id}")
        self._delete(f"{_PREFIX_LOCK_COSTCAP}{session_id}")
        self._delete(f"{_PREFIX_LOCK_TIMEOUT}{session_id}")
        logger.debug("Cleaned up limit state — session_id=%s", session_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string with milliseconds."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
