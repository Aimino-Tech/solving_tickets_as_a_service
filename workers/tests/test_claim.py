"""Tests for Redis-based duplicate job claim mechanism."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from workers.dispatch.claim import (
    ClaimManager,
    _extract_issue_id,
    _is_claimable_task,
    claim,
    get_claim_manager,
)


class TestClaimManager:

    def test_claim_acquired(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.set.return_value = True
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        result = mgr.claim("issue-1", "worker-a", ttl=300)
        assert result is True
        fake.set.assert_called_once_with("stas:claim:issue-1", "worker-a", nx=True, ex=300)

    def test_claim_already_held(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.set.return_value = False
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        result = mgr.claim("issue-1", "worker-b", ttl=300)
        assert result is False

    def test_claim_default_ttl(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.set.return_value = True
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        mgr.claim("issue-2", "worker-a")
        call_kwargs = fake.set.call_args[1]
        assert call_kwargs["nx"] is True
        assert "ex" in call_kwargs

    def test_claim_redis_error_fails_open(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.set.side_effect = Exception("Redis connection refused")
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        result = mgr.claim("issue-3", "worker-a")
        assert result is True

    def test_release(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        mgr.release("issue-1")
        fake.delete.assert_called_once_with("stas:claim:issue-1")

    def test_release_redis_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.delete.side_effect = Exception("Redis error")
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        mgr.release("issue-1")

    def test_get_claim_returns_worker_id(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.get.return_value = "worker-a"
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        assert mgr.get_claim("issue-1") == "worker-a"
        fake.get.assert_called_once_with("stas:claim:issue-1")

    def test_get_claim_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.get.return_value = None
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        assert mgr.get_claim("issue-1") is None

    def test_get_claim_redis_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.get.side_effect = Exception("Redis error")
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        assert mgr.get_claim("issue-1") is None

    def test_is_claimed_true(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.get.return_value = "worker-a"
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        assert mgr.is_claimed("issue-1") is True

    def test_is_claimed_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.get.return_value = None
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        assert mgr.is_claimed("issue-1") is False

    def test_claim_with_different_workers(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mgr = ClaimManager()
        fake = MagicMock()
        fake.set.side_effect = [True, False]
        monkeypatch.setattr(mgr, "_get_client", lambda: fake)
        assert mgr.claim("issue-1", "worker-a") is True
        assert mgr.claim("issue-1", "worker-b") is False
        assert fake.set.call_count == 2


class TestStandaloneClaim:

    def test_standalone_claim_returns_bool(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import workers.dispatch.claim as cm
        cm._CM = None
        fake_mgr = MagicMock()
        fake_mgr.claim.return_value = True
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        result = claim("issue-1", "worker-a")
        assert result is True

    def test_standalone_claim_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import workers.dispatch.claim as cm
        cm._CM = None
        fake_mgr = MagicMock()
        fake_mgr.claim.return_value = False
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        assert claim("issue-1", "worker-b") is False


class TestSingleton:

    def test_get_claim_manager_returns_same_instance(self) -> None:
        m1 = get_claim_manager()
        m2 = get_claim_manager()
        assert m1 is m2

    def test_claim_manager_is_claimmanager(self) -> None:
        assert isinstance(get_claim_manager(), ClaimManager)


class TestIsClaimableTask:

    def test_dispatch_task_is_claimable(self) -> None:
        assert _is_claimable_task("workers.tasks.agent.dispatch_opencode") is True
        assert _is_claimable_task("workers.tasks.triage.classify") is True
        assert _is_claimable_task("workers.tasks.sandbox.run") is True
        assert _is_claimable_task("workers.tasks.verification.verify") is True
        assert _is_claimable_task("workers.tasks.pr_creation.create_pr") is True

    def test_periodic_tasks_not_claimable(self) -> None:
        assert _is_claimable_task("workers.tasks.periodic.queue_health_check") is False
        assert _is_claimable_task("workers.tasks.periodic.dlq_cleanup") is False
        assert _is_claimable_task("workers.tasks.periodic.push_metrics") is False
        assert _is_claimable_task("workers.celery_app.ping") is False

    def test_unknown_task_not_claimable(self) -> None:
        assert _is_claimable_task("some.random.task") is False
        assert _is_claimable_task("") is False

    def test_billing_tasks_not_claimable(self) -> None:
        assert _is_claimable_task("workers.billing.usage.sync_usage_to_stripe") is False


class TestExtractIssueId:

    def test_from_kwargs_issue_id(self) -> None:
        result = _extract_issue_id(None, (), {"issue_id": "GH-42"})
        assert result == "GH-42"

    def test_from_kwargs_issue_context_url(self) -> None:
        result = _extract_issue_id(None, (), {"issue_context": {"issue_url": "https://github.com/o/r/issues/5"}})
        assert result == "https://github.com/o/r/issues/5"

    def test_from_kwargs_issue_context_number(self) -> None:
        result = _extract_issue_id(None, (), {"issue_context": {"issue_number": 99}})
        assert result == "99"

    def test_from_args_dict(self) -> None:
        result = _extract_issue_id(None, ({"issue_url": "https://github.com/o/r/issues/7"},), {})
        assert result == "https://github.com/o/r/issues/7"

    def test_from_args_dict_number(self) -> None:
        result = _extract_issue_id(None, ({"issue_number": 42},), {})
        assert result == "42"

    def test_from_kwargs_identifier(self) -> None:
        result = _extract_issue_id(None, (), {"identifier": "PROJ-123"})
        assert result == "PROJ-123"

    def test_from_kwargs_pipeline_id(self) -> None:
        result = _extract_issue_id(None, (), {"pipeline_id": "pl-abc"})
        assert result == "pl-abc"

    def test_from_kwargs_run_id(self) -> None:
        result = _extract_issue_id(None, (), {"run_id": "run-xyz"})
        assert result == "run-xyz"

    def test_returns_none_when_no_identifier(self) -> None:
        result = _extract_issue_id(None, (), {"some": "data"})
        assert result is None

    def test_returns_none_with_empty_args(self) -> None:
        result = _extract_issue_id(None, (), {})
        assert result is None

    def test_issue_id_takes_priority(self) -> None:
        result = _extract_issue_id(
            None,
            ({"issue_url": "https://github.com/o/r/issues/1"},),
            {"issue_id": "GH-99", "identifier": "PROJ-5"},
        )
        assert result == "GH-99"

    def test_identifier_fallback(self) -> None:
        result = _extract_issue_id(None, (), {"identifier": "TASK-1", "pipeline_id": "pl-b"})
        assert result == "TASK-1"


class TestClaimMiddleware:

    def test_blocks_duplicate_task(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from celery.exceptions import Ignore
        from workers.dispatch.claim import _check_claim_before_task
        fake_mgr = MagicMock()
        fake_mgr.claim.return_value = False
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        with pytest.raises(Ignore):
            _check_claim_before_task("task-1", task, ({"issue_url": "https://github.com/o/r/issues/1"},), {})

    def test_allows_first_task(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from workers.dispatch.claim import _check_claim_before_task
        fake_mgr = MagicMock()
        fake_mgr.claim.return_value = True
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        _check_claim_before_task("task-1", task, ({"issue_url": "https://github.com/o/r/issues/1"},), {})

    def test_skips_non_claimable_task(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from workers.dispatch.claim import _check_claim_before_task
        fake_mgr = MagicMock()
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        task = MagicMock()
        task.name = "workers.tasks.periodic.queue_health_check"
        _check_claim_before_task("task-1", task, (), {})
        fake_mgr.claim.assert_not_called()

    def test_skips_when_issue_id_unresolvable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from workers.dispatch.claim import _check_claim_before_task
        fake_mgr = MagicMock()
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        _check_claim_before_task("task-1", task, (), {})
        fake_mgr.claim.assert_not_called()

    def test_releases_on_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from workers.dispatch.claim import _release_claim_after_task
        fake_mgr = MagicMock()
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        _release_claim_after_task("task-1", task, ({"issue_url": "https://github.com/o/r/issues/1"},), {}, state="SUCCESS")
        fake_mgr.release.assert_called_once()

    def test_no_release_on_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from workers.dispatch.claim import _release_claim_after_task
        fake_mgr = MagicMock()
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        _release_claim_after_task("task-1", task, ({"issue_url": "https://github.com/o/r/issues/1"},), {}, state="FAILURE")
        fake_mgr.release.assert_not_called()

    def test_no_release_on_retry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from workers.dispatch.claim import _release_claim_after_task
        fake_mgr = MagicMock()
        monkeypatch.setattr("workers.dispatch.claim.get_claim_manager", lambda: fake_mgr)
        task = MagicMock()
        task.name = "workers.tasks.agent.dispatch_opencode"
        _release_claim_after_task("task-1", task, ({"issue_url": "https://github.com/o/r/issues/1"},), {}, state="RETRY")
        fake_mgr.release.assert_not_called()


class TestConnect:

    def test_connect_claim_middleware_noop(self) -> None:
        from workers.dispatch.claim import connect_claim_middleware
        connect_claim_middleware()
