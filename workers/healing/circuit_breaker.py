import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

CIRCUIT_BREAKER_THRESHOLD = int(os.getenv("STAS_CIRCUIT_BREAKER_THRESHOLD", "5"))
CIRCUIT_BREAKER_PAUSE = int(os.getenv("STAS_CIRCUIT_BREAKER_PAUSE_SECONDS", "60"))
CIRCUIT_KEY_PREFIX = "stas:circuit:"
FAILURE_COUNT_KEY = "failure_count"
LAST_FAILURE_KEY = "last_failure"
STATE_KEY = "state"


class CircuitBreaker:
    def __init__(self, redis_client: Any | None = None):
        self._redis = redis_client

    def _circuit_key(self, task_type: str) -> str:
        return f"{CIRCUIT_KEY_PREFIX}{task_type}"

    def record_failure(self, task_type: str) -> dict[str, Any]:
        now = time.time()
        key = self._circuit_key(task_type)
        state: dict[str, Any] = {"state": "closed", "failure_count": 0, "last_failure": now}

        if self._redis:
            try:
                pipe = self._redis.pipeline()
                pipe.hincrby(key, FAILURE_COUNT_KEY, 1)
                pipe.hset(key, LAST_FAILURE_KEY, str(now))
                pipe.expire(key, 3600)
                pipe.hgetall(key)
                results = pipe.execute()
                raw = results[3] if len(results) > 3 else {}
                state = {
                    "failure_count": int(raw.get(b"failure_count", raw.get("failure_count", 0))),
                    "last_failure": float(raw.get(b"last_failure", raw.get("last_failure", now))),
                    "state": "closed",
                }
            except Exception as exc:
                logger.warning("Failed to record failure in Redis: %s", exc)

        if isinstance(state["failure_count"], int) and state["failure_count"] >= CIRCUIT_BREAKER_THRESHOLD:
            state["state"] = "open"
            if self._redis:
                try:
                    self._redis.hset(key, STATE_KEY, "open")
                    self._redis.expire(key, CIRCUIT_BREAKER_PAUSE + 10)
                except Exception:
                    pass
            logger.warning("Circuit breaker OPEN for task_type=%s after %d failures", task_type, state["failure_count"])

        return state

    def record_success(self, task_type: str) -> None:
        key = self._circuit_key(task_type)
        if self._redis:
            try:
                self._redis.delete(key)
            except Exception:
                pass

    def is_open(self, task_type: str) -> bool:
        key = self._circuit_key(task_type)
        if self._redis:
            try:
                state = self._redis.hget(key, STATE_KEY)
                if state and state in (b"open", "open"):
                    return True
            except Exception:
                pass
        return False

    def get_state(self, task_type: str) -> dict[str, Any]:
        key = self._circuit_key(task_type)
        state: dict[str, Any] = {"state": "closed", "failure_count": 0}

        if self._redis:
            try:
                raw = self._redis.hgetall(key)
                if raw:
                    state = {
                        "failure_count": int(raw.get(b"failure_count", raw.get("failure_count", 0))),
                        "last_failure": float(raw.get(b"last_failure", raw.get("last_failure", 0))),
                        "state": raw.get(b"state", raw.get("state", "closed")),
                    }
                    if isinstance(state["state"], bytes):
                        state["state"] = state["state"].decode()
            except Exception:
                pass

        return state

    def reset(self, task_type: str) -> None:
        key = self._circuit_key(task_type)
        if self._redis:
            try:
                self._redis.delete(key)
            except Exception:
                pass
