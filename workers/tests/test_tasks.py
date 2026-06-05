"""Tests for Celery worker task definitions."""

from workers.celery_app import app


def test_ping():
    result = app.tasks["workers.celery_app.ping"].run()
    assert result["status"] == "pong"


def test_triage_issue():
    from workers.tasks.triage import triage_issue

    result = triage_issue.run({
        "title": "Bug: app crashes on startup",
        "body": "When I start the app it crashes immediately",
    })
    assert "issue_data" in result
    assert "triage_result" in result
    assert result["issue_data"]["title"] == "Bug: app crashes on startup"


def test_dispatch_opencode():
    from workers.tasks.agent import dispatch_opencode

    result = dispatch_opencode.run({
        "issue_title": "Fix login bug",
        "repo_owner": "test-owner",
        "repo_name": "test-repo",
        "issue_number": 1,
    })
    assert "issue_context" in result
    assert "result" in result
    assert result["issue_context"]["issue_number"] == 1


def test_boot_sandbox():
    from workers.tasks.sandbox import boot_sandbox

    result = boot_sandbox.run("https://github.com/test/repo.git", "main")
    assert "sandbox_id" in result
    assert result["sandbox_id"] is not None
    assert result["repo_url"] == "https://github.com/test/repo.git"
    assert result["branch"] == "main"


def test_run_verification():
    from workers.tasks.verification import run_verification

    result = run_verification.run("sandbox-123", "pytest")
    assert "passed" in result
    assert result["sandbox_id"] == "sandbox-123"
    assert result["test_command"] == "pytest"


def test_create_pull_request():
    from workers.tasks.pr_creation import create_pull_request

    fix_result = {
        "branch": "fix/test-branch",
        "summary": "Fix the login bug",
    }
    repo_info = {
        "owner": "test-owner",
        "repo": "test-repo",
    }
    result = create_pull_request.run(fix_result, repo_info)
    assert "repo_info" in result
    assert "fix_result" in result
    assert result["repo_info"]["repo"] == "test-repo"
    assert result["fix_result"]["branch"] == "fix/test-branch"


def test_send_notification():
    from workers.tasks.notifications import send_notification

    result = send_notification.run("issue-comment", "Test message")
    assert result["status"] == "sent"
    assert result["channel"] == "issue-comment"


def test_process_webhook():
    from workers.tasks.notifications import process_webhook

    result = process_webhook.run("issues.labeled", {
        "label": {"name": "stas:fix"},
    })
    assert result["event_type"] == "issues.labeled"
    assert result["status"] == "processed"
    assert "payload" in result
