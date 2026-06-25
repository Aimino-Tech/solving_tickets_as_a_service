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
def test_boot_sandbox_placeholder(mock_getenv):
    """Returns placeholder when E2B_API_KEY is not set."""
    from workers.tasks.sandbox import boot_sandbox

    mock_getenv.side_effect = lambda key, default=None: {
        "E2B_API_KEY": "",
        "E2B_TEMPLATE_ID": "default",
        "E2B_SANDBOX_TIMEOUT_MS": "300000",
    }.get(key, default)

    result = boot_sandbox.run("https://github.com/test/repo.git", "main")
    assert result["sandbox_id"] == "placeholder"
    assert result["repo_url"] == "https://github.com/test/repo.git"
    assert result["branch"] == "main"
    assert result["status"] == "placeholder"


@patch("workers.tasks.verification.os.getenv")
@patch("workers.tasks.verification.subprocess.run")
def test_run_verification_local_success(mock_run, mock_getenv):
    """Local fallback returns passed=True when command exits 0."""
    from workers.tasks.verification import run_verification

    mock_getenv.return_value = ""
    mock_run.return_value.returncode = 0
    mock_run.return_value.stdout = "All 42 tests passed"
    mock_run.return_value.stderr = ""

    result = run_verification.run("", "pytest")
    assert result["passed"] is True
    assert "All 42 tests passed" in result["output"]
    assert result["test_command"] == "pytest"
    assert mock_run.called


@patch("workers.tasks.verification.os.getenv")
@patch("workers.tasks.verification.subprocess.run")
def test_run_verification_local_failure(mock_run, mock_getenv):
    """Local fallback returns passed=False when command exits non-zero."""
    from workers.tasks.verification import run_verification

    mock_getenv.return_value = ""
    mock_run.return_value.returncode = 1
    mock_run.return_value.stdout = "FAILED test_login"
    mock_run.return_value.stderr = ""

    result = run_verification.run("", "pytest")
    assert result["passed"] is False
    assert "FAILED test_login" in result["output"]


@patch("workers.tasks.verification.os.getenv")
@patch("workers.tasks.verification.subprocess.run")
def test_run_verification_with_sandbox_id_no_key(mock_run, mock_getenv):
    """When sandbox_id is given but E2B_API_KEY is unset, falls back to local."""
    from workers.tasks.verification import run_verification

    mock_getenv.return_value = ""
    mock_run.return_value.returncode = 0
    mock_run.return_value.stdout = "local fallback"
    mock_run.return_value.stderr = ""

    result = run_verification.run("sandbox-abc", "pytest --verbose")
    assert result["passed"] is True
    assert result["sandbox_id"] == "sandbox-abc"
    assert result["test_command"] == "pytest --verbose"


@patch("workers.tasks.pr_creation._get_installation_token")
def test_create_pull_request(mock_get_token):
    from workers.tasks.pr_creation import create_pull_request

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
        assert result["repo_info"]["repo"] == "test-repo"
        assert result["fix_result"]["branch"] == "fix/test-branch"
        assert result["html_url"] == "https://github.com/test-owner/test-repo/pull/1"
        assert result["status"] == "created"


def test_send_notification_log():
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
