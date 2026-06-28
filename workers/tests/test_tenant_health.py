"""Comprehensive tests for per-tenant health monitoring.

Covers:
    workers.monitoring.tenant_health — TenantHealthMetrics, TenantSnapshot
    Health status recording and retrieval
    Request/error/retry/rate-limit tracking
    Active task, queue depth, concurrent sessions
    Duration recording and percentile computation
    Uptime and last-seen tracking
    Tenant registration and unregistration
    Snapshot generation
    Module-level singleton
    Prometheus text exposition format (render_all)

NOTE: Each test uses a unique tenant_id to avoid pollution from the
module-level global metric store shared across all tests.
"""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from workers.monitoring.tenant_health import (
    TenantHealthMetrics,
    TenantSnapshot,
    get_tenant_health_metrics,
)

_counter = 0


def _unique_id(prefix: str = "t") -> str:
    """Return a unique tenant_id per call to avoid test pollution."""
    global _counter  # noqa: PLW0603
    _counter += 1
    return f"{prefix}-{_counter:04d}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def metrics() -> TenantHealthMetrics:
    """Return a fresh TenantHealthMetrics instance with no pre-registered tenants."""
    return TenantHealthMetrics()


@pytest.fixture
def pre_registered_metrics() -> TenantHealthMetrics:
    """Return a TenantHealthMetrics with three pre-registered tenants."""
    m = TenantHealthMetrics(tenant_ids=["pre-alpha", "pre-beta", "pre-gamma"])
    return m


# ---------------------------------------------------------------------------
# Health Status
# ---------------------------------------------------------------------------


class TestHealthStatus:
    def test_record_healthy(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_health(tid, "healthy")
        assert metrics.get_health(tid) == "healthy"

    def test_record_degraded(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_health(tid, "degraded")
        assert metrics.get_health(tid) == "degraded"

    def test_record_down(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_health(tid, "down")
        assert metrics.get_health(tid) == "down"

    def test_unknown_tenant_returns_none(self, metrics: TenantHealthMetrics) -> None:
        assert metrics.get_health("nonexistent-999") is None

    def test_status_transition(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_health(tid, "healthy")
        assert metrics.get_health(tid) == "healthy"
        metrics.record_health(tid, "degraded")
        assert metrics.get_health(tid) == "degraded"
        metrics.record_health(tid, "down")
        assert metrics.get_health(tid) == "down"
        metrics.record_health(tid, "healthy")
        assert metrics.get_health(tid) == "healthy"

    def test_multiple_tenants_independent(self, metrics: TenantHealthMetrics) -> None:
        a, b = _unique_id("a"), _unique_id("b")
        metrics.record_health(a, "healthy")
        metrics.record_health(b, "down")
        assert metrics.get_health(a) == "healthy"
        assert metrics.get_health(b) == "down"

    def test_invalid_status_defaults_to_degraded(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_health(tid, "unknown")
        assert metrics.get_health(tid) == "degraded"


# ---------------------------------------------------------------------------
# Request Tracking
# ---------------------------------------------------------------------------


class TestRequestTracking:
    def test_record_successful_request(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_request(tid, "fix_issue", succeeded=True)
        snap = metrics.snapshot(tid)
        assert snap.requests_total == 1
        assert snap.success_total == 1
        assert snap.errors_total == 0

    def test_record_failed_request(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_request(tid, "fix_issue", succeeded=False, error_type="TimeoutError")
        snap = metrics.snapshot(tid)
        assert snap.requests_total == 1
        assert snap.errors_total == 1
        assert snap.success_total == 0

    def test_error_without_explicit_type_defaults(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_error(tid, "triage", "ValueError")
        snap = metrics.snapshot(tid)
        assert snap.errors_total == 1
        assert snap.requests_total == 1
        assert snap.success_total == 0

    def test_record_retry(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_retry(tid, "fix_issue")
        snap = metrics.snapshot(tid)
        assert snap.retries_total == 1

    def test_record_rate_limited(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_rate_limited(tid)
        snap = metrics.snapshot(tid)
        assert snap.rate_limited_total == 1

    def test_multiple_task_types_separate_counts(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_request(tid, "fix_issue", succeeded=True)
        metrics.record_request(tid, "triage", succeeded=True)
        metrics.record_request(tid, "fix_issue", succeeded=False, error_type="BuildError")
        snap = metrics.snapshot(tid)
        assert snap.requests_total == 3
        assert snap.success_total == 2
        assert snap.errors_total == 1


# ---------------------------------------------------------------------------
# Active Tasks
# ---------------------------------------------------------------------------


class TestActiveTasks:
    def test_initial_active_tasks_zero(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        snap = metrics.snapshot(tid)
        assert snap.active_tasks == 0

    def test_increment_active_tasks(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_active_task(tid, worker="w1", delta=1)
        # snapshot.active_tasks defaults to worker="default"
        assert metrics.snapshot(tid).active_tasks == 0
        metrics.record_active_task(tid, worker="default", delta=1)
        assert metrics.snapshot(tid).active_tasks == 1

    def test_decrement_active_tasks(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_active_task(tid, worker="default", delta=1)
        metrics.record_active_task(tid, worker="default", delta=-1)
        snap = metrics.snapshot(tid)
        assert snap.active_tasks == 0

    def test_active_tasks_never_negative(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_active_task(tid, worker="default", delta=-5)
        snap = metrics.snapshot(tid)
        assert snap.active_tasks >= 0

    def test_different_workers_independent(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_active_task(tid, worker="w1", delta=3)
        metrics.record_active_task(tid, worker="w2", delta=2)
        assert metrics.snapshot(tid).active_tasks == 0

    def test_worker_specific_snapshot_in_active_tasks(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_active_task(tid, worker="worker-1", delta=5)
        metrics.record_active_task(tid, worker="default", delta=2)
        snap = metrics.snapshot(tid)
        assert snap.active_tasks == 2


# ---------------------------------------------------------------------------
# Queue Depth
# ---------------------------------------------------------------------------


class TestQueueDepth:
    def test_initial_queue_depth_zero(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        snap = metrics.snapshot(tid)
        assert snap.queue_depth == 0

    def test_set_queue_depth(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_queue_depth(tid, 42)
        snap = metrics.snapshot(tid)
        assert snap.queue_depth == 42

    def test_update_queue_depth(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_queue_depth(tid, 10)
        metrics.record_queue_depth(tid, 5)
        snap = metrics.snapshot(tid)
        assert snap.queue_depth == 5

    def test_multiple_tenants_queue_depth(self, metrics: TenantHealthMetrics) -> None:
        a, b = _unique_id("a"), _unique_id("b")
        metrics.record_queue_depth(a, 100)
        metrics.record_queue_depth(b, 200)
        assert metrics.snapshot(a).queue_depth == 100
        assert metrics.snapshot(b).queue_depth == 200


# ---------------------------------------------------------------------------
# Concurrent Sessions and Rate Limit
# ---------------------------------------------------------------------------


class TestConcurrentSessions:
    def test_record_concurrent_sessions(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_concurrent_sessions(tid, 5)
        snap = metrics.snapshot(tid)
        assert snap is not None


class TestRateLimitRemaining:
    def test_record_rate_limit_remaining(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_rate_limit_remaining(tid, 42)
        snap = metrics.snapshot(tid)
        assert snap is not None


# ---------------------------------------------------------------------------
# Duration Tracking
# ---------------------------------------------------------------------------


class TestDurationTracking:
    def test_duration_recorded(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_request(tid, "fix_issue", succeeded=True, duration=1.5)
        snap = metrics.snapshot(tid)
        assert snap.duration_p50 == pytest.approx(1.5, rel=0.1)
        assert snap.duration_p95 == pytest.approx(1.5, rel=0.1)
        assert snap.duration_p99 == pytest.approx(1.5, rel=0.1)

    def test_percentiles_correct(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        durations = [0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0]
        for d in durations:
            metrics.record_request(tid, "fix_issue", succeeded=True, duration=d)
        snap = metrics.snapshot(tid)
        assert snap.duration_p50 == pytest.approx(1.0, rel=0.3)
        assert snap.duration_p95 == pytest.approx(10.0, rel=0.3)
        assert snap.duration_p99 == pytest.approx(10.0, rel=0.3)

    def test_duration_bounded_to_1000_records(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        for i in range(1050):
            metrics.record_request(tid, "fix_issue", succeeded=True, duration=float(i))
        snap = metrics.snapshot(tid)
        assert snap.duration_p50 > 0

    def test_no_duration_returns_zero(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        snap = metrics.snapshot(tid)
        assert snap.duration_p50 == 0.0
        assert snap.duration_p95 == 0.0
        assert snap.duration_p99 == 0.0


# ---------------------------------------------------------------------------
# Uptime and Last Seen
# ---------------------------------------------------------------------------


class TestUptime:
    def test_uptime_increases(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        snap1 = metrics.snapshot(tid)
        assert snap1.uptime_seconds >= 0
        snap2 = metrics.snapshot(tid)
        assert snap2.uptime_seconds >= snap1.uptime_seconds

    def test_uptime_resets_after_unregister(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_health(tid, "healthy")
        snap1 = metrics.snapshot(tid)
        assert snap1.uptime_seconds >= 0
        metrics.unregister_tenant(tid)
        metrics.register_tenant(tid)
        snap2 = metrics.snapshot(tid)
        assert snap2.uptime_seconds < snap1.uptime_seconds + 0.1

    def test_last_seen_updated_on_activity(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        snap1 = metrics.snapshot(tid)
        old_ts = snap1.last_seen_timestamp
        time.sleep(0.01)
        metrics.record_health(tid, "healthy")
        snap2 = metrics.snapshot(tid)
        assert snap2.last_seen_timestamp > old_ts


# ---------------------------------------------------------------------------
# Tenant Registration
# ---------------------------------------------------------------------------


class TestRegistration:
    def test_register_new_tenant_sets_healthy(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.register_tenant(tid)
        assert metrics.get_health(tid) == "healthy"

    def test_register_idempotent(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.register_tenant(tid)
        metrics.register_tenant(tid)
        assert metrics.get_health(tid) == "healthy"

    def test_unregister_removes_tracking(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.register_tenant(tid)
        metrics.record_health(tid, "healthy")
        metrics.unregister_tenant(tid)
        assert metrics.get_health(tid) is None

    def test_unregister_then_reregister(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.register_tenant(tid)
        metrics.record_health(tid, "healthy")
        metrics.unregister_tenant(tid)
        metrics.register_tenant(tid)
        assert metrics.get_health(tid) == "healthy"


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------


class TestSnapshots:
    def test_snapshot_structure(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.register_tenant(tid)
        metrics.record_health(tid, "healthy")
        metrics.record_request(tid, "fix_issue", succeeded=True)
        snap = metrics.snapshot(tid)
        assert isinstance(snap, TenantSnapshot)
        assert snap.tenant_id == tid
        assert snap.status == "healthy"
        assert snap.requests_total >= 1

    def test_snapshot_includes_recent_errors(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.register_tenant(tid)
        metrics.record_error(tid, "fix_issue", "BuildError")
        metrics.record_error(tid, "triage", "TimeoutError")
        snap = metrics.snapshot(tid)
        assert len(snap.recent_errors) == 2
        assert snap.recent_errors[0]["error_type"] == "BuildError"
        assert snap.recent_errors[1]["error_type"] == "TimeoutError"

    def test_all_snapshots(self, pre_registered_metrics: TenantHealthMetrics) -> None:
        snaps = pre_registered_metrics.all_snapshots()
        assert len(snaps) == 3
        tenant_ids = {s.tenant_id for s in snaps}
        assert tenant_ids == {"pre-alpha", "pre-beta", "pre-gamma"}

    def test_snapshot_unknown_tenant_returns_unknown_status(
        self, metrics: TenantHealthMetrics
    ) -> None:
        tid = _unique_id()
        snap = metrics.snapshot(tid)
        assert snap.tenant_id == tid
        assert snap.status == "unknown"


# ---------------------------------------------------------------------------
# Module-Level Singleton
# ---------------------------------------------------------------------------


class TestSingleton:
    def test_get_tenant_health_metrics_returns_same_instance(self) -> None:
        m1 = get_tenant_health_metrics()
        m2 = get_tenant_health_metrics()
        assert m1 is m2

    def test_singleton_is_tenant_health_metrics_instance(self) -> None:
        m = get_tenant_health_metrics()
        assert isinstance(m, TenantHealthMetrics)


# ---------------------------------------------------------------------------
# Prometheus Render (in-memory exposition format)
# ---------------------------------------------------------------------------


class TestRender:
    def test_render_all_returns_string(self, metrics: TenantHealthMetrics) -> None:
        output = TenantHealthMetrics.render_all()
        assert isinstance(output, str)
        assert output.endswith("\n")

    def test_render_all_includes_gauges(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_health(tid, "healthy")
        output = TenantHealthMetrics.render_all()
        assert "# HELP tenant_health_status" in output
        assert "# TYPE tenant_health_status gauge" in output
        assert f"tenant_health_status{{tenant_id={tid}}} 1" in output

    def test_render_all_includes_counters(self, metrics: TenantHealthMetrics) -> None:
        tid = _unique_id()
        metrics.record_request(tid, "fix_issue", succeeded=True)
        output = TenantHealthMetrics.render_all()
        assert "# HELP tenant_requests_total" in output
        assert "# TYPE tenant_requests_total counter" in output
        assert "tenant_requests_total{" in output

    def test_render_all_empty_when_no_metrics(self) -> None:
        output = TenantHealthMetrics.render_all()
        assert isinstance(output, str)

    def test_render_all_multiple_tenants(self, metrics: TenantHealthMetrics) -> None:
        a, b = _unique_id("a"), _unique_id("b")
        metrics.record_health(a, "healthy")
        metrics.record_health(b, "down")
        output = TenantHealthMetrics.render_all()
        assert f"tenant_id={a}" in output
        assert f"tenant_id={b}" in output


# ---------------------------------------------------------------------------
# Pre-registered Tenants
# ---------------------------------------------------------------------------


class TestPreRegistered:
    def test_pre_registered_tenants(self, pre_registered_metrics: TenantHealthMetrics) -> None:
        snaps = pre_registered_metrics.all_snapshots()
        assert len(snaps) == 3

    def test_health_recording_on_pre_registered(
        self, pre_registered_metrics: TenantHealthMetrics
    ) -> None:
        pre_registered_metrics.record_health("pre-alpha", "healthy")
        assert pre_registered_metrics.get_health("pre-alpha") == "healthy"


# ---------------------------------------------------------------------------
# Concurrency Sanity
# ---------------------------------------------------------------------------


class TestConcurrency:
    def test_concurrent_access_no_crash(self, metrics: TenantHealthMetrics) -> None:
        """Basic sanity — rapid-fire calls should not corrupt state."""
        for i in range(100):
            tid = f"concur-{i % 5}"
            metrics.record_health(tid, "healthy" if i % 2 == 0 else "degraded")
            metrics.record_request(tid, "fix_issue", succeeded=i % 3 != 0)
            metrics.record_active_task(tid, worker="w1", delta=1)

        for i in range(5):
            snap = metrics.snapshot(f"concur-{i}")
            assert snap is not None
