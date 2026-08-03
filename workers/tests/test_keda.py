"""Tests for the KEDA ScaledObject configuration and queue depth metrics exporter."""

from __future__ import annotations

import io
import json
import os
import threading
from unittest.mock import MagicMock, patch

import pytest

from workers.scaling.keda import (
    QUEUE_CONCURRENCY,
    QUEUE_SCALING_THRESHOLDS,
    KedaMetricsCollector,
    KedaMetricsHandler,
    _escape_label,
    get_collector,
    is_keda_available,
    render_keda_metrics,
    start_keda_metrics_server,
)


@pytest.fixture(autouse=True)
def _reset_collector() -> None:
    import workers.scaling.keda as keda_mod
    keda_mod._collector = None


# ---------------------------------------------------------------------------
# KEDA detection
# ---------------------------------------------------------------------------


class TestKedaDetection:
    def test_not_available_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            assert is_keda_available() is False

    def test_available_when_enabled(self):
        with patch.dict(os.environ, {"KEDA_ENABLED": "true"}, clear=True):
            assert is_keda_available() is True


# ---------------------------------------------------------------------------
# KedaMetricsCollector
# ---------------------------------------------------------------------------


class TestKedaMetricsCollector:
    def test_initial_state(self):
        collector = KedaMetricsCollector()
        assert collector.queue_depths == {}
        assert collector.last_poll == 0.0
        assert collector.last_error is None
        assert collector._started is False

    def test_start_is_idempotent(self):
        collector = KedaMetricsCollector()
        collector.start()
        assert collector._started is True
        t1 = collector._timer
        collector.start()
        assert collector._timer is t1
        collector.stop()

    def test_stop_cancels_timer(self):
        collector = KedaMetricsCollector()
        collector.start()
        assert collector._timer is not None
        collector.stop()
        assert collector._started is False
        assert collector._timer is None

    @patch("workers.scaling.keda.KedaMetricsCollector._fetch_queue_depths")
    def test_poll_success(self, mock_fetch: MagicMock):
        mock_fetch.return_value = {
            "syntaro.agents.dispatch": 3,
            "syntaro.agents.sandbox": 0,
        }
        collector = KedaMetricsCollector(poll_interval=9999)
        collector._started = True
        collector._poll()
        assert collector.queue_depths["syntaro.agents.dispatch"] == 3
        assert collector.queue_depths["syntaro.agents.sandbox"] == 0
        assert collector.last_poll > 0
        assert collector.last_error is None

    @patch("workers.scaling.keda.KedaMetricsCollector._fetch_queue_depths")
    def test_poll_failure_records_error(self, mock_fetch: MagicMock):
        mock_fetch.side_effect = ConnectionError("Broker unreachable")
        collector = KedaMetricsCollector(poll_interval=9999)
        collector._started = True
        collector._poll()
        assert collector.last_error is not None
        assert "Broker unreachable" in collector.last_error

    @patch("httpx.get")
    def test_fetch_queue_depths_httpx(self, mock_httpx_get: MagicMock):
        mock_response = MagicMock()
        mock_response.json.return_value = [
            {"name": "syntaro.agents.dispatch", "messages_ready": 3, "messages_unacknowledged": 1},
            {"name": "syntaro.agents.sandbox", "messages_ready": 0, "messages_unacknowledged": 2},
            {"name": "not.a.syntaro.queue", "messages_ready": 99, "messages_unacknowledged": 0},
            {"name": "celery.boring", "messages_ready": 1, "messages_unacknowledged": 0},
        ]
        mock_response.raise_for_status.return_value = None
        mock_httpx_get.return_value = mock_response
        collector = KedaMetricsCollector()
        depths = collector._fetch_queue_depths()
        assert depths["syntaro.agents.dispatch"] == 4
        assert depths["syntaro.agents.sandbox"] == 2
        assert depths["celery.boring"] == 1
        assert "not.a.syntaro.queue" not in depths

    def test_queue_depths_returns_copy(self):
        collector = KedaMetricsCollector()
        collector._queue_depths["test"] = 42
        depths = collector.queue_depths
        assert depths == {"test": 42}
        depths["test"] = 99
        assert collector._queue_depths["test"] == 42


# ---------------------------------------------------------------------------
# render_keda_metrics
# ---------------------------------------------------------------------------


class TestRenderKedaMetrics:
    def test_render_empty(self):
        output = render_keda_metrics()
        assert output.startswith("# HELP keda_queue_depth")
        assert "# TYPE keda_queue_depth gauge" in output
        for qname in QUEUE_SCALING_THRESHOLDS:
            assert f'keda_queue_depth{{queue="{qname}"}} 0' in output
        assert "keda_up 1" in output
        assert "keda_last_poll_seconds" in output

    def test_render_with_depths(self):
        collector = get_collector()
        with collector._lock:
            collector._queue_depths = {
                "syntaro.agents.dispatch": 5,
                "syntaro.agents.sandbox": 3,
            }
            collector._last_poll = 1234567890.0
            collector._last_error = None
        output = render_keda_metrics()
        assert 'keda_queue_depth{queue="syntaro.agents.dispatch"} 5' in output
        assert 'keda_queue_depth{queue="syntaro.agents.sandbox"} 3' in output
        assert "keda_last_poll_seconds 1234567890.0" in output
        assert "keda_up 1" in output

    def test_render_with_error(self):
        collector = get_collector()
        with collector._lock:
            collector._last_error = "Connection refused"
            collector._last_poll = 100.0
        output = render_keda_metrics()
        assert "keda_up 0" in output
        assert 'keda_last_poll_error{error="Connection refused"} 1' in output

    def test_render_prometheus_format(self):
        output = render_keda_metrics()
        assert output.endswith("\n")


# ---------------------------------------------------------------------------
# _escape_label
# ---------------------------------------------------------------------------


class TestEscapeLabel:
    def test_no_escaping_needed(self):
        assert _escape_label("hello") == "hello"

    def test_escapes_backslash(self):
        assert _escape_label("a\\b") == "a\\\\b"

    def test_escapes_double_quote(self):
        assert _escape_label('say "hi"') == 'say \\"hi\\"'

    def test_escapes_newline(self):
        assert _escape_label("line1\nline2") == "line1\\nline2"


# ---------------------------------------------------------------------------
# KedaMetricsHandler
# ---------------------------------------------------------------------------


def _make_handler(path: str) -> KedaMetricsHandler:
    request = MagicMock()
    request.command = "GET"
    request.path = path
    request.request_version = "HTTP/1.0"

    rfile = io.BytesIO(b"")
    wfile = io.BytesIO()

    handler = KedaMetricsHandler.__new__(KedaMetricsHandler)
    handler.raw_requestline = f"GET {path} HTTP/1.0\r\n".encode("iso-8859-1")
    handler.requestline = f"GET {path} HTTP/1.0"
    handler.request = request
    handler.client_address = ("127.0.0.1", 0)
    handler.server = None
    handler.rfile = rfile
    handler.wfile = None
    handler.setup()
    handler.wfile = wfile
    handler.close_connection = True
    handler.command = "GET"
    handler.path = path
    handler.request_version = "HTTP/1.0"
    handler.headers = {}
    handler.responses = {}
    return handler


def _extract_status(body: bytes) -> int:
    first_line = body.split(b"\r\n")[0].decode("utf-8")
    return int(first_line.split(" ", 2)[1])


class TestKedaMetricsHandler:
    def test_keda_metrics_endpoint(self):
        handler = _make_handler("/keda-metrics")
        handler.do_GET()
        body = handler.wfile.getvalue()
        assert _extract_status(body) == 200
        assert b"keda_queue_depth" in body
        assert b"keda_up" in body

    def test_health_endpoint(self):
        handler = _make_handler("/health")
        handler.do_GET()
        body = handler.wfile.getvalue()
        assert _extract_status(body) == 200
        body_str = body.decode("utf-8")
        json_start = body_str.find("{")
        payload = json.loads(body_str[json_start:])
        assert payload["status"] == "ok"

    def test_health_live_endpoint(self):
        handler = _make_handler("/health/live")
        handler.do_GET()
        body = handler.wfile.getvalue()
        assert _extract_status(body) == 200

    def test_health_ready_endpoint(self):
        handler = _make_handler("/health/ready")
        handler.do_GET()
        body = handler.wfile.getvalue()
        assert _extract_status(body) == 200

    def test_unknown_endpoint_returns_404(self):
        handler = _make_handler("/unknown")
        handler.do_GET()
        body = handler.wfile.getvalue()
        assert _extract_status(body) == 404


# ---------------------------------------------------------------------------
# start_keda_metrics_server
# ---------------------------------------------------------------------------


class TestStartKedaMetricsServer:
    def test_starts_server_in_daemon_thread(self):
        start_keda_metrics_server(port=0)
        threads = threading.enumerate()
        thread_names = {t.name for t in threads}
        assert "keda-metrics-server" in thread_names

    def test_collector_is_started(self):
        start_keda_metrics_server(port=0)
        collector = get_collector()
        assert collector._started is True

    def test_multiple_calls_do_not_crash(self):
        start_keda_metrics_server(port=0)
        start_keda_metrics_server(port=0)


# ---------------------------------------------------------------------------
# Module export integrity
# ---------------------------------------------------------------------------


class TestModuleExports:
    def test_keda_module_importable(self):
        from workers.scaling.keda import (
            KEDA_ENABLED_ENV,
            KedaMetricsCollector,
            start_keda_metrics_server,
        )
        assert callable(start_keda_metrics_server)
        assert KEDA_ENABLED_ENV == "KEDA_ENABLED"

    def test_keda_module_exports_via_package(self):
        from workers.scaling import (
            KedaMetricsCollector,
            configure_scaling,
            get_collector,
            is_keda_available,
            start_keda_metrics_server,
        )
        assert callable(configure_scaling)
        assert callable(is_keda_available)
        assert callable(start_keda_metrics_server)

    def test_constants_match_keda_config(self):
        from workers.scaling.keda_config import QUEUE_SCALING_THRESHOLDS as ORIGINAL
        assert QUEUE_SCALING_THRESHOLDS == ORIGINAL

    def test_all_queues_have_thresholds(self):
        from workers.celeryconfig import task_queues
        for queue in task_queues:
            name = queue.name
            assert name in QUEUE_SCALING_THRESHOLDS, (
                f"Queue {name!r} is missing from QUEUE_SCALING_THRESHOLDS"
            )

    def test_all_queues_have_concurrency(self):
        from workers.celeryconfig import task_queues
        for queue in task_queues:
            name = queue.name
            assert name in QUEUE_CONCURRENCY, (
                f"Queue {name!r} is missing from QUEUE_CONCURRENCY"
            )
