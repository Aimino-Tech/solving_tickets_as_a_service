"""
Send notifications for completed STAS runs.

Supports:
  - GitHub issue comments (via installation token)
  - Slack webhook messages (if SLACK_WEBHOOK_URL is set)
"""

import json
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
def send_notification(
    self,
    channel: str,
    message: str,
    correlation_id: str = "",
    **kwargs,
) -> dict:
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
        json.dumps({
            "event": "notification.send.start",
            "channel": channel,
            "message_length": len(message),
            "correlation_id": correlation_id,
        })
    )

    try:
        results: dict[str, Any] = {
            "channel": channel,
            "status": "sent",
            "correlation_id": correlation_id,
        }

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
                logger.info(
                    json.dumps({
                        "event": "notification.issue_comment_posted",
                        "comment_url": results["comment_url"],
                        "correlation_id": correlation_id,
                    })
                )
            else:
                logger.warning(
                    json.dumps({
                        "event": "notification.issue_comment_skipped",
                        "reason": "missing issue_url or installation_id",
                        "correlation_id": correlation_id,
                    })
                )
                results["comment_skipped"] = True

        # --- Slack ---
        if channel in ("slack", "issue-comment+slack"):
            sent = _send_slack_webhook(message)
            results["slack_sent"] = sent
            logger.info(
                json.dumps({
                    "event": "notification.slack_result",
                    "sent": sent,
                    "correlation_id": correlation_id,
                })
            )

        # --- Log (default fallback) ---
        if channel == "log":
            logger.info(
                json.dumps({
                    "event": "notification.log",
                    "message_preview": message[:500],
                    "correlation_id": correlation_id,
                })
            )

        return results

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "notification.error",
                "error": str(exc),
                "correlation_id": correlation_id,
            }),
            exc_info=True,
        )
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    name="workers.tasks.notifications.process_webhook",
    autoretry_for=(Exception,),
)
def process_webhook(
    self,
    event_type: str,
    payload: dict,
    correlation_id: str = "",
) -> dict:
    """Route a webhook event to the appropriate handler."""
    logger.info(
        json.dumps({
            "event": "webhook.process.start",
            "event_type": event_type,
            "correlation_id": correlation_id,
        })
    )
    try:
        result = {
            "event_type": event_type,
            "status": "processed",
            "handlers": [],
            "correlation_id": correlation_id,
        }

        if event_type == "issues.labeled":
            label = (payload.get("label") or {}).get("name", "")
            if label == os.getenv("STAS_LABEL", "stas:fix"):
                logger.info(
                    json.dumps({
                        "event": "webhook.process.label_match",
                        "label": label,
                        "handler": "start_pipeline",
                        "correlation_id": correlation_id,
                    })
                )
                result["handlers"].append("start_pipeline")

        elif event_type == "issues.opened":
            logger.info(
                json.dumps({
                    "event": "webhook.process.issue_opened",
                    "handler": "check_auto_triage",
                    "correlation_id": correlation_id,
                })
            )
            result["handlers"].append("check_auto_triage")

        else:
            logger.debug(
                json.dumps({
                    "event": "webhook.process.no_handler",
                    "event_type": event_type,
                    "correlation_id": correlation_id,
                })
            )

        return result

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "webhook.process.error",
                "error": str(exc),
                "correlation_id": correlation_id,
            }),
            exc_info=True,
        )
        raise self.retry(exc=exc)
