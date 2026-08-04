"""Tests for PR creation task, GitHub client, branch naming, and Linear client."""

import json
import os
import subprocess
from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from workers.branch_naming import generate_branch_name
from workers.github.client import GitHubClient, get_installation_token, parse_repo_info
from workers.linear_client import LinearClient
from workers.tasks.pr_creation import (
    _build_pr_body,
    _extract_issue_number,
    _get_changed_files_summary,
    _load_template,
    create_pull_request,
)


# ---------------------------------------------------------------------------
# Branch naming
# ---------------------------------------------------------------------------


class TestGenerateBranchName:
    def test_basic(self):
        name = generate_branch_name("AIM-1959", "fix login bug")
        assert name.startswith("syntaro/fix/")
        assert "fix-login-bug" in name
        assert len(name.split("-")[-1]) == 8  # SHA hex

    def test_slug_truncation(self):
        long_id = "a" * 100
        name = generate_branch_name("ISSUE-1", long_id)
        slug_part = name.split("/")[-1].rsplit("-", 1)[0]
        assert len(slug_part) <= 40

    def test_special_chars_removed(self):
        name = generate_branch_name("TICK-1", "Hello World! @#$%")
        assert "@" not in name
        assert "hello-world" in name

    def test_fix_type_parameter(self):
        name = generate_branch_name("AIM-1959", "add feature", fix_type="feature")
        assert name.startswith("syntaro/feature/")


# ---------------------------------------------------------------------------
# GitHub client
# ---------------------------------------------------------------------------


class TestParseRepoInfo:
    def test_valid(self):
        owner, repo = parse_repo_info("owner/repo")
        assert owner == "owner"
        assert repo == "repo"

    def test_invalid(self):
        with pytest.raises(ValueError):
            parse_repo_info("invalid")


class TestGitHubClient:
    @patch("workers.github.client.get_installation_token")
    def test_init_with_installation_id(self, mock_get_token):
        mock_get_token.return_value = "ghs_test_token"
        client = GitHubClient(installation_id=123)
        assert client._installation_id == 123

    def test_init_with_token(self):
        client = GitHubClient(token="ghp_test")
        assert client._token == "ghp_test"

    @patch("workers.github.client.get_installation_token")
    def test_resolve_token_with_installation(self, mock_get_token):
        mock_get_token.return_value = "ghs_test_token"
        client = GitHubClient(installation_id=123)
        assert client._resolve_token() == "ghs_test_token"

    def test_resolve_token_direct(self):
        client = GitHubClient(token="ghp_direct")
        assert client._resolve_token() == "ghp_direct"

    @patch("workers.github.client.os.getenv")
    def test_resolve_token_from_env(self, mock_getenv):
        mock_getenv.return_value = "ghp_from_env"
        client = GitHubClient()
        assert client._resolve_token() == "ghp_from_env"

    def test_resolve_token_raises(self):
        client = GitHubClient()
        with pytest.raises(ValueError):
            client._resolve_token()

    @patch("workers.github.client.subprocess.run")
    def test_push_branch(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        client = GitHubClient(token="ghp_test")
        client.push_branch("/workspace", "syntaro/fix/test-123")
        mock_run.assert_called_once_with(
            ["git", "push", "origin", "syntaro/fix/test-123"],
            cwd="/workspace",
            check=True,
            capture_output=True,
            text=True,
        )

    @patch.object(GitHubClient, "_request")
    def test_create_pr(self, mock_request):
        mock_request.return_value = {
            "html_url": "https://github.com/o/r/pull/42",
            "number": 42,
        }
        client = GitHubClient(token="ghp_test")
        result = client.create_pr(
            "o/r", "branch", "main", "Title", "Body", labels=["bug"],
        )
        assert result["pr_url"] == "https://github.com/o/r/pull/42"
        assert result["pr_number"] == 42
        assert result["status"] == "opened"

    @patch.object(GitHubClient, "_request")
    def test_find_existing_pr_found(self, mock_request):
        mock_request.return_value = [
            {
                "html_url": "https://github.com/o/r/pull/1",
                "number": 1,
                "state": "open",
            },
        ]
        client = GitHubClient(token="ghp_test")
        result = client.find_existing_pr("o/r", "branch")
        assert result is not None
        assert result["pr_number"] == 1

    @patch.object(GitHubClient, "_request")
    def test_find_existing_pr_not_found(self, mock_request):
        mock_request.return_value = []
        client = GitHubClient(token="ghp_test")
        result = client.find_existing_pr("o/r", "nonexistent-branch")
        assert result is None

    @patch.object(GitHubClient, "_request")
    def test_update_pr(self, mock_request):
        mock_request.return_value = {
            "html_url": "https://github.com/o/r/pull/42",
            "number": 42,
        }
        client = GitHubClient(token="ghp_test")
        result = client.update_pr("o/r", 42, title="New Title")
        assert result["status"] == "updated"

    @patch.object(GitHubClient, "_request")
    def test_check_mergeable(self, mock_request):
        mock_request.return_value = {
            "mergeable": True,
            "mergeable_state": "clean",
        }
        client = GitHubClient(token="ghp_test")
        result = client.check_mergeable("o/r", 42)
        assert result["mergeable"] is True
        assert result["mergeable_state"] == "clean"


# ---------------------------------------------------------------------------
# PR creation task
# ---------------------------------------------------------------------------


class TestExtractIssueNumber:
    def test_with_prefix(self):
        assert _extract_issue_number("AIM-1959") == "1959"

    def test_no_prefix(self):
        assert _extract_issue_number("42") == "42"


class TestLoadTemplate:
    def test_loads_without_error(self):
        content = _load_template()
        assert "$issue_description" in content
        assert "$issue_number" in content
        assert "$changed_files_summary" in content
        assert "$test_pass_rate" in content


class TestBuildPrBody:
    @patch("workers.tasks.pr_creation._get_changed_files_summary")
    def test_basic(self, mock_summary):
        mock_summary.return_value = "src/main.py | 10 ++++++++"
        body = _build_pr_body("Fix the bug", "AIM-1959", "/ws", None, "main")
        assert "Fix the bug" in body
        assert "#1959" in body
        assert "src/main.py | 10 ++++++++" in body
        assert "N/A" in body

    @patch("workers.tasks.pr_creation._get_changed_files_summary")
    def test_with_verification(self, mock_summary):
        mock_summary.return_value = "src/main.py | 5 +"
        body = _build_pr_body(
            "Fix bug", "AIM-1", "/ws",
            {"score": 0.95, "passed": True},
            "main",
        )
        assert "95" in body

    @patch("workers.tasks.pr_creation._get_changed_files_summary")
    def test_with_empty_body(self, mock_summary):
        mock_summary.return_value = ""
        body = _build_pr_body("", "ISSUE-42", "/ws", None, "main")
        assert "No description provided" in body


class TestGetChangedFilesSummary:
    @patch("workers.tasks.pr_creation.subprocess.run")
    def test_success(self, mock_run):
        mock_run.return_value = MagicMock(
            stdout="src/main.py | 10 ++++++++\n",
            returncode=0,
        )
        result = _get_changed_files_summary("/ws", "main")
        assert "src/main.py" in result
        mock_run.assert_called_once()

    @patch("workers.tasks.pr_creation.subprocess.run")
    def test_no_changes(self, mock_run):
        mock_run.return_value = MagicMock(stdout="", returncode=0)
        result = _get_changed_files_summary("/ws", "main")
        assert "No file changes detected" in result

    @patch("workers.tasks.pr_creation.subprocess.run")
    def test_on_error(self, mock_run):
        mock_run.side_effect = subprocess.CalledProcessError(128, "git")
        result = _get_changed_files_summary("/ws", "main")
        assert "Could not generate" in result


class TestCreatePullRequestTask:
    @patch("workers.tasks.pr_creation.GitHubClient")
    @patch("workers.tasks.pr_creation.LinearClient")
    @patch("workers.tasks.pr_creation._build_pr_body")
    def test_creates_new_pr(
        self, mock_build_body, mock_linear_cls, mock_gh_cls,
    ):
        mock_gh = MagicMock()
        mock_gh_cls.return_value = mock_gh

        mock_gh.find_existing_pr.return_value = None
        mock_gh.create_pr.return_value = {
            "pr_url": "https://github.com/o/r/pull/42",
            "pr_number": 42,
            "status": "opened",
        }
        mock_gh.check_mergeable.return_value = {
            "mergeable": True,
            "mergeable_state": "clean",
        }
        mock_build_body.return_value = "PR body text"

        mock_linear = MagicMock()
        mock_linear.post_comment.return_value = {"id": "lin_comment_123"}
        mock_linear_cls.return_value = mock_linear

        result = create_pull_request.run(
            issue_id="AIM-1959",
            workspace_path="/ws",
            issue_title="Fix the bug",
            issue_body="Details",
            repo_owner="owner",
            repo_name="repo",
            branch_name="syntaro/fix/test-abc12345",
            verification_result={"score": 0.95, "passed": True},
            installation_id=123,
        )

        assert result["pr_url"] == "https://github.com/o/r/pull/42"
        assert result["pr_number"] == 42
        assert result["status"] == "opened"
        assert result["linear_comment_id"] == "lin_comment_123"
        assert result["mergeable"] is True
        assert result["branch"] == "syntaro/fix/test-abc12345"
        assert result["base_branch"] == "main"

        mock_gh.push_branch.assert_called_once_with("/ws", "syntaro/fix/test-abc12345")
        mock_gh.create_pr.assert_called_once()
        mock_gh.find_existing_pr.assert_called_once_with(
            "owner/repo", "syntaro/fix/test-abc12345",
        )
        mock_linear.post_comment.assert_called_once()

    @patch("workers.tasks.pr_creation.GitHubClient")
    @patch("workers.tasks.pr_creation.LinearClient")
    @patch("workers.tasks.pr_creation._build_pr_body")
    def test_updates_existing_pr(
        self, mock_build_body, mock_linear_cls, mock_gh_cls,
    ):
        mock_gh = MagicMock()
        mock_gh_cls.return_value = mock_gh

        mock_gh.find_existing_pr.return_value = {
            "pr_url": "https://github.com/o/r/pull/1",
            "pr_number": 1,
            "status": "open",
        }
        mock_gh.update_pr.return_value = {
            "pr_url": "https://github.com/o/r/pull/1",
            "pr_number": 1,
            "status": "updated",
        }
        mock_gh.check_mergeable.return_value = {
            "mergeable": True,
            "mergeable_state": "clean",
        }
        mock_build_body.return_value = "PR body text"

        mock_linear = MagicMock()
        mock_linear.post_comment.return_value = {"id": "lin_456"}
        mock_linear_cls.return_value = mock_linear

        result = create_pull_request.run(
            issue_id="AIM-1959",
            workspace_path="/ws",
            issue_title="Fix the bug",
            issue_body="Details",
            repo_owner="owner",
            repo_name="repo",
            branch_name="syntaro/fix/existing-branch",
            installation_id=123,
        )

        assert result["pr_number"] == 1
        assert result["status"] == "updated"
        mock_gh.update_pr.assert_called_once()
        mock_gh.create_pr.assert_not_called()

    @patch("workers.tasks.pr_creation.GitHubClient")
    @patch("workers.tasks.pr_creation.LinearClient")
    @patch("workers.tasks.pr_creation._build_pr_body")
    def test_skips_linear_when_no_api_key(
        self, mock_build_body, mock_linear_cls, mock_gh_cls,
    ):
        mock_gh = MagicMock()
        mock_gh_cls.return_value = mock_gh
        mock_gh.find_existing_pr.return_value = None
        mock_gh.create_pr.return_value = {
            "pr_url": "https://github.com/o/r/pull/42",
            "pr_number": 42,
            "status": "opened",
        }
        mock_gh.check_mergeable.return_value = {
            "mergeable": True,
            "mergeable_state": "clean",
        }
        mock_build_body.return_value = "body"

        mock_linear_cls.side_effect = ValueError("LINEAR_API_KEY is not set")

        result = create_pull_request.run(
            issue_id="AIM-1959",
            workspace_path="/ws",
            issue_title="Test",
            issue_body="Body",
            repo_owner="owner",
            repo_name="repo",
            branch_name="syntaro/fix/test",
        )

        assert result["linear_comment_id"] is None

    @patch("workers.tasks.pr_creation.GitHubClient")
    @patch("workers.tasks.pr_creation._build_pr_body")
    def test_adds_labels(self, mock_build_body, mock_gh_cls):
        mock_gh = MagicMock()
        mock_gh_cls.return_value = mock_gh
        mock_gh.find_existing_pr.return_value = None
        mock_gh.create_pr.return_value = {
            "pr_url": "https://github.com/o/r/pull/7",
            "pr_number": 7,
            "status": "opened",
        }
        mock_gh.check_mergeable.return_value = {
            "mergeable": True,
            "mergeable_state": "clean",
        }
        mock_build_body.return_value = "body"

        create_pull_request.run(
            issue_id="AIM-1",
            workspace_path="/ws",
            issue_title="Test",
            issue_body="Body",
            repo_owner="owner",
            repo_name="repo",
            branch_name="syntaro/fix/test",
            labels=["bug", "automated"],
            installation_id=123,
        )

        mock_gh.push_branch.assert_called_once()
        mock_gh.create_pr.assert_called_once()
        call_kwargs = mock_gh.create_pr.call_args[1]
        assert call_kwargs["labels"] == ["bug", "automated"]


# ---------------------------------------------------------------------------
# Linear client
# ---------------------------------------------------------------------------


class TestLinearClient:
    @patch("workers.linear_client.httpx.Client")
    def test_post_comment(self, mock_httpx_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "data": {
                "commentCreate": {
                    "success": True,
                    "comment": {"id": "lin_comment_123"},
                },
            },
        }
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_httpx_cls.return_value.__enter__.return_value = mock_client

        client = LinearClient(api_key="lin_api_key")
        result = client.post_comment("ISSUE-1", "Hello Linear")
        assert result["id"] == "lin_comment_123"

    @patch("workers.linear_client.httpx.Client")
    def test_transition_issue(self, mock_httpx_cls):
        responses = [
            MagicMock(
                json=lambda: {
                    "data": {"issue": {"team": {"id": "team_1"}}},
                },
            ),
            MagicMock(
                json=lambda: {
                    "data": {
                        "team": {
                            "states": {
                                "nodes": [
                                    {"id": "state_review", "name": "Human Review"},
                                    {"id": "state_done", "name": "Done"},
                                ],
                            },
                        },
                    },
                },
            ),
            MagicMock(
                json=lambda: {
                    "data": {"issueUpdate": {"success": True}},
                },
            ),
        ]
        mock_client = MagicMock()
        mock_client.post.side_effect = responses
        mock_httpx_cls.return_value.__enter__.return_value = mock_client

        client = LinearClient(api_key="lin_api_key")
        result = client.transition_issue("ISSUE-1", "Human Review")
        assert result is True

    def test_init_without_key_raises(self):
        with patch("workers.linear_client.os.environ.get", return_value=""):
            with pytest.raises(ValueError, match="LINEAR_API_KEY"):
                LinearClient()

    def test_init_with_key_param(self):
        client = LinearClient(api_key="custom_key")
        assert client.api_key == "custom_key"

    @patch("workers.linear_client.httpx.Client")
    def test_graphql_error_raises(self, mock_httpx_cls):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"errors": [{"message": "Not found"}]}
        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_httpx_cls.return_value.__enter__.return_value = mock_client

        client = LinearClient(api_key="key")
        with pytest.raises(RuntimeError, match="Linear API error"):
            client.post_comment("ISSUE-1", "body")
