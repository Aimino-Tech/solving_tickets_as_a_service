"""
Python Emergency Stop — mirrors the TypeScript EmergencyStop class.

Provides a shared Redis + filesystem mechanism for the kill switch that
works across both the TypeScript webhook server and the Python Celery
workers. Both sides read the same Redis key and lock file.

Usage:
    from workers.emergency.stop import EmergencyStop

    if EmergencyStop.check():
        print("Emergency stop active — refusing task")
        return

    # Also check within async contexts
    status = EmergencyStop.get_status()
    print(f"Active: {status['active']}, Reason: {status.get('reason')}")
"""

import json
import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration (mirrors src/config.ts emergency section defaults)
# ---------------------------------------------------------------------------

_REDIS_KEY = os.getenv("STAS_EMERGENCY_REDIS_KEY", "stas:emergency_stop")
_LOCK_FILE = os.getenv("STAS_EMERGENCY_LOCK_FILE", "/tmp/stas-emergency-stop.lock")
_HOLD_QUEUE = os.getenv("STAS_EMERGENCY_HOLD_QUEUE", "stas.emergency.hold")
_REVOKE_TIMEOUT = int(os.getenv("STAS_EMERGENCY_REVOKE_TIMEOUT_MS", "5000"))

# ---------------------------------------------------------------------------
# Cached state (avoids hitting Redis / filesystem on every task dispatch)
# ---------------------------------------------------------------------------

_cached_active: bool = False
_cached_reason: Optional[str] = None
_cached_activated_at: Optional[str] = None
_cache_expiry: float = 0
_CACHE_TTL: float = 5.0  # Re-check every 5 seconds


# ---------------------------------------------------------------------------
# EmergencyStop
# ---------------------------------------------------------------------------

class EmergencyStop:
    """Global kill switch for all running agents (Python mirror)."""

    _redis = None  # Lazy-imported redis client

    @classmethod
    def _get_redis(cls):
        """Get or create a Redis client (lazy import)."""
        if cls._redis is None:
            try:
                import redis as redis_module
                redis_url = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
                cls._redis = redis_module.from_url(redis_url, decode_responses=True)
            except ImportError:
                logger.warning("redis-py not available — emergency stop will use file-based check only")
                cls._redis = False  # Sentinel
            except Exception as exc:
                logger.warning("Failed to connect to Redis for emergency stop: %s", exc)
                cls._redis = False
        return cls._redis if cls._redis is not False else None

    @classmethod
    def check(cls) -> bool:
        """
        Quick synchronous check — returns True if the kill switch is active.

        Uses a 5-second cache to avoid hammering Redis/filesystem on every
        task dispatch. Checks Redis first, then the lock file.
        """
        global _cached_active, _cache_expiry, _cached_reason, _cached_activated_at

        # Return cached result if still fresh
        now = time.time()
        if now < _cache_expiry:
            return _cached_active

        # 1. Check Redis
        redis_client = cls._get_redis()
        if redis_client is not None:
            try:
                value = redis_client.get(_REDIS_KEY)
                if value:
                    _cached_active = True
                    _cache_expiry = now + _CACHE_TTL
                    try:
                        data = json.loads(value)
                        _cached_reason = data.get("reason")
                        _cached_activated_at = data.get("activatedAt")
                    except (json.JSONDecodeError, TypeError):
                        _cached_reason = str(value)
                    return True
            except Exception as exc:
                logger.debug("Redis check failed: %s", exc)

        # 2. Check lock file
        try:
            if os.path.exists(_LOCK_FILE):
                with open(_LOCK_FILE, "r") as f:
                    content = f.read().strip()
                _cached_active = True
                _cache_expiry = now + _CACHE_TTL
                try:
                    data = json.loads(content)
                    _cached_reason = data.get("reason")
                    _cached_activated_at = data.get("activatedAt")
                except (json.JSONDecodeError, TypeError):
                    _cached_reason = content
                return True
        except Exception as exc:
            logger.debug("Lock file check failed: %s", exc)

        # 3. Not active
        _cached_active = False
        _cached_reason = None
        _cached_activated_at = None
        _cache_expiry = now + _CACHE_TTL
        return False

    @classmethod
    def get_status(cls) -> dict:
        """
        Get the full status of the kill switch.
        Returns a dict with keys: active, reason, activatedAt.
        """
        # Ensure cache is fresh
        cls.check()

        return {
            "active": _cached_active,
            "reason": _cached_reason,
            "activatedAt": _cached_activated_at,
        }

    @classmethod
    def invalidate_cache(cls) -> None:
        """Force re-check on next access (useful after external activation)."""
        global _cache_expiry
        _cache_expiry = 0

    @classmethod
    def get_config(cls) -> dict:
        """Return the current configuration values (for diagnostics)."""
        return {
            "redisKey": _REDIS_KEY,
            "lockFile": _LOCK_FILE,
            "holdQueue": _HOLD_QUEUE,
            "revokeTimeoutMs": _REVOKE_TIMEOUT,
        }
