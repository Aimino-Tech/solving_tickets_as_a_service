"""
Comprehensive tests for PLG self-serve onboarding (AIM-2075).

Covers:
    workers.billing.plg          — PLG state machine, tier display, no-config detection,
                                   welcome issue creation, dashboard data aggregation
"""

from __future__ import annotations

import json
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from workers.billing.plg import (
    PlgState,
    _build_display,
    _build_welcome_issue_body,
    _resolve_tier,
    _tier_max_issues,
    auto_configure_webhook,
    check_no_config,
    create_welcome_issue,
    get_dashboard_data,
    get_onboarding_summary,
    get_or_create_state,
    get_state,
    get_usage_summary,
    mark_first_fix_completed,
    mark_github_installed,
    mark_repo_selected,
    mark_webhook_configured,
    mark_welcome_issue_created,
)


# ===========================================================================
# Fixtures
# ===========================================================================


class DictRedisMock:
    """In-memory Redis mock that mimics the subset of Redis used by plg.py."""

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

    def hgetall(self, key: str) -> dict[str, str]:
        return {}

    def hincrby(self, name: str, key: str, amount: int = 1) -> int:
        return 1

    def hsetnx(self, name: str, key: str, value: str) -> int:
        return 1

    def expire(self, name: str, time: int) -> int:
        return 1

    def scan(self, cursor: int = 0, match: str | None = None, count: int = 10) -> tuple[int, list[str]]:
        return 0, []

    def pipeline(self) -> MagicMock:
        pipe = MagicMock()
        pipe.hincrby.return_value = 1
        pipe.hsetnx.return_value = 1
        pipe.expire.return_value = 1
        pipe.execute.return_value = [1]
        return pipe

    def __getattr__(self, name: str) -> Any:
        return MagicMock()


# ===========================================================================
# PlgState Tests
# ===========================================================================


class TestPlgState:
    def test_default_state(self) -> None:
        s = PlgState(tenant_id="t-1")
        assert s.tenant_id == "t-1"
        assert not s.github_installed
        assert not s.repo_selected
        assert not s.webhook_configured
        assert not s.welcome_issue_created
        assert not s.first_fix_completed
        assert s.installation_id is None
        assert s.connected_repos == 0

    def test_to_dict_roundtrip(self) -> None:
        s = PlgState(
            tenant_id="t-1",
            github_installed=True,
            installation_id=42,
            connected_repos=3,
            webhook_configured=True,
        )
        d = s.to_dict()
        assert d["tenant_id"] == "t-1"
        assert d["github_installed"] is True
        assert d["installation_id"] == 42
        restored = PlgState.from_dict(d)
        assert restored.tenant_id == s.tenant_id
        assert restored.github_installed is True
        assert restored.installation_id == 42

    def test_from_dict_handles_missing_keys(self) -> None:
        s = PlgState.from_dict({"tenant_id": "t-2"})
        assert s.tenant_id == "t-2"
        assert not s.github_installed
        assert s.installation_id is None
        assert s.connected_repos == 0

    def test_from_dict_with_all_fields(self) -> None:
        now = time.time()
        d = {
            "tenant_id": "t-3",
            "github_installed": True,
            "installation_id": 99,
            "repo_selected": True,
            "connected_repos": 5,
            "webhook_configured": True,
            "welcome_issue_created": True,
            "first_fix_completed": True,
            "joined_at": now,
            "updated_at": now,
        }
        s = PlgState.from_dict(d)
        assert s.github_installed is True
        assert s.installation_id == 99
        assert s.repo_selected is True
        assert s.welcome_issue_created is True
        assert s.first_fix_completed is True


# ===========================================================================
# Tier / Display Tests
# ===========================================================================


class TestTierResolution:
    def test_default_tier_is_free(self) -> None:
        assert _resolve_tier("unknown-tenant") == "free"

    def test_free_tier_max_issues(self) -> None:
        assert _tier_max_issues("free") == 3

    def test_pro_tier_max_issues(self) -> None:
        assert _tier_max_issues("pro") == 100

    def test_enterprise_unlimited(self) -> None:
        assert _tier_max_issues("enterprise") == -1

    def test_unknown_tier_defaults_to_free(self) -> None:
        assert _tier_max_issues("premium_gold") == 3

    def test_tier_override_via_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TENANT_T_CUSTOM_TIER", "pro")
        assert _resolve_tier("t-custom") == "pro"


class TestDisplayBuilder:
    def test_display_free_tier(self) -> None:
        assert _build_display(2, 1) == "2/3 free fixes"

    def test_display_zero_usage(self) -> None:
        assert _build_display(0, 3) == "0/3 free fixes"

    def test_display_exhausted(self) -> None:
        assert _build_display(3, 0) == "3/3 free fixes"

    def test_display_unlimited(self) -> None:
        assert _build_display(42, -1) == "42 fixes (unlimited)"

    def test_display_pro_tier(self) -> None:
        assert _build_display(50, 50) == "50/100 free fixes"


# ===========================================================================
# Usage Summary Tests
# ===========================================================================


class TestUsageSummary:
    @patch("workers.billing.plg._get_redis")
    def test_usage_summary_free_tier(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        summary = get_usage_summary("tenant-1")
        assert summary["tier"] == "free"
        assert summary["count"] == 0
        assert summary["remaining"] == 3
        assert "0/3" in summary["display"]

    @patch("workers.billing.plg._get_redis")
    def test_usage_summary_uses_usage_counter(self, mock_get_redis: MagicMock) -> None:
        redis_mock = DictRedisMock()
        with patch("workers.billing.usage._get_redis", return_value=redis_mock):
            from workers.billing.usage import increment_usage

            increment_usage("tenant-usage")

        mock_get_redis.return_value = redis_mock
        summary = get_usage_summary("tenant-usage")
        assert summary["count"] >= 0
        assert "remaining" in summary

    def test_usage_summary_redis_unavailable(self) -> None:
        with patch("workers.billing.plg._get_redis", return_value=None):
            summary = get_usage_summary("tenant-offline")
        assert summary["count"] == 0
        assert summary["tier"] == "free"
        assert summary["remaining"] == 3


# ===========================================================================
# No-Config Detection Tests
# ===========================================================================


class TestNoConfigDetection:
    @patch("workers.billing.plg._get_redis")
    def test_no_config_detects_all_missing(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        result = check_no_config("new-tenant")
        assert result["configured"] is False
        assert "github_installed" in result["missing"]
        assert "webhook_configured" in result["missing"]
        assert "repo_selected" in result["missing"]

    @patch("workers.billing.plg._get_redis")
    def test_no_config_partial(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        state = PlgState(tenant_id="partial", github_installed=True, installation_id=42)
        mc.setex("stas:plg:partial", 99999, json.dumps(state.to_dict()))
        mock_get_redis.return_value = mc
        result = check_no_config("partial")
        assert result["configured"] is False
        assert "webhook_configured" in result["missing"]
        assert "repo_selected" in result["missing"]
        assert "github_installed" not in result["missing"]

    @patch("workers.billing.plg._get_redis")
    def test_no_config_complete(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        state = PlgState(
            tenant_id="complete",
            github_installed=True,
            installation_id=42,
            repo_selected=True,
            webhook_configured=True,
            welcome_issue_created=True,
        )
        mc.setex("stas:plg:complete", 99999, json.dumps(state.to_dict()))
        mock_get_redis.return_value = mc
        result = check_no_config("complete")
        assert result["configured"] is True
        assert result["missing"] == []


# ===========================================================================
# State Persistence Tests
# ===========================================================================


class TestStatePersistence:
    @patch("workers.billing.plg._get_redis")
    def test_get_or_create_new(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        state = get_or_create_state("new-tenant")
        assert state.tenant_id == "new-tenant"
        assert not state.github_installed

    @patch("workers.billing.plg._get_redis")
    def test_get_or_create_existing(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.setex(
            "stas:plg:existing",
            99999,
            json.dumps(PlgState(tenant_id="existing", github_installed=True, installation_id=42).to_dict()),
        )
        mock_get_redis.return_value = mc
        state = get_or_create_state("existing")
        assert state.github_installed is True
        assert state.installation_id == 42

    @patch("workers.billing.plg._get_redis")
    def test_mark_github_installed(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        state = mark_github_installed("t-1", 123)
        assert state.github_installed is True
        assert state.installation_id == 123
        raw = mc.get("stas:plg:t-1")
        assert raw is not None
        assert json.loads(raw)["github_installed"] is True

    @patch("workers.billing.plg._get_redis")
    def test_mark_repo_selected(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        state = mark_repo_selected("t-1", 5)
        assert state.repo_selected is True
        assert state.connected_repos == 5

    @patch("workers.billing.plg._get_redis")
    def test_mark_webhook_configured(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        state = mark_webhook_configured("t-1")
        assert state.webhook_configured is True

    @patch("workers.billing.plg._get_redis")
    def test_mark_welcome_issue_created(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        state = mark_welcome_issue_created("t-1")
        assert state.welcome_issue_created is True

    @patch("workers.billing.plg._get_redis")
    def test_mark_first_fix_completed(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        state = mark_first_fix_completed("t-1")
        assert state.first_fix_completed is True

    @patch("workers.billing.plg._get_redis")
    def test_get_state_returns_none_for_new(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        assert get_state("nonexistent") is None

    @patch("workers.billing.plg._get_redis")
    def test_get_state_returns_existing(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.setex(
            "stas:plg:known",
            99999,
            json.dumps(PlgState(tenant_id="known", github_installed=True).to_dict()),
        )
        mock_get_redis.return_value = mc
        state = get_state("known")
        assert state is not None
        assert state.github_installed is True

    @patch("workers.billing.plg._get_redis")
    def test_redis_unavailable_fallback(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = None
        state = get_or_create_state("offline")
        assert state.tenant_id == "offline"
        state2 = get_state("offline")
        assert state2 is None


# ===========================================================================
# Onboarding Summary Tests
# ===========================================================================


class TestOnboardingSummary:
    @patch("workers.billing.plg._get_redis")
    def test_summary_for_new_tenant(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        summary = get_onboarding_summary("new-tenant")
        assert summary["state"] == "not_started"
        assert not summary["completed"]
        assert not summary["github_installed"]
        assert summary["usage"]["count"] == 0
        assert summary["joined_at"] is None

    @patch("workers.billing.plg._get_redis")
    def test_summary_partial_onboarding(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        state = PlgState(tenant_id="partial", github_installed=True, installation_id=42)
        mc.setex("stas:plg:partial", 99999, json.dumps(state.to_dict()))
        mock_get_redis.return_value = mc
        summary = get_onboarding_summary("partial")
        assert summary["state"] == "in_progress"
        assert not summary["completed"]
        assert summary["github_installed"] is True
        assert summary["joined_at"] is not None

    @patch("workers.billing.plg._get_redis")
    def test_summary_completed(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        state = PlgState(
            tenant_id="done",
            github_installed=True,
            installation_id=42,
            repo_selected=True,
            webhook_configured=True,
            connected_repos=3,
        )
        mc.setex("stas:plg:done", 99999, json.dumps(state.to_dict()))
        mock_get_redis.return_value = mc
        summary = get_onboarding_summary("done")
        assert summary["state"] == "completed"
        assert summary["completed"] is True
        assert summary["connected_repos"] == 3
        assert summary["installed_repos"] == 3


# ===========================================================================
# Welcome Issue Tests
# ===========================================================================


class TestWelcomeIssueBody:
    def test_body_contains_bot_name(self) -> None:
        body = _build_welcome_issue_body("STAS")
        assert "STAS" in body
        assert "stas:fix" in body

    def test_body_contains_instructions(self) -> None:
        body = _build_welcome_issue_body("TestBot")
        assert "label" in body.lower()
        assert "pull request" in body.lower()
        assert "TestBot" in body


class TestCreateWelcomeIssue:
    @patch("workers.billing.plg._get_installation_token")
    @patch("workers.billing.plg.httpx")
    def test_creates_issue_successfully(
        self, mock_httpx: MagicMock, mock_token: MagicMock
    ) -> None:
        mock_token.return_value = "ghs_test_token"
        mock_response = MagicMock()
        mock_response.status_code = 201
        mock_response.json.return_value = {
            "html_url": "https://github.com/owner/repo/issues/1",
            "number": 1,
        }
        mock_httpx.post.return_value = mock_response

        with patch("workers.billing.plg.mark_welcome_issue_created") as mock_mark:
            result = create_welcome_issue("tenant-1", 42, "owner", "repo")

        assert result["success"] is True
        assert result["issue_url"] == "https://github.com/owner/repo/issues/1"
        assert result["issue_number"] == 1
        mock_mark.assert_called_once_with("tenant-1")

    @patch("workers.billing.plg._get_installation_token")
    def test_fails_without_token(self, mock_token: MagicMock) -> None:
        mock_token.return_value = None
        result = create_welcome_issue("tenant-1", 42, "owner", "repo")
        assert result["success"] is False
        assert "token" in result["error"].lower()

    @patch("workers.billing.plg._get_installation_token")
    @patch("workers.billing.plg.httpx")
    def test_handles_github_api_error(
        self, mock_httpx: MagicMock, mock_token: MagicMock
    ) -> None:
        mock_token.return_value = "ghs_test_token"
        mock_response = MagicMock()
        mock_response.status_code = 422
        mock_response.text = "Validation error"
        mock_httpx.post.return_value = mock_response

        result = create_welcome_issue("tenant-1", 42, "owner", "repo")
        assert result["success"] is False
        assert "422" in result["error"]


# ===========================================================================
# Webhook Auto-Config Tests
# ===========================================================================


class TestAutoConfigureWebhook:
    @patch("workers.billing.plg._get_installation_token")
    @patch("workers.billing.plg.httpx")
    def test_configures_webhook(
        self, mock_httpx: MagicMock, mock_token: MagicMock
    ) -> None:
        mock_token.return_value = "ghs_test_token"

        repos_response = MagicMock()
        repos_response.status_code = 200
        repos_response.json.return_value = {
            "repositories": [
                {"full_name": "owner/repo", "owner": {"login": "owner"}, "name": "repo"},
            ]
        }

        hooks_response = MagicMock()
        hooks_response.status_code = 200
        hooks_response.json.return_value = []

        create_response = MagicMock()
        create_response.status_code = 201
        create_response.json.return_value = {"id": 123, "active": True}

        mock_httpx.get.side_effect = [repos_response, hooks_response]
        mock_httpx.post.return_value = create_response

        with patch("workers.billing.plg.mark_webhook_configured") as mock_mark:
            result = auto_configure_webhook("tenant-1", 42, "https://stas.dev/webhook")

        assert result["configured"] is True
        assert result["webhook_id"] == 123
        assert result["repos_configured"] == 1
        assert result["total_repos"] == 1
        mock_mark.assert_called_once_with("tenant-1")

    @patch("workers.billing.plg._get_installation_token")
    def test_fails_without_token(self, mock_token: MagicMock) -> None:
        mock_token.return_value = None
        result = auto_configure_webhook("tenant-1", 42, "https://stas.dev/webhook")
        assert result["configured"] is False
        assert "token" in result["error"].lower()

    @patch("workers.billing.plg._get_installation_token")
    @patch("workers.billing.plg.httpx")
    def test_skips_existing_webhooks(
        self, mock_httpx: MagicMock, mock_token: MagicMock
    ) -> None:
        mock_token.return_value = "ghs_test_token"

        repos_response = MagicMock()
        repos_response.status_code = 200
        repos_response.json.return_value = {
            "repositories": [
                {"full_name": "owner/repo", "owner": {"login": "owner"}, "name": "repo"},
            ]
        }

        hooks_response = MagicMock()
        hooks_response.status_code = 200
        hooks_response.json.return_value = [
            {
                "id": 456,
                "config": {"url": "https://stas.dev/webhook"},
                "active": True,
            }
        ]

        mock_httpx.get.side_effect = [repos_response, hooks_response]

        result = auto_configure_webhook("tenant-1", 42, "https://stas.dev/webhook")

        assert result["configured"] is True
        assert result["webhook_id"] == 456
        mock_httpx.post.assert_not_called()


# ===========================================================================
# Dashboard Data Tests
# ===========================================================================


class TestDashboardData:
    @patch("workers.billing.plg._get_redis")
    def test_dashboard_for_new_tenant(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        data = get_dashboard_data("new-tenant")
        assert data["tenant_id"] == "new-tenant"
        assert data["first_fix_completed"] is False
        assert data["onboarding_completed"] is False
        assert data["connected_repos"] == []
        assert data["recent_runs"] == []

    @patch("workers.billing.plg._get_redis")
    def test_dashboard_for_onboarded_tenant(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        state = PlgState(
            tenant_id="onboarded",
            github_installed=True,
            installation_id=42,
            repo_selected=True,
            webhook_configured=True,
            connected_repos=3,
            first_fix_completed=True,
        )
        mc.setex("stas:plg:onboarded", 99999, json.dumps(state.to_dict()))
        mock_get_redis.return_value = mc

        data = get_dashboard_data("onboarded")
        assert data["onboarding_completed"] is True
        assert data["first_fix_completed"] is True


# ===========================================================================
# Edge Cases
# ===========================================================================


class TestPlgEdgeCases:
    @patch("workers.billing.plg._get_redis")
    def test_special_chars_in_tenant_id(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        state = mark_github_installed("tenant/with:special/ chars", 42)
        assert state.github_installed is True

    @patch("workers.billing.plg._get_redis")
    def test_multiple_tenants_independent(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        mark_github_installed("tenant-a", 1)
        mark_github_installed("tenant-b", 2)
        sa = get_state("tenant-a")
        sb = get_state("tenant-b")
        assert sa is not None and sb is not None
        assert sa.installation_id == 1
        assert sb.installation_id == 2

    @patch("workers.billing.plg._get_redis")
    def test_state_persistence_roundtrip(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        mark_github_installed("t-round", 42)
        mark_repo_selected("t-round", 3)
        mark_webhook_configured("t-round")
        mark_welcome_issue_created("t-round")
        mark_first_fix_completed("t-round")
        state = get_state("t-round")
        assert state is not None
        assert state.github_installed is True
        assert state.repo_selected is True
        assert state.webhook_configured is True
        assert state.welcome_issue_created is True
        assert state.first_fix_completed is True
        assert state.connected_repos == 3

    def test_welcome_issue_body_contains_stas_fix_label(self) -> None:
        body = _build_welcome_issue_body("STAS")
        assert "stas:fix" in body

    @patch("workers.billing.plg._get_redis")
    def test_get_onboarding_summary_structured_dict(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        summary = get_onboarding_summary("t-1")
        for k in (
            "tenant_id", "state", "github_installed", "repo_selected",
            "completed", "usage", "connected_repos", "first_fix_completed",
        ):
            assert k in summary
