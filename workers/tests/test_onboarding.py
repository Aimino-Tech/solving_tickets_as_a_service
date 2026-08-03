"""Comprehensive tests for onboarding automation (AIM-2018)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from workers.billing.onboarding import (
    OnboardingState, OnboardingStateMachine, get_onboarding_machine,
)
from workers.billing.onboarding_middleware import (
    OnboardingIncomplete, connect_onboarding_middleware, invalidate_cache,
)


class DictRedisMock:
    def __init__(self) -> None:
        self._data: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self._data.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self._data[key] = value

    def set(self, key: str, value: str) -> None:
        self._data[key] = value

    def delete(self, key: str) -> int:
        return 1 if self._data.pop(key, None) is not None else 0

    def ping(self) -> bool:
        return True

    def __getattr__(self, name: str) -> Any:
        return MagicMock()


class TestOnboardingState:
    def test_default_state_is_not_started(self):
        s = OnboardingState(tenant_id="t-1")
        assert s.state == "not_started"
        assert not s.github_installed
        assert not s.linear_authed
        assert not s.repo_selected
        assert not s.completed

    def test_to_dict_roundtrip(self):
        s = OnboardingState(tenant_id="t-1", state="github_installed", github_installed=True, installation_id=42, installed_repos=3)
        d = s.to_dict()
        assert d["state"] == "github_installed"
        restored = OnboardingState.from_dict(d)
        assert restored.tenant_id == s.tenant_id
        assert restored.installation_id == 42

    def test_from_dict_handles_missing_keys(self):
        s = OnboardingState.from_dict({"tenant_id": "t-2"})
        assert s.state == "not_started"

    def test_from_dict_with_all_fields(self):
        now = time.time()
        d = {"tenant_id": "t-3", "state": "completed", "github_installed": True, "linear_authed": True, "repo_selected": True, "completed": True, "installation_id": 99, "linear_org_id": "org-abc", "installed_repos": 5, "created_at": now, "updated_at": now}
        s = OnboardingState.from_dict(d)
        assert s.state == "completed"
        assert s.installation_id == 99


class TestOnboardingTransitions:
    def _make_machine(self):
        return OnboardingStateMachine()

    @patch("workers.billing.onboarding._get_redis")
    def test_not_started_to_github_installed(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        state = self._make_machine().transition("t-1", "install_github", installation_id=123)
        assert state.state == "github_installed"
        assert state.github_installed
        assert state.installation_id == 123

    @patch("workers.billing.onboarding._get_redis")
    def test_github_installed_to_linear_authed(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-1", 99999, json.dumps(OnboardingState(tenant_id="t-1", state="github_installed", github_installed=True, installation_id=123).to_dict()))
        mock_get_redis.return_value = mc
        state = self._make_machine().transition("t-1", "auth_linear", linear_org_id="org-linear")
        assert state.state == "linear_authed"
        assert state.linear_authed

    @patch("workers.billing.onboarding._get_redis")
    def test_github_installed_to_repo_selected(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-1", 99999, json.dumps(OnboardingState(tenant_id="t-1", state="github_installed", github_installed=True).to_dict()))
        mock_get_redis.return_value = mc
        state = self._make_machine().transition("t-1", "select_repo", installed_repos=3)
        assert state.state == "repo_selected"
        assert state.installed_repos == 3

    @patch("workers.billing.onboarding._get_redis")
    def test_linear_authed_to_repo_selected(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-1", 99999, json.dumps(OnboardingState(tenant_id="t-1", state="linear_authed", github_installed=True, linear_authed=True, installation_id=123).to_dict()))
        mock_get_redis.return_value = mc
        state = self._make_machine().transition("t-1", "select_repo", installed_repos=3)
        assert state.state == "repo_selected"
        assert state.installed_repos == 3

    @patch("workers.billing.onboarding._get_redis")
    def test_repo_selected_to_completed(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-1", 99999, json.dumps(OnboardingState(tenant_id="t-1", state="repo_selected", github_installed=True, linear_authed=True, repo_selected=True, installation_id=123).to_dict()))
        mock_get_redis.return_value = mc
        state = self._make_machine().transition("t-1", "complete")
        assert state.state == "completed"
        assert state.completed

    @patch("workers.billing.onboarding._get_redis")
    def test_full_flow(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        m = self._make_machine()
        assert m.transition("t-full", "install_github", installation_id=42).state == "github_installed"
        assert m.transition("t-full", "auth_linear", linear_org_id="org-x").state == "linear_authed"
        assert m.transition("t-full", "select_repo", installed_repos=5).state == "repo_selected"
        assert m.transition("t-full", "complete").state == "completed"


class TestOnboardingInvalidTransitions:
    @patch("workers.billing.onboarding._get_redis")
    def test_cannot_auth_linear_before_github(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        with pytest.raises(ValueError, match="Invalid transition"):
            OnboardingStateMachine().transition("t-1", "auth_linear")

    @patch("workers.billing.onboarding._get_redis")
    def test_cannot_complete_before_repo_selected(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-1", 99999, json.dumps(OnboardingState(tenant_id="t-1", state="github_installed", github_installed=True).to_dict()))
        mock_get_redis.return_value = mc
        with pytest.raises(ValueError, match="Invalid transition"):
            OnboardingStateMachine().transition("t-1", "complete")

    @patch("workers.billing.onboarding._get_redis")
    def test_unknown_event_raises(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        with pytest.raises(ValueError, match="Unknown onboarding event"):
            OnboardingStateMachine().transition("t-1", "unknown_event")

    @patch("workers.billing.onboarding._get_redis")
    def test_cannot_select_repo_from_not_started(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        with pytest.raises(ValueError, match="Invalid transition"):
            OnboardingStateMachine().transition("t-1", "select_repo")


class TestOnboardingRedisPersistence:
    @patch("workers.billing.onboarding._get_redis")
    def test_persists_to_redis(self, mock_get_redis):
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        OnboardingStateMachine().transition("t-1", "install_github", installation_id=42)
        raw = mc.get("syntaro:onboarding:t-1")
        assert raw is not None
        assert json.loads(raw)["state"] == "github_installed"

    @patch("workers.billing.onboarding._get_redis")
    def test_reads_from_redis(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-1", 99999, json.dumps(OnboardingState(tenant_id="t-1", state="repo_selected", github_installed=True, linear_authed=True, repo_selected=True, installation_id=42).to_dict()))
        mock_get_redis.return_value = mc
        result = OnboardingStateMachine().get_state("t-1")
        assert result is not None
        assert result.state == "repo_selected"

    @patch("workers.billing.onboarding._get_redis")
    def test_returns_none_when_no_state(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        assert OnboardingStateMachine().get_state("nonexistent") is None


class TestOnboardingFileFallback:
    FALLBACK_DIR = "/tmp/syntaro-onboarding"

    def teardown_method(self) -> None:
        import shutil
        shutil.rmtree(self.FALLBACK_DIR, ignore_errors=True)

    @patch("workers.billing.onboarding._get_redis")
    def test_writes_file_when_redis_unavailable(self, mock_get_redis):
        mock_get_redis.return_value = None
        OnboardingStateMachine().transition("t-file", "install_github", installation_id=77)
        fp = Path(f"{self.FALLBACK_DIR}/t-file.json")
        assert fp.exists()
        assert json.loads(fp.read_text())["state"] == "github_installed"

    @patch("workers.billing.onboarding._get_redis")
    def test_reads_file_when_redis_unavailable(self, mock_get_redis):
        mock_get_redis.return_value = None
        fp = Path(f"{self.FALLBACK_DIR}/t-file.json")
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(json.dumps(OnboardingState(tenant_id="t-file", state="linear_authed", github_installed=True, linear_authed=True, installation_id=77, linear_org_id="org-xyz").to_dict()))
        result = OnboardingStateMachine().get_state("t-file")
        assert result is not None
        assert result.state == "linear_authed"
        assert result.linear_org_id == "org-xyz"

    @patch("workers.billing.onboarding._get_redis")
    def test_fallback_on_redis_failure(self, mock_get_redis):
        mc = DictRedisMock()
        mc.get = MagicMock(side_effect=RuntimeError("Redis connection lost"))
        mc.setex = MagicMock(side_effect=RuntimeError("Redis connection lost"))
        mock_get_redis.return_value = mc
        state = OnboardingStateMachine().transition("t-fallback", "install_github", installation_id=1)
        assert state.state == "github_installed"

    @patch("workers.billing.onboarding._get_redis")
    def test_missing_file_returns_none(self, mock_get_redis):
        mock_get_redis.return_value = None
        assert OnboardingStateMachine().get_state("nonexistent-tenant") is None


class TestOnboardingStatusAndReset:
    @patch("workers.billing.onboarding._get_redis")
    def test_get_status_default(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        status = OnboardingStateMachine().get_status("t-1")
        assert status["state"] == "not_started"

    @patch("workers.billing.onboarding._get_redis")
    def test_get_status_after_transition(self, mock_get_redis):
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        OnboardingStateMachine().transition("t-1", "install_github", installation_id=42)
        assert OnboardingStateMachine().get_status("t-1")["state"] == "github_installed"

    @patch("workers.billing.onboarding._get_redis")
    def test_reset_clears_state(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-1", 99999, json.dumps(OnboardingState(tenant_id="t-1", state="completed", completed=True, github_installed=True, linear_authed=True, repo_selected=True).to_dict()))
        mock_get_redis.return_value = mc
        m = OnboardingStateMachine()
        m.reset("t-1")
        assert m.get_status("t-1")["state"] == "not_started"

    @patch("workers.billing.onboarding._get_redis")
    def test_reset_nonexistent_tenant(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        OnboardingStateMachine().reset("does-not-exist")


class TestFirstIssueWizard:
    @patch("workers.billing.onboarding._get_redis")
    @patch("workers.billing.onboarding.Path.write_text")
    def test_trigger_file_written_on_completion(self, mock_write_text, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-1", 99999, json.dumps(OnboardingState(tenant_id="t-1", state="repo_selected", github_installed=True, linear_authed=True, repo_selected=True, installation_id=42).to_dict()))
        mock_get_redis.return_value = mc
        OnboardingStateMachine().transition("t-1", "complete")
        assert mock_write_text.called

    @patch("workers.billing.onboarding._get_redis")
    def test_trigger_not_fired_on_non_completion(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        with patch("workers.billing.onboarding.OnboardingStateMachine._trigger_first_issue_wizard") as mt:
            OnboardingStateMachine().transition("t-1", "install_github", installation_id=42)
            mt.assert_not_called()


class TestOnboardingMiddleware:
    @patch("workers.billing.onboarding._get_redis")
    def test_allows_completed_tenant(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-complete", 99999, json.dumps(OnboardingState(tenant_id="t-complete", state="completed", completed=True, github_installed=True, linear_authed=True, repo_selected=True).to_dict()))
        mock_get_redis.return_value = mc
        from workers.billing.onboarding_middleware import _check_onboarding
        _check_onboarding("t-complete", MagicMock(name="task"), "task-1")

    @patch("workers.billing.onboarding._get_redis")
    def test_blocks_incomplete_tenant(self, mock_get_redis):
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-incomplete", 99999, json.dumps(OnboardingState(tenant_id="t-incomplete", state="not_started").to_dict()))
        mock_get_redis.return_value = mc
        from workers.billing.onboarding_middleware import _check_onboarding
        with pytest.raises(OnboardingIncomplete, match="not completed onboarding"):
            _check_onboarding("t-incomplete", MagicMock(name="task"), "task-1")

    @patch("workers.billing.onboarding._get_redis")
    def test_allows_missing_tenant_context(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        from workers.billing.onboarding_middleware import _on_task_prerun
        task = MagicMock()
        task.request.kwargs = {}
        task.request.args = ()
        _on_task_prerun(task_id="task-1", task=task)

    @patch("workers.billing.onboarding._get_redis")
    def test_cache_hit(self, mock_get_redis):
        invalidate_cache()
        mc = DictRedisMock()
        mc.setex("syntaro:onboarding:t-cached", 99999, json.dumps(OnboardingState(tenant_id="t-cached", state="completed", completed=True, github_installed=True, linear_authed=True, repo_selected=True).to_dict()))
        get_wrapped = mc.get
        mc.get = MagicMock(side_effect=get_wrapped)
        mock_get_redis.return_value = mc
        from workers.billing.onboarding_middleware import _check_onboarding, _cache
        t = MagicMock(name="task")
        _check_onboarding("t-cached", t, "task-1")
        assert mc.get.call_count >= 1
        calls_before = mc.get.call_count
        _check_onboarding("t-cached", t, "task-2")
        assert mc.get.call_count == calls_before
        assert _cache.get("t-cached") is True

    def test_invalidate_cache(self):
        from workers.billing.onboarding_middleware import _cache
        _cache["t-1"] = True
        _cache["t-2"] = True
        invalidate_cache("t-1")
        assert "t-1" not in _cache
        assert _cache.get("t-2") is True
        invalidate_cache()
        assert len(_cache) == 0

    def test_connect_middleware(self):
        connect_onboarding_middleware()


class TestOnboardingSingleton:
    def test_get_machine_returns_singleton(self):
        assert get_onboarding_machine() is get_onboarding_machine()

    def test_singleton_is_state_machine(self):
        assert isinstance(get_onboarding_machine(), OnboardingStateMachine)


class TestOnboardingEdgeCases:
    @patch("workers.billing.onboarding._get_redis")
    def test_special_chars_in_tenant_id(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        state = OnboardingStateMachine().transition("tenant/with:special/ chars", "install_github")
        assert state.state == "github_installed"

    @patch("workers.billing.onboarding._get_redis")
    def test_multiple_tenants_independent(self, mock_get_redis):
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        m = OnboardingStateMachine()
        m.transition("tenant-a", "install_github", installation_id=1)
        m.transition("tenant-b", "install_github", installation_id=2)
        sa = m.get_state("tenant-a")
        sb = m.get_state("tenant-b")
        assert sa is not None and sb is not None
        assert sa.installation_id == 1 and sb.installation_id == 2

    @patch("workers.billing.onboarding._get_redis")
    def test_get_status_returns_structured_dict(self, mock_get_redis):
        mock_get_redis.return_value = DictRedisMock()
        status = OnboardingStateMachine().get_status("t-1")
        for k in ("tenant_id", "state", "github_installed", "linear_authed", "repo_selected", "completed", "installed_repos"):
            assert k in status
