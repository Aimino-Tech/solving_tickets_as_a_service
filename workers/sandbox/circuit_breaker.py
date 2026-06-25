"""
Circuit breaker for sandbox providers -- wraps pybreaker with per-provider state.

When a provider fails *fail_max* times within a rolling *reset_timeout* window
the circuit opens and ``call_or_fallback`` routes to the next provider in the
chain instead. After *reset_timeout* seconds the circuit transitions to
half-open -- one probe call decides whether to close again or stay open.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, TypeVar

import pybreaker

logger = logging.getLogger(__name__)

CircuitBreakerError = pybreaker.CircuitBreakerError
STATE_CLOSED = pybreaker.STATE_CLOSED
STATE_OPEN = pybreaker.STATE_OPEN
STATE_HALF_OPEN = pybreaker.STATE_HALF_OPEN

T = TypeVar("T")

DEFAULT_FAIL_MAX = 3
DEFAULT_RESET_TIMEOUT = 300
DEFAULT_SUCCESS_THRESHOLD = 1


class SandboxCircuitListener(pybreaker.CircuitBreakerListener):
    """Log state transitions so we can trace provider health over time."""

    def state_change(
        self,
        cb: pybreaker.CircuitBreaker,
        old_state: Any,
        new_state: Any,
    ) -> None:
        old_name = old_state.__class__.__name__ if old_state else "None"
        new_name = new_state.__class__.__name__
        logger.info(
            "Circuit breaker '%s': %s -> %s",
            cb.name or "unnamed",
            old_name,
            new_name,
        )

    def failure(self, cb: pybreaker.CircuitBreaker, exc: BaseException) -> None:
        logger.warning(
            "Circuit breaker '%s' recorded failure: %s",
            cb.name or "unnamed",
            exc,
        )

    def success(self, cb: pybreaker.CircuitBreaker) -> None:
        logger.debug(
            "Circuit breaker '%s' recorded success",
            cb.name or "unnamed",
        )


class BreakerRegistry:
    """Holds a circuit breaker per named provider.

    Lazily creates breakers on first access so that configuration can be
    loaded after import time.
    """

    def __init__(
        self,
        fail_max: int = DEFAULT_FAIL_MAX,
        reset_timeout: float = DEFAULT_RESET_TIMEOUT,
        success_threshold: int = DEFAULT_SUCCESS_THRESHOLD,
    ) -> None:
        self._fail_max = fail_max
        self._reset_timeout = reset_timeout
        self._success_threshold = success_threshold
        self._breakers: dict[str, pybreaker.CircuitBreaker] = {}

    def get(self, provider_name: str) -> pybreaker.CircuitBreaker:
        """Return (creating if necessary) the breaker for *provider_name*."""
        if provider_name not in self._breakers:
            self._breakers[provider_name] = pybreaker.CircuitBreaker(
                fail_max=self._fail_max,
                reset_timeout=self._reset_timeout,
                success_threshold=self._success_threshold,
                name=f"sandbox:{provider_name}",
                listeners=[SandboxCircuitListener()],
            )
        return self._breakers[provider_name]

    def state_of(self, provider_name: str) -> str:
        """Return the current state name for *provider_name*'s breaker."""
        breaker = self.get(provider_name)
        return breaker.state.__class__.__name__

    def reset(self, provider_name: str | None = None) -> None:
        """Force-close a breaker (or all breakers when None)."""
        if provider_name:
            if provider_name in self._breakers:
                self._breakers[provider_name].close()
        else:
            for brk in self._breakers.values():
                brk.close()

    @property
    def all_states(self) -> dict[str, str]:
        return {
            name: brk.state.__class__.__name__
            for name, brk in self._breakers.items()
        }

    @property
    def fail_max(self) -> int:
        return self._fail_max

    @property
    def reset_timeout(self) -> float:
        return self._reset_timeout


_global_registry: BreakerRegistry | None = None


def get_breaker_registry(
    fail_max: int = DEFAULT_FAIL_MAX,
    reset_timeout: float = DEFAULT_RESET_TIMEOUT,
) -> BreakerRegistry:
    """Return (creating if necessary) the global breaker registry singleton."""
    global _global_registry
    if _global_registry is None:
        _global_registry = BreakerRegistry(
            fail_max=fail_max,
            reset_timeout=reset_timeout,
        )
    return _global_registry


def call_or_fallback(
    func: Callable[..., T],
    provider_name: str,
    *args: Any,
    fallback: Callable[..., T] | None = None,
    registry: BreakerRegistry | None = None,
    **kwargs: Any,
) -> T:
    """Call *func* under the circuit breaker for *provider_name*.

    If the circuit is open or *func* raises an exception the *fallback* is
    called instead (if one was given).  When no fallback is provided the
    original exception propagates.
    """
    reg = registry or get_breaker_registry()
    breaker = reg.get(provider_name)

    try:
        return breaker.call(func, *args, **kwargs)
    except pybreaker.CircuitBreakerError as exc:
        logger.warning(
            "Circuit breaker '%s' is OPEN -- %s",
            provider_name,
            "calling fallback" if fallback else "raising",
        )
        if fallback:
            return fallback(*args, **kwargs)
        raise
    except Exception as exc:
        logger.warning(
            "Circuit breaker '%s' caught failure -- %s",
            provider_name,
            exc,
        )
        if fallback:
            return fallback(*args, **kwargs)
        raise
