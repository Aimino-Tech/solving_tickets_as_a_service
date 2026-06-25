from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import redis

logger = logging.getLogger(__name__)

REDIS_URL_ENV = "CELERY_RESULT_BACKEND"
DEFAULT_REDIS_URL = "redis://localhost:6379/0"

RETRY_THRESHOLD = 3
ESCALATION_PREFIX = "stas:escalation"


class EscalationTracker:
    def __init__(self) -> None:
        redis_url = os.getenv(REDIS_URL_ENV, DEFAULT_REDIS_URL)
        self._redis: redis.Redis | None = None
        try:
            self._redis = redis.from_url(redis_url, decode_responses=True)
        except Exception as exc:
            logger.warning("Redis not available for escalation tracking: %s", exc)

    def record_retry(
        self,
        issue_key: str,
        attempt: int,
        error: str,
        repo: str = "",
        issue_number: int = 0,
    ) -> dict[str, Any]:
        key = f"{ESCALATION_PREFIX}:retries:{issue_key}"
        now = time.time()
        entry = {
            "attempt": attempt,
            "error": error,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "repo": repo,
            "issue_number": issue_number,
        }

        if self._redis:
            self._redis.rpush(key, json.dumps(entry))
            self._redis.expire(key, 86400 * 7)
            retries = self._redis.llen(key)
        else:
            retries = attempt

        return {
            "issue_key": issue_key,
            "attempt": attempt,
            "total_retries": retries,
            "should_escalate": retries >= RETRY_THRESHOLD,
        }

    def should_escalate(self, issue_key: str) -> bool:
        key = f"{ESCALATION_PREFIX}:retries:{issue_key}"
        if self._redis:
            count = self._redis.llen(key)
            return count >= RETRY_THRESHOLD
        return False

    def get_retry_history(self, issue_key: str) -> list[dict[str, Any]]:
        key = f"{ESCALATION_PREFIX}:retries:{issue_key}"
        if not self._redis:
            return []
        entries = self._redis.lrange(key, 0, -1)
        return [json.loads(e) for e in entries] if entries else []

    def is_silenced(self, issue_key: str) -> bool:
        key = f"{ESCALATION_PREFIX}:silenced:{issue_key}"
        if self._redis:
            return self._redis.exists(key) > 0
        return False

    def silence(self, issue_key: str, ttl: int = 3600) -> None:
        key = f"{ESCALATION_PREFIX}:silenced:{issue_key}"
        if self._redis:
            self._redis.setex(key, ttl, "1")
            logger.info("Escalation silenced for %s (ttl=%ds)", issue_key, ttl)

    def acknowledge(self, issue_key: str) -> None:
        key = f"{ESCALATION_PREFIX}:silenced:{issue_key}"
        if self._redis:
            self._redis.setex(key, 86400, "acknowledged")
            logger.info("Escalation acknowledged for %s", issue_key)

    def log_escalation_event(
        self,
        event_type: str,
        issue_key: str,
        details: dict[str, Any],
    ) -> None:
        key = f"{ESCALATION_PREFIX}:events:{issue_key}"
        event = {
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **details,
        }
        if self._redis:
            self._redis.rpush(key, json.dumps(event))
            self._redis.expire(key, 86400 * 30)
        logger.info("Escalation event logged: %s for %s — %s", event_type, issue_key, json.dumps(details))
