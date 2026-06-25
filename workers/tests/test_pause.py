"""Tests for pipeline pause/resume."""
import json
import os
import tempfile
import time
from unittest.mock import MagicMock, patch
import pytest


@pytest.fixture
def pause_state_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def pm(pause_state_dir):
    from workers.dispatch.pause import PauseManager
    return PauseManager(state_dir=pause_state_dir)


class TestPauseManager:

    def test_pause_sets_paused_state(self, pm):
        assert pm.is_paused("my-project") is False
        result = pm.pause("my-project", paused_by="test")
        assert result["paused"] is True
        assert pm.is_paused("my-project") is True

    def test_resume_clears_paused_state(self, pm):
        pm.pause("my-project", paused_by="test")
        assert pm.is_paused("my-project") is True
        result = pm.resume("my-project", resumed_by="test")
        assert result["paused"] is False
        assert pm.is_paused("my-project") is False

    def test_resume_is_idempotent(self, pm):
        pm.resume("my-project", resumed_by="test")
        assert pm.is_paused("my-project") is False
        pm.resume("my-project", resumed_by="test")
        assert pm.is_paused("my-project") is False

    def test_is_paused_returns_false_for_unknown(self, pm):
        assert pm.is_paused("nonexistent") is False

    def test_pause_and_resume_independent(self, pm):
        pm.pause("project-a", paused_by="test")
        pm.resume("project-b", resumed_by="test")
        assert pm.is_paused("project-a") is True
        assert pm.is_paused("project-b") is False

    def test_state_persists_across_instances(self, pause_state_dir):
        from workers.dispatch.pause import PauseManager
        pm1 = PauseManager(state_dir=pause_state_dir)
        pm1.pause("my-project", paused_by="admin")
        pm2 = PauseManager(state_dir=pause_state_dir)
        assert pm2.is_paused("my-project") is True
        assert pm2.get_status("my-project")["paused_by"] == "admin"

    def test_get_status_when_paused(self, pm):
        pm.pause("my-project", paused_by="ops")
        status = pm.get_status("my-project")
        assert status["paused"] is True
        assert status["paused_by"] == "ops"
        assert status["project_slug"] == "my-project"

    def test_get_status_when_not_paused(self, pm):
        status = pm.get_status("unknown")
        assert status["paused"] is False
        assert status["project_slug"] == "unknown"

    def test_list_paused(self, pm):
        pm.pause("project-a", paused_by="test")
        pm.pause("project-b", paused_by="test")
        pm.resume("project-c", resumed_by="test")
        paused = pm.list_paused()
        slugs = [p["project_slug"] for p in paused]
        assert "project-a" in slugs
        assert "project-b" in slugs
        assert "project-c" not in slugs
        assert len(paused) == 2

    def test_list_all(self, pm):
        pm.pause("project-a", paused_by="test")
        pm.resume("project-b", resumed_by="test")
        all_p = pm.list_all()
        assert len(all_p) == 2

    def test_concurrent_pause_resume(self, pm):
        import threading
        errors = []
        def toggle(n):
            try:
                for _ in range(n):
                    pm.pause("shared-project", paused_by="test")
                    pm.resume("shared-project", resumed_by="test")
            except Exception as e:
                errors.append(e)
        threads = [threading.Thread(target=toggle, args=(30,)) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert not errors


class TestPauseMiddleware:

    def test_is_dispatch_task(self):
        from workers.dispatch.pause_middleware import _is_dispatch_task
        assert _is_dispatch_task("workers.tasks.agent.dispatch_opencode") is True
        assert _is_dispatch_task("workers.tasks.linear_poll.triage") is True
        assert _is_dispatch_task("workers.tasks.periodic.queue_health_check") is False
        assert _is_dispatch_task("workers.celery_app.ping") is False
        assert _is_dispatch_task("some.random.task") is False

    def test_extract_project_slug(self):
        from workers.dispatch.pause_middleware import _extract_project_slug
        task = MagicMock()
        assert _extract_project_slug(task, (), {"project_slug": "my-proj"}) == "my-proj"
        assert _extract_project_slug(task, (), {"issue_context": {"project_slug": "p"}}) == "p"
        assert _extract_project_slug(task, (), {"issue_context": {"repo_full_name": "o/r"}}) == "o/r"
        assert _extract_project_slug(task, (), {"identifier": "PROJ-123"}) == "proj"
        assert _extract_project_slug(task, (), {}) is None

    @patch("workers.dispatch.pause_middleware._get_pm")
    def test_blocks_dispatch_when_paused(self, mock_get_pm):
        from celery.exceptions import Ignore
        from workers.dispatch.pause_middleware import _check_pause_before_dispatch
        mock_pm = MagicMock()
        mock_pm.is_paused.return_value = True
        mock_get_pm.return_value = mock_pm
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        with pytest.raises(Ignore):
            _check_pause_before_dispatch("tid", task, (), {"project_slug": "my-proj"}, signal_kwargs={})

    @patch("workers.dispatch.pause_middleware._get_pm")
    def test_allows_when_not_paused(self, mock_get_pm):
        from workers.dispatch.pause_middleware import _check_pause_before_dispatch
        mock_pm = MagicMock()
        mock_pm.is_paused.return_value = False
        mock_get_pm.return_value = mock_pm
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        _check_pause_before_dispatch("tid", task, (), {"project_slug": "my-proj"}, signal_kwargs={})

    @patch("workers.dispatch.pause_middleware._get_pm")
    def test_allows_when_project_unknown(self, mock_get_pm):
        from workers.dispatch.pause_middleware import _check_pause_before_dispatch
        mock_pm = MagicMock()
        mock_get_pm.return_value = mock_pm
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        _check_pause_before_dispatch("tid", task, (), {}, signal_kwargs={})
        mock_pm.is_paused.assert_not_called()


class TestPollPauseIntegration:

    @patch("workers.tasks.linear_poll.get_pause_manager")
    @patch("workers.tasks.linear_poll.get_issues_by_state")
    @patch("workers.tasks.linear_poll.triage")
    def test_skips_paused(self, mock_triage, mock_get_issues, mock_get_pm):
        from workers.tasks.linear_poll import poll_active_issues, _is_tracked
        _is_tracked.clear()
        mock_pm = MagicMock()
        mock_pm.is_paused.side_effect = lambda slug: slug == "paused-team"
        mock_get_pm.return_value = mock_pm
        paused = {"id": "p1", "identifier": "P-1", "title": "Paused", "team": {"key": "paused-team"}, "labels": {"nodes": [{"name": "stas:fix"}]}}
        active = {"id": "a1", "identifier": "A-1", "title": "Active", "team": {"key": "ACTIVE"}, "labels": {"nodes": [{"name": "stas:fix"}]}}
        mock_get_issues.return_value = [paused, active]
        result = poll_active_issues.run()
        assert result["skipped_paused"] == 1
        assert result["dispatched"] == 1
        mock_triage.delay.assert_called_once_with(issue_id="a1", identifier="A-1", pipeline="default", title="Active")

    @patch("workers.tasks.linear_poll.get_pause_manager")
    @patch("workers.tasks.linear_poll.get_issues_by_state")
    @patch("workers.tasks.linear_poll.triage")
    def test_dispatches_all_when_none_paused(self, mock_triage, mock_get_issues, mock_get_pm):
        from workers.tasks.linear_poll import poll_active_issues, _is_tracked
        _is_tracked.clear()
        mock_pm = MagicMock()
        mock_pm.is_paused.return_value = False
        mock_get_pm.return_value = mock_pm
        issues = [
            {"id": "i1", "identifier": "T-1", "title": "Issue 1", "team": {"key": "TEAM"}, "labels": {"nodes": []}},
            {"id": "i2", "identifier": "T-2", "title": "Issue 2", "team": {"key": "TEAM"}, "labels": {"nodes": []}},
        ]
        mock_get_issues.return_value = issues
        result = poll_active_issues.run()
        assert result["skipped_paused"] == 0
        assert result["dispatched"] == 2


class TestPauseAPI:

    def test_pause_and_resume(self, pause_state_dir):
        from workers.dispatch.pause import PauseManager
        pm = PauseManager(state_dir=pause_state_dir)
        pm.pause("my-project", paused_by="api")
        assert pm.is_paused("my-project") is True
        pm.resume("my-project", resumed_by="api")
        assert pm.is_paused("my-project") is False

    def test_get_status(self, pause_state_dir):
        from workers.dispatch.pause import PauseManager
        pm = PauseManager(state_dir=pause_state_dir)
        pm.pause("my-project", paused_by="api")
        status = pm.get_status("my-project")
        assert status["paused"] is True

    def test_list_paused(self, pause_state_dir):
        from workers.dispatch.pause import PauseManager
        pm = PauseManager(state_dir=pause_state_dir)
        pm.pause("project-a", paused_by="api")
        pm.pause("project-b", paused_by="api")
        assert len(pm.list_paused()) == 2
        pm.resume("project-b", resumed_by="api")
        assert len(pm.list_paused()) == 1


class TestInFlightNotInterrupted:

    def test_pause_does_not_affect_existing_tasks(self, pm):
        pm.pause("my-project", paused_by="test")
        assert pm.is_paused("my-project") is True


def test_poll_task_registered():
    from workers.celery_app import app
    task_name = "workers.tasks.linear_poll.poll_active_issues"
    from workers.tasks.linear_poll import poll_active_issues
    assert task_name in app.tasks
