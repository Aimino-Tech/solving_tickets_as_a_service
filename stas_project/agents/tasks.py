"""
STAS agent pipeline tasks.

Wraps the existing workers.tasks modules into Celery chains for
end-to-end issue processing: triage → agent dispatch → sandbox →
verification → PR creation → notifications.
"""
from __future__ import absolute_import, unicode_literals

import logging
import re
from datetime import datetime

from celery import chain, shared_task

logger = logging.getLogger(__name__)

# Regex to extract owner/repo/number from a GitHub issue URL.
_ISSUE_URL_RE = re.compile(
    r"^https?://github\.com/([^/]+)/([^/]+)/issues/(\d+)/?$"
)


def _parse_issue_url(issue_url: str) -> dict | None:
    """Return {owner, repo, issue_number} or None."""
    m = _ISSUE_URL_RE.match(issue_url)
    if m:
        return {
            "owner": m.group(1),
            "repo": m.group(2),
            "issue_number": int(m.group(3)),
        }
    return None


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def run_issue_pipeline(
    self,
    issue_url: str,
    issue_number: int | None,
    repo_full_name: str,
    repo_url: str,
    installation_id: int,
    event_id: str | None = None,
):
    """
    Entry point: full agent pipeline for a single issue.

    Orchestrates: triage → dispatch → verify → PR → notify
    """
    from agents.models import AgentRun
    from webhooks.models import WebhookEvent

    event = None
    if event_id:
        try:
            event = WebhookEvent.objects.get(id=event_id)
        except WebhookEvent.DoesNotExist:
            pass

    run = AgentRun.objects.create(
        issue_url=issue_url,
        issue_number=issue_number,
        repo_full_name=repo_full_name,
        repo_url=repo_url,
        installation_id=str(installation_id),
        webhook_event=event,
    )

    logger.info(
        "Starting agent pipeline for %s #%d (run=%s)",
        repo_full_name,
        issue_number or 0,
        run.id,
    )

    # Common context passed through every chain step
    ctx = {
        "run_id": str(run.id),
        "issue_url": issue_url,
        "issue_number": issue_number,
        "repo_full_name": repo_full_name,
        "repo_url": repo_url,
        "installation_id": installation_id,
    }

    # Execute pipeline as a Celery chain
    pipeline = chain(
        triage_issue.s(**ctx),
        dispatch_agent.s(),
        verify_fix.s(),
        create_pr.s(),
        send_notifications.s(),
    )

    pipeline.apply_async()

    return {"run_id": str(run.id), "status": AgentRun.Status.TRIAGE}


@shared_task(bind=True, max_retries=2)
def triage_issue(self, **kwargs):
    """Classify the issue using the existing workers.tasks.triage module."""
    run_id = kwargs["run_id"]
    issue_url = kwargs["issue_url"]
    repo_full_name = kwargs["repo_full_name"]
    issue_number = kwargs.get("issue_number")

    from agents.models import AgentRun

    try:
        run = AgentRun.objects.get(id=run_id)
        run.status = AgentRun.Status.TRIAGE
        run.save(update_fields=["status"])
    except AgentRun.DoesNotExist:
        run = None

    try:
        from workers.tasks.triage import triage_issue as run_triage

        result = run_triage({
            "issue_url": issue_url,
            "title": f"Issue #{issue_number} in {repo_full_name}",
            "body": f"Issue: {issue_url}\nRepo: {repo_full_name}",
        })

        triage = result.get("triage_result", {})
        if run:
            run.triage_result = triage
            run.save(update_fields=["triage_result"])

        logger.info("Triage result for %s: %s", issue_url, triage)
        return {**kwargs, "triage_result": triage}

    except Exception as exc:
        logger.error("Triage failed for %s: %s", issue_url, exc)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3)
def dispatch_agent(self, previous_result: dict):
    """Dispatch OpenCode agent using workers.tasks.agent module."""
    run_id = previous_result["run_id"]
    issue_url = previous_result["issue_url"]

    from agents.models import AgentRun

    try:
        run = AgentRun.objects.get(id=run_id)
        run.status = AgentRun.Status.DISPATCH
        run.save(update_fields=["status"])
    except AgentRun.DoesNotExist:
        run = None

    try:
        from workers.tasks.agent import dispatch_opencode

        # Prepare issue context for the OpenCode dispatch
        issue_context = {
            "issue_url": issue_url,
            "triage_result": previous_result.get("triage_result", {}),
            "repo_full_name": previous_result.get("repo_full_name", ""),
            "issue_number": previous_result.get("issue_number"),
            "installation_id": previous_result.get("installation_id"),
        }

        agent_result = dispatch_opencode(issue_context)

        logger.info(
            "Agent dispatch completed for %s: %s",
            issue_url,
            agent_result.get("result", {}).get("status"),
        )

        return {**previous_result, "agent_result": agent_result}

    except Exception as exc:
        logger.error("Agent dispatch failed for %s: %s", issue_url, exc)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=2)
def verify_fix(self, previous_result: dict):
    """Verify the fix by running tests in sandbox."""
    run_id = previous_result["run_id"]

    from agents.models import AgentRun

    try:
        run = AgentRun.objects.get(id=run_id)
        run.status = AgentRun.Status.VERIFICATION
        run.save(update_fields=["status"])
    except AgentRun.DoesNotExist:
        pass

    agent_result = previous_result.get("agent_result", {})
    branch = agent_result.get("branch", "")
    repo_url = previous_result.get("repo_url", "")

    if not branch:
        logger.warning("No branch to verify — skipping verification")
        return {**previous_result, "verification_result": {"skipped": True}}

    try:
        from workers.tasks.verification import run_verification

        verification_result = run_verification(
            sandbox_id="placeholder",
            test_command="pnpm test",
        )
        return {**previous_result, "verification_result": verification_result}

    except Exception as exc:
        logger.error("Verification failed: %s", exc)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3)
def create_pr(self, previous_result: dict):
    """Create a pull request for the fix."""
    run_id = previous_result["run_id"]
    issue_number = previous_result.get("issue_number")
    repo_full_name = previous_result.get("repo_full_name", "")
    installation_id = previous_result.get("installation_id")

    from agents.models import AgentRun

    agent_result = previous_result.get("agent_result", {})
    branch = agent_result.get("branch", "")
    issue_url = previous_result.get("issue_url", "")

    parsed = _parse_issue_url(issue_url)

    # Build the fix_result and repo_info for the PR creation task
    fix_result = {
        "branch": branch or f"stas/fix-issue-{issue_number or 'unknown'}",
        "base_branch": "main",
        "summary": f"Automated fix for {issue_url}",
    }
    repo_info = {
        "owner": parsed["owner"] if parsed else repo_full_name.split("/")[0],
        "repo": parsed["repo"] if parsed else repo_full_name.split("/")[-1],
        "installation_id": installation_id,
    }

    if not branch:
        logger.warning(
            "No branch from OpenCode — creating PR with default branch name %s",
            fix_result["branch"],
        )

    try:
        from workers.tasks.pr_creation import create_pull_request

        pr_result = create_pull_request(fix_result, repo_info)

        pr_url = pr_result.get("html_url", "")
        pr_number = pr_result.get("number")

        try:
            run = AgentRun.objects.get(id=run_id)
            run.pr_url = pr_url or ""
            run.pr_number = pr_number
            run.status = AgentRun.Status.PR_CREATED if pr_url else AgentRun.Status.COMPLETED
            run.save(update_fields=["pr_url", "pr_number", "status"])
        except AgentRun.DoesNotExist:
            pass

        return {**previous_result, "pr_result": pr_result}

    except Exception as exc:
        logger.error("PR creation failed: %s", exc)
        raise self.retry(exc=exc)


@shared_task
def send_notifications(previous_result: dict):
    """Send final notifications via workers.tasks.notifications."""
    run_id = previous_result["run_id"]

    from agents.models import AgentRun

    try:
        run = AgentRun.objects.get(id=run_id)
        run.status = AgentRun.Status.COMPLETED
        run.completed_at = datetime.now()
        run.save(update_fields=["status", "completed_at"])
    except AgentRun.DoesNotExist:
        pass

    pr_result = previous_result.get("pr_result", {})
    agent_result = previous_result.get("agent_result", {})
    issue_url = previous_result.get("issue_url", "")
    installation_id = previous_result.get("installation_id")

    pr_url = pr_result.get("html_url", "") or "No PR created"

    try:
        from workers.tasks.notifications import send_notification

        # Post a comment on the GitHub issue
        message = (
            f"🤖 **STAS** completed its analysis.\n\n"
            f"**Result**: {pr_url}\n"
        )
        if pr_result.get("status") == "created":
            message += f"**PR**: {pr_url}\n"
        elif pr_result.get("status") == "already_exists":
            message += "A PR for this branch already exists.\n"
        else:
            message += "No changes were needed or possible.\n"

        send_notification(
            channel="issue-comment",
            message=message,
            issue_url=issue_url,
            installation_id=installation_id,
        )

        # Also try Slack if configured
        send_notification(
            channel="slack",
            message=f"STAS completed: {pr_url} for {issue_url}",
        )

    except Exception as exc:
        logger.warning("Notification failed: %s", exc)

    return previous_result
