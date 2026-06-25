"""
Send notifications for completed STAS runs.

Supports:
  - GitHub issue comments (via installation token)
  - Slack webhook messages (if SLACK_WEBHOOK_URL is set)
"""

import logging
import os
from typing import Any

import httpx
from celery import shared_task

logger = logging.getLogger(__name__)


def _get_github_token(installation_id: int) -> str:
    """Get a GitHub installation token by calling the Express stas-bot helper.

    Fallback: try to construct directly if GITHUB_APP_ID/private-key available.
    """
    # Reuse the same JWT helper from pr_creation
    from workers.tasks.pr_creation import _get_installation_token

    return _get_installation_token(installation_id)


def _post_issue_comment(
    owner: str,
    repo: str,
    issue_number: int,
    body: str,
    installation_id: int,
) -> dict[str, Any]:
    """Post a comment on a GitHub issue."""
    token = _get_github_token(installation_id)
    url = f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}/comments"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "STAS-Bot",
    }
    with httpx.Client() as client:
        resp = client.post(url, headers=headers, json={"body": body})
        resp.raise_for_status()
        return resp.json()


def _send_slack_webhook(message: str) -> bool:
    """Send a message to Slack if SLACK_WEBHOOK_URL is configured."""
    webhook_url = os.getenv("SLACK_WEBHOOK_URL", "")
    if not webhook_url:
        logger.debug("SLACK_WEBHOOK_URL not set — skipping Slack notification")
        return False

    with httpx.Client() as client:
        resp = client.post(webhook_url, json={"text": message})
        resp.raise_for_status()
        return True


def _parse_issue_url(url: str) -> dict[str, Any] | None:
    """Parse 'https://github.com/owner/repo/issues/123' into parts."""
    try:
        parts = url.strip().rstrip("/").split("/")
        # https://github.com/owner/repo/issues/123
        if len(parts) >= 7 and parts[2] == "github.com" and parts[5] == "issues":
            return {
                "owner": parts[3],
                "repo": parts[4],
                "issue_number": int(parts[6]),
            }
    except (IndexError, ValueError):
        pass
    return None


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    name="workers.tasks.notifications.send_notification",
    autoretry_for=(Exception,),
)
def send_notification(self, channel: str, message: str, **kwargs) -> dict:
    """
    Send a notification via the specified channel.

    Supported channels:
      - "issue-comment" — post a comment on the GitHub issue
      - "slack" — send a Slack message
      - "issue-comment+slack" — both
      - "log" — just log it (default fallback)

    Extra kwargs for issue-comment:
      - issue_url (str) — full GitHub issue URL
      - installation_id (int) — GitHub App installation ID

    Returns with status: "sent", "skipped", or "error".
    """
    logger.info(
        "Sending notification — channel=%s message_len=%d",
        channel,
        len(message),
    )

    try:
        results: dict[str, Any] = {"channel": channel, "status": "sent"}

        # --- GitHub issue comment ---
        if channel in ("issue-comment", "issue-comment+slack"):
            issue_url = kwargs.get("issue_url", "")
            install_id = kwargs.get("installation_id")
            parsed = _parse_issue_url(issue_url) if issue_url else None

            if parsed and install_id:
                comment = _post_issue_comment(
                    owner=parsed["owner"],
                    repo=parsed["repo"],
                    issue_number=parsed["issue_number"],
                    body=message,
                    installation_id=install_id,
                )
                results["comment_url"] = comment.get("html_url", "")
                logger.info("Issue comment posted — %s", results["comment_url"])
            else:
                logger.warning(
                    "Cannot post issue comment — missing issue_url=%s installation_id=%s",
                    issue_url,
                    install_id,
                )
                results["comment_skipped"] = True

        # --- Slack ---
        if channel in ("slack", "issue-comment+slack"):
            sent = _send_slack_webhook(message)
            results["slack_sent"] = sent

        # --- Log (default fallback) ---
        if channel == "log":
            logger.info("Notification (log channel): %s", message[:500])

        return results

    except Exception as exc:
        logger.error("Notification failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    name="workers.tasks.notifications.process_webhook",
    autoretry_for=(Exception,),
)
def process_webhook(self, event_type: str, payload: dict) -> dict:
    """Route a webhook event to the appropriate handler."""
    logger.info("Processing webhook — event=%s", event_type)
    try:
        result = {"event_type": event_type, "status": "processed", "handlers": []}

        if event_type == "issues.labeled":
            label = (payload.get("label") or {}).get("name", "")
            if label == os.getenv("STAS_LABEL", "stas:fix"):
                logger.info("Matched target label=%s, handler=start_pipeline", label)
                result["handlers"].append("start_pipeline")
                # In practice, the Django webhook view already starts the pipeline.
                # This task can be used for follow-up actions like logging.

        elif event_type == "issues.opened":
            logger.info("Issue opened — handler=check_auto_triage")
            result["handlers"].append("check_auto_triage")

        else:
            logger.debug("No specific handler for event_type=%s", event_type)

        return result

    except Exception as exc:
        logger.error("Webhook processing failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
