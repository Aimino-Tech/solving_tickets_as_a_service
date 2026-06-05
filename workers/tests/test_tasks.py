from workers.celery_app import app


def test_ping():
    result = app.tasks["workers.celery_app.ping"].run()
    assert result["status"] == "pong"


def test_triage_issue():
    from workers.tasks.triage import triage_issue

    result = triage_issue.run({
        "issue_title": "Bug: app crashes on startup",
        "issue_body": "When I start the app it crashes immediately",
    })
    # Without OPENAI_API_KEY, triage returns default "unknown" classification
    assert result["type"] == "unknown"
    assert result["confidence"] == 0
    assert "triage_result" in result


def test_dispatch_opencode():
    from workers.tasks.agent import dispatch_opencode

    result = dispatch_opencode.run({
        "issue_title": "Fix login bug",
        "repo_owner": "test-owner",
        "repo_name": "test-repo",
        "issue_number": 1,
    })
    assert "pr_url" in result or "errors" in result


def test_boot_sandbox():
    from workers.tasks.sandbox import boot_sandbox

    result = boot_sandbox.run("https://github.com/test/repo.git", "main")
    assert result["success"] is True
    assert result["sandbox_id"] is not None


def test_run_verification():
    from workers.tasks.verification import run_verification

    result = run_verification.run("sandbox-123", "pytest")
    assert "passed" in result
    assert result["sandbox_id"] == "sandbox-123"


def test_create_pull_request():
    from workers.tasks.pr_creation import create_pull_request

    fix_result = {
        "branch_name": "fix/test-branch",
        "summary": "Fix the login bug",
    }
    repo_info = {
        "repo_owner": "test-owner",
        "repo_name": "test-repo",
    }
    result = create_pull_request.run(fix_result, repo_info)
    # Without GITHUB_TOKEN, PR creation returns a placeholder
    assert result["success"] is False
    assert result["pr_url"] is None
    assert result["status"] == "placeholder"


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
    assert result["handled"] is True
    assert "label:stas:fix" in result["actions"]
