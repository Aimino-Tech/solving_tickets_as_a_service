"""Tests for multi-backend dispatch with retry route graph."""
from __future__ import annotations

import time
from unittest.mock import MagicMock

import pytest

from workers.dispatch.multi_backend import (
    BackendRoute,
    BackendStatus,
    MaxRetryExhausted,
    RetryRouteGraph,
    get_default_graph,
    reset_default_graph,
)


# ===========================================================================
# BackendRoute
# ===========================================================================


class TestBackendRoute:
    def test_defaults(self) -> None:
        route = BackendRoute(name="opencode")
        assert route.name == "opencode"
        assert route.max_retries == 3
        assert route.retry_delay == 1.0
        assert route.status == BackendStatus.HEALTHY
        assert route.failure_count == 0
        assert route.circuit_threshold == 5
        assert route.circuit_reset_timeout == 30.0
        assert route.last_failure_time == 0.0

    def test_custom_values(self) -> None:
        route = BackendRoute(
            name="linear",
            max_retries=1,
            retry_delay=0.5,
            circuit_threshold=3,
            circuit_reset_timeout=15.0,
        )
        assert route.name == "linear"
        assert route.max_retries == 1
        assert route.retry_delay == 0.5
        assert route.circuit_threshold == 3
        assert route.circuit_reset_timeout == 15.0

    def test_is_circuit_open_true(self) -> None:
        route = BackendRoute(name="test")
        route.status = BackendStatus.CIRCUIT_OPEN
        assert route.is_circuit_open is True
        assert route.is_healthy is False

    def test_is_circuit_open_false_when_healthy(self) -> None:
        route = BackendRoute(name="test")
        assert route.is_circuit_open is False
        assert route.is_healthy is True

    def test_is_circuit_open_false_when_degraded(self) -> None:
        route = BackendRoute(name="test")
        route.status = BackendStatus.DEGRADED
        assert route.is_circuit_open is False
        assert route.is_healthy is False

    def test_reset_circuit(self) -> None:
        route = BackendRoute(name="test")
        route.status = BackendStatus.CIRCUIT_OPEN
        route.failure_count = 5
        route.last_failure_time = 12345.0
        route.reset_circuit()
        assert route.is_healthy is True
        assert route.failure_count == 0
        assert route.last_failure_time == 0.0


# ===========================================================================
# RetryRouteGraph — mutations
# ===========================================================================


class TestRetryRouteGraphConstruction:
    def test_empty_graph(self) -> None:
        graph = RetryRouteGraph()
        assert graph.empty is True
        assert graph.routes == []

    def test_add_route(self) -> None:
        graph = RetryRouteGraph()
        route = BackendRoute(name="opencode")
        graph.add_route(route)
        assert graph.empty is False
        assert len(graph.routes) == 1
        assert graph.routes[0].name == "opencode"

    def test_add_backend(self) -> None:
        graph = RetryRouteGraph()
        returned = graph.add_backend("linear", max_retries=2)
        assert isinstance(returned, BackendRoute)
        assert returned.name == "linear"
        assert returned.max_retries == 2
        assert len(graph.routes) == 1

    def test_add_multiple_routes(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("opencode")
        graph.add_backend("linear")
        graph.add_backend("github")
        assert [r.name for r in graph.routes] == ["opencode", "linear", "github"]

    def test_insert_route(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("a")
        graph.add_backend("c")
        route_b = BackendRoute(name="b")
        graph.insert_route(1, route_b)
        assert [r.name for r in graph.routes] == ["a", "b", "c"]

    def test_remove_route_exists(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("a")
        graph.add_backend("b")
        assert graph.remove_route("a") is True
        assert [r.name for r in graph.routes] == ["b"]

    def test_remove_route_not_found(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("a")
        assert graph.remove_route("nonexistent") is False

    def test_clear(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("opencode")
        graph.add_backend("linear")
        graph.clear()
        assert graph.empty is True

    def test_get_route_found(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("opencode", max_retries=2)
        r = graph.get_route("opencode")
        assert r is not None
        assert r.max_retries == 2

    def test_get_route_not_found(self) -> None:
        graph = RetryRouteGraph()
        assert graph.get_route("nonexistent") is None

    def test_healthy_routes(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("healthy1")
        r2 = graph.add_backend("open")
        r2.status = BackendStatus.CIRCUIT_OPEN
        graph.add_backend("healthy2")
        assert [r.name for r in graph.healthy_routes] == ["healthy1", "healthy2"]


# ===========================================================================
# RetryRouteGraph — dispatch
# ===========================================================================


class TestRetryRouteGraphDispatch:
    def test_dispatch_succeeds_first_route_first_attempt(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("opencode", max_retries=2)

        fn = MagicMock(return_value="ok")
        result = graph.dispatch(fn, "arg1", key="val")
        assert result == "ok"
        fn.assert_called_once_with("arg1", key="val")

    def test_dispatch_retry_then_succeed(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("opencode", max_retries=2, retry_delay=0.01)

        fn = MagicMock(
            side_effect=[ConnectionError("fail"), ConnectionError("fail"), "ok"]
        )
        result = graph.dispatch(fn)
        assert result == "ok"
        assert fn.call_count == 3

    def test_dispatch_retry_exhausted_falls_to_next_backend(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("opencode", max_retries=1, retry_delay=0.01)
        graph.add_backend("linear", max_retries=0, retry_delay=0.01)

        fn = MagicMock(
            side_effect=[ConnectionError("fail"), ConnectionError("fail"), "ok"]
        )
        result = graph.dispatch(fn)
        assert result == "ok"
        # 2 attempts on opencode (initial + 1 retry) = 2 calls
        # 1 attempt on linear = 1 call
        assert fn.call_count == 3

    def test_dispatch_exhausts_all_backends(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("opencode", max_retries=0, retry_delay=0.01)
        graph.add_backend("linear", max_retries=0, retry_delay=0.01)

        fn = MagicMock(side_effect=RuntimeError("boom"))

        with pytest.raises(MaxRetryExhausted) as exc_info:
            graph.dispatch(fn)

        assert "All 2 backend route(s) exhausted" in str(exc_info.value)
        assert exc_info.value.last_exception is not None
        assert isinstance(exc_info.value.last_exception, RuntimeError)
        assert fn.call_count == 2

    def test_dispatch_skips_circuit_open_route(self) -> None:
        graph = RetryRouteGraph()
        graph.add_backend("broken", max_retries=0, retry_delay=0.01)
        graph.add_backend("okay", max_retries=0, retry_delay=0.01)

        # Mark first route as circuit-open
        broken = graph.get_route("broken")
        assert broken is not None
        broken.status = BackendStatus.CIRCUIT_OPEN
        broken.last_failure_time = time.time()
        broken.circuit_reset_timeout = 3600  # not expiring soon

        fn = MagicMock(return_value="success")
        result = graph.dispatch(fn)
        assert result == "success"
        # Should only call fn once (on "okay" route)
        assert fn.call_count == 1

    def test_dispatch_uses_route_specific_dispatch_fn(self) -> None:
        graph = RetryRouteGraph()

        def route_fn(*args, **kwargs):
            return "from-route-fn"

        route = BackendRoute(name="custom", dispatch_fn=route_fn, max_retries=0)
        graph.add_route(route)

        task_fn = MagicMock()
        result = graph.dispatch(task_fn)
        assert result == "from-route-fn"
        task_fn.assert_not_called()

    def test_dispatch_empty_graph_raises(self) -> None:
        graph = RetryRouteGraph()
        fn = MagicMock()
        with pytest.raises(MaxRetryExhausted) as exc_info:
            graph.dispatch(fn)
        assert "0 backend route(s)" in str(exc_info.value)
        fn.assert_not_called()

    def test_dispatch_resets_route_on_success(self) -> None:
        graph = RetryRouteGraph()
        route = graph.add_backend("opencode", max_retries=0, retry_delay=0.01)

        # Mark as degraded first
        route.status = BackendStatus.DEGRADED
        route.failure_count = 3

        fn = MagicMock(return_value="ok")
        graph.dispatch(fn)

        # Should have been reset to healthy
        assert route.is_healthy is True
        assert route.failure_count == 0

    def test_dispatch_marks_route_as_failed_on_exhaustion(self) -> None:
        graph = RetryRouteGraph()
        route = graph.add_backend("opencode", max_retries=0, retry_delay=0.01)

        fn = MagicMock(side_effect=RuntimeError("boom"))

        with pytest.raises(MaxRetryExhausted):
            graph.dispatch(fn)

        assert route.is_circuit_open is False  # 1 failure < threshold=5
        assert route.status == BackendStatus.DEGRADED
        assert route.failure_count == 1
        assert route.last_failure_time > 0

    def test_circuit_opens_after_threshold(self) -> None:
        graph = RetryRouteGraph()
        route = graph.add_backend(
            "opencode",
            max_retries=0,
            retry_delay=0.01,
            circuit_threshold=2,
        )

        fn = MagicMock(side_effect=RuntimeError("boom"))

        # First exhaustion -> DEGRADED
        with pytest.raises(MaxRetryExhausted):
            graph.dispatch(fn)
        assert route.status == BackendStatus.DEGRADED
        assert route.failure_count == 1

        # Second exhaustion -> CIRCUIT_OPEN
        with pytest.raises(MaxRetryExhausted):
            graph.dispatch(fn)
        assert route.is_circuit_open is True
        assert route.failure_count == 2

    def test_circuit_resets_after_timeout(self) -> None:
        graph = RetryRouteGraph()
        route = graph.add_backend(
            "opencode",
            max_retries=0,
            retry_delay=0.01,
            circuit_threshold=2,
        )

        fn = MagicMock(side_effect=RuntimeError("boom"))

        # Trigger circuit open
        with pytest.raises(MaxRetryExhausted):
            graph.dispatch(fn)
        with pytest.raises(MaxRetryExhausted):
            graph.dispatch(fn)
        assert route.is_circuit_open is True

        # Simulate timeout elapsed
        route.last_failure_time = 0
        route.circuit_reset_timeout = 0

        # Now it should be half-open (DEGRADED)
        ok = graph._check_circuit(route)
        assert ok is True
        assert route.status == BackendStatus.DEGRADED

    def test_reset_all_circuits(self) -> None:
        graph = RetryRouteGraph()
        r1 = graph.add_backend("a")
        r2 = graph.add_backend("b")
        r1.status = BackendStatus.CIRCUIT_OPEN
        r1.failure_count = 5
        r2.status = BackendStatus.DEGRADED
        r2.failure_count = 3

        graph.reset_all_circuits()
        assert r1.is_healthy is True
        assert r1.failure_count == 0
        assert r2.is_healthy is True
        assert r2.failure_count == 0


# ===========================================================================
# Singleton
# ===========================================================================


class TestDefaultGraph:
    def test_get_default_graph_returns_graph(self) -> None:
        reset_default_graph()
        graph = get_default_graph()
        assert isinstance(graph, RetryRouteGraph)
        assert [r.name for r in graph.routes] == ["opencode", "linear", "github"]

    def test_get_default_graph_is_singleton(self) -> None:
        reset_default_graph()
        g1 = get_default_graph()
        g2 = get_default_graph()
        assert g1 is g2

    def test_reset_default_graph(self) -> None:
        reset_default_graph()
        g1 = get_default_graph()
        reset_default_graph()
        g2 = get_default_graph()
        assert g1 is not g2


# ===========================================================================
# Integration-style
# ===========================================================================


class TestIntegration:
    def test_full_lifecycle_ok(self) -> None:
        """Successful dispatch through default graph."""
        reset_default_graph()
        graph = get_default_graph()
        # Reduce retries for speed
        for r in graph.routes:
            r.max_retries = 0
            r.retry_delay = 0.0

        fn = MagicMock(return_value="done")
        result = graph.dispatch(fn)
        assert result == "done"
        fn.assert_called_once()

    def test_full_lifecycle_fallback(self) -> None:
        """First route fails, second route succeeds."""
        reset_default_graph()
        graph = get_default_graph()
        for r in graph.routes:
            r.max_retries = 0
            r.retry_delay = 0.0

        call_count = 0

        def flaky_fn(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 1:
                raise ConnectionError("first route fails")
            return "recovered"

        result = graph.dispatch(flaky_fn)
        assert result == "recovered"
        assert call_count == 2

    def test_default_graph_used_after_reset(self) -> None:
        reset_default_graph()
        g = get_default_graph()
        fn = MagicMock(return_value="ok")
        g.dispatch(fn)
        assert fn.called
