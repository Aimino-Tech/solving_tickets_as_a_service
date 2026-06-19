#!/usr/bin/env python3
"""
Celery Worker Pipeline E2E Helper.

Dispatches tasks through the Celery pipeline stages in sequence and reports
results as JSON. Designed to be invoked by the TypeScript E2E test suite.

Usage:
    python3 worker_pipeline_helper.py \\
        --broker amqp://guest:guest@localhost:5672// \\
        --backend redis://localhost:6379/0

Output (JSON Lines):
    {"stage": "triage", "task_id": "...", "status": "SUCCESS", "result": {...}}
    {"stage": "agent", "task_id": "...", "status": "SUCCESS", "result": {...}}
    ...
"""

import argparse
import json
import os
import sys
import time
import uuid

# ---------------------------------------------------------------------------
# Suppress Celery logging noise during test runs
# ---------------------------------------------------------------------------
os.environ["CELERY_LOG_LEVEL"] = "CRITICAL"

import logging

logging.getLogger("celery").setLevel(logging.CRITICAL)
logging.getLogger("kombu").setLevel(logging.CRITICAL)
logging.getLogger("amqp").setLevel(logging.CRITICAL)

from celery import Celery
from celery.result import AsyncResult

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

parser = argparse.ArgumentParser(description="Celery Pipeline E2E Helper")
parser.add_argument("--broker", default="amqp://guest:guest@localhost:5672//", help="Celery broker URL")
parser.add_argument("--backend", default="redis://localhost:6379/0", help="Celery result backend URL")
parser.add_argument("--timeout", type=int, default=120, help="Max seconds to wait per task")
parser.add_argument("--poll-interval", type=float, default=0.5, help="Poll interval in seconds")

args = parser.parse_args()

# ---------------------------------------------------------------------------
# Celery app
# ---------------------------------------------------------------------------

app = Celery("stas-e2e", broker=args.broker, backend=args.backend)
app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)

# ---------------------------------------------------------------------------
# Result helpers
# ---------------------------------------------------------------------------


def emit(stage: str, task_id: str, status: str, result: dict | None = None, error: str | None = None) -> None:
    """Emit a JSON result line that the TypeScript test can parse."""
    record = {
        "stage": stage,
        "task_id": task_id,
        "status": status,
    }
    if result is not None:
        record["result"] = result
    if error is not None:
        record["error"] = error
    print(json.dumps(record), flush=True)


def wait_for_result(task: AsyncResult, stage: str, timeout: int, poll_interval: float) -> dict:
    """Poll for a task result and emit progress lines."""
    deadline = time.monotonic() + timeout
    last_state = None

    while time.monotonic() < deadline:
        state = task.state
        if state != last_state:
            emit(stage, task.id, state)
            last_state = state

        if state == "SUCCESS":
            return {"status": "SUCCESS", "result": task.result}
        if state == "FAILURE":
            error = str(task.result) if task.result else "Unknown error"
            return {"status": "FAILURE", "error": error}
        if state in ("REVOKED", "REJECTED"):
            return {"status": state, "error": f"Task was {state}"}

        time.sleep(poll_interval)

    # Timeout
    task.revoke(terminate=True)
    return {"status": "TIMEOUT", "error": f"Task did not complete within {timeout}s"}


# ---------------------------------------------------------------------------
# Pipeline execution
# ---------------------------------------------------------------------------


def run_pipeline() -> int:
    """
    Execute the full Celery worker pipeline:
    triage → agent → sandbox → verification → PR creation → notifications

    Each stage feeds its output into the next stage as input.
    Returns 0 on success, 1 on failure.
    """
    exit_code = 0

    # ------------------------------------------------------------------
    # Stage 1: Triage
    # ------------------------------------------------------------------
    stage = "triage"
    issue_data = {
        "title": "Fix broken user login",
        "body": "Users are unable to log in when the password contains special characters like @#$%.",
        "repo_owner": "test-owner",
        "repo_name": "test-repo",
        "issue_number": 42,
        "installation_id": 555,
    }

    try:
        task = app.send_task(
            "workers.tasks.triage.triage_issue",
            kwargs={"issue_data": issue_data},
            task_id=str(uuid.uuid4()),
        )
        triage_result = wait_for_result(task, stage, args.timeout, args.poll_interval)
        if triage_result["status"] != "SUCCESS":
            exit_code = 1
            return exit_code

        triage_output = triage_result["result"]
    except Exception as exc:
        emit(stage, "N/A", "EXCEPTION", error=str(exc))
        return 1

    # ------------------------------------------------------------------
    # Stage 2: Agent (OpenCode dispatch)
    # ------------------------------------------------------------------
    stage = "agent"
    issue_context = triage_output.get("issue_data", issue_data)

    try:
        task = app.send_task(
            "workers.tasks.agent.dispatch_opencode",
            kwargs={"issue_context": issue_context},
            task_id=str(uuid.uuid4()),
        )
        agent_result = wait_for_result(task, stage, args.timeout, args.poll_interval)
        if agent_result["status"] != "SUCCESS":
            exit_code = 1
            return exit_code

        agent_output = agent_result["result"]
    except Exception as exc:
        emit(stage, "N/A", "EXCEPTION", error=str(exc))
        return 1

    # ------------------------------------------------------------------
    # Stage 3: Sandbox
    # ------------------------------------------------------------------
    stage = "sandbox"
    repo_url = f"https://github.com/{issue_context.get('repo_owner', 'owner')}/{issue_context.get('repo_name', 'repo')}.git"
    branch = agent_output.get("result", {}).get("branchName", "stas/fix-42")

    try:
        task = app.send_task(
            "workers.tasks.sandbox.boot_sandbox",
            kwargs={"repo_url": repo_url, "branch": branch},
            task_id=str(uuid.uuid4()),
        )
        sandbox_result = wait_for_result(task, stage, args.timeout, args.poll_interval)
        if sandbox_result["status"] != "SUCCESS":
            exit_code = 1
            return exit_code

        sandbox_output = sandbox_result["result"]
    except Exception as exc:
        emit(stage, "N/A", "EXCEPTION", error=str(exc))
        return 1

    # ------------------------------------------------------------------
    # Stage 4: Verification
    # ------------------------------------------------------------------
    stage = "verification"
    sandbox_id = sandbox_output.get("sandbox_id", "placeholder")
    test_command = "npm test"

    try:
        task = app.send_task(
            "workers.tasks.verification.run_verification",
            kwargs={"sandbox_id": sandbox_id, "test_command": test_command},
            task_id=str(uuid.uuid4()),
        )
        verification_result = wait_for_result(task, stage, args.timeout, args.poll_interval)
        if verification_result["status"] != "SUCCESS":
            exit_code = 1
            return exit_code

        verification_output = verification_result["result"]
    except Exception as exc:
        emit(stage, "N/A", "EXCEPTION", error=str(exc))
        return 1

    # ------------------------------------------------------------------
    # Stage 5: PR Creation
    # ------------------------------------------------------------------
    stage = "pr_creation"
    fix_result = agent_output.get("result", {"branch": branch, "summary": "Fix applied"})
    repo_info = {
        "owner": issue_context.get("repo_owner", "owner"),
        "repo": issue_context.get("repo_name", "repo"),
    }

    try:
        task = app.send_task(
            "workers.tasks.pr_creation.create_pull_request",
            kwargs={"fix_result": fix_result, "repo_info": repo_info},
            task_id=str(uuid.uuid4()),
        )
        pr_result = wait_for_result(task, stage, args.timeout, args.poll_interval)
        if pr_result["status"] != "SUCCESS":
            exit_code = 1
            return exit_code

        pr_output = pr_result["result"]
    except Exception as exc:
        emit(stage, "N/A", "EXCEPTION", error=str(exc))
        return 1

    # ------------------------------------------------------------------
    # Stage 6: Notifications
    # ------------------------------------------------------------------
    stage = "notifications"
    channel = "issue-comment"
    message = (
        f"✅ Pipeline complete for {issue_data.get('title', 'issue')}!\n"
        f"PR: {pr_output.get('pr_url', 'N/A')}\n"
        f"Status: {pr_output.get('status', 'unknown')}"
    )

    try:
        task = app.send_task(
            "workers.tasks.notifications.send_notification",
            kwargs={"channel": channel, "message": message},
            task_id=str(uuid.uuid4()),
        )
        notification_result = wait_for_result(task, stage, args.timeout, args.poll_interval)
        if notification_result["status"] != "SUCCESS":
            exit_code = 1
            return exit_code
    except Exception as exc:
        emit(stage, "N/A", "EXCEPTION", error=str(exc))
        return 1

    return exit_code


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sys.exit(run_pipeline())
