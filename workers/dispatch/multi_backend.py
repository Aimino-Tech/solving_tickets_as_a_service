"""
Multi-backend dispatch with retry route graph.

Defines a directed acyclic graph of backend routes for dispatching tasks
across multiple backends (e.g., OpenCode, Linear, GitHub).  Each route
has retry configuration with exponential backoff.  When a route exhausts
its retries, the graph falls through to the next route automatically.

The ``RetryRouteGraph`` also implements per-route circuit-breaker logic:
after ``circuit_threshold`` consecutive failures the route is skipped
until a ``circuit_reset_timeout`` elapses.

Route graph topology (default)::

    primary (opencode) ──retry N──→ secondary (linear) ──retry N──→ fallback (github)
        │                                  │                             │
        └── circuit open? skip ────────────┴── circuit open? skip ───────┘
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration  (all from environment with sensible defaults)
# ---------------------------------------------------------------------------

DEFAULT_MAX_RETRIES = int(os.getenv("MULTI_BACKEND_MAX_RETRIES", "3"))
DEFAULT_RETRY_DELAY = float(os.getenv("MULTI_BACKEND_RETRY_DELAY", "1.0"))
DEFAULT_CIRCUIT_THRESHOLD = int(os.getenv("MULTI_BACKEND_CIRCUIT_THRESHOLD", "5"))
DEFAULT_CIRCUIT_RESET_TIMEOUT = float(
    os.getenv("MULTI_BACKEND_CIRCUIT_RESET", "30.0")
)


# ---------------------------------------------------------------------------
# Enums & Data classes
# ---------------------------------------------------------------------------


class BackendStatus(Enum):
    """Health status of a backend route."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    CIRCUIT_OPEN = "circuit_open"


@dataclass
class BackendRoute:
    """A single backend route in the dispatch graph.

    Parameters
    ----------
    name:
        Human-readable backend identifier (e.g. ``"opencode"``).
    max_retries:
        How many times to retry **after** the initial attempt (so total
        attempts = ``max_retries + 1``).
    retry_delay:
        Base delay in seconds before the first retry.  Each subsequent
        retry doubles the delay (exponential backoff).
    dispatch_fn:
        Optional callable that implements the actual dispatch.  If
        omitted, the graph's ``dispatch()`` method passes its own
        ``task_callable`` argument instead.
    status:
        Current circuit-breaker health status.
    failure_count:
        Running count of consecutive failures since last success.
    circuit_threshold:
        Consecutive failures before the circuit opens.
    circuit_reset_timeout:
        Seconds to wait before trying a circuit-open backend again.
    last_failure_time:
        Unix timestamp of the most recent failure.
    """

    name: str
    max_retries: int = DEFAULT_MAX_RETRIES
    retry_delay: float = DEFAULT_RETRY_DELAY
    dispatch_fn: Optional[Callable] = None
    status: BackendStatus = BackendStatus.HEALTHY
    failure_count: int = 0
    circuit_threshold: int = DEFAULT_CIRCUIT_THRESHOLD
    circuit_reset_timeout: float = DEFAULT_CIRCUIT_RESET_TIMEOUT
    last_failure_time: float = 0.0

    @property
    def is_circuit_open(self) -> bool:
        return self.status == BackendStatus.CIRCUIT_OPEN

    @property
    def is_healthy(self) -> bool:
        return self.status == BackendStatus.HEALTHY

    def reset_circuit(self) -> None:
        self.status = BackendStatus.HEALTHY
        self.failure_count = 0
        self.last_failure_time = 0.0


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------


class MaxRetryExhausted(Exception):
    """All backend routes and retries have been exhausted."""

    def __init__(self, message: str, last_exception: Optional[Exception] = None):
        super().__init__(message)
        self.last_exception = last_exception


# ---------------------------------------------------------------------------
# Route graph
# ---------------------------------------------------------------------------


class RetryRouteGraph:
    """Directed acyclic graph of backend routes with retry + circuit-breaker.

    Thread-safe for concurrent reads/writes via an internal lock.

    Usage::

        graph = RetryRouteGraph()
        graph.add_backend("opencode", max_retries=2)
        graph.add_backend("linear", max_retries=1)
        graph.add_backend("github", max_retries=0)

        def my_dispatch(issue_id: str) -> str:
            ...  # actual dispatch logic

        result = graph.dispatch(my_dispatch, issue_id="GH-42")
    """

    def __init__(self) -> None:
        self._routes: list[BackendRoute] = []
        self._lock = threading.RLock()

    # ---- Graph mutation ---------------------------------------------------

    def add_route(self, route: BackendRoute) -> BackendRoute:
        """Append a pre-built ``BackendRoute`` to the end of the graph."""
        with self._lock:
            self._routes.append(route)
        return route

    def add_backend(self, name: str, **kwargs: Any) -> BackendRoute:
        """Create a ``BackendRoute`` from keyword args and append it."""
        route = BackendRoute(name=name, **kwargs)
        return self.add_route(route)

    def insert_route(self, index: int, route: BackendRoute) -> BackendRoute:
        """Insert a route at a specific position in the graph."""
        with self._lock:
            self._routes.insert(index, route)
        return route

    def remove_route(self, name: str) -> bool:
        """Remove the first route whose name matches *name*."""
        with self._lock:
            for i, r in enumerate(self._routes):
                if r.name == name:
                    del self._routes[i]
                    return True
        return False

    # ---- Query ------------------------------------------------------------

    @property
    def routes(self) -> list[BackendRoute]:
        """Return a shallow copy of the route list."""
        with self._lock:
            return list(self._routes)

    def get_route(self, name: str) -> Optional[BackendRoute]:
        """Look up a route by name."""
        with self._lock:
            for r in self._routes:
                if r.name == name:
                    return r
        return None

    @property
    def empty(self) -> bool:
        return len(self._routes) == 0

    @property
    def healthy_routes(self) -> list[BackendRoute]:
        return [r for r in self.routes if not r.is_circuit_open]

    # ---- Circuit breaker internals ----------------------------------------

    def _check_circuit(self, route: BackendRoute) -> bool:
        """Return ``True`` if the route can accept traffic.

        If the circuit is open but the reset timeout has elapsed, the
        circuit transitions to ``DEGRADED`` (half-open) and returns
        ``True`` so the next dispatch tests the waters.
        """
        if not route.is_circuit_open:
            return True

        elapsed = time.time() - route.last_failure_time
        if elapsed >= route.circuit_reset_timeout:
            logger.info(
                "Circuit half-open backend=%s after %.1fs",
                route.name,
                elapsed,
            )
            route.status = BackendStatus.DEGRADED
            route.failure_count = 0
            return True

        return False

    def _mark_failure(self, route: BackendRoute) -> None:
        route.failure_count += 1
        route.last_failure_time = time.time()
        if route.failure_count >= route.circuit_threshold:
            route.status = BackendStatus.CIRCUIT_OPEN
            logger.warning(
                "Circuit opened backend=%s after %d failures",
                route.name,
                route.failure_count,
            )
        else:
            route.status = BackendStatus.DEGRADED

    def _mark_success(self, route: BackendRoute) -> None:
        route.failure_count = 0
        route.status = BackendStatus.HEALTHY

    # ---- Core dispatch ---------------------------------------------------

    def dispatch(
        self,
        task_callable: Callable,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Dispatch *task_callable* through the route graph.

        For each route in order:

        1. If the circuit is open and the reset timeout has **not**
           elapsed, skip the route entirely.
        2. Try the callable up to ``max_retries + 1`` times (the initial
           attempt plus retries).
        3. Between retries, sleep with exponential backoff:
           ``retry_delay * 2 ** attempt``.
        4. On success, reset the circuit to healthy.
        5. On exhaustion, mark the route as failed and fall through to
           the next route.

        Returns
        -------
        The first successful result from any route.

        Raises
        ------
        MaxRetryExhausted
            When every route has been tried and every retry exhausted.
        """
        last_exception: Optional[Exception] = None

        for route in self._routes:
            if not self._check_circuit(route):
                logger.info("Skipping route=%s circuit open", route.name)
                continue

            fn = route.dispatch_fn or task_callable
            total_attempts = route.max_retries + 1  # initial + retries

            for attempt in range(total_attempts):
                try:
                    result = fn(*args, **kwargs)
                    self._mark_success(route)
                    logger.info(
                        "Dispatch ok route=%s attempt=%d/%d",
                        route.name,
                        attempt + 1,
                        total_attempts,
                    )
                    return result
                except Exception as exc:
                    last_exception = exc
                    logger.warning(
                        "Dispatch fail route=%s attempt=%d/%d error=%s",
                        route.name,
                        attempt + 1,
                        total_attempts,
                        exc,
                    )

                    if attempt < route.max_retries:
                        delay = route.retry_delay * (2**attempt)
                        logger.debug("Retrying route=%s in %.2fs", route.name, delay)
                        time.sleep(delay)

            self._mark_failure(route)

        raise MaxRetryExhausted(
            f"All {len(self._routes)} backend route(s) exhausted: "
            f"{last_exception or 'no routes configured'}",
            last_exception=last_exception,
        )

    def reset_all_circuits(self) -> None:
        """Reset every route to healthy (useful after a config change)."""
        with self._lock:
            for r in self._routes:
                r.reset_circuit()

    def clear(self) -> None:
        """Remove all routes."""
        with self._lock:
            self._routes.clear()


# ---------------------------------------------------------------------------
# Singleton default graph
# ---------------------------------------------------------------------------

_DEFAULT_GRAPH: Optional[RetryRouteGraph] = None


def get_default_graph() -> RetryRouteGraph:
    """Return the process-wide singleton ``RetryRouteGraph``.

    The default graph is lazily initialised with three backends:
    ``opencode`` → ``linear`` → ``github``.
    """
    global _DEFAULT_GRAPH
    if _DEFAULT_GRAPH is None:
        _DEFAULT_GRAPH = _build_default_graph()
    return _DEFAULT_GRAPH


def _build_default_graph() -> RetryRouteGraph:
    graph = RetryRouteGraph()
    graph.add_backend("opencode")
    graph.add_backend("linear")
    graph.add_backend("github")
    return graph


def reset_default_graph() -> None:
    """Drop the singleton so the next ``get_default_graph()`` call rebuilds."""
    global _DEFAULT_GRAPH
    _DEFAULT_GRAPH = None
