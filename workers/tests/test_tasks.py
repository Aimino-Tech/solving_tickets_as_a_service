"""Tests for Celery worker task definitions."""

from unittest.mock import patch

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


def test_run_verification():
    from workers.tasks.verification import run_verification

    result = run_verification.run("sandbox-123", "pytest")
    assert "passed" in result
    assert result["sandbox_id"] == "sandbox-123"
    assert result["test_command"] == "pytest"


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
        "label": {"name": "stas:fix"},
    })
    assert result["event_type"] == "issues.labeled"
    assert result["status"] == "processed"
    assert "handlers" in result
