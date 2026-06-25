"""Human review escalation — posts to Linear, transitions state, notifies Slack."""

import json
import logging
import os

from celery import shared_task

logger = logging.getLogger(__name__)

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
NEEDS_HUMAN_STATE = os.getenv("LINEAR_HUMAN_REVIEW_STATE", "Needs Human Intervention")


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.human_escalation.escalate_to_human",
    queue="stas.queue.notifications",
)
def escalate_to_human(
    self,
    issue_id: str,
    review_result: dict,
    workspace_path: str = "",
    extra_context: dict | None = None,
) -> dict:
    """Escalate to human review — post comment, transition state, notify Slack."""
    logger.info("Escalating %s to human review", issue_id)

    try:
        from workers.linear.client import get_client
        linear = get_client()

        findings = review_result.get("findings", [])
        findings_text = "\n".join(
            f"- [{f.get('severity', 'unknown').upper()}] {f.get('category', '?')}: {f.get('description', '')} (file: {f.get('file', 'N/A')})"
            for f in findings[:20]
        )

        extra = extra_context or {}
        conflict_summary = extra.get("conflict_summary", "")
        pr_url = extra.get("pr_url", "")

        comment_parts = [
            "## 🚨 Human Review Required",
            "",
            f"**Issue**: {issue_id}",
            f"**Verdict**: {review_result.get('verdict', 'unknown')}",
            f"**Severity**: {review_result.get('severity', 'unknown')}",
            f"**Score**: {review_result.get('score', 0)}",
            "",
            "### Adversarial Findings",
            findings_text or "_No structured findings_",
        ]

        if conflict_summary:
            comment_parts.extend([
                "",
                "### Merge Conflicts",
                f"```\n{conflict_summary[:1000]}\n```",
            ])

        if pr_url:
            comment_parts.extend([
                "",
                f"**PR**: {pr_url}",
            ])

        try:
            linear.post_comment(issue_id, "\n".join(comment_parts))
            linear.transition_issue(issue_id, NEEDS_HUMAN_STATE)
        except Exception as exc:
            logger.warning("Failed to post to Linear: %s", exc)

        # Slack notification
        if SLACK_WEBHOOK_URL:
            try:
                import httpx
                slack_message = {
                    "text": f"🚨 Human review needed for {issue_id}\n"
                            f"Severity: {review_result.get('severity', 'unknown')}\n"
                            f"Findings: {len(findings)} issues found",
                }
                httpx.post(SLACK_WEBHOOK_URL, json=slack_message, timeout=10)
            except Exception as exc:
                logger.warning("Failed to send Slack notification: %s", exc)

        result = {
            "status": "escalated",
            "issue_id": issue_id,
            "findings_count": len(findings),
            "linear_state": NEEDS_HUMAN_STATE,
        }

        logger.info(json.dumps({"event": "escalation.complete", **result}))
        return result

    except Exception as exc:
        logger.error("Escalation failed: %s", exc, exc_info=True)
        raise self.retry(exc=exc)
