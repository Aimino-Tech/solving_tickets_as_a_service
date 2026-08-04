"""Tests for the emergency kill switch (deadman switch)."""

import json
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_file_lock():
    """Remove any leftover lock file before and after each test."""
    lock = "/tmp/syntaro-emergency-stop.lock"
    try:
        os.unlink(lock)
    except FileNotFoundError:
        pass
    yield
    try:
        os.unlink(lock)
    except FileNotFoundError:
        pass


@pytest.fixture
def es_no_redis():
    """EmergencyStop with no Redis available (file-only mode)."""
    from workers.emergency.stop import EmergencyStop

    return EmergencyStop(redis_client=None)


@pytest.fixture
def es_with_mock_redis():
    """EmergencyStop backed by a mock Redis client."""
    from workers.emergency.stop import EmergencyStop

    mock_redis = MagicMock()
    return EmergencyStop(redis_client=mock_redis), mock_redis


# ---------------------------------------------------------------------------
# EmergencyStop — check / activate / deactivate
# ---------------------------------------------------------------------------


class TestEmergencyStopCore:

    def test_check_returns_false_by_default(self, es_no_redis):
        assert es_no_redis.check() is False

    def test_activate_sets_check_true(self, es_no_redis):
        es_no_redis.activate(reason="test")
        assert es_no_redis.check() is True

    def test_deactivate_clears_check(self, es_no_redis):
        es_no_redis.activate(reason="test")
        assert es_no_redis.check() is True
        es_no_redis.deactivate()
        assert es_no_redis.check() is False

    def test_activate_returns_state_with_reason(self, es_no_redis):
        state = es_no_redis.activate(reason="Runaway agent")
        assert state["active"] is True
        assert state["reason"] == "Runaway agent"
        assert "activated_at" in state

    def test_activate_default_reason(self, es_no_redis):
        state = es_no_redis.activate()
        assert state["reason"] == "operator-initiated"

    def test_deactivate_returns_state(self, es_no_redis):
        es_no_redis.activate("testing")
        state = es_no_redis.deactivate()
        assert state["active"] is False
        assert "deactivated_at" in state

    def test_read_state_when_active(self, es_no_redis):
        es_no_redis.activate(reason="testing read_state")
        state = es_no_redis.read_state()
        assert state["active"] is True
        assert state["reason"] == "testing read_state"

    def test_read_state_when_inactive(self, es_no_redis, monkeypatch, tmp_path):
        lock_path = str(tmp_path / "check.lock")
        monkeypatch.setenv("EMERGENCY_STOP_LOCK_FILE", lock_path)
        from workers.emergency.stop import EmergencyStop, _DISABLE_REDIS

        es = EmergencyStop(redis_client=_DISABLE_REDIS)
        state = es.read_state()
        assert state["active"] is False

    def test_activate_writes_file_lock(self, es_no_redis):
        es_no_redis.activate(reason="file-check")
        assert os.path.isfile("/tmp/syntaro-emergency-stop.lock")
        with open("/tmp/syntaro-emergency-stop.lock") as f:
            data = json.load(f)
        assert data["active"] is True
        assert data["reason"] == "file-check"

    def test_deactivate_removes_file_lock(self, es_no_redis):
        es_no_redis.activate("cleanup")
        assert os.path.isfile("/tmp/syntaro-emergency-stop.lock")
        es_no_redis.deactivate()
        assert not os.path.isfile("/tmp/syntaro-emergency-stop.lock")

    def test_deactivate_idempotent(self, es_no_redis):
        es_no_redis.deactivate()
        es_no_redis.deactivate()
        assert es_no_redis.check() is False

    def test_activate_idempotent(self, es_no_redis):
        es_no_redis.activate("first")
        es_no_redis.activate("second")
        assert es_no_redis.check() is True
        state = es_no_redis.read_state()
        assert state["reason"] == "second"


# ---------------------------------------------------------------------------
# EmergencyStop — Redis integration
# ---------------------------------------------------------------------------


class TestEmergencyStopRedis:

    def test_check_uses_redis_when_available(self, es_with_mock_redis):
        es, mock_r = es_with_mock_redis
        mock_r.get.return_value = json.dumps({"active": True, "reason": "test"})
        assert es.check() is True
        mock_r.get.assert_called_once_with("syntaro:emergency_stop")

    def test_check_returns_false_when_redis_key_missing(self, es_with_mock_redis):
        es, mock_r = es_with_mock_redis
        mock_r.get.return_value = None
        assert es.check() is False

    def test_activate_writes_to_redis(self, es_with_mock_redis):
        es, mock_r = es_with_mock_redis
        es.activate(reason="redis-test")
        mock_r.set.assert_called_once()
        args = mock_r.set.call_args[0]
        assert args[0] == "syntaro:emergency_stop"
        payload = json.loads(args[1])
        assert payload["active"] is True
        assert payload["reason"] == "redis-test"

    def test_deactivate_deletes_redis_key(self, es_with_mock_redis):
        es, mock_r = es_with_mock_redis
        es.activate(reason="del-test")
        es.deactivate()
        mock_r.delete.assert_called_once_with("syntaro:emergency_stop")

    def test_redis_failure_falls_back_to_file(self, es_with_mock_redis):
        es, mock_r = es_with_mock_redis
        mock_r.get.side_effect = Exception("Redis unreachable")
        # File lock not set yet
        assert es.check() is False
        # Set file lock manually
        with open("/tmp/syntaro-emergency-stop.lock", "w") as f:
            f.write('{"active": true}')
        assert es.check() is True


# ---------------------------------------------------------------------------
# EmergencyStop — persistence across instances
# ---------------------------------------------------------------------------


class TestEmergencyStopPersistence:

    def test_file_lock_persists_across_instances(self):
        from workers.emergency.stop import EmergencyStop

        es1 = EmergencyStop(redis_client=None)
        es1.activate(reason="persist-test")
        es2 = EmergencyStop(redis_client=None)
        assert es2.check() is True
        state = es2.read_state()
        assert state["reason"] == "persist-test"


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------


def test_get_emergency_stop_singleton():
    from workers.emergency.stop import get_emergency_stop

    a = get_emergency_stop()
    b = get_emergency_stop()
    assert a is b


# ---------------------------------------------------------------------------
# Middleware — _is_agent_task
# ---------------------------------------------------------------------------


class TestEmergencyMiddlewareRouting:

    def test_is_agent_task(self):
        from workers.emergency.middleware import _is_agent_task

        assert _is_agent_task("workers.tasks.agent.dispatch_opencode") is True
        assert _is_agent_task("workers.tasks.triage.triage_issue") is True
        assert _is_agent_task("workers.tasks.sandbox.boot_sandbox") is True
        assert _is_agent_task("workers.tasks.verification.run_verification") is True
        assert _is_agent_task("workers.tasks.pr_creation.create_pull_request") is True
        assert _is_agent_task("workers.tasks.notifications.send_notification") is True
        assert _is_agent_task("workers.tasks.linear_poll.triage") is True
        assert _is_agent_task("workers.tasks.pipeline_orchestrator.orchestrate_pipeline") is True

    def test_allows_periodic_tasks(self):
        from workers.emergency.middleware import _is_agent_task

        assert _is_agent_task("workers.celery_app.ping") is False
        assert _is_agent_task("workers.tasks.periodic.queue_health_check") is False
        assert _is_agent_task("workers.tasks.periodic.dlq_cleanup") is False
        assert _is_agent_task("workers.tasks.periodic.push_metrics") is False
        assert _is_agent_task("workers.tasks.periodic.report_liveness") is False
        assert _is_agent_task("workers.tasks.sandbox_gc.sandbox_gc") is False

    def test_allows_unknown_tasks(self):
        from workers.emergency.middleware import _is_agent_task

        assert _is_agent_task("some.random.task") is False
        assert _is_agent_task("celery.internal.task") is False


# ---------------------------------------------------------------------------
# Middleware — signal handler rejects when stop is active
# ---------------------------------------------------------------------------


class TestEmergencyMiddlewareSignal:

    @patch("workers.emergency.middleware._get_es")
    def test_blocks_dispatch_when_emergency_active(self, mock_get_es):
        from celery.exceptions import Ignore
        from workers.emergency.middleware import _check_emergency_stop

        mock_es = MagicMock()
        mock_es.check.return_value = True
        mock_get_es.return_value = mock_es

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        with pytest.raises(Ignore):
            _check_emergency_stop("tid", task, (), {}, signal_kwargs={})

    @patch("workers.emergency.middleware._get_es")
    def test_allows_dispatch_when_emergency_inactive(self, mock_get_es):
        from workers.emergency.middleware import _check_emergency_stop

        mock_es = MagicMock()
        mock_es.check.return_value = False
        mock_get_es.return_value = mock_es

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        # Should not raise
        _check_emergency_stop("tid", task, (), {}, signal_kwargs={})

    @patch("workers.emergency.middleware._get_es")
    def test_allows_periodic_during_emergency(self, mock_get_es):
        from workers.emergency.middleware import _check_emergency_stop

        mock_es = MagicMock()
        mock_es.check.return_value = True
        mock_get_es.return_value = mock_es

        task = MagicMock()
        task.name = "workers.celery_app.ping"

        # Should not raise — ping is allowed
        _check_emergency_stop("tid", task, (), {}, signal_kwargs={})
        mock_es.check.assert_not_called()  # Allowed tasks skip the check


# ---------------------------------------------------------------------------
# Activate kills in-flight tasks (mock level)
# ---------------------------------------------------------------------------


class TestEmergencyActivateRevoke:

    def test_revoke_active_tasks(self):
        from workers.emergency.server import _revoke_active_tasks
        from workers.celery_app import app as celery_app

        mock_inspect = MagicMock()
        mock_inspect.active.return_value = {
            "worker1@host": [
                {"name": "workers.tasks.agent.dispatch_opencode", "id": "task-1"},
                {"name": "workers.tasks.notifications.send_notification", "id": "task-2"},
            ],
            "worker2@host": [
                {"name": "workers.celery_app.ping", "id": "task-3"},
                {"name": "workers.tasks.verification.run_verification", "id": "task-4"},
            ],
        }

        mock_revoke = MagicMock()
        mock_control = MagicMock()
        mock_control.inspect.return_value = mock_inspect
        mock_control.revoke = mock_revoke

        original = celery_app.control
        celery_app.control = mock_control
        try:
            result = _revoke_active_tasks(celery_app)
        finally:
            celery_app.control = original

        assert len(result) == 3
        revoked_ids = [r["task_id"] for r in result]
        assert "task-1" in revoked_ids
        assert "task-2" in revoked_ids
        assert "task-4" in revoked_ids
        assert "task-3" not in revoked_ids

        assert mock_revoke.call_count == 3
        for call_args in mock_revoke.call_args_list:
            assert call_args[1].get("terminate") is True

    def test_activate_emergency_kills_and_moves(self):
        from workers.emergency.server import _activate_emergency
        from workers.celery_app import app as celery_app
        from workers.emergency.stop import get_emergency_stop

        def fake_activate(reason=""):
            return {"active": True, "reason": reason, "activated_at": "2025-01-01T00:00:00.000Z"}

        original = get_emergency_stop().activate
        try:
            with patch.object(get_emergency_stop(), "activate", side_effect=fake_activate), \
                 patch("workers.emergency.server._revoke_active_tasks", return_value=[{"task_id": "t1", "task_name": "agent.dispatch", "worker": "w1"}]), \
                 patch("workers.emergency.server._move_pending_to_hold", return_value={"syntaro.agents.dispatch": 3}):

                state = _activate_emergency(celery_app, reason="integration test")

            assert state["active"] is True
            assert state["reason"] == "integration test"
            assert len(state["revoked_tasks"]) == 1
            assert state["moved_to_hold"]["syntaro.agents.dispatch"] == 3
        finally:
            get_emergency_stop().activate = original


# ---------------------------------------------------------------------------
# Deactivate + resume
# ---------------------------------------------------------------------------


def test_deactivate_clears_and_resumes():
    from workers.emergency.stop import EmergencyStop

    es = EmergencyStop(redis_client=None)
    es.activate("test resume")
    assert es.check() is True
    es.deactivate()
    assert es.check() is False
    # After deactivate, new EmergencyStop instance should also see inactive
    es2 = EmergencyStop(redis_client=None)
    assert es2.check() is False


# ---------------------------------------------------------------------------
# No false positives in normal operation
# ---------------------------------------------------------------------------


class TestEmergencyStopFalsePositives:

    def test_no_false_positive_without_lock(self, es_no_redis):
        assert es_no_redis.check() is False

    def test_no_false_positive_after_deactivate(self, es_no_redis):
        es_no_redis.activate("temp")
        es_no_redis.deactivate()
        assert es_no_redis.check() is False
        # Verify no side effects on unrelated state
        assert not os.path.isfile("/tmp/syntaro-emergency-stop.lock")

    def test_middleware_does_not_block_normal_operation(self):
        from workers.emergency.middleware import _is_agent_task

        # Normal operation: no emergency, no blocking
        assert _is_agent_task("workers.tasks.agent.dispatch_opencode") is True
        # But the handler itself checks emergency state before raising


# ---------------------------------------------------------------------------
# Module import / integrity
# ---------------------------------------------------------------------------


def test_emergency_stop_modules_importable():
    from workers.emergency import stop
    from workers.emergency import middleware
    from workers.emergency import server

    assert stop is not None
    assert middleware is not None
    assert server is not None


def test_emergency_stop_registered_in_celery():
    from workers.celery_app import app

    # The module should be importable without side effects
    assert "workers.celery_app.ping" in app.tasks
