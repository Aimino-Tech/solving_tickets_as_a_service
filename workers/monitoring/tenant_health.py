"""
Tenant Health Monitoring — Prometheus metrics per tenant.

Exposes per-tenant health indicators as Prometheus metrics:
  - Health status (healthy/degraded/down)
  - Request and error counters
  - Active task tracking
  - Processing duration
  - Queue depth
  - Uptime and liveness timestamps

Usage:
    from workers.monitoring.tenant_health import TenantHealthMetrics

    metrics = TenantHealthMetrics()
    metrics.record_health("tenant-abc", "healthy")
    metrics.record_request("tenant-abc", "fix_issue", succeeded=True)
    metrics.record_active_task("tenant-abc", "worker-1", delta=1)
    metrics.record_duration("tenant-abc", "fix_issue", 12.5)
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Internal In-Memory Metric Store ─────────────────────────────────────────

_lock = threading.Lock()

# tenant_id -> { label_key -> value }
_gauges: Dict[str, Dict[str, float]] = {}
_counters: Dict[str, Dict[str, float]] = {}

# Timestamps for uptime tracking
_tenant_start_times: Dict[str, float] = {}

# Label history for last-N error tracking
# tenant_id -> [(timestamp, error_type, task_name)]
_recent_errors: Dict[str, List[Tuple[float, str, str]]] = {}
_MAX_RECENT_ERRORS = 100


def _label_key(**labels: str) -> str:
    return ",".join(f"{k}={v}" for k, v in sorted(labels.items()))


def _set_gauge(name: str, value: float, **labels: str) -> None:
    with _lock:
        label_key = _label_key(**labels)
        if name not in _gauges:
            _gauges[name] = {}
        _gauges[name][label_key] = value


def _inc_counter(name: str, value: float = 1, **labels: str) -> None:
    with _lock:
        label_key = _label_key(**labels)
        if name not in _counters:
            _counters[name] = {}
        _counters[name][label_key] = _counters[name].get(label_key, 0) + value


def _get_gauge(name: str, **labels: str) -> Optional[float]:
    with _lock:
        label_key = _label_key(**labels)
        return _gauges.get(name, {}).get(label_key)


def _sum_counter(name: str, **match_labels: str) -> float:
    """Sum counter entries whose label keys contain all ``match_labels``.

    This allows aggregating across label dimensions not specified in the query.
    For example, ``_sum_counter("tenant_requests_total", tenant_id="abc")``
    sums across all ``task_type`` values for that tenant.
    """
    total = 0.0
    with _lock:
        entries = _counters.get(name, {})
        for label_key, value in entries.items():
            # Each label_key is "k1=v1,k2=v2,..." — check every match_label is present
            if all(f"{k}={v}" in label_key for k, v in match_labels.items()):
                total += value
    return total


def _get_all_gauges() -> Dict[str, Dict[str, float]]:
    with _lock:
        return {k: dict(v) for k, v in _gauges.items()}


def _get_all_counters() -> Dict[str, Dict[str, float]]:
    with _lock:
        return {k: dict(v) for k, v in _counters.items()}


# ── Prometheus Client Integration (Optional) ────────────────────────────────

try:
    from prometheus_client import Counter, Gauge, Histogram, CollectorRegistry

    _REGISTRY: Any = CollectorRegistry()

    # ── Gauges ──────────────────────────────────────────────────────
    tenant_health_status = Gauge(
        "tenant_health_status",
        "Current health status per tenant (1=healthy, 0=degraded, -1=down)",
        ["tenant_id"],
        registry=_REGISTRY,
    )
    tenant_active_tasks = Gauge(
        "tenant_active_tasks",
        "Number of currently active tasks per tenant",
        ["tenant_id", "worker"],
        registry=_REGISTRY,
    )
    tenant_queue_depth = Gauge(
        "tenant_queue_depth",
        "Current queue depth per tenant",
        ["tenant_id"],
        registry=_REGISTRY,
    )
    tenant_uptime_seconds = Gauge(
        "tenant_uptime_seconds",
        "Uptime of a tenant's processing pipeline in seconds",
        ["tenant_id"],
        registry=_REGISTRY,
    )
    tenant_last_seen_timestamp = Gauge(
        "tenant_last_seen_timestamp",
        "Unix timestamp of the last recorded activity for a tenant",
        ["tenant_id"],
        registry=_REGISTRY,
    )
    tenant_concurrent_sessions = Gauge(
        "tenant_concurrent_sessions",
        "Number of concurrent fix sessions per tenant",
        ["tenant_id"],
        registry=_REGISTRY,
    )
    tenant_rate_limit_remaining = Gauge(
        "tenant_rate_limit_remaining",
        "Remaining rate-limit capacity for a tenant (0=throttled)",
        ["tenant_id"],
        registry=_REGISTRY,
    )

    # ── Counters ────────────────────────────────────────────────────
    tenant_requests_total = Counter(
        "tenant_requests_total",
        "Total number of requests processed per tenant",
        ["tenant_id", "task_type"],
        registry=_REGISTRY,
    )
    tenant_success_total = Counter(
        "tenant_success_total",
        "Total number of successful requests per tenant",
        ["tenant_id", "task_type"],
        registry=_REGISTRY,
    )
    tenant_errors_total = Counter(
        "tenant_errors_total",
        "Total number of errors per tenant",
        ["tenant_id", "task_type", "error_type"],
        registry=_REGISTRY,
    )
    tenant_retries_total = Counter(
        "tenant_retries_total",
        "Total number of task retries per tenant",
        ["tenant_id", "task_type"],
        registry=_REGISTRY,
    )
    tenant_rate_limited_total = Counter(
        "tenant_rate_limited_total",
        "Total number of rate-limited/throttled requests per tenant",
        ["tenant_id"],
        registry=_REGISTRY,
    )

    # ── Histograms ──────────────────────────────────────────────────
    tenant_task_duration_seconds = Histogram(
        "tenant_task_duration_seconds",
        "Duration of task processing per tenant in seconds",
        ["tenant_id", "task_type"],
        buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, float("inf")),
        registry=_REGISTRY,
    )

    _PROMETHEUS_AVAILABLE = True
    logger.info("Prometheus client metrics initialized for tenant health")

except ImportError:
    _PROMETHEUS_AVAILABLE = False
    logger.debug("prometheus_client not available — using in-memory metrics only")

    # Sentinel stubs
    tenant_health_status = None
    tenant_active_tasks = None
    tenant_queue_depth = None
    tenant_uptime_seconds = None
    tenant_last_seen_timestamp = None
    tenant_concurrent_sessions = None
    tenant_rate_limit_remaining = None
    tenant_requests_total = None
    tenant_success_total = None
    tenant_errors_total = None
    tenant_retries_total = None
    tenant_rate_limited_total = None
    tenant_task_duration_seconds = None


# ── TenantHealthMetrics ─────────────────────────────────────────────────────


@dataclass
class TenantSnapshot:
    """A point-in-time snapshot of a tenant's health metrics."""

    tenant_id: str
    status: str  # "healthy", "degraded", "down"
    uptime_seconds: float
    active_tasks: int
    queue_depth: int
    requests_total: int
    errors_total: int
    success_total: int
    retries_total: int
    rate_limited_total: int
    duration_p50: float
    duration_p95: float
    duration_p99: float
    last_seen_timestamp: float
    recent_errors: List[Dict[str, Any]] = field(default_factory=list)


class TenantHealthMetrics:
    """
    Per-tenant Prometheus metrics for health monitoring.

    This class provides both a Prometheus client integration (when
    ``prometheus_client`` is installed) and a fallback in-memory store.

    All methods accept a ``tenant_id`` as the first argument, making
    them trivially usable from multi-tenant Celery task contexts.
    """

    def __init__(self, tenant_ids: Optional[List[str]] = None) -> None:
        self._duration_records: Dict[str, List[float]] = {}
        self._tenant_ids: set = set(tenant_ids) if tenant_ids else set()

        if self._tenant_ids:
            for tid in self._tenant_ids:
                self.register_tenant(tid)

    def _ensure_tenant(self, tenant_id: str) -> None:
        """Ensure in-memory tracking structures exist for a tenant."""
        if tenant_id not in _tenant_start_times:
            _tenant_start_times[tenant_id] = time.time()
        if tenant_id not in self._duration_records:
            self._duration_records[tenant_id] = []
        self._tenant_ids.add(tenant_id)

    # ── Health Status ───────────────────────────────────────────────

    def record_health(self, tenant_id: str, status: str) -> None:
        """
        Record a tenant's current health status.

        Args:
            tenant_id: Unique tenant identifier.
            status: One of ``"healthy"``, ``"degraded"``, or ``"down"``.
        """
        self._ensure_tenant(tenant_id)
        value = {"healthy": 1, "degraded": 0, "down": -1}.get(status, 0)
        _set_gauge("tenant_health_status", float(value), tenant_id=tenant_id)
        if _PROMETHEUS_AVAILABLE and tenant_health_status is not None:
            tenant_health_status.labels(tenant_id=tenant_id).set(value)
        self._touch(tenant_id)

    def get_health(self, tenant_id: str) -> Optional[str]:
        """Get the current health status label for a tenant."""
        val = _get_gauge("tenant_health_status", tenant_id=tenant_id)
        if val is None:
            return None
        inverse = {1: "healthy", 0: "degraded", -1: "down"}
        return inverse.get(int(val), "unknown")

    # ── Request Tracking ────────────────────────────────────────────

    def record_request(
        self,
        tenant_id: str,
        task_type: str,
        *,
        succeeded: bool = True,
        duration: Optional[float] = None,
        error_type: Optional[str] = None,
    ) -> None:
        """
        Record a request (task execution) for a tenant.

        Args:
            tenant_id: Unique tenant identifier.
            task_type: The type of task (e.g. ``"fix_issue"``, ``"triage"``).
            succeeded: Whether the request completed successfully.
            duration: Optional processing duration in seconds.
            error_type: Required if ``succeeded`` is False — the error class name.
        """
        self._ensure_tenant(tenant_id)

        _inc_counter("tenant_requests_total", 1, tenant_id=tenant_id, task_type=task_type)
        if _PROMETHEUS_AVAILABLE and tenant_requests_total is not None:
            tenant_requests_total.labels(tenant_id=tenant_id, task_type=task_type).inc()

        if succeeded:
            _inc_counter("tenant_success_total", 1, tenant_id=tenant_id, task_type=task_type)
            if _PROMETHEUS_AVAILABLE and tenant_success_total is not None:
                tenant_success_total.labels(tenant_id=tenant_id, task_type=task_type).inc()
        else:
            error = error_type or "UnknownError"
            _inc_counter("tenant_errors_total", 1, tenant_id=tenant_id, task_type=task_type, error_type=error)
            if _PROMETHEUS_AVAILABLE and tenant_errors_total is not None:
                tenant_errors_total.labels(
                    tenant_id=tenant_id, task_type=task_type, error_type=error
                ).inc()

            # Track recent errors
            with _lock:
                if tenant_id not in _recent_errors:
                    _recent_errors[tenant_id] = []
                _recent_errors[tenant_id].append((time.time(), error, task_type))
                if len(_recent_errors[tenant_id]) > _MAX_RECENT_ERRORS:
                    _recent_errors[tenant_id] = _recent_errors[tenant_id][-_MAX_RECENT_ERRORS:]

        if duration is not None:
            self._record_duration(tenant_id, task_type, duration)

        self._touch(tenant_id)

    def record_error(
        self,
        tenant_id: str,
        task_type: str,
        error_type: str,
    ) -> None:
        """Convenience method to record an error without a full request context."""
        self.record_request(tenant_id, task_type, succeeded=False, error_type=error_type)

    def record_retry(self, tenant_id: str, task_type: str) -> None:
        """Record a task retry for a tenant."""
        _inc_counter("tenant_retries_total", 1, tenant_id=tenant_id, task_type=task_type)
        if _PROMETHEUS_AVAILABLE and tenant_retries_total is not None:
            tenant_retries_total.labels(tenant_id=tenant_id, task_type=task_type).inc()
        self._touch(tenant_id)

    def record_rate_limited(self, tenant_id: str) -> None:
        """Record a rate-limited request for a tenant."""
        _inc_counter("tenant_rate_limited_total", 1, tenant_id=tenant_id)
        if _PROMETHEUS_AVAILABLE and tenant_rate_limited_total is not None:
            tenant_rate_limited_total.labels(tenant_id=tenant_id).inc()
        self._touch(tenant_id)

    # ── Active Tasks ────────────────────────────────────────────────

    def record_active_task(self, tenant_id: str, worker: str = "default", delta: int = 1) -> None:
        """
        Adjust the active task count for a tenant.

        Args:
            tenant_id: Unique tenant identifier.
            worker: Worker name.
            delta: +1 to increment, -1 to decrement.
        """
        current = _get_gauge("tenant_active_tasks", tenant_id=tenant_id, worker=worker) or 0.0
        new_val = max(0.0, current + delta)
        _set_gauge("tenant_active_tasks", new_val, tenant_id=tenant_id, worker=worker)
        if _PROMETHEUS_AVAILABLE and tenant_active_tasks is not None:
            tenant_active_tasks.labels(tenant_id=tenant_id, worker=worker).set(new_val)
        self._touch(tenant_id)

    # ── Queue Depth ─────────────────────────────────────────────────

    def record_queue_depth(self, tenant_id: str, depth: int) -> None:
        """Set the current queue depth for a tenant."""
        _set_gauge("tenant_queue_depth", float(depth), tenant_id=tenant_id)
        if _PROMETHEUS_AVAILABLE and tenant_queue_depth is not None:
            tenant_queue_depth.labels(tenant_id=tenant_id).set(depth)
        self._touch(tenant_id)

    # ── Concurrent Sessions ─────────────────────────────────────────

    def record_concurrent_sessions(self, tenant_id: str, count: int) -> None:
        """Set the current number of concurrent fix sessions for a tenant."""
        _set_gauge("tenant_concurrent_sessions", float(count), tenant_id=tenant_id)
        if _PROMETHEUS_AVAILABLE and tenant_concurrent_sessions is not None:
            tenant_concurrent_sessions.labels(tenant_id=tenant_id).set(count)

    # ── Rate Limit Remaining ────────────────────────────────────────

    def record_rate_limit_remaining(self, tenant_id: str, remaining: int) -> None:
        """Set the remaining rate-limit capacity for a tenant."""
        _set_gauge("tenant_rate_limit_remaining", float(remaining), tenant_id=tenant_id)
        if _PROMETHEUS_AVAILABLE and tenant_rate_limit_remaining is not None:
            tenant_rate_limit_remaining.labels(tenant_id=tenant_id).set(remaining)

    # ── Duration Tracking ───────────────────────────────────────────

    def _record_duration(self, tenant_id: str, task_type: str, duration: float) -> None:
        """Record a task processing duration."""
        if _PROMETHEUS_AVAILABLE and tenant_task_duration_seconds is not None:
            tenant_task_duration_seconds.labels(tenant_id=tenant_id, task_type=task_type).observe(duration)

        # Also store in-memory for percentile calculations
        with _lock:
            if tenant_id not in self._duration_records:
                self._duration_records[tenant_id] = []
            self._duration_records[tenant_id].append(duration)
            # Keep a bounded sliding window (last 1000 records)
            if len(self._duration_records[tenant_id]) > 1000:
                self._duration_records[tenant_id] = self._duration_records[tenant_id][-1000:]

    def _percentile(self, tenant_id: str, p: float) -> float:
        """Compute the p-th percentile of recorded durations for a tenant."""
        with _lock:
            values = sorted(self._duration_records.get(tenant_id, []))
        if not values:
            return 0.0
        k = max(0, min(len(values) - 1, int(len(values) * p / 100)))
        return values[k]

    # ── Uptime ──────────────────────────────────────────────────────

    def record_uptime(self, tenant_id: str) -> None:
        """Update the uptime gauge for a tenant."""
        uptime = time.time() - _tenant_start_times.get(tenant_id, time.time())
        _set_gauge("tenant_uptime_seconds", uptime, tenant_id=tenant_id)
        if _PROMETHEUS_AVAILABLE and tenant_uptime_seconds is not None:
            tenant_uptime_seconds.labels(tenant_id=tenant_id).set(uptime)

    # ── Last Seen ───────────────────────────────────────────────────

    def _touch(self, tenant_id: str) -> None:
        """Update the last-seen timestamp for a tenant."""
        now = time.time()
        _set_gauge("tenant_last_seen_timestamp", now, tenant_id=tenant_id)
        if _PROMETHEUS_AVAILABLE and tenant_last_seen_timestamp is not None:
            tenant_last_seen_timestamp.labels(tenant_id=tenant_id).set(now)

    # ── Snapshot ────────────────────────────────────────────────────

    def snapshot(self, tenant_id: str) -> TenantSnapshot:
        """
        Return a point-in-time snapshot of all health metrics for a tenant.

        This is useful for dashboard APIs, alerting logic, and debug endpoints.
        """
        self._ensure_tenant(tenant_id)
        self.record_uptime(tenant_id)

        status_gauge = _get_gauge("tenant_health_status", tenant_id=tenant_id)
        if status_gauge is None:
            status = "unknown"
        else:
            status_map = {1: "healthy", 0: "degraded", -1: "down"}
            status = status_map.get(int(status_gauge), "unknown")

        active = int(_get_gauge("tenant_active_tasks", tenant_id=tenant_id, worker="default") or 0)
        queue = int(_get_gauge("tenant_queue_depth", tenant_id=tenant_id) or 0)
        uptime = time.time() - _tenant_start_times.get(tenant_id, time.time())
        last_seen = _get_gauge("tenant_last_seen_timestamp", tenant_id=tenant_id) or 0.0

        requests = int(_sum_counter("tenant_requests_total", tenant_id=tenant_id))
        success = int(_sum_counter("tenant_success_total", tenant_id=tenant_id))
        errors = int(_sum_counter("tenant_errors_total", tenant_id=tenant_id))
        retries = int(_sum_counter("tenant_retries_total", tenant_id=tenant_id))
        rate_limited = int(_sum_counter("tenant_rate_limited_total", tenant_id=tenant_id))

        # Recent errors
        with _lock:
            recent_raw = list(_recent_errors.get(tenant_id, []))

        recent_errors_list: List[Dict[str, Any]] = []
        for ts, err_type, ttype in recent_raw[-10:]:
            recent_errors_list.append(
                {
                    "timestamp": ts,
                    "error_type": err_type,
                    "task_type": ttype,
                }
            )

        return TenantSnapshot(
            tenant_id=tenant_id,
            status=status,
            uptime_seconds=uptime,
            active_tasks=active,
            queue_depth=queue,
            requests_total=requests,
            errors_total=errors,
            success_total=success,
            retries_total=retries,
            rate_limited_total=rate_limited,
            duration_p50=self._percentile(tenant_id, 50),
            duration_p95=self._percentile(tenant_id, 95),
            duration_p99=self._percentile(tenant_id, 99),
            last_seen_timestamp=last_seen,
            recent_errors=recent_errors_list,
        )

    def all_snapshots(self) -> List[TenantSnapshot]:
        """Return snapshots for all tenants tracked by this instance."""
        with _lock:
            tenant_ids = list(self._tenant_ids)
        return [self.snapshot(tid) for tid in tenant_ids]

    # ── Tenant Registration ─────────────────────────────────────────

    def register_tenant(self, tenant_id: str) -> None:
        """Register a new tenant for tracking. Idempotent."""
        self._ensure_tenant(tenant_id)
        self._tenant_ids.add(tenant_id)
        # Initialize health as healthy on first registration
        if self.get_health(tenant_id) is None:
            self.record_health(tenant_id, "healthy")

    def unregister_tenant(self, tenant_id: str) -> None:
        """Remove a tenant from tracking and clear its metric entries."""
        with _lock:
            _tenant_start_times.pop(tenant_id, None)
            _recent_errors.pop(tenant_id, None)
            # Remove gauge entries with this tenant_id
            for name in list(_gauges):
                _gauges[name] = {
                    k: v for k, v in _gauges[name].items() if f"tenant_id={tenant_id}" not in k
                }

        self._tenant_ids.discard(tenant_id)
        self._duration_records.pop(tenant_id, None)

    # ── Render (for /metrics endpoint) ──────────────────────────────

    @staticmethod
    def render_all() -> str:
        """
        Render all in-memory tenant metrics in Prometheus text exposition format.

        Use this to serve a ``/metrics`` endpoint when ``prometheus_client``
        is *not* installed.
        """
        lines: List[str] = []
        gauges = _get_all_gauges()
        counters = _get_all_counters()

        for name, labels_map in gauges.items():
            lines.append(f"# HELP {name} {name}")
            lines.append(f"# TYPE {name} gauge")
            for label_key, value in labels_map.items():
                labels_str = f"{{{label_key}}}" if label_key else ""
                lines.append(f"{name}{labels_str} {value}")

        for name, labels_map in counters.items():
            lines.append(f"# HELP {name} {name}")
            lines.append(f"# TYPE {name} counter")
            for label_key, value in labels_map.items():
                labels_str = f"{{{label_key}}}" if label_key else ""
                lines.append(f"{name}{labels_str} {value}")

        return "\n".join(lines) + "\n"


# ── Module-Level Singleton ──────────────────────────────────────────────────

_default_metrics: Optional[TenantHealthMetrics] = None


def get_tenant_health_metrics() -> TenantHealthMetrics:
    """Return the module-level singleton ``TenantHealthMetrics`` instance."""
    global _default_metrics  # noqa: PLW0603
    if _default_metrics is None:
        _default_metrics = TenantHealthMetrics()
    return _default_metrics
