import json
import logging
import os

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.human_escalation.escalate_to_human",
    autoretry_for=(Exception,),
)
def escalate_to_human(
    self,
    issue_id: str,
    review_result: dict | None = None,
    reason: str = "",
) -> dict:
    logger.warning("Escalating to human review -- issue=%s reason=%s", issue_id, reason)

    _post_linear_comment(issue_id, review_result, reason)
    _send_slack_notification(issue_id, review_result, reason)

    return {
        "status": "escalated",
        "issue_id": issue_id,
        "reason": reason,
        "action": "human_review",
    }


def _post_linear_comment(issue_id: str, review_result: dict | None, reason: str):
    try:
        from workers.linear.client import LinearClient
        client = LinearClient()
        findings = review_result.get("findings", []) if review_result else []
        findings_text = ""
        for f in findings[:5]:
            file_str = f" in {f.get('file', '')}" if f.get('file') else ""
            findings_text += f"- **{f.get('severity', 'unknown')}** {f.get('category', 'unknown')}{file_str}: {f.get('description', '')}\n"

        body = (
            f"## Human Review Required\n\n"
            f"**Reason**: {reason}\n\n"
        )
        if findings_text:
            body += f"### Critical Findings\n\n{findings_text}\n\n"
        body += "This issue requires manual human intervention to resolve."

        client.post_comment(issue_id, body)
        logger.info("Posted human escalation comment on Linear issue %s", issue_id)
    except Exception as exc:
        logger.warning("Failed to post Linear comment: %s", exc)


def _send_slack_notification(issue_id: str, review_result: dict | None, reason: str):
    slack_webhook = os.getenv("SLACK_WEBHOOK_URL")
    if not slack_webhook:
        return

    try:
        import requests
        severity = review_result.get("severity", "unknown") if review_result else "unknown"
        requests.post(
            slack_webhook,
            json={
                "text": f":warning: *Human Review Required*",
                "blocks": [
                    {"type": "section", "text": {"type": "mrkdwn", "text": f"*Issue*: {issue_id}\n*Reason*: {reason}\n*Severity*: {severity}"}},
                ],
            },
            timeout=10,
        )
        logger.info("Sent Slack notification for issue %s", issue_id)
    except Exception as exc:
        logger.warning("Failed to send Slack notification: %s", exc)
