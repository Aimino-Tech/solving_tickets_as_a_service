import pytest

from workers.tasks.onboarding import (
    complete_onboarding,
    handle_github_installation,
    handle_linear_oauth,
    dispatch_test_issue,
)


def test_handle_github_installation():
    result = handle_github_installation(12345, "tenant-test", ["owner/repo1"])
    assert result["installation_id"] == 12345
    assert result["tenant_id"] == "tenant-test"
    assert result["status"] == "registered"


def test_handle_linear_oauth():
    result = handle_linear_oauth("tenant-test", "tok_abc", "team-123")
    assert result["tenant_id"] == "tenant-test"
    assert result["linear_team_id"] == "team-123"
    assert result["status"] == "connected"


def test_handle_github_installation_without_repos():
    result = handle_github_installation(99999, "tenant-empty")
    assert result["repos"] == []


def test_dispatch_test_issue():
    result = dispatch_test_issue("tenant-test", "my-repo")
    assert result["status"] == "dispatched"
    assert "onboarding-test" in result["issue_key"]


def test_complete_onboarding():
    result = complete_onboarding("tenant-test")
    assert result["status"] == "onboarded"
    assert "onboarded_at" in result
