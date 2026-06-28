from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

_COST_KEY_PREFIX = "stas:cost:"
_AGGREGATE_KEY = "stas:cost:aggregate"


@dataclass
class CostEntry:
    run_id: str
    model_name: str
    model_cost_cents: int = 0
    sandbox_cost_cents: int = 0
    overhead_cents: int = 0
    total_cost_cents: int = 0
    duration_seconds: int = 0
    timestamp: str = ""

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()
        if self.total_cost_cents == 0:
            self.total_cost_cents = self.model_cost_cents + self.sandbox_cost_cents + self.overhead_cents

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> CostEntry:
        return CostEntry(
            run_id=data["run_id"],
            model_name=data.get("model_name", "unknown"),
            model_cost_cents=data.get("model_cost_cents", 0),
            sandbox_cost_cents=data.get("sandbox_cost_cents", 0),
            overhead_cents=data.get("overhead_cents", 0),
            total_cost_cents=data.get("total_cost_cents", 0),
            duration_seconds=data.get("duration_seconds", 0),
            timestamp=data.get("timestamp", ""),
        )


@dataclass
class CostSummary:
    total_runs: int = 0
    total_cost_cents: int = 0
    avg_cost_cents: float = 0.0
    min_cost_cents: int = 0
    max_cost_cents: int = 0
    last_updated: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_REDIS_CLIENT: Optional[Any] = None
_REDIS_URL = os.getenv(
    "REDIS_URL",
    os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
)


def _get_redis() -> Any:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod
        _REDIS_CLIENT = _redis_mod.from_url(_REDIS_URL, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Cost tracker Redis unavailable: %s", exc)
        _REDIS_CLIENT = None
        return None


def record_cost(entry: CostEntry) -> bool:
    try:
        client = _get_redis()
    except Exception as exc:
        logger.warning("Redis unavailable — cost not recorded run=%s: %s", entry.run_id, exc)
        return False
    if not client:
        logger.warning("Redis unavailable — cost not recorded run=%s", entry.run_id)
        return False

    try:
        key = f"{_COST_KEY_PREFIX}{entry.run_id}"
        client.set(key, json.dumps(entry.to_dict()))
        client.expire(key, 90 * 24 * 60 * 60)
        pipe = client.pipeline()
        pipe.hincrby(_AGGREGATE_KEY, "total_runs", 1)
        pipe.hincrby(_AGGREGATE_KEY, "total_cost_cents", entry.total_cost_cents)
        pipe.hset(_AGGREGATE_KEY, "last_updated", entry.timestamp)
        pipe.execute()
        return True
    except Exception as exc:
        logger.error("Failed to record cost run=%s: %s", entry.run_id, exc)
        return False


def get_cost(run_id: str) -> CostEntry | None:
    client = _get_redis()
    if not client:
        return None
    try:
        key = f"{_COST_KEY_PREFIX}{run_id}"
        data = client.get(key)
        if not data:
            return None
        return CostEntry.from_dict(json.loads(data))
    except Exception as exc:
        logger.error("Failed to get cost run=%s: %s", run_id, exc)
        return None


def get_summary() -> CostSummary:
    client = _get_redis()
    if not client:
        return CostSummary()
    try:
        data = client.hgetall(_AGGREGATE_KEY)
        if not data:
            return CostSummary()
        total_runs = int(data.get("total_runs", 0))
        total_cost_cents = int(data.get("total_cost_cents", 0))
        avg_cost_cents = round(total_cost_cents / max(total_runs, 1), 1)
        return CostSummary(
            total_runs=total_runs,
            total_cost_cents=total_cost_cents,
            avg_cost_cents=avg_cost_cents,
            last_updated=data.get("last_updated", ""),
        )
    except Exception as exc:
        logger.error("Failed to get cost summary: %s", exc)
        return CostSummary()


def get_all_costs(limit: int = 100) -> list[CostEntry]:
    client = _get_redis()
    if not client:
        return []
    results: list[CostEntry] = []
    cursor = 0
    try:
        while True:
            cursor, keys = client.scan(cursor, match=f"{_COST_KEY_PREFIX}*", count=limit)
            for key in keys:
                data = client.get(key)
                if data:
                    try:
                        results.append(CostEntry.from_dict(json.loads(data)))
                    except (json.JSONDecodeError, KeyError):
                        continue
            if cursor == 0 or len(results) >= limit:
                break
    except Exception as exc:
        logger.error("Failed to scan cost keys: %s", exc)
    results.sort(key=lambda e: e.timestamp, reverse=True)
    return results[:limit]


def format_cost_for_display(cost_cents: int) -> str:
    if cost_cents <= 0:
        return "$0.00"
    if cost_cents < 100:
        return f"¢{cost_cents}"
    return f"${cost_cents / 100:.2f}"


def build_cost_summary_line(run_id: str, cost_cents: int, pass_rate: float) -> str:
    cost_str = format_cost_for_display(cost_cents)
    rate_str = f"{pass_rate * 100:.0f}%"
    return (
        f"✅ **Verified fix** — Cost: {cost_str} | "
        f"Pass rate: {rate_str} | "
        f"[Evidence details](docs/benchmarks.md)"
    )
