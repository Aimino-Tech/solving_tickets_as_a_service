"""Tests for the runaway agent protection (guard + middleware)."""

from __future__ import annotations

import os
import time
from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_runaway_state():
    """Remove any leftover lock files before and after each test."""
    lock_dir = "/tmp/stas-runaway"
    if os.path.isdir(lock_dir):
        for f in os.listdir(lock_dir):
            try:
                os.unlink(os.path.join(lock_dir, f))
            except (FileNotFoundError, OSError):
                pass
    yield
    if os.path.isdir(lock_dir):
        for f in os.listdir(lock_dir):
            try:
                os.unlink(os.path.join(lock_dir, f))
            except (FileNotFoundError, OSError):
                pass


@pytest.fixture
def guard_no_redis():
    """RunawayGuard with no Redis available (file-only mode)."""
    from workers.runaway.guard import RunawayGuard

    return RunawayGuard(redis_client=None)


@pytest.fixture
def guard_with_mock_redis():
    """RunawayGuard backed by a mock Redis client."""
    from workers.runaway.guard import RunawayGuard

    mock_redis = MagicMock()
    mock_redis.ping.return_value = True
    mock_redis.from_url.return_value = mock_redis
    return RunawayGuard(redis_client=mock_redis), mock_redis


# ---------------------------------------------------------------------------
# RunawayGuard — timeout enforcement
# ---------------------------------------------------------------------------


class TestRunawayGuardTimeout:

    def test_mark_start_records_epoch(self, guard_no_redis):
        task_id = "task-abc"
        guard_no_redis.mark_start(task_id)
        elapsed = guard_no_redis.get_elapsed(task_id)
        assert elapsed is not None
        assert elapsed >= 0.0

    def test_get_elapsed_returns_none_for_unknown(self, guard_no_redis):
        assert guard_no_redis.get_elapsed("nonexistent") is None

    def test_mark_complete_clears_state(self, guard_no_redis):
        task_id = "task-clear"
        guard_no_redis.mark_start(task_id)
        assert guard_no_redis.get_elapsed(task_id) is not None
        guard_no_redis.mark_complete(task_id)
        assert guard_no_redis.get_elapsed(task_id) is None

    def test_check_timeout_not_exceeded(self, guard_no_redis):
        task_id = "task-ok"
        guard_no_redis.mark_start(task_id)
        exceeded, reason = guard_no_redis.check_timeout(task_id, "test.task", (), {})
        assert exceeded is False
        assert reason == ""

    def test_check_timeout_exceeded(self, guard_no_redis, monkeypatch):
        task_id = "task-slow"
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_TIMEOUT_SECONDS", 60)
        guard_no_redis._redis_set(
            f"stas:runaway:{task_id}",
            str(int(time.time()) - 1000),
        )
        exceeded, reason = guard_no_redis.check_timeout(task_id, "test.task", (), {})
        assert exceeded is True
        assert "exceeded timeout" in reason

    def test_check_timeout_labels_issue(self, guard_no_redis, monkeypatch, mocker):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_TIMEOUT_SECONDS", 60)
        mock_label = mocker.patch("workers.runaway.guard._label_github_issue")
        task_id = "task-label"
        guard_no_redis._redis_set(
            f"stas:runaway:{task_id}",
            str(int(time.time()) - 1000),
        )
        kwargs = {
            "repo_full_name": "owner/repo",
            "issue_number": 42,
        }
        exceeded, reason = guard_no_redis.check_timeout(
            task_id, "test.task", (), kwargs,
        )
        assert exceeded is True
        mock_label.assert_called_once_with("owner/repo", 42)

    def test_check_timeout_deduplicates_label(self, guard_no_redis, monkeypatch, mocker):
        """Ensure the same issue is only labeled once."""
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_TIMEOUT_SECONDS", 60)
        mock_label = mocker.patch("workers.runaway.guard._label_github_issue")
        task_id = "task-dedup"
        guard_no_redis._redis_set(
            f"stas:runaway:{task_id}",
            str(int(time.time()) - 1000),
        )
        kwargs = {
            "repo_full_name": "owner/repo",
            "issue_number": 42,
        }
        # First call should label
        guard_no_redis.check_timeout(task_id, "test.task", (), kwargs)
        assert mock_label.call_count == 1

        # Second call should NOT label (deduplicated)
        guard_no_redis.check_timeout(task_id, "test.task", (), kwargs)
        assert mock_label.call_count == 1  # still 1

    def test_check_timeout_returns_false_for_unknown_task(self, guard_no_redis):
        exceeded, reason = guard_no_redis.check_timeout(
            "nonexistent", "test.task", (), {},
        )
        assert exceeded is False
        assert reason == ""


# ---------------------------------------------------------------------------
# RunawayGuard — token tracking
# ---------------------------------------------------------------------------


class TestRunawayGuardTokens:

    def test_track_tokens_increments(self, guard_no_redis):
        task_id = "task-tok"
        new_total = guard_no_redis.track_tokens(task_id, 150)
        assert new_total == 150
        assert guard_no_redis.get_tokens(task_id) == 150

    def test_track_tokens_accumulates(self, guard_no_redis):
        task_id = "task-tok2"
        guard_no_redis.track_tokens(task_id, 100)
        guard_no_redis.track_tokens(task_id, 50)
        assert guard_no_redis.get_tokens(task_id) == 150

    def test_get_tokens_returns_zero_for_unknown(self, guard_no_redis):
        assert guard_no_redis.get_tokens("nonexistent") == 0

    def test_check_token_limit_not_exceeded(self, guard_no_redis):
        task_id = "task-tok-ok"
        guard_no_redis.track_tokens(task_id, 500)
        exceeded, reason = guard_no_redis.check_token_limit(
            task_id, "test.task", (), {},
        )
        assert exceeded is False
        assert reason == ""

    def test_check_token_limit_exceeded(self, guard_no_redis, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_MAX_TOKENS", 100)
        task_id = "task-tok-exceed"
        guard_no_redis.track_tokens(task_id, 200)
        exceeded, reason = guard_no_redis.check_token_limit(
            task_id, "test.task", (), {},
        )
        assert exceeded is True
        assert "exceeded token limit" in reason

    def test_check_token_limit_no_tokens_skipped(self, guard_no_redis):
        task_id = "task-tok-zero"
        exceeded, reason = guard_no_redis.check_token_limit(
            task_id, "test.task", (), {},
        )
        assert exceeded is False
        assert reason == ""


# ---------------------------------------------------------------------------
# RunawayGuard — cost tracking
# ---------------------------------------------------------------------------


class TestRunawayGuardCost:

    def test_track_cost_increments(self, guard_no_redis):
        task_id = "task-cost"
        new_total = guard_no_redis.track_cost(task_id, 0.05)
        assert new_total == 0.05
        assert guard_no_redis.get_cost(task_id) == 0.05

    def test_track_cost_accumulates(self, guard_no_redis):
        task_id = "task-cost2"
        guard_no_redis.track_cost(task_id, 0.03)
        guard_no_redis.track_cost(task_id, 0.02)
        assert guard_no_redis.get_cost(task_id) == 0.05

    def test_get_cost_returns_zero_for_unknown(self, guard_no_redis):
        assert guard_no_redis.get_cost("nonexistent") == 0.0

    def test_check_cost_limit_not_exceeded(self, guard_no_redis):
        task_id = "task-cost-ok"
        guard_no_redis.track_cost(task_id, 0.10)
        exceeded, reason = guard_no_redis.check_cost_limit(
            task_id, "test.task", (), {},
        )
        assert exceeded is False

    def test_check_cost_limit_exceeded(self, guard_no_redis, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_MAX_COST", "1.0")
        task_id = "task-cost-exceed"
        guard_no_redis.track_cost(task_id, 5.0)
        exceeded, reason = guard_no_redis.check_cost_limit(
            task_id, "test.task", (), {},
        )
        assert exceeded is True
        assert "exceeded cost limit" in reason

    def test_check_cost_limit_no_cost_skipped(self, guard_no_redis):
        task_id = "task-cost-zero"
        exceeded, reason = guard_no_redis.check_cost_limit(
            task_id, "test.task", (), {},
        )
        assert exceeded is False
        assert reason == ""


# ---------------------------------------------------------------------------
# RunawayGuard — retry tracking
# ---------------------------------------------------------------------------


class TestRunawayGuardRetries:
    """Each test uses a unique session ID to avoid cross-test pollution."""

    _counter = 0

    def _unique_session(self) -> str:
        TestRunawayGuardRetries._counter += 1
        return f"session-{TestRunawayGuardRetries._counter:x}"

    def test_get_retry_count_zero_by_default(self, guard_no_redis):
        session = self._unique_session()
        assert guard_no_redis.get_retry_count(session) == 0

    def test_increment_retry(self, guard_no_redis):
        session = self._unique_session()
        count = guard_no_redis.increment_retry(session)
        assert count == 1
        assert guard_no_redis.get_retry_count(session) == 1

    def test_increment_retry_accumulates(self, guard_no_redis):
        session = self._unique_session()
        guard_no_redis.increment_retry(session)
        guard_no_redis.increment_retry(session)
        guard_no_redis.increment_retry(session)
        assert guard_no_redis.get_retry_count(session) == 3

    def test_reset_retries(self, guard_no_redis):
        session = self._unique_session()
        guard_no_redis.increment_retry(session)
        guard_no_redis.increment_retry(session)
        guard_no_redis.reset_retries(session)
        assert guard_no_redis.get_retry_count(session) == 0

    def test_check_retries_not_exceeded(self, guard_no_redis):
        session = self._unique_session()
        guard_no_redis.increment_retry(session)
        exceeded, reason = guard_no_redis.check_retries(
            session, "test.task", (), {},
        )
        assert exceeded is False

    def test_check_retries_exceeded(self, guard_no_redis):
        session = self._unique_session()
        guard_no_redis.increment_retry(session)
        guard_no_redis.increment_retry(session)
        guard_no_redis.increment_retry(session)
        exceeded, reason = guard_no_redis.check_retries(
            session, "test.task", (), {}, max_retries=3,
        )
        assert exceeded is True
        assert "exceeded max retries" in reason


# ---------------------------------------------------------------------------
# RunawayGuard — check_all (combined)
# ---------------------------------------------------------------------------


class TestRunawayGuardCheckAll:

    def test_check_all_passes_when_no_limits_exceeded(self, guard_no_redis):
        task_id = "task-all-ok"
        guard_no_redis.mark_start(task_id)
        guard_no_redis.track_tokens(task_id, 100)
        guard_no_redis.track_cost(task_id, 0.01)
        exceeded, reason = guard_no_redis.check_all(task_id, "test.task", (), {})
        assert exceeded is False
        assert reason == ""

    def test_check_all_returns_timeout_first(self, guard_no_redis, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_TIMEOUT_SECONDS", 60)
        task_id = "task-all-timeout"
        guard_no_redis._redis_set(
            f"stas:runaway:{task_id}",
            str(int(time.time()) - 1000),
        )
        guard_no_redis.track_tokens(task_id, 999999)
        exceeded, reason = guard_no_redis.check_all(task_id, "test.task", (), {})
        assert exceeded is True
        assert "timeout" in reason

    def test_check_all_returns_token_limit(self, guard_no_redis, monkeypatch):
        monkeypatch.setattr("workers.runaway.guard.DEFAULT_MAX_TOKENS", 100)
        task_id = "task-all-tokens"
        guard_no_redis.mark_start(task_id)
        guard_no_redis.track_tokens(task_id, 500)
        exceeded, reason = guard_no_redis.check_all(task_id, "test.task", (), {})
        assert exceeded is True
        assert "token limit" in reason


# ---------------------------------------------------------------------------
# RunawayGuard — tier-based limits
# ---------------------------------------------------------------------------


class TestRunawayGuardTiers:

    def test_get_tier_default(self, guard_no_redis):
        assert guard_no_redis.get_tier(None) == "free"

    def test_get_tier_from_env(self, guard_no_redis, monkeypatch):
        monkeypatch.setenv("STAS_DEFAULT_TIER", "pro")
        assert guard_no_redis.get_tier() == "pro"

    def test_get_limits_for_tier_returns_defaults_for_unknown(self, guard_no_redis):
        limits = guard_no_redis.get_limits_for_tier("nonexistent")
        assert limits["timeout_seconds"] > 0
        assert limits["max_tokens"] > 0

    def test_tier_limits_parsed_from_env(self, guard_no_redis, monkeypatch):
        monkeypatch.setenv(
            "STAS_RUNAWAY_TIER_LIMITS",
            "free=300,50000,5.0;pro=600,100000,10.0;enterprise=900,200000,20.0",
        )
        import importlib
        import workers.runaway.guard as g

        importlib.reload(g)
        guard = g.RunawayGuard(redis_client=None)

        free_limits = guard.get_limits_for_tier("free")
        assert free_limits["timeout_seconds"] == 300
        assert free_limits["max_tokens"] == 50000
        assert free_limits["max_cost"] == 5.0

        pro_limits = guard.get_limits_for_tier("pro")
        assert pro_limits["timeout_seconds"] == 600
        assert pro_limits["max_tokens"] == 100000

        enterprise_limits = guard.get_limits_for_tier("enterprise")
        assert enterprise_limits["timeout_seconds"] == 900


# ---------------------------------------------------------------------------
# RunawayGuard — Redis integration
# ---------------------------------------------------------------------------


class TestRunawayGuardRedis:

    def test_mark_start_writes_to_redis(self, guard_with_mock_redis):
        guard, mock_r = guard_with_mock_redis
        guard.mark_start("task-redis-1")
        mock_r.setex.assert_called_once()
        args = mock_r.setex.call_args[0]
        assert args[0].startswith("stas:runaway:")
        assert args[0].endswith("task-redis-1")

    def test_track_tokens_uses_incrby(self, guard_with_mock_redis):
        guard, mock_r = guard_with_mock_redis
        mock_r.incrby.return_value = 150
        result = guard.track_tokens("task-redis-2", 150)
        assert result == 150
        mock_r.incrby.assert_called_once()

    def test_track_cost_uses_incrbyfloat(self, guard_with_mock_redis):
        guard, mock_r = guard_with_mock_redis
        mock_r.incrbyfloat.return_value = "0.05"
        result = guard.track_cost("task-redis-3", 0.05)
        assert result == 0.05
        mock_r.incrbyfloat.assert_called_once()

    def test_mark_complete_deletes_redis_keys(self, guard_with_mock_redis):
        guard, mock_r = guard_with_mock_redis
        guard.mark_start("task-redis-del")
        guard.track_tokens("task-redis-del", 100)
        guard.track_cost("task-redis-del", 0.05)
        guard.mark_complete("task-redis-del")
        assert mock_r.delete.call_count >= 1


# ---------------------------------------------------------------------------
# _extract_repo_and_issue helper
# ---------------------------------------------------------------------------


class TestExtractRepoAndIssue:

    def test_extract_from_kwargs(self):
        from workers.runaway.guard import _extract_repo_and_issue

        repo, issue = _extract_repo_and_issue(
            (),
            {"repo_full_name": "owner/repo", "issue_number": 42},
        )
        assert repo == "owner/repo"
        assert issue == 42

    def test_extract_from_issue_context(self):
        from workers.runaway.guard import _extract_repo_and_issue

        repo, issue = _extract_repo_and_issue(
            (),
            {
                "issue_context": {
                    "repo_full_name": "org/project",
                    "issue_number": 7,
                },
            },
        )
        assert repo == "org/project"
        assert issue == 7

    def test_extract_from_positional_arg(self):
        from workers.runaway.guard import _extract_repo_and_issue

        repo, issue = _extract_repo_and_issue(
            ({"repo_full_name": "owner/repo", "issue_number": 99},),
            {},
        )
        assert repo == "owner/repo"
        assert issue == 99

    def test_extract_returns_none_when_missing(self):
        from workers.runaway.guard import _extract_repo_and_issue

        repo, issue = _extract_repo_and_issue((), {})
        assert repo is None
        assert issue is None


# ---------------------------------------------------------------------------
# _label_github_issue helper
# ---------------------------------------------------------------------------


class TestLabelGitHubIssue:

    def test_labels_issue(self, mocker):
        from workers.runaway.guard import _label_github_issue

        mock_client_class = mocker.patch("workers.runaway.guard.GitHubClient")
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client

        result = _label_github_issue("owner/repo", 42)
        assert result is True
        mock_client._request.assert_called_once_with(
            "POST",
            "/repos/owner/repo/issues/42/labels",
            json_body={"labels": ["stas:timeout"]},
        )

    def test_labels_issue_failure_returns_false(self, mocker):
        from workers.runaway.guard import _label_github_issue

        mock_client_class = mocker.patch("workers.runaway.guard.GitHubClient")
        mock_client = MagicMock()
        mock_client._request.side_effect = Exception("API error")
        mock_client_class.return_value = mock_client

        result = _label_github_issue("owner/repo", 42)
        assert result is False


# ---------------------------------------------------------------------------
# Middleware — _is_agent_task
# ---------------------------------------------------------------------------


class TestRunawayMiddlewareRouting:

    def test_is_agent_task(self):
        from workers.runaway.middleware import _is_agent_task

        assert _is_agent_task("workers.tasks.agent.dispatch_opencode") is True
        assert _is_agent_task("workers.tasks.triage.triage_issue") is True
        assert _is_agent_task("workers.tasks.sandbox.boot_sandbox") is True
        assert _is_agent_task("workers.tasks.verification.run_verification") is True
        assert _is_agent_task("workers.tasks.pr_creation.create_pull_request") is True
        assert _is_agent_task("workers.tasks.notifications.send_notification") is True
        assert _is_agent_task("workers.tasks.merge_queue.process_merge_queue") is True

    def test_allows_periodic_tasks(self):
        from workers.runaway.middleware import _is_agent_task

        assert _is_agent_task("workers.celery_app.ping") is False
        assert _is_agent_task("workers.tasks.periodic.queue_health_check") is False
        assert _is_agent_task("workers.tasks.periodic.dlq_cleanup") is False
        assert _is_agent_task("workers.tasks.periodic.push_metrics") is False
        assert _is_agent_task("workers.tasks.periodic.report_liveness") is False
        assert _is_agent_task("workers.tasks.sandbox_gc.sandbox_gc") is False

    def test_allows_unknown_tasks(self):
        from workers.runaway.middleware import _is_agent_task

        assert _is_agent_task("some.random.task") is False
        assert _is_agent_task("celery.internal.task") is False


# ---------------------------------------------------------------------------
# Middleware — signal handler
# ---------------------------------------------------------------------------


class TestRunawayMiddlewareSignal:

    def test_blocks_task_when_timeout_exceeded(self, mocker):
        from celery.exceptions import Ignore
        from workers.runaway.middleware import _check_runaway_before_task

        mock_guard = MagicMock()
        mock_guard.get_elapsed.return_value = None
        mock_guard.check_all.return_value = (True, "timeout exceeded")
        mocker.patch("workers.runaway.middleware._get_guard", return_value=mock_guard)

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        with pytest.raises(Ignore):
            _check_runaway_before_task("tid", task, (), {}, signal_kwargs={})

    def test_allows_task_when_within_limits(self, mocker):
        from workers.runaway.middleware import _check_runaway_before_task

        mock_guard = MagicMock()
        mock_guard.get_elapsed.return_value = None
        mock_guard.check_all.return_value = (False, "")
        mocker.patch("workers.runaway.middleware._get_guard", return_value=mock_guard)

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        _check_runaway_before_task("tid", task, (), {}, signal_kwargs={})

    def test_allows_periodic_unconditionally(self, mocker):
        from workers.runaway.middleware import _check_runaway_before_task

        mock_get_guard = mocker.patch("workers.runaway.middleware._get_guard")
        task = MagicMock()
        task.name = "workers.celery_app.ping"

        _check_runaway_before_task("tid", task, (), {}, signal_kwargs={})
        mock_get_guard.assert_not_called()

    def test_preserves_start_time_on_retry(self, mocker):
        from workers.runaway.middleware import _check_runaway_before_task

        mock_guard = MagicMock()
        mock_guard.get_elapsed.return_value = 10.0
        mock_guard.check_all.return_value = (False, "")
        mocker.patch("workers.runaway.middleware._get_guard", return_value=mock_guard)

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        _check_runaway_before_task("tid", task, (), {}, signal_kwargs={})
        mock_guard.mark_start.assert_not_called()


# ---------------------------------------------------------------------------
# Middleware — postrun cleanup
# ---------------------------------------------------------------------------


class TestRunawayMiddlewarePostrun:

    def test_cleans_up_on_success(self, mocker):
        from workers.runaway.middleware import _cleanup_after_task

        mock_guard = MagicMock()
        mocker.patch("workers.runaway.middleware._get_guard", return_value=mock_guard)

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        _cleanup_after_task("tid", task, "SUCCESS", signal_kwargs={})
        mock_guard.mark_complete.assert_called_once_with("tid")

    def test_cleans_up_on_ignored(self, mocker):
        from workers.runaway.middleware import _cleanup_after_task

        mock_guard = MagicMock()
        mocker.patch("workers.runaway.middleware._get_guard", return_value=mock_guard)

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        _cleanup_after_task("tid", task, "IGNORED", signal_kwargs={})
        mock_guard.mark_complete.assert_called_once_with("tid")

    def test_skips_cleanup_on_failure(self, mocker):
        from workers.runaway.middleware import _cleanup_after_task

        mock_guard = MagicMock()
        mocker.patch("workers.runaway.middleware._get_guard", return_value=mock_guard)

        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"

        _cleanup_after_task("tid", task, "FAILURE", signal_kwargs={})
        mock_guard.mark_complete.assert_not_called()

    def test_skips_cleanup_for_periodic(self, mocker):
        from workers.runaway.middleware import _cleanup_after_task

        mock_get_guard = mocker.patch("workers.runaway.middleware._get_guard")
        task = MagicMock()
        task.name = "workers.celery_app.ping"

        _cleanup_after_task("tid", task, "SUCCESS", signal_kwargs={})
        mock_get_guard.assert_not_called()


# ---------------------------------------------------------------------------
# Module import / integrity
# ---------------------------------------------------------------------------


class TestRunawayModuleIntegrity:

    def test_modules_importable(self):
        from workers.runaway import guard
        from workers.runaway import middleware

        assert guard is not None
        assert middleware is not None

    def test_get_runaway_guard_singleton(self):
        from workers.runaway.guard import get_runaway_guard

        a = get_runaway_guard()
        b = get_runaway_guard()
        assert a is b

    def test_connect_runaway_middleware_noop(self):
        from workers.runaway.middleware import connect_runaway_middleware

        connect_runaway_middleware()
