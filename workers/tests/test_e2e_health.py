"""Tests for the E2E health check periodic task."""

from __future__ import annotations
import os
from unittest.mock import MagicMock, patch
import pytest


@pytest.fixture(autouse=True)
def _clear_env():
    keys = ["CELERY_BROKER_URL","CELERY_RESULT_BACKEND","RABBITMQ_URL","REDIS_URL",
            "RABBITMQ_API_URL","E2E_HEALTH_ENDPOINTS","E2E_CRITICAL_QUEUES",
            "E2E_MAX_QUEUE_DEPTH","E2E_PING_TASK_TIMEOUT"]
    saved = {k: os.environ.pop(k, None) for k in keys}
    yield
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v


class TestCheckBroker:
    def test_ok(self):
        from workers.health.e2e_check import _check_broker
        with patch("workers.health.e2e_check.Celery") as mc:
            mc.return_value.connection.return_value = MagicMock()
            ok, err = _check_broker("amqp://guest:guest@localhost:5672//")
        assert ok is True; assert err is None

    def test_failure(self):
        from workers.health.e2e_check import _check_broker
        with patch("workers.health.e2e_check.Celery") as mc:
            mc.return_value.connection.side_effect = RuntimeError("connection refused")
            ok, err = _check_broker("amqp://guest:guest@localhost:5672//")
        assert ok is False; assert "connection refused" in str(err)

    def test_empty_url(self):
        from workers.health.e2e_check import _check_broker
        ok, err = _check_broker("")
        assert ok is False; assert "no broker URL configured" in str(err)


class TestCheckBackend:
    def test_ok(self):
        from workers.health.e2e_check import _check_backend, _redis_mod
        with patch.object(_redis_mod, "from_url") as m:
            c = MagicMock(); m.return_value = c
            ok, err = _check_backend("redis://localhost:6379/0")
        assert ok is True; assert err is None; c.ping.assert_called_once(); c.close.assert_called_once()

    def test_failure(self):
        from workers.health.e2e_check import _check_backend, _redis_mod
        with patch.object(_redis_mod, "from_url") as m:
            m.side_effect = ConnectionError("Redis unavailable")
            ok, err = _check_backend("redis://localhost:6379/0")
        assert ok is False; assert "Redis unavailable" in str(err)

    def test_empty_url(self):
        from workers.health.e2e_check import _check_backend
        ok, err = _check_backend(""); assert ok is False; assert "no backend URL configured" in str(err)


class TestCheckWorkerPing:
    def test_ok(self):
        from workers.health.e2e_check import _check_worker_ping
        with patch("workers.health.e2e_check.Celery") as mc, \
             patch("workers.health.e2e_check.BROKER_URL", "amqp://guest:guest@localhost:5672//"), \
             patch("workers.health.e2e_check.BACKEND_URL", "redis://localhost:6379/0"):
            mc.return_value.control.ping.return_value = [{"w1": {"ok": True}}]
            ok, err = _check_worker_ping()
        assert ok is True; assert err is None

    def test_no_response(self):
        from workers.health.e2e_check import _check_worker_ping
        with patch("workers.health.e2e_check.Celery") as mc, \
             patch("workers.health.e2e_check.BROKER_URL", "a"), \
             patch("workers.health.e2e_check.BACKEND_URL", "b"):
            mc.return_value.control.ping.return_value = []
            ok, err = _check_worker_ping()
        assert ok is False; assert "no ping response" in str(err)

    def test_config_missing(self):
        from workers.health.e2e_check import _check_worker_ping
        with patch("workers.health.e2e_check.BROKER_URL", ""), \
             patch("workers.health.e2e_check.BACKEND_URL", ""):
            ok, err = _check_worker_ping()
        assert ok is False; assert "broker or backend URL" in str(err)

    def test_exception(self):
        from workers.health.e2e_check import _check_worker_ping
        with patch("workers.health.e2e_check.Celery") as mc, \
             patch("workers.health.e2e_check.BROKER_URL", "a"), \
             patch("workers.health.e2e_check.BACKEND_URL", "b"):
            mc.side_effect = RuntimeError("crashed")
            ok, err = _check_worker_ping()
        assert ok is False; assert "crashed" in str(err)


class TestCheckHttpEndpoints:
    def test_all_ok(self):
        from workers.health.e2e_check import _check_http_endpoints
        eps = [{"name":"a","url":"http://a/health"},{"name":"b","url":"http://b/health/"}]
        with patch("workers.health.e2e_check.httpx.get") as m:
            m.return_value = MagicMock(status_code=200)
            r = _check_http_endpoints(eps)
        assert len(r) == 2; assert all(x["status"] == "ok" for x in r)

    def test_one_fails(self):
        from workers.health.e2e_check import _check_http_endpoints
        eps = [{"name":"a","url":"http://a/health"},{"name":"b","url":"http://b/health/"}]
        with patch("workers.health.e2e_check.httpx.get") as m:
            m.side_effect = [MagicMock(status_code=200), RuntimeError("refused")]
            r = _check_http_endpoints(eps)
        assert r[0]["status"] == "ok"; assert r[1]["status"] == "error"

    def test_empty_url(self):
        from workers.health.e2e_check import _check_http_endpoints
        r = _check_http_endpoints([{"name":"x","url":""}])
        assert r[0]["status"] == "error"; assert "no URL configured" in r[0]["detail"]


class TestCheckQueueDepths:
    def test_all_within(self):
        from workers.health.e2e_check import _check_queue_depths
        with patch("workers.health.e2e_check.httpx.get") as m:
            m.return_value = MagicMock(status_code=200, json=lambda: {"messages":5})
            r = _check_queue_depths("http://localhost:15672", ["q1","q2"], 100)
        assert len(r) == 2; assert all(x["status"] == "ok" for x in r)

    def test_exceeds(self):
        from workers.health.e2e_check import _check_queue_depths
        with patch("workers.health.e2e_check.httpx.get") as m:
            m.return_value = MagicMock(status_code=200, json=lambda: {"messages":200})
            r = _check_queue_depths("http://localhost:15672", ["q1"], 100)
        assert r[0]["status"] == "critical"; assert "exceeds limit" in r[0]["detail"]

    def test_not_found(self):
        from workers.health.e2e_check import _check_queue_depths
        with patch("workers.health.e2e_check.httpx.get") as m:
            m.return_value = MagicMock(status_code=404)
            r = _check_queue_depths("http://localhost:15672", ["x"], 100)
        assert r[0]["status"] == "skipped"; assert "not found" in r[0]["detail"]

    def test_api_not_configured(self):
        from workers.health.e2e_check import _check_queue_depths
        r = _check_queue_depths("", ["q1"], 100)
        assert "skipped" in r[0]["note"]


class TestRunE2eHealthCheck:
    @patch("workers.health.e2e_check._check_broker")
    @patch("workers.health.e2e_check._check_backend")
    @patch("workers.health.e2e_check._check_worker_ping")
    @patch("workers.health.e2e_check._check_http_endpoints")
    @patch("workers.health.e2e_check._check_queue_depths")
    def test_all_pass(self, mq, mh, mp, mb2, mb1):
        from workers.health.e2e_check import run_e2e_health_check
        mb1.return_value = (True, None); mb2.return_value = (True, None)
        mp.return_value = (True, None); mh.return_value = [{"name":"a","status":"ok"}]
        mq.return_value = [{"queue":"q","status":"ok"}]
        r = run_e2e_health_check()
        assert r["status"] == "ok"; assert "elapsed_seconds" in r

    @patch("workers.health.e2e_check._check_broker")
    @patch("workers.health.e2e_check._check_backend")
    @patch("workers.health.e2e_check._check_worker_ping")
    @patch("workers.health.e2e_check._check_http_endpoints")
    @patch("workers.health.e2e_check._check_queue_depths")
    def test_broker_fail(self, mq, mh, mp, mb2, mb1):
        from workers.health.e2e_check import run_e2e_health_check
        mb1.return_value = (False, "broker down"); mb2.return_value = (True, None)
        mp.return_value = (True, None); mh.return_value = [{"name":"a","status":"ok"}]
        mq.return_value = [{"queue":"q","status":"ok"}]
        r = run_e2e_health_check()
        assert r["status"] != "ok"; assert r["checks"]["broker"]["detail"] == "broker down"

    @patch("workers.health.e2e_check._check_broker")
    @patch("workers.health.e2e_check._check_backend")
    @patch("workers.health.e2e_check._check_worker_ping")
    @patch("workers.health.e2e_check._check_http_endpoints")
    @patch("workers.health.e2e_check._check_queue_depths")
    def test_critical(self, mq, mh, mp, mb2, mb1):
        from workers.health.e2e_check import run_e2e_health_check
        mb1.return_value = (False, "x"); mb2.return_value = (False, "x")
        mp.return_value = (False, "x"); mh.return_value = [{"name":"a","status":"error"}]
        mq.return_value = [{"queue":"q","status":"error"}]
        r = run_e2e_health_check(); assert r["status"] == "critical"

    def test_registered(self):
        from workers.celery_app import app
        assert "workers.health.e2e_check.run_e2e_health_check" in app.tasks
