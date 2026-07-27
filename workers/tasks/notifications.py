"""
Send notifications for completed STAS runs.

Supports:
  - GitHub issue comments (via installation token)
  - Slack webhook messages (if SLACK_WEBHOOK_URL is set)
  - Email notifications (via SMTP or SendGrid)
  - Discord webhook messages
  - In-app notifications (writes to notification_history table)
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


def _send_email_notification(
    to_addr: str,
    subject: str,
    body: str,
    from_addr: str = "stas@aimino.io",
) -> bool:
    """Send an email notification using available channels (SendGrid or SMTP)."""
    sendgrid_key = os.getenv("STAS_SENDGRID_API_KEY", "")
    if sendgrid_key:
        try:
            import httpx
            data = {
                "personalizations": [{"to": [{"email": to_addr}]}],
                "from": {"email": from_addr},
                "subject": subject,
                "content": [{"type": "text/plain", "value": body}],
            }
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(
                    "https://api.sendgrid.com/v3/mail/send",
                    json=data,
                    headers={
                        "Authorization": f"Bearer {sendgrid_key}",
                        "Content-Type": "application/json",
                    },
                )
                resp.raise_for_status()
            logger.info("Email sent via SendGrid to=%s subject=%s", to_addr, subject)
            return True
        except Exception as exc:
            logger.warning("SendGrid email failed — %s", exc)

    smtp_host = os.getenv("STAS_SMTP_HOST", "")
    if smtp_host:
        try:
            import smtplib
            import ssl
            from email.mime.text import MIMEText

            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = subject
            msg["From"] = from_addr
            msg["To"] = to_addr

            smtp_port = int(os.getenv("STAS_SMTP_PORT", "587"))
            smtp_user = os.getenv("STAS_SMTP_USER", "")
            smtp_password = os.getenv("STAS_SMTP_PASSWORD", "")

            with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
                server.starttls(context=ssl.create_default_context())
                if smtp_user:
                    server.login(smtp_user, smtp_password)
                server.sendmail(from_addr, [to_addr], msg.as_string())
            logger.info("Email sent via SMTP to=%s subject=%s", to_addr, subject)
            return True
        except Exception as exc:
            logger.warning("SMTP email failed — %s", exc)

    logger.debug("No email transport configured (SendGrid or SMTP)")
    return False


def _send_discord_webhook(message: str, webhook_url: str | None = None) -> bool:
    """Send a message to a Discord channel via webhook."""
    url = webhook_url or os.getenv("DISCORD_WEBHOOK_URL", "")
    if not url:
        logger.debug("DISCORD_WEBHOOK_URL not set — skipping Discord notification")
        return False

    try:
        with httpx.Client() as client:
            resp = client.post(url, json={"content": message})
            resp.raise_for_status()
        logger.info("Discord notification sent")
        return True
    except Exception as exc:
        logger.warning("Discord webhook failed — %s", exc)
        return False


def _write_in_app_notification(
    user_id: int,
    event_type: str,
    title: str,
    body: str,
    metadata: dict[str, Any] | None = None,
) -> bool:
    """Write a notification to the notification_history table for in-app display."""
    try:
        import psycopg2
        dsn = os.getenv("DATABASE_URL", "")
        if not dsn:
            logger.debug("DATABASE_URL not set — skipping in-app notification")
            return False

        conn = psycopg2.connect(dsn)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO notification_history (user_id, event_type, channel, title, body, metadata)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                [user_id, event_type, "in_app", title, body, json.dumps(metadata or {})],
            )
            conn.commit()
        conn.close()
        logger.info("In-app notification written user_id=%s event_type=%s", user_id, event_type)
        return True
    except Exception as exc:
        logger.warning("Failed to write in-app notification — %s", exc)
        return False


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
      - "email" — send an email notification
      - "discord" — send a Discord webhook message
      - "in-app" — write to notification_history table
      - "log" — just log it (default fallback)

    Extra kwargs for issue-comment:
      - issue_url (str) — full GitHub issue URL
      - installation_id (int) — GitHub App installation ID

    Extra kwargs for email:
      - to (str) — recipient email address
      - subject (str) — email subject

    Extra kwargs for in-app:
      - user_id (int) — user ID for the notification
      - event_type (str) — event type name
      - metadata (dict) — optional metadata dict

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

        # --- Email ---
        if channel == "email":
            to_addr = kwargs.get("to", "")
            subject = kwargs.get("subject", "STAS Notification")
            if to_addr:
                sent = _send_email_notification(to_addr, subject, message)
                results["email_sent"] = sent
            else:
                logger.warning("Email notification skipped — no 'to' address provided")
                results["email_skipped"] = True

        # --- Discord ---
        if channel == "discord":
            discord_url = kwargs.get("webhook_url")
            sent = _send_discord_webhook(message, discord_url)
            results["discord_sent"] = sent

        # --- In-app notification ---
        if channel == "in-app":
            user_id = kwargs.get("user_id")
            event_type = kwargs.get("event_type", "notification")
            metadata = kwargs.get("metadata", {})
            if user_id:
                sent = _write_in_app_notification(
                    user_id, event_type, subject or "STAS Notification", message, metadata,
                )
                results["in_app_sent"] = sent
            else:
                logger.warning("In-app notification skipped — no user_id provided")
                results["in_app_skipped"] = True

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


# ---------------------------------------------------------------------------
# Webhook notification dispatch (used by pipeline steps)
# ---------------------------------------------------------------------------


def _build_event_payload(
    event_type: str,
    pipeline_context: dict[str, Any],
    step_results: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a normalised event payload from pipeline context and step results."""
    issue_data = pipeline_context.get("issue_data", {})
    pr_result = (step_results or {}).get("pr_creation", {}) if step_results else {}

    return {
        "event_type": event_type,
        "issue_id": issue_data.get("issue_id", pipeline_context.get("issue_id", "?")),
        "issue_title": issue_data.get("title", pipeline_context.get("issue_title", "")),
        "issue_url": issue_data.get("issue_url", pipeline_context.get("issue_url", "")),
        "pr_url": pr_result.get("html_url", pipeline_context.get("pr_url", "")),
        "status": event_type,
        "summary": pipeline_context.get("summary", issue_data.get("summary", "")),
        "timestamp": pipeline_context.get("timestamp", ""),
    }


def _post_linear_deliverable(payload: dict[str, Any]) -> bool:
    """Post the deliverables summary as a comment on the Linear ticket.

    Extracts the issue_id and summary from the event payload and posts
    the summary as a Linear comment so the result is visible directly
    in the ticket's activity feed — not just in GitHub.

    Returns True if the comment was posted successfully.
    """
    issue_id = payload.get("issue_id", "")
    summary = payload.get("summary", "")
    event_type = payload.get("event_type", "")
    pr_url = payload.get("pr_url", "")

    if not issue_id or not summary:
        logger.debug("No issue_id or summary in payload — skipping Linear deliverable")
        return False

    pr_section = ""
    if pr_url:
        pr_section = f"\n\n**PR**: {pr_url}"

    emoji = "\u2705" if event_type in ("fix_completed", "merge_completed") else "\u2139\ufe0f"
    body = (
        f"{emoji} **STAS Deliverables Summary**\n\n"
        f"{summary}"
        f"{pr_section}"
        f"\n\n---\n_Posted automatically by STAS_"
    )

    try:
        from workers.linear.client_sync import post_comment
        result = post_comment(issue_id, body)
        if result and result.get("id"):
            logger.info(
                "Linear deliverable comment posted issue=%s comment=%s",
                issue_id, result["id"],
            )
            return True
        logger.warning(
            "Linear deliverable comment returned no ID for issue=%s — response=%s",
            issue_id, result,
        )
        return False
    except Exception as exc:
        logger.warning(
            "Failed to post Linear deliverable comment issue=%s — %s",
            issue_id, exc,
        )
        return False


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.notifications.dispatch_webhook_event",
    autoretry_for=(Exception,),
)
def dispatch_webhook_event(
    self,
    event_type: str,
    pipeline_context: dict[str, Any],
    step_results: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Dispatch a webhook notification event.

    Called as a pipeline step after PR creation, review decision, or
    pipeline failure. Builds an event payload from context and delegates
    to ``dispatch_to_webhooks``.

    Also posts the deliverables summary as a Linear comment so the
    result is visible directly in the ticket's activity feed.

    Returns the dispatch results. Notification failures are logged as
    warnings but never raise — the pipeline continues.
    """
    from workers.notifications import dispatch_to_webhooks

    logger.info(
        "Dispatching webhook event — type=%s issue=%s",
        event_type,
        pipeline_context.get("issue_id", "?"),
    )

    payload = _build_event_payload(event_type, pipeline_context, step_results)

    try:
        results = dispatch_to_webhooks(event_type, payload)
        logger.info(
            "Webhook dispatch complete — event=%s results=%d",
            event_type, len(results),
        )

        _post_linear_deliverable(payload)

        return {
            "event_type": event_type,
            "status": "dispatched",
            "results": results,
        }
    except Exception as exc:
        logger.warning(
            "Webhook dispatch failed for event %s — %s (pipeline continues)",
            event_type, exc,
        )
        return {
            "event_type": event_type,
            "status": "error",
            "error": str(exc),
        }
