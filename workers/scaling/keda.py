"""KEDA ScaledObject configuration and queue depth metrics exporter.

This module serves two purposes:

1. **Configuration management** — exports scaling thresholds, concurrency
   ranges, and KEDA-detection helpers used by the Celery app and the
   ``k8s/keda-scaled-object.yaml`` manifest.

2. **Queue depth metrics exporter** — a lightweight HTTP server that
   periodically polls RabbitMQ queue depths via the Management HTTP API
   and exposes them as Prometheus-format metrics on ``/keda-metrics``.
   KEDA's Prometheus scaler can scrape this endpoint when direct
   RabbitMQ queries are unavailable.

Design
------
* ``QUEUE_SCALING_THRESHOLDS`` — backlog depth that triggers a scale-up
  per queue.  Shorter queues (notifications, triage) tolerate deeper
  backlogs; critical queues (dispatch) scale up at just 2.

* ``QUEUE_CONCURRENCY`` — (min, max) worker concurrency per queue for
  Celery's native ``--autoscale``.

* ``start_keda_metrics_server()`` — starts the Prometheus metrics
  endpoint in a daemon thread; safe to call during Celery worker init.
"""

from __future__ import annotations

import http.server
import json
import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

# Re-export key constants from keda_config for convenience.
from workers.scaling.keda_config import (  # noqa: E402  # isort: skip
    DEFAULT_MAX_CONCURRENCY,
    DEFAULT_MIN_CONCURRENCY,
    KEDA_ENABLED_ENV,
    QUEUE_CONCURRENCY,
    QUEUE_SCALING_THRESHOLDS,
    get_concurrency_range,
    get_queue_threshold,
    is_keda_available,
)

__all__ = [
    # Re-exports
    "QUEUE_SCALING_THRESHOLDS",
    "QUEUE_CONCURRENCY",
    "DEFAULT_MIN_CONCURRENCY",
    "DEFAULT_MAX_CONCURRENCY",
    "KEDA_ENABLED_ENV",
    "is_keda_available",
    "get_queue_threshold",
    "get_concurrency_range",
    # Metrics exporter
    "KedaMetricsCollector",
    "start_keda_metrics_server",
    "render_keda_metrics",
]

# ---------------------------------------------------------------------------
# Queue Depth Metrics Exporter
# ---------------------------------------------------------------------------
# The collector connects to the RabbitMQ Management HTTP API and fetches
# queue-depth information for every queue whose name starts with a known
# prefix.  The resulting metrics are rendered in Prometheus text format
# and served on /keda-metrics.

RABBITMQ_MGMT_URL = os.getenv(
    "RABBITMQ_MGMT_URL",
    "http://guest:guest@localhost:15672/api/queues",
)
KEDA_METRICS_PORT = int(os.getenv("KEDA_METRICS_PORT", "9091"))
KEDA_METRICS_INTERVAL = int(os.getenv("KEDA_METRICS_INTERVAL", "15"))

_QUEUE_PREFIXES = ("syntaro.agents.", "celery.")


class KedaMetricsCollector:
    """Periodically fetches RabbitMQ queue depths and caches them.

    The collector runs a background timer that queries the RabbitMQ
    Management HTTP API at a configurable interval.  The cached depths
    are then rendered on demand via :func:`render_keda_metrics`.

    Thread-safe for reads (uses a lock around the cached dict).
    """

    def __init__(
        self,
        mgmt_url: str = RABBITMQ_MGMT_URL,
        poll_interval: int = KEDA_METRICS_INTERVAL,
    ) -> None:
        self._mgmt_url = mgmt_url
        self._poll_interval = poll_interval
        self._lock = threading.Lock()
        self._queue_depths: dict[str, int] = {}
        self._last_poll: float = 0.0
        self._last_error: str | None = None
        self._timer: threading.Timer | None = None
        self._started = False

    # ── Public API ────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background polling loop (idempotent)."""
        if self._started:
            return
        self._started = True
        self._poll()
        logger.info(
            "KEDA metrics collector started — polling %s every %ds",
            self._mgmt_url,
            self._poll_interval,
        )

    def stop(self) -> None:
        """Stop the background polling loop."""
        self._started = False
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    @property
    def queue_depths(self) -> dict[str, int]:
        """Return a snapshot of the current queue depths."""
        with self._lock:
            return dict(self._queue_depths)

    @property
    def last_poll(self) -> float:
        """Unix timestamp of the last successful poll."""
        with self._lock:
            return self._last_poll

    @property
    def last_error(self) -> str | None:
        """Error message from the last failed poll, if any."""
        with self._lock:
            return self._last_error

    # ── Internal ──────────────────────────────────────────────────────

    def _poll(self) -> None:
        """Fetch queue depths from the RabbitMQ Management API."""
        if not self._started:
            return

        try:
            depths = self._fetch_queue_depths()
            with self._lock:
                self._queue_depths = depths
                self._last_poll = time.time()
                self._last_error = None
            logger.debug("KEDA metrics polled %d queues", len(depths))
        except Exception as exc:
            logger.warning("KEDA metrics poll failed — %s", exc)
            with self._lock:
                self._last_error = str(exc)

        self._timer = threading.Timer(self._poll_interval, self._poll)
        self._timer.daemon = True
        self._timer.start()

    def _fetch_queue_depths(self) -> dict[str, int]:
        """Query RabbitMQ Management API and return ``{queue_name: depth}``.

        Only includes queues whose name starts with ``syntaro.agents.``
        or ``celery.``.
        """
        try:
            import httpx

            resp = httpx.get(self._mgmt_url, timeout=10.0)
            resp.raise_for_status()
            queues: list[dict[str, Any]] = resp.json()
        except ImportError:
            import urllib.request

            req = urllib.request.Request(self._mgmt_url)
            with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
                queues = json.loads(resp.read().decode())

        depths: dict[str, int] = {}
        for q in queues:
            name: str = q.get("name", "")
            if not name.startswith(_QUEUE_PREFIXES):
                continue
            ready = int(q.get("messages_ready", 0))
            unack = int(q.get("messages_unacknowledged", 0))
            depths[name] = ready + unack

        return depths


# ── Global collector instance (singleton) ──────────────────────────────

_collector: KedaMetricsCollector | None = None


def get_collector() -> KedaMetricsCollector:
    """Return the global :class:`KedaMetricsCollector` singleton."""
    global _collector
    if _collector is None:
        _collector = KedaMetricsCollector()
    return _collector


# ── Metrics Rendering ──────────────────────────────────────────────────


def render_keda_metrics() -> str:
    """Render queue depth metrics in Prometheus text exposition format."""
    collector = get_collector()
    depths = collector.queue_depths
    last_poll = collector.last_poll
    last_err = collector.last_error

    lines: list[str] = []

    lines.append("# HELP keda_queue_depth Current depth of a Celery queue (ready + unack)")
    lines.append("# TYPE keda_queue_depth gauge")
    for qname, depth in sorted(depths.items()):
        lines.append(f'keda_queue_depth{{queue="{qname}"}} {depth}')

    for qname in sorted(QUEUE_SCALING_THRESHOLDS):
        if qname not in depths:
            lines.append(f'keda_queue_depth{{queue="{qname}"}} 0')

    lines.append("# HELP keda_up Whether the KEDA metrics collector is running (1=up)")
    lines.append("# TYPE keda_up gauge")
    lines.append(f"keda_up {'0' if last_err else '1'}")

    lines.append("# HELP keda_last_poll_seconds Unix timestamp of last successful poll")
    lines.append("# TYPE keda_last_poll_seconds gauge")
    lines.append(f"keda_last_poll_seconds {last_poll}")

    if last_err:
        lines.append("# HELP keda_last_poll_error Error message from last failed poll")
        lines.append("# TYPE keda_last_poll_error gauge")
        lines.append(f'keda_last_poll_error{{error="{_escape_label(last_err)}"}} 1')

    return "\n".join(lines) + "\n"


def _escape_label(value: str) -> str:
    value = value.replace("\\", "\\\\")
    value = value.replace('"', '\\"')
    value = value.replace("\n", "\\n")
    return value


# ── HTTP Server ────────────────────────────────────────────────────────


class KedaMetricsHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler serving ``/keda-metrics`` and ``/health`` for KEDA."""

    def do_GET(self) -> None:  # type: ignore[override]
        if self.path == "/keda-metrics":
            self._respond(200, render_keda_metrics(), "text/plain; charset=utf-8")
        elif self.path in ("/health", "/health/live", "/health/ready"):
            self._respond(
                200,
                json.dumps({"status": "ok", "collector_up": get_collector().last_error is None}),
                "application/json",
            )
        else:
            self._respond(404, "Not found\n", "text/plain")

    def _respond(self, status: int, body: str, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, fmt: str, *args: Any) -> None:
        logger.debug("KEDA metrics HTTP — " + fmt, *args)


def start_keda_metrics_server(port: int = KEDA_METRICS_PORT) -> None:
    """Start the KEDA metrics HTTP server in a daemon thread.

    The server exposes:

    * ``GET /keda-metrics`` — Prometheus-format queue depth metrics
      for KEDA's Prometheus scaler.
    * ``GET /health`` — JSON health check (used by k8s probes).

    Parameters
    ----------
    port : int
        HTTP port (default 9091, configurable via ``KEDA_METRICS_PORT``).
    """
    collector = get_collector()
    collector.start()

    server = http.server.HTTPServer(("0.0.0.0", port), KedaMetricsHandler)
    thread = threading.Thread(
        target=server.serve_forever,
        daemon=True,
        name="keda-metrics-server",
    )
    thread.start()
    logger.info("KEDA metrics server started on :%d/keda-metrics", port)
