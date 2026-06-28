"""
Emergency stop (deadman switch) — single action to kill all running agent tasks.

Design
------
- Uses Redis key ``stas:emergency_stop`` as primary indicator.
- Falls back to a file-based lock at ``/tmp/stas-emergency-stop.lock`` when
  Redis is unavailable (e.g. in testing or minimal environments).
- Singleton access via :func:`get_emergency_stop`.

Usage::

    stop = get_emergency_stop()
    stop.activate("Runaway agent on project X")
    assert stop.check() is True
    stop.deactivate()
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REDIS_KEY = "stas:emergency_stop"


def _get_lock_file() -> str:
    return os.getenv("EMERGENCY_STOP_LOCK_FILE", "/tmp/stas-emergency-stop.lock")


FILE_LOCK = "/tmp/stas-emergency-stop.lock"

# Queues whose tasks should be stopped / moved to hold during emergency
AGENT_QUEUES = [
    "stas.agents.triage",
    "stas.agents.dispatch",
    "stas.agents.sandbox",
    "stas.agents.verification",
    "stas.agents.pr_creation",
    "stas.agents.notifications",
    "stas.agents.default",
]

HOLD_QUEUE = "stas.agents.hold"


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


# ---------------------------------------------------------------------------
# Sentinel values for redis_client constructor argument
# ---------------------------------------------------------------------------

# Default: auto-detect Redis (try to connect, fall back to file on failure)
_UNSET = object()
# Explicitly disable Redis (file-only mode, never attempts a connection)
_DISABLE_REDIS = object()


# ---------------------------------------------------------------------------
# EmergencyStop class
# ---------------------------------------------------------------------------


class EmergencyStop:
    """Global kill switch for all running agent tasks.

    Thread-safe: uses a new Redis connection per call (lightweight enough for
    the low-frequency check pattern).  File-based fallback uses atomic writes.
    """

    def __init__(self, redis_client: Any = _UNSET) -> None:
        if redis_client is _UNSET:
            self._redis = None     # auto-detect
        elif redis_client is _DISABLE_REDIS:
            self._redis = _DISABLE_REDIS  # explicitly disabled
        else:
            self._redis = redis_client    # caller-provided client

    # -- Redis helpers -------------------------------------------------------

    def _get_redis(self) -> Optional[Any]:
        if self._redis is _DISABLE_REDIS:
            return None
        if self._redis is not None:
            return self._redis
        try:
            import redis as _redis_mod

            url = os.getenv(
                "REDIS_URL",
                os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
            )
            self._redis = _redis_mod.from_url(url, decode_responses=True)
            self._redis.ping()
        except Exception:
            self._redis = None
        return self._redis

    # -- Public API ----------------------------------------------------------

    def check(self) -> bool:
        """Return ``True`` if emergency stop is active.

        Checks Redis first; falls back to the file-based lock.  Returns
        ``False`` if neither source indicates a stop.
        """
        r = self._get_redis()
        if r is not None:
            try:
                val = r.get(REDIS_KEY)
                if val is not None:
                    return True
            except Exception:
                pass
        # Fallback: file lock
        return os.path.isfile(_get_lock_file())

    def read_state(self) -> dict[str, Any]:
        """Return full state dict, or a default inactive dict."""
        r = self._get_redis()
        if r is not None:
            try:
                val = r.get(REDIS_KEY)
                if val is not None:
                    return json.loads(val)
            except Exception:
                pass
        lock = _get_lock_file()
        try:
            with open(lock) as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        return {"active": False}

    def activate(self, reason: str = "") -> dict[str, Any]:
        """Activate the emergency stop and return the state dict.

        Sets both the Redis key and the file lock so either source can
        be read independently.
        """
        state: dict[str, Any] = {
            "active": True,
            "reason": reason or "operator-initiated",
            "activated_at": _now_iso(),
        }
        payload = json.dumps(state)

        r = self._get_redis()
        if r is not None:
            try:
                r.set(REDIS_KEY, payload)
            except Exception as exc:
                logger.warning("Failed to write Redis emergency stop: %s", exc)

        lock = _get_lock_file()
        with open(lock, "w") as f:
            f.write(payload)

        logger.warning("EMERGENCY STOP ACTIVATED — reason=%s", reason or "unspecified")
        return state

    def deactivate(self) -> dict[str, Any]:
        """Deactivate the emergency stop and return the former state."""
        state = {"active": False, "deactivated_at": _now_iso()}

        r = self._get_redis()
        if r is not None:
            try:
                r.delete(REDIS_KEY)
            except Exception as exc:
                logger.warning("Failed to delete Redis emergency stop: %s", exc)

        try:
            os.unlink(_get_lock_file())
        except FileNotFoundError:
            pass

        logger.warning("EMERGENCY STOP DEACTIVATED")
        return state


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_manager: EmergencyStop | None = None


def get_emergency_stop() -> EmergencyStop:
    global _manager
    if _manager is None:
        _manager = EmergencyStop()
    return _manager
