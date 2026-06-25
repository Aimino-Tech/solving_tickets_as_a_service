"""
Circuit Breaker — pauses a task type after N consecutive failures.

After 5 consecutive failures of the **same task type**, the circuit opens
(pauses) for 60 seconds. After that, it transitions to half-open, allows one
test execution, and either closes (success) or re-opens (failure).

Design
------
    - Consecutive failures are tracked per task type in Redis.
    - States: ``CLOSED`` (normal), ``OPEN`` (paused), ``HALF_OPEN`` (testing).
    - The ``check_circuit()`` function is called before task dispatch.
    - The ``record_failure()`` / ``record_success()`` functions are called
      after task completion.

Redis Keys
----------
    ``stas:circuit:{task_type}:state`` — ``CLOSED`` | ``OPEN`` | ``HALF_OPEN``
    ``stas:circuit:{task_type}:failure_count`` — integer
    ``stas:circuit:{task_type}:opened_at`` — ISO timestamp when circuit opened
    ``stas:circuit:{task_type}:half_open_at`` — ISO timestamp when half-open

Configuration (env vars)
------------------------
    ``CIRCUIT_BREAKER_THRESHOLD`` (default: 5) — consecutive failures before open.
    ``CIRCUIT_BREAKER_OPEN_SECONDS`` (default: 60) — how long circuit stays open.
    ``CIRCUIT_BREAKER_HALF_OPEN_MAX`` (default: 1) — max tests in half-open state.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_THRESHOLD = int(os.getenv("CIRCUIT_BREAKER_THRESHOLD", "5"))
_OPEN_SECONDS = int(os.getenv("CIRCUIT_BREAKER_OPEN_SECONDS", "60"))
_HALF_OPEN_MAX = int(os.getenv("CIRCUIT_BREAKER_HALF_OPEN_MAX", "1"))
_REDIS_PREFIX = "stas:circuit:"

# ── States ────────────────────────────────────────────────────────────

CLOSED = "CLOSED"
OPEN = "OPEN"
HALF_OPEN = "HALF_OPEN"

CircuitState = str  # Literal[CLOSED, OPEN, HALF_OPEN]


# ---------------------------------------------------------------------------
# Redis client (lazy)
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        url = os.getenv(
            "REDIS_URL",
            os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
        )
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Circuit breaker - Redis unavailable: %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _state_key(task_type: str) -> str:
    return _REDIS_PREFIX + task_type + ":state"


def _fail_count_key(task_type: str) -> str:
    return _REDIS_PREFIX + task_type + ":failure_count"


def _opened_at_key(task_type: str) -> str:
    return _REDIS_PREFIX + task_type + ":opened_at"


def _half_open_at_key(task_type: str) -> str:
    return _REDIS_PREFIX + task_type + ":half_open_at"


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------


def get_state(task_type: str) -> CircuitState:
    """Get the current circuit breaker state for a task type.

    Automatically transitions OPEN -> HALF_OPEN after ``_OPEN_SECONDS``.
    """
    client = _get_redis()
    if not client:
        return CLOSED  # Degrade gracefully: closed

    try:
        state = client.get(_state_key(task_type))
        if state is None:
            return CLOSED

        if state == OPEN:
            opened_at = client.get(_opened_at_key(task_type))
            if opened_at:
                try:
                    elapsed = time.time() - float(opened_at)
                    if elapsed >= _OPEN_SECONDS:
                        # Auto-transition to HALF_OPEN
                        set_state(task_type, HALF_OPEN)
                        client.set(_half_open_at_key(task_type), str(time.time()))
                        logger.info(
                            json.dumps({
                                "event": "circuit.auto_half_open",
                                "task_type": task_type,
                                "elapsed_s": round(elapsed, 1),
                            })
                        )
                        return HALF_OPEN
                except (ValueError, TypeError):
                    pass
            return OPEN

        elif state == HALF_OPEN:
            return HALF_OPEN

        return CLOSED
    except Exception as exc:
        logger.debug("Failed to get circuit state for %s - %s", task_type, exc)
        return CLOSED


def set_state(task_type: str, state: CircuitState) -> None:
    """Set the circuit breaker state for a task type."""
    client = _get_redis()
    if not client:
        return

    try:
        client.set(_state_key(task_type), state)
        client.expire(_state_key(task_type), _OPEN_SECONDS * 4)  # safety TTL
    except Exception as exc:
        logger.debug("Failed to set circuit state for %s - %s", task_type, exc)


def check_circuit(task_type: str) -> tuple[bool, str]:
    """Check whether a task is allowed to execute.

    Args:
        task_type: The Celery task name.

    Returns:
        ``(allowed, reason)``. If the circuit is open, ``allowed`` is False
        and ``reason`` explains why.
    """
    state = get_state(task_type)

    if state == OPEN:
        opened_at = _get_opened_at(task_type)
        reason = (
            "Circuit OPEN for task '%s' - paused for %ds (opened at %s)"
            % (task_type, _OPEN_SECONDS, opened_at or "unknown")
        )
        logger.warning(
            json.dumps({
                "event": "circuit.blocked",
                "task_type": task_type,
                "state": state,
                "opened_at": opened_at or "unknown",
            })
        )
        return False, reason

    elif state == HALF_OPEN:
        # In half-open, we allow a limited number of test executions
        test_count = _get_half_open_test_count(task_type)
        if test_count >= _HALF_OPEN_MAX:
            reason = (
                "Circuit HALF_OPEN for task '%s' - already used %d/%d test attempts"
                % (task_type, test_count, _HALF_OPEN_MAX)
            )
            logger.debug("Half-open test limit reached for %s", task_type)
            return False, reason

        _increment_half_open_test_count(task_type)
        logger.info(
            json.dumps({
                "event": "circuit.half_open_test",
                "task_type": task_type,
                "test_count": test_count + 1,
                "max_tests": _HALF_OPEN_MAX,
            })
        )
        return True, "half_open_test"

    return True, "circuit_closed"


def _get_opened_at(task_type: str) -> Optional[str]:
    """Get the ISO timestamp when the circuit was opened."""
    client = _get_redis()
    if not client:
        return None
    try:
        return client.get(_opened_at_key(task_type))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Recording outcomes
# ---------------------------------------------------------------------------


def record_failure(task_type: str) -> dict[str, Any]:
    """Record a task failure and potentially open the circuit.

    Args:
        task_type: The Celery task name.

    Returns:
        A dict with keys ``state``, ``failure_count``, ``threshold``.
    """
    client = _get_redis()
    if not client:
        return {"state": CLOSED, "failure_count": 0}

    try:
        # Increment consecutive failure count
        fail_count = client.incr(_fail_count_key(task_type))
        client.expire(_fail_count_key(task_type), _OPEN_SECONDS * 4)

        # If we're in HALF_OPEN and get a failure, go back to OPEN
        current_state = get_state(task_type)
        if current_state == HALF_OPEN:
            set_state(task_type, OPEN)
            client.set(_opened_at_key(task_type), str(time.time()))
            logger.warning(
                json.dumps({
                    "event": "circuit.re_opened",
                    "task_type": task_type,
                    "failure_count": fail_count,
                    "threshold": _THRESHOLD,
                })
            )
            return {"state": OPEN, "failure_count": int(fail_count), "threshold": _THRESHOLD}

        # If consecutive failures exceed threshold, open the circuit
        if fail_count >= _THRESHOLD and current_state == CLOSED:
            set_state(task_type, OPEN)
            client.set(_opened_at_key(task_type), str(time.time()))
            logger.warning(
                json.dumps({
                    "event": "circuit.opened",
                    "task_type": task_type,
                    "failure_count": fail_count,
                    "threshold": _THRESHOLD,
                    "pause_duration_s": _OPEN_SECONDS,
                })
            )

        return {
            "state": OPEN if int(fail_count) >= _THRESHOLD else CLOSED,
            "failure_count": int(fail_count),
            "threshold": _THRESHOLD,
        }

    except Exception as exc:
        logger.error("Failed to record failure for %s - %s", task_type, exc)
        return {"state": CLOSED, "failure_count": 0}


def record_success(task_type: str) -> dict[str, Any]:
    """Record a task success and potentially close the circuit.

    Args:
        task_type: The Celery task name.

    Returns:
        A dict with the new state.
    """
    client = _get_redis()
    if not client:
        return {"state": CLOSED}

    try:
        # Reset failure count
        client.delete(_fail_count_key(task_type))

        current_state = get_state(task_type)

        if current_state == HALF_OPEN:
            # Success in half-open means circuit closes
            set_state(task_type, CLOSED)
            client.delete(_opened_at_key(task_type))
            client.delete(_half_open_at_key(task_type))
            _reset_half_open_test_count(task_type)
            logger.info(
                json.dumps({
                    "event": "circuit.closed",
                    "task_type": task_type,
                })
            )
            return {"state": CLOSED}

        elif current_state == OPEN:
            # Success while open is unusual but possible if auto-recovered
            # Keep the circuit open until the timeout expires
            pass

        return {"state": current_state}

    except Exception as exc:
        logger.error("Failed to record success for %s - %s", task_type, exc)
        return {"state": CLOSED}


# ---------------------------------------------------------------------------
# Half-open test tracking (via Redis)
# ---------------------------------------------------------------------------


def _half_open_test_key(task_type: str) -> str:
    return _REDIS_PREFIX + task_type + ":half_open_tests"


def _get_half_open_test_count(task_type: str) -> int:
    client = _get_redis()
    if not client:
        return 0
    try:
        val = client.get(_half_open_test_key(task_type))
        return int(val) if val else 0
    except (ValueError, TypeError, Exception):
        return 0


def _increment_half_open_test_count(task_type: str) -> int:
    client = _get_redis()
    if not client:
        return 0
    try:
        count = client.incr(_half_open_test_key(task_type))
        client.expire(_half_open_test_key(task_type), _OPEN_SECONDS + 10)
        return int(count)
    except Exception:
        return 0


def _reset_half_open_test_count(task_type: str) -> None:
    client = _get_redis()
    if not client:
        return
    try:
        client.delete(_half_open_test_key(task_type))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Diagnostic / admin
# ---------------------------------------------------------------------------


def get_all_circuits() -> dict[str, dict[str, Any]]:
    """Get the state of all tracked circuit breakers.

    Returns:
        Dict mapping task type -> state info.
    """
    client = _get_redis()
    if not client:
        return {}

    circuits: dict[str, dict[str, Any]] = {}
    try:
        cursor = 0
        while True:
            cursor, keys = client.scan(cursor, match=_REDIS_PREFIX + "*:state")
            for key in keys:
                task_type = key[len(_REDIS_PREFIX):-6]  # strip prefix and ":state"
                state = client.get(key)
                fail_count_raw = client.get(_fail_count_key(task_type))
                opened_at = client.get(_opened_at_key(task_type))
                half_open_at = client.get(_half_open_at_key(task_type))

                info: dict[str, Any] = {
                    "state": state or CLOSED,
                    "failure_count": int(fail_count_raw) if fail_count_raw else 0,
                    "threshold": _THRESHOLD,
                }
                if opened_at:
                    info["opened_at"] = opened_at
                if half_open_at:
                    info["half_open_at"] = half_open_at
                circuits[task_type] = info
            if cursor == 0:
                break
    except Exception as exc:
        logger.error("Failed to list circuits - %s", exc)

    return circuits


def reset_circuit(task_type: str) -> bool:
    """Manually reset a circuit breaker to CLOSED."""
    client = _get_redis()
    if not client:
        return False
    try:
        keys_to_delete = [
            _state_key(task_type),
            _fail_count_key(task_type),
            _opened_at_key(task_type),
            _half_open_at_key(task_type),
            _half_open_test_key(task_type),
        ]
        client.delete(*keys_to_delete)
        logger.info(
            json.dumps({
                "event": "circuit.manual_reset",
                "task_type": task_type,
            })
        )
        return True
    except Exception as exc:
        logger.error("Failed to reset circuit for %s - %s", task_type, exc)
        return False
