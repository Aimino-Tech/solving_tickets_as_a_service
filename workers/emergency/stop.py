import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

EMERGENCY_STOP_KEY = "stas:emergency_stop"
EMERGENCY_REASON_KEY = "stas:emergency_stop:reason"
EMERGENCY_TIMESTAMP_KEY = "stas:emergency_stop:timestamp"
EMERGENCY_LOCK_FILE = "/tmp/stas-emergency-stop.lock"


class EmergencyStop:
    def __init__(self, redis_client: Any | None = None):
        self._redis = redis_client

    def is_active(self) -> bool:
        if self._redis:
            try:
                return bool(self._redis.get(EMERGENCY_STOP_KEY))
            except Exception as exc:
                logger.warning("Redis check failed: %s", exc)
        return os.path.isfile(EMERGENCY_LOCK_FILE)

    def activate(self, reason: str = "Manual emergency stop") -> dict[str, Any]:
        timestamp = time.time()
        if self._redis:
            try:
                self._redis.set(EMERGENCY_STOP_KEY, "1")
                self._redis.set(EMERGENCY_REASON_KEY, reason)
                self._redis.set(EMERGENCY_TIMESTAMP_KEY, str(timestamp))
            except Exception as exc:
                logger.error("Failed to set Redis emergency stop: %s", exc)

        with open(EMERGENCY_LOCK_FILE, "w") as f:
            f.write(f"{reason}\n{timestamp}\n")

        logger.warning("EMERGENCY STOP ACTIVATED — reason=%s", reason)
        return {"active": True, "reason": reason, "timestamp": timestamp}

    def deactivate(self) -> dict[str, Any]:
        if self._redis:
            try:
                self._redis.delete(EMERGENCY_STOP_KEY)
                self._redis.delete(EMERGENCY_REASON_KEY)
                self._redis.delete(EMERGENCY_TIMESTAMP_KEY)
            except Exception as exc:
                logger.error("Failed to clear Redis emergency stop: %s", exc)

        if os.path.isfile(EMERGENCY_LOCK_FILE):
            os.remove(EMERGENCY_LOCK_FILE)

        logger.warning("EMERGENCY STOP DEACTIVATED")
        return {"active": False}

    def get_status(self) -> dict[str, Any]:
        active = self.is_active()
        reason = "N/A"
        timestamp: float | None = None

        if self._redis:
            try:
                reason = self._redis.get(EMERGENCY_REASON_KEY) or "N/A"
                ts = self._redis.get(EMERGENCY_TIMESTAMP_KEY)
                if ts:
                    timestamp = float(ts)
            except Exception:
                pass

        if not active and os.path.isfile(EMERGENCY_LOCK_FILE):
            try:
                with open(EMERGENCY_LOCK_FILE) as f:
                    lines = f.read().strip().split("\n")
                    if len(lines) >= 1:
                        reason = lines[0]
                    if len(lines) >= 2:
                        try:
                            timestamp = float(lines[1])
                        except ValueError:
                            pass
            except OSError:
                pass

        return {
            "active": active,
            "reason": reason,
            "timestamp": timestamp,
            "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(timestamp)) if timestamp else None,
        }
