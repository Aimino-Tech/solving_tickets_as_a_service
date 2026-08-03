"""Tests for per-issue duplicate job prevention."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestDedupManager:

    @pytest.fixture
    def fake_redis(self):
        _store: dict = {}

        class FakeStrictRedis:
            def set(self, key, value, nx=False, ex=None):
                if nx and key in _store:
                    return False
                _store[key] = value
                return True

            def delete(self, key):
                return _store.pop(key, None) is not None

            def exists(self, key):
                return 1 if key in _store else 0

        return FakeStrictRedis()

    @pytest.fixture
    def dm(self, fake_redis):
        from workers.dispatch.dedup import DedupManager

        mgr = DedupManager(redis_url="redis://localhost:6379/0")
        mgr._client = fake_redis
        return mgr

    def test_acquire_returns_true_first_time(self, dm):
        assert dm.acquire("issue-1") is True

    def test_acquire_returns_false_when_locked(self, dm):
        assert dm.acquire("issue-1") is True
        assert dm.acquire("issue-1") is False

    def test_release_allows_reacquire(self, dm):
        assert dm.acquire("issue-1") is True
        dm.release("issue-1")
        assert dm.acquire("issue-1") is True

    def test_is_locked_returns_true_when_locked(self, dm):
        dm.acquire("issue-1")
        assert dm.is_locked("issue-1") is True

    def test_is_locked_returns_false_when_not_locked(self, dm):
        assert dm.is_locked("nonexistent") is False

    def test_is_locked_after_release(self, dm):
        dm.acquire("issue-1")
        dm.release("issue-1")
        assert dm.is_locked("issue-1") is False

    def test_acquire_different_issues_independent(self, dm):
        assert dm.acquire("issue-a") is True
        assert dm.acquire("issue-b") is True
        assert dm.is_locked("issue-a") is True
        assert dm.is_locked("issue-b") is True

    def test_clear_aliases_release(self, dm):
        dm.acquire("issue-1")
        dm.clear("issue-1")
        assert dm.is_locked("issue-1") is False

    def test_ttl_applied(self, dm):
        original_set = dm._get_client().set

        def tracking_set(key, value, nx=False, ex=None):
            assert nx is True
            assert ex is not None
            assert ex > 0
            return original_set(key, value, nx=nx, ex=ex)

        with patch.object(dm._get_client(), "set", side_effect=tracking_set) as mock_set:
            dm.acquire("issue-ttl", ttl=7200)
            mock_set.assert_called_once_with(
                "syntaro:dedup:issue-ttl", "1", nx=True, ex=7200
            )

    def test_acquire_fails_open_on_redis_error(self, dm):
        dm._client = MagicMock()
        dm._client.set.side_effect = Exception("Connection refused")
        assert dm.acquire("issue-1") is True

    def test_is_locked_false_on_redis_error(self, dm):
        dm._client = MagicMock()
        dm._client.exists.side_effect = Exception("Connection refused")
        assert dm.is_locked("issue-1") is False

    def test_release_silent_on_redis_error(self, dm):
        dm._client = MagicMock()
        dm._client.delete.side_effect = Exception("Connection refused")
        dm.release("issue-1")

    def test_key_prefix(self, dm):
        with patch.object(dm._get_client(), "set", return_value=True) as mock_set:
            dm.acquire("my-issue")
            mock_set.assert_called_once_with(
                "syntaro:dedup:my-issue", "1", nx=True, ex=3600
            )

    def test_dedup_manager_singleton(self):
        from workers.dispatch.dedup import get_dedup_manager

        m1 = get_dedup_manager()
        m2 = get_dedup_manager()
        assert m1 is m2


class TestDedupMiddleware:

    def test_is_dispatch_task(self):
        from workers.dispatch.dedup_middleware import _is_dispatch_task

        assert _is_dispatch_task("workers.tasks.agent.dispatch_opencode") is True
        assert _is_dispatch_task("workers.tasks.linear_poll.triage") is True
        assert _is_dispatch_task("workers.tasks.linear_poll.poll_active_issues") is True
        assert (
            _is_dispatch_task("workers.tasks.pipeline_orchestrator.orchestrate_pipeline")
            is True
        )
        assert _is_dispatch_task("workers.tasks.periodic.queue_health_check") is False
        assert _is_dispatch_task("workers.celery_app.ping") is False
        assert _is_dispatch_task("some.random.task") is False
        assert _is_dispatch_task("workers.tasks.agent.other_task") is True
        assert _is_dispatch_task("workers.tasks.linear_poll.other") is True

    def test_extract_issue_id_from_kwargs(self):
        from workers.dispatch.dedup_middleware import _extract_issue_id

        task = MagicMock()
        assert _extract_issue_id(task, (), {"issue_id": "ISSUE-42"}) == "ISSUE-42"
        assert _extract_issue_id(task, (), {"issue_id": 123}) == "123"

    def test_extract_issue_id_from_issue_context_kwargs(self):
        from workers.dispatch.dedup_middleware import _extract_issue_id

        task = MagicMock()
        result = _extract_issue_id(
            task, (), {"issue_context": {"issue_id": "ctx-99"}}
        )
        assert result == "ctx-99"

    def test_extract_issue_id_from_args(self):
        from workers.dispatch.dedup_middleware import _extract_issue_id

        task = MagicMock()
        result = _extract_issue_id(task, ({"issue_id": "arg-1"},), {})
        assert result == "arg-1"

    def test_extract_issue_id_from_args_url_fallback(self):
        from workers.dispatch.dedup_middleware import _extract_issue_id

        task = MagicMock()
        result = _extract_issue_id(
            task, ({"issue_url": "https://github.com/o/r/issues/5"},), {}
        )
        assert "https://github.com/o/r/issues/5" in result

    def test_extract_issue_id_returns_none_when_missing(self):
        from workers.dispatch.dedup_middleware import _extract_issue_id

        task = MagicMock()
        assert _extract_issue_id(task, (), {}) is None
        assert _extract_issue_id(task, ({"other": "data"},), {}) is None

    @patch("workers.dispatch.dedup_middleware._get_dm")
    def test_blocks_dispatch_when_duplicate(self, mock_get_dm):
        from celery.exceptions import Ignore
        from workers.dispatch.dedup_middleware import _dedup_before_dispatch

        mock_dm = MagicMock()
        mock_dm.acquire.return_value = False
        mock_get_dm.return_value = mock_dm

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        with pytest.raises(Ignore):
            _dedup_before_dispatch(
                "task-123", task, (), {"issue_id": "ISSUE-1"}, signal_kwargs={}
            )

    @patch("workers.dispatch.dedup_middleware._get_dm")
    def test_allows_first_dispatch(self, mock_get_dm):
        from workers.dispatch.dedup_middleware import _dedup_before_dispatch
        from workers.dispatch.dedup_middleware import _ACQUIRED_LOCKS

        _ACQUIRED_LOCKS.clear()
        mock_dm = MagicMock()
        mock_dm.acquire.return_value = True
        mock_get_dm.return_value = mock_dm

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        _dedup_before_dispatch(
            "task-456", task, (), {"issue_id": "ISSUE-2"}, signal_kwargs={}
        )
        assert _ACQUIRED_LOCKS.get("task-456") == "ISSUE-2"
        _ACQUIRED_LOCKS.clear()

    @patch("workers.dispatch.dedup_middleware._get_dm")
    def test_allows_when_issue_unknown(self, mock_get_dm):
        from workers.dispatch.dedup_middleware import _dedup_before_dispatch

        mock_dm = MagicMock()
        mock_get_dm.return_value = mock_dm

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        _dedup_before_dispatch("task-789", task, (), {}, signal_kwargs={})
        mock_dm.acquire.assert_not_called()

    def test_skips_non_dispatch_tasks(self):
        from workers.dispatch.dedup_middleware import _dedup_before_dispatch

        mock_dm = MagicMock()

        task = MagicMock()
        task.name = "workers.tasks.periodic.queue_health_check"

        _dedup_before_dispatch(
            "task-111", task, (), {"issue_id": "ISSUE-3"}, signal_kwargs={}
        )
        mock_dm.acquire.assert_not_called()

    @patch("workers.dispatch.dedup_middleware._get_dm")
    def test_release_on_success(self, mock_get_dm):
        from workers.dispatch.dedup_middleware import (
            _ACQUIRED_LOCKS,
            _dedup_release_on_success,
        )

        _ACQUIRED_LOCKS.clear()
        _ACQUIRED_LOCKS["task-1"] = "ISSUE-1"

        mock_dm = MagicMock()
        mock_get_dm.return_value = mock_dm

        _dedup_release_on_success(sender=None, task_id="task-1")
        mock_dm.release.assert_called_once_with("ISSUE-1")
        assert "task-1" not in _ACQUIRED_LOCKS

    @patch("workers.dispatch.dedup_middleware._get_dm")
    def test_release_on_failure(self, mock_get_dm):
        from workers.dispatch.dedup_middleware import (
            _ACQUIRED_LOCKS,
            _dedup_release_on_failure,
        )

        _ACQUIRED_LOCKS.clear()
        _ACQUIRED_LOCKS["task-2"] = "ISSUE-2"

        mock_dm = MagicMock()
        mock_get_dm.return_value = mock_dm

        _dedup_release_on_failure(sender=None, task_id="task-2")
        mock_dm.release.assert_called_once_with("ISSUE-2")
        assert "task-2" not in _ACQUIRED_LOCKS

    @patch("workers.dispatch.dedup_middleware._get_dm")
    def test_release_on_postrun_safety_net(self, mock_get_dm):
        from workers.dispatch.dedup_middleware import (
            _ACQUIRED_LOCKS,
            _dedup_release_on_postrun,
        )

        _ACQUIRED_LOCKS.clear()
        _ACQUIRED_LOCKS["task-3"] = "ISSUE-3"

        mock_dm = MagicMock()
        mock_get_dm.return_value = mock_dm

        _dedup_release_on_postrun(sender=None, task_id="task-3")
        mock_dm.release.assert_called_once_with("ISSUE-3")
        assert "task-3" not in _ACQUIRED_LOCKS

    @patch("workers.dispatch.dedup_middleware._get_dm")
    def test_no_release_when_task_not_tracked(self, mock_get_dm):
        from workers.dispatch.dedup_middleware import (
            _ACQUIRED_LOCKS,
            _dedup_release_on_success,
        )

        _ACQUIRED_LOCKS.clear()
        mock_dm = MagicMock()
        mock_get_dm.return_value = mock_dm

        _dedup_release_on_success(sender=None, task_id="unknown-task")
        mock_dm.release.assert_not_called()

    def test_connect_dedup_middleware_does_not_raise(self):
        from workers.dispatch.dedup_middleware import connect_dedup_middleware

        connect_dedup_middleware()

    @patch("workers.dispatch.dedup_middleware._get_dm")
    def test_full_lifecycle(self, mock_get_dm):
        from celery.exceptions import Ignore
        from workers.dispatch.dedup_middleware import (
            _ACQUIRED_LOCKS,
            _dedup_before_dispatch,
            _dedup_release_on_success,
        )

        _ACQUIRED_LOCKS.clear()
        mock_dm = MagicMock()

        mock_dm.acquire.return_value = True
        mock_get_dm.return_value = mock_dm

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        _dedup_before_dispatch("task-1", task, (), {"issue_id": "ISSUE-1"}, signal_kwargs={})
        assert _ACQUIRED_LOCKS["task-1"] == "ISSUE-1"

        mock_dm.acquire.return_value = False
        task2 = MagicMock()
        task2.name = "workers.tasks.agent.dispatch_opencode"
        with pytest.raises(Ignore):
            _dedup_before_dispatch(
                "task-2", task2, (), {"issue_id": "ISSUE-1"}, signal_kwargs={}
            )

        _dedup_release_on_success(sender=None, task_id="task-1")
        mock_dm.release.assert_called_once_with("ISSUE-1")
        assert "task-1" not in _ACQUIRED_LOCKS

        mock_dm.acquire.return_value = True
        _dedup_before_dispatch("task-3", task, (), {"issue_id": "ISSUE-1"}, signal_kwargs={})
        assert _ACQUIRED_LOCKS["task-3"] == "ISSUE-1"
        _ACQUIRED_LOCKS.clear()
