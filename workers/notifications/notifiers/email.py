"""
Email notifier.

Sends pipeline event notifications via SMTP or SendGrid API. Each
event type has its own plain-text template.
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.mime.text import MIMEText
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Plain-text templates per event type
# ---------------------------------------------------------------------------


def _template_fix_completed(payload: dict[str, Any]) -> str:
    return f"""SYNTARO Fix Completed
{'=' * 60}

Issue : {payload.get('issue_id', '?')} — {payload.get('issue_title', '')}
URL   : {payload.get('issue_url', '')}
PR    : {payload.get('pr_url', 'N/A')}

Summary:
{payload.get('summary', 'No summary provided.')}

Timestamp: {payload.get('timestamp', '')}
"""


def _template_review_needed(payload: dict[str, Any]) -> str:
    return f"""SYNTARO Review Needed
{'=' * 60}

Issue : {payload.get('issue_id', '?')} — {payload.get('issue_title', '')}
URL   : {payload.get('issue_url', '')}
PR    : {payload.get('pr_url', 'N/A')}

The fix is ready for review.

Timestamp: {payload.get('timestamp', '')}
"""


def _template_rework_required(payload: dict[str, Any]) -> str:
    return f"""SYNTARO Rework Required
{'=' * 60}

Issue : {payload.get('issue_id', '?')} — {payload.get('issue_title', '')}
URL   : {payload.get('issue_url', '')}

Details:
{payload.get('summary', 'No details provided.')}

Timestamp: {payload.get('timestamp', '')}
"""


def _template_merge_completed(payload: dict[str, Any]) -> str:
    return f"""SYNTARO Merge Completed
{'=' * 60}

Issue : {payload.get('issue_id', '?')} — {payload.get('issue_title', '')}
URL   : {payload.get('issue_url', '')}
PR    : {payload.get('pr_url', 'N/A')}

The fix has been merged.

Timestamp: {payload.get('timestamp', '')}
"""


def _template_pipeline_failed(payload: dict[str, Any]) -> str:
    return f"""SYNTARO Pipeline Failed
{'=' * 60}

Issue : {payload.get('issue_id', '?')} — {payload.get('issue_title', '')}
URL   : {payload.get('issue_url', '')}

Error:
{payload.get('summary', 'No details provided.')}

Timestamp: {payload.get('timestamp', '')}
"""


# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------

_TEMPLATES: dict[str, Any] = {
    "fix_completed": _template_fix_completed,
    "review_needed": _template_review_needed,
    "rework_required": _template_rework_required,
    "merge_completed": _template_merge_completed,
    "pipeline_failed": _template_pipeline_failed,
}


def _render_body(event_type: str, payload: dict[str, Any]) -> str:
    """Render the email body for the given event type."""
    template_fn = _TEMPLATES.get(event_type)
    if template_fn is None:
        return f"Event: {event_type}\n{'=' * 60}\n{payload.get('summary', '')}\n"
    return template_fn(payload)


# ---------------------------------------------------------------------------
# Sender implementations
# ---------------------------------------------------------------------------


def _send_via_smtp(
    to_addr: str,
    from_addr: str,
    subject: str,
    body: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    use_tls: bool = True,
) -> None:
    """Send email via SMTP."""
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr

    context = ssl.create_default_context() if use_tls else None

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
        if use_tls:
            server.starttls(context=context)
        if smtp_user:
            server.login(smtp_user, smtp_password)
        server.sendmail(from_addr, [to_addr], msg.as_string())


def _send_via_sendgrid(
    to_addr: str,
    from_addr: str,
    subject: str,
    body: str,
    api_key: str,
) -> None:
    """Send email via SendGrid v3 Mail Send API."""
    data = {
        "personalizations": [{"to": [{"email": to_addr}]}],
        "from": {"email": from_addr},
        "subject": subject,
        "content": [{"type": "text/plain", "value": body}],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            "https://api.sendgrid.com/v3/mail/send",
            json=data,
            headers=headers,
        )
        resp.raise_for_status()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def notify_email(
    payload: dict[str, Any],
    to: str,
    from_addr: str = "syntaro@localhost",
    subject_prefix: str = "[SYNTARO]",
    smtp_host: str = "",
    smtp_port: int = 587,
    smtp_user: str = "",
    smtp_password: str = "",
    use_sendgrid: bool = False,
) -> dict[str, Any]:
    """Send an email notification for a pipeline event.

    Parameters
    ----------
    payload:
        Normalised event payload (see ``webhooks.py``).
    to:
        Recipient email address.
    from_addr:
        Sender email address.
    subject_prefix:
        Prefix for the email subject line.
    smtp_host:
        SMTP server hostname. Ignored when ``use_sendgrid=True``.
    smtp_port:
        SMTP server port.
    smtp_user:
        SMTP username.
    smtp_password:
        SMTP password.
    use_sendgrid:
        If ``True``, sends via SendGrid API instead of SMTP. Reads
        ``SYNTARO_SENDGRID_API_KEY`` from the environment.

    Returns
    -------
    Dict with keys ``status`` (``sent`` / ``error``) and optional ``error``.
    """
    event_type = payload.get("event_type", "fix_completed")
    issue_id = payload.get("issue_id", "?")
    body = _render_body(event_type, payload)
    subject = f"{subject_prefix} {event_type.replace('_', ' ').title()} — {issue_id}"

    try:
        if use_sendgrid:
            api_key = os.getenv("SYNTARO_SENDGRID_API_KEY", "")
            if not api_key:
                return {
                    "status": "error",
                    "error": "SYNTARO_SENDGRID_API_KEY not set",
                }
            _send_via_sendgrid(to, from_addr, subject, body, api_key)
        else:
            if not smtp_host:
                return {
                    "status": "error",
                    "error": "SMTP host not configured",
                }
            _send_via_smtp(
                to, from_addr, subject, body,
                smtp_host, smtp_port, smtp_user, smtp_password,
            )

        logger.info(
            "Email notification sent — event=%s issue=%s to=%s",
            event_type, issue_id, to,
        )
        return {"status": "sent"}

    except Exception as exc:
        logger.warning("Email notification failed — %s", exc)
        return {"status": "error", "error": str(exc)}
