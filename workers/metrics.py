"""
Celery Worker Prometheus Metrics — task monitoring and observability.

Exposes metrics via:
  1. A /metrics HTTP endpoint (served on a separate port)
  2. Optional push gateway integration
  3. In-memory gauge/counter for the periodic tasks

Usage:
    from workers.metrics import record_gauge, record_counter, start_metrics_server
    record_gauge("celery_tasks_active", 3, worker="worker1")
"""

import logging
import os
import threading
from typing import Any

logger = logging.getLogger(__name__)

# ── Metric Registry ─────────────────────────────────────────────────────────

# Simple in-memory metrics (no external dep requirement)
_gauges: dict[str, dict[str, float]] = {}
_counters: dict[str, dict[str, float | int]] = {}
_lock = threading.Lock()


def record_gauge(name: str, value: float, **labels: str) -> None:
    """Set a gauge metric."""
    with _lock:
        label_key = _label_key(**labels)
        if name not in _gauges:
            _gauges[name] = {}
        _gauges[name][label_key] = float(value)


def record_counter(name: str, value: float | int = 1, **labels: str) -> None:
    """Increment a counter metric."""
    with _lock:
        label_key = _label_key(**labels)
        if name not in _counters:
            _counters[name] = {}
        _counters[name][label_key] = _counters[name].get(label_key, 0) + value


def _label_key(**labels: str) -> str:
    return ",".join(f"{k}={v}" for k, v in sorted(labels.items()))


# ── Prometheus Exposition Format ───────────────────────────────────────────


def render_metrics() -> str:
    """Render all metrics in Prometheus text exposition format."""
    lines: list[str] = []

    with _lock:
        for name, labels_map in _gauges.items():
            lines.append(f"# HELP {name} {name}")
            lines.append(f"# TYPE {name} gauge")
            for label_key, value in labels_map.items():
                if label_key:
                    labels_str = "{" + label_key + "}"
                else:
                    labels_str = ""
                lines.append(f"{name}{labels_str} {value}")

        for name, labels_map in _counters.items():
            lines.append(f"# HELP {name} {name}")
            lines.append(f"# TYPE {name} counter")
            for label_key, value in labels_map.items():
                if label_key:
                    labels_str = "{" + label_key + "}"
                else:
                    labels_str = ""
                lines.append(f"{name}{labels_str} {value}")

    # ── Built-in Celery metrics ────────────────────────────────────
    try:
        from celery._state import get_current_worker_state

        state = get_current_worker_state()
        lines.append("# HELP celery_worker_state Current worker state")
        lines.append("# TYPE celery_worker_state gauge")
        lines.append(f"celery_worker_state {{state=\"{state}\"}} 1")
    except (ImportError, Exception):
        pass

    return "\n".join(lines) + "\n"


# ── Prometheus client integration (optional) ───────────────────────────────

REGISTRY: Any = None

try:
    from prometheus_client import Counter, Gauge, CollectorRegistry

    REGISTRY = CollectorRegistry()

    # ── Task Counters ──────────────────────────────────────────────
    tasks_total = Counter(
        "celery_tasks_total",
        "Total number of Celery tasks executed",
        ["task_name", "queue"],
        registry=REGISTRY,
    )
    tasks_success_total = Counter(
        "celery_tasks_success_total",
        "Number of successfully completed Celery tasks",
        ["task_name", "queue"],
        registry=REGISTRY,
    )
    tasks_failed_total = Counter(
        "celery_tasks_failed_total",
        "Number of failed Celery tasks",
        ["task_name", "queue", "error_type"],
        registry=REGISTRY,
    )
    tasks_retried_total = Counter(
        "celery_tasks_retried_total",
        "Number of Celery task retries",
        ["task_name", "queue"],
        registry=REGISTRY,
    )

    # ── Task Gauges ────────────────────────────────────────────────
    tasks_active = Gauge(
        "celery_tasks_active",
        "Number of currently active Celery tasks",
        ["worker", "queue"],
        registry=REGISTRY,
    )
    tasks_scheduled = Gauge(
        "celery_tasks_scheduled",
        "Number of scheduled Celery tasks (ETA)",
        ["queue"],
        registry=REGISTRY,
    )
    worker_liveness = Gauge(
        "celery_worker_liveness",
        "Worker liveness indicator (1=alive, 0=dead)",
        ["worker", "hostname"],
        registry=REGISTRY,
    )
    queue_depth = Gauge(
        "celery_queue_depth",
        "Current depth of a Celery queue",
        ["queue"],
        registry=REGISTRY,
    )

    # ── Duration Histogram (via gauge since we avoid external deps) ─
    task_duration_seconds = Gauge(
        "celery_task_duration_seconds",
        "Duration of the last Celery task execution in seconds",
        ["task_name", "queue"],
        registry=REGISTRY,
    )

    # ── E2B Metrics ─────────────────────────────────────────────
    e2b_health_check = Gauge(
        "e2b_health_check",
        "E2B sandbox health check status (1=healthy, 0=failed)",
        registry=REGISTRY,
    )
    e2b_health_checks_total = Counter(
        "e2b_health_checks_total",
        "Total number of E2B health checks performed",
        ["status"],
        registry=REGISTRY,
    )
    e2b_health_check_failures_total = Counter(
        "e2b_health_check_failures_total",
        "E2B health check failures by error type",
        ["error"],
        registry=REGISTRY,
    )
    e2b_failures_total = Counter(
        "stas_e2b_failures_total",
        "E2B sandbox failures by error type and repository",
        ["repo", "error"],
        registry=REGISTRY,
    )
    e2b_fallback_to_docker_total = Counter(
        "stas_e2b_fallback_to_docker_total",
        "E2B to Docker fallback events by repository and reason",
        ["repo", "reason"],
        registry=REGISTRY,
    )
    e2b_template_valid = Gauge(
        "e2b_template_valid",
        "E2B template validation status (1=valid, 0=invalid)",
        ["template"],
        registry=REGISTRY,
    )
    e2b_template_validation_failures_total = Counter(
        "e2b_template_validation_failures_total",
        "E2B template validation failures by template and error type",
        ["template", "error"],
        registry=REGISTRY,
    )

    logger.info("Prometheus client metrics initialized")

except ImportError:
    logger.debug("prometheus_client not available — using in-memory metrics only")
    tasks_total = None
    tasks_success_total = None
    tasks_failed_total = None
    tasks_retried_total = None
    tasks_active = None
    tasks_scheduled = None
    worker_liveness = None
    queue_depth = None
    task_duration_seconds = None


# ── HTTP Server for /metrics (optional) ─────────────────────────────────────


def start_metrics_server(port: int = 9090) -> None:
    """
    Start a simple HTTP server on the given port serving /metrics.
    This runs in a daemon thread and is safe to call during Celery worker startup.
    """
    import http.server

    class MetricsHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # type: ignore[override]
            if self.path == "/metrics":
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(render_metrics().encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, fmt: str, *args: Any) -> None:
            logger.debug("Metrics HTTP server — " + fmt, *args)

    server = http.server.HTTPServer(("0.0.0.0", port), MetricsHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="metrics-server")
    thread.start()
    logger.info("Metrics HTTP server started on :%d/metrics", port)


# ── Celery Signal Handlers ─────────────────────────────────────────────────


def connect_celery_signals(app: "Celery | None" = None) -> None:  # type: ignore[name-defined]
    """
    Connect Celery signals to automatically record metrics.
    Call this during Celery worker initialization.

    Args:
        app: Optional Celery application instance.
             If provided, signals are connected to this app instance.
    """
    from celery import signals

    @signals.task_prerun.connect
    def on_task_prerun(task_id: str, task: Any, **kwargs: Any) -> None:
        """Increment active task count on task start."""
        if tasks_active is not None:
            worker_name = os.getenv("WORKER_NAME", "unknown")
            queue = getattr(task, "queue", "unknown")
            tasks_active.labels(worker=worker_name, queue=queue).inc()

    @signals.task_postrun.connect
    def on_task_postrun(task_id: str, task: Any, retval: Any, state: str, **kwargs: Any) -> None:
        """Decrement active task count on task completion."""
        if tasks_active is not None:
            worker_name = os.getenv("WORKER_NAME", "unknown")
            queue = getattr(task, "queue", "unknown")
            tasks_active.labels(worker=worker_name, queue=queue).dec()

    @signals.task_success.connect
    def on_task_success(sender: Any, result: Any, **kwargs: Any) -> None:
        """Record successful task completion."""
        task_name = sender.name if sender else "unknown"
        queue = getattr(sender, "queue", "unknown")

        if tasks_success_total is not None:
            tasks_success_total.labels(task_name=task_name, queue=queue).inc()
        record_counter("celery_tasks_success_total", 1, task_name=task_name, queue=queue)

    @signals.task_failure.connect
    def on_task_failure(sender: Any, task_id: str, exception: Exception, **kwargs: Any) -> None:
        """Record failed task."""
        task_name = sender.name if sender else "unknown"
        queue = getattr(sender, "queue", "unknown")
        error_type = type(exception).__name__

        if tasks_failed_total is not None:
            tasks_failed_total.labels(task_name=task_name, queue=queue, error_type=error_type).inc()
        record_counter("celery_tasks_failed_total", 1, task_name=task_name, queue=queue, error_type=error_type)

    @signals.task_retry.connect
    def on_task_retry(sender: Any, reason: str, **kwargs: Any) -> None:
        """Record task retry."""
        task_name = sender.name if sender else "unknown"
        queue = getattr(sender, "queue", "unknown")

        if tasks_retried_total is not None:
            tasks_retried_total.labels(task_name=task_name, queue=queue).inc()
        record_counter("celery_tasks_retried_total", 1, task_name=task_name, queue=queue)

    logger.info("Celery signal handlers connected for metrics")
