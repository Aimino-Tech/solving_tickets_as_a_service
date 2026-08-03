"""Tests for Celery worker task definitions."""

from unittest.mock import patch, MagicMock

from workers.celery_app import app


def test_ping():
    """Ping task must be registered."""
    assert "workers.celery_app.ping" in app.tasks


def test_triage_issue():
    from workers.tasks.triage import triage_issue

    result = triage_issue.run({
        "title": "Bug: app crashes on startup",
        "body": "When I start the app it crashes immediately",
    })
    assert "issue_data" in result
    assert "triage_result" in result
    assert result["issue_data"]["title"] == "Bug: app crashes on startup"


@patch("workers.tasks.agent.subprocess.run")
def test_dispatch_opencode(mock_run):
    from workers.tasks.agent import dispatch_opencode

    # Simulate successful OpenCode CLI run
    mock_run.return_value.returncode = 0
    mock_run.return_value.stdout = "Everything looks good"
    mock_run.return_value.stderr = ""

    result = dispatch_opencode.run({
        "issue_title": "Fix login bug",
        "repo_owner": "test-owner",
        "repo_name": "test-repo",
        "issue_number": 1,
    })
    assert "issue_context" in result
    assert "result" in result
    assert result["issue_context"]["issue_number"] == 1


@patch("workers.tasks.sandbox.os.getenv")
def test_boot_sandbox(mock_getenv):
    from workers.tasks.sandbox import boot_sandbox

    mock_getenv.side_effect = lambda key, default=None: {
        "E2B_API_KEY": "",
        "E2B_TEMPLATE_ID": "default",
        "E2B_SANDBOX_TIMEOUT_MS": "300000",
    }.get(key, default)

    result = boot_sandbox.run("https://github.com/test/repo.git", "main")
    assert "sandbox_id" in result
    assert result["sandbox_id"] == "placeholder"
    assert result["repo_url"] == "https://github.com/test/repo.git"
    assert result["branch"] == "main"


@patch("workers.tasks.verification.SandboxRunner")
def test_run_verification(mock_runner_cls):
    from workers.tasks.verification import run_verification

    mock_instance = MagicMock()
    mock_runner_cls.return_value = mock_instance
    mock_instance.run_tests.return_value = MagicMock(
        exit_code=0, timed_out=False, duration_ms=1500, passed=True,
        raw_output="All tests passed", error_message="",
        summary=MagicMock(pass_rate=1.0, total=10, passed=10, failed=0, skipped=0, error=0),
    )

    result = run_verification.run("sandbox-123", "pytest")
    assert result["issue_id"] == "sandbox-123"
    assert result["passed"] is True


@patch("workers.tasks.verification.SandboxRunner")
def test_verify_agent_output_passed(mock_runner_cls):
    from workers.tasks.verification import verify_agent_output

    mock_instance = MagicMock()
    mock_runner_cls.return_value = mock_instance
    mock_instance.run_tests.return_value = MagicMock(
        exit_code=0, timed_out=False, duration_ms=2500, passed=True,
        raw_output="10 passed in 1.2s", error_message="",
        summary=MagicMock(pass_rate=1.0, total=10, passed=10, failed=0, skipped=0, error=0),
    )

    result = verify_agent_output.run(
        issue_id="ISS-42", workspace_path="/tmp/test-repo",
        test_command="pytest", ac_list=["Fix login bug", "Add input validation"],
    )

    assert result["passed"] is True
    assert result["score"] >= 0.7
    assert result["summary"]["total_tests"] == 10
    assert result["summary"]["test_pass_rate"] == 1.0
    assert result["status"] == "passed"


@patch("workers.tasks.verification.SandboxRunner")
def test_verify_agent_output_failed(mock_runner_cls):
    from workers.tasks.verification import verify_agent_output

    mock_instance = MagicMock()
    mock_runner_cls.return_value = mock_instance
    mock_instance.run_tests.return_value = MagicMock(
        exit_code=1, timed_out=False, duration_ms=3000, passed=False,
        raw_output="3 passed, 5 failed in 2.0s", error_message="",
        summary=MagicMock(pass_rate=0.375, total=8, passed=3, failed=5, skipped=0, error=0),
    )

    result = verify_agent_output.run(
        issue_id="ISS-43", workspace_path="/tmp/test-repo",
        test_command="pytest", ac_list=[],
    )

    assert result["passed"] is False
    assert result["summary"]["test_pass_rate"] == 0.375
    assert result["status"] == "failed"


@patch("workers.tasks.verification.SandboxRunner")
def test_verify_agent_output_sandbox_error(mock_runner_cls):
    from workers.tasks.verification import verify_agent_output

    mock_runner_cls.side_effect = FileNotFoundError("Workspace not found")

    result = verify_agent_output.run(
        issue_id="ISS-44", workspace_path="/nonexistent",
        test_command="pytest", ac_list=[],
    )

    assert result["passed"] is False
    assert result["score"] == 0.0
    assert result["status"] == "workspace_error"


@patch("workers.tasks.pr_creation._get_installation_token")
def test_create_pull_request(mock_get_token):
    from workers.tasks.pr_creation import create_pull_request
    from workers.tasks.pr_creation import _call_github

    mock_get_token.return_value = "ghs_test_token"

    fix_result = {
        "branch": "fix/test-branch",
        "summary": "Fix the login bug",
    }
    repo_info = {
        "owner": "test-owner",
        "repo": "test-repo",
        "installation_id": 123456,
    }

    with patch("workers.tasks.pr_creation._call_github") as mock_gh:
        mock_gh.return_value = {
            "html_url": "https://github.com/test-owner/test-repo/pull/1",
            "number": 1,
        }

        result = create_pull_request.run(fix_result, repo_info)
        assert "repo_info" in result
        assert "fix_result" in result
        assert result["repo_info"]["repo"] == "test-repo"
        assert result["fix_result"]["branch"] == "fix/test-branch"
        assert result["html_url"] == "https://github.com/test-owner/test-repo/pull/1"
        assert result["status"] == "created"


def test_send_notification():
    from workers.tasks.notifications import send_notification

    result = send_notification.run("log", "Test message")
    assert result["status"] == "sent"
    assert result["channel"] == "log"


def test_process_webhook():
    from workers.tasks.notifications import process_webhook

    result = process_webhook.run("issues.labeled", {
        "label": {"name": "syntaro:fix"},
    })
    assert result["event_type"] == "issues.labeled"
    assert result["status"] == "processed"
    assert "handlers" in result
