"""
Webhook notification dispatcher.

Routes ``event_type`` + ``payload`` to every configured notifier matching the
event type. Configuration is loaded from the ``STAS_WEBHOOK_CONFIG`` environment
variable (JSON), workflow YAML front matter, or environment variables with
``$VAR_NAME`` substitution.

Usage::

    from workers.notifications import dispatch_to_webhooks

    dispatch_to_webhooks("fix_completed", event_payload, webhook_config)

Invalid webhook URLs log a warning but do **not** block the pipeline.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from workers.notifications.notifiers.discord import notify_discord
from workers.notifications.notifiers.slack import notify_slack, notify_slack_threaded, notify_slack_progress
from workers.notifications.notifiers.teams import notify_teams
from workers.notifications.notifiers.email import notify_email
from workers.notifications.rate_limiter import (
    COMMENT_RATE_LIMIT_ENABLED,
    get_comment_rate_limiter,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Event types the notification system handles
# ---------------------------------------------------------------------------

SUPPORTED_EVENTS = frozenset({
    "fix_completed",
    "review_needed",
    "rework_required",
    "merge_completed",
    "pipeline_failed",
})

# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

_VAR_RE = re.compile(r"\$([A-Z_][A-Z0-9_]*)")


def _resolve_env_ref(value: str) -> str:
    """Replace ``$VAR_NAME`` references with environment variable values.

    Leaves unknown variables in place (so a bad reference logs a warning
    but does not crash).
    """
    def _sub(m: re.Match) -> str:
        name = m.group(1)
        resolved = os.getenv(name)
        if resolved is None:
            logger.warning("Environment variable $%s referenced in webhook config but not set", name)
            return m.group(0)
        return resolved
    return _VAR_RE.sub(_sub, value)


def _load_config_from_env() -> dict[str, Any]:
    """Load webhook configuration from ``STAS_WEBHOOK_CONFIG`` env var."""
    raw = os.getenv("STAS_WEBHOOK_CONFIG", "{}")
    try:
        config = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("STAS_WEBHOOK_CONFIG is not valid JSON — %s", exc)
        return {}
    return config


def _resolve_config(config: dict[str, Any]) -> dict[str, Any]:
    """Walk config and resolve ``$VAR_NAME`` environment references in string values."""
    resolved: dict[str, Any] = {}
    for event_type, notifiers_list in config.items():
        if event_type not in SUPPORTED_EVENTS:
            logger.debug("Unknown event type %r in webhook config — skipping", event_type)
            continue
        resolved_list: list[dict[str, Any]] = []
        for entry in notifiers_list:
            resolved_entry: dict[str, Any] = {}
            for key, value in entry.items():
                if isinstance(value, str):
                    resolved_entry[key] = _resolve_env_ref(value)
                else:
                    resolved_entry[key] = value
            resolved_list.append(resolved_entry)
        resolved[event_type] = resolved_list
    return resolved


def _validate_notifier_entry(entry: dict[str, Any], event_type: str) -> bool:
    """Validate a single notifier entry. Returns ``True`` if valid."""
    notifier_type = entry.get("type", "")
    if notifier_type not in ("slack", "teams", "email", "discord"):
        logger.warning(
            "Unknown notifier type %r for event %r — supported: slack, teams, email, discord",
            notifier_type, event_type,
        )
        return False
    url = entry.get("url", "")
    if notifier_type in ("slack", "teams", "discord") and not url:
        logger.warning(
            "Missing webhook URL for %s notifier on event %r — skipping",
            notifier_type, event_type,
        )
        return False
    if notifier_type == "email":
        smtp_host = entry.get("smtp_host", os.getenv("STAS_SMTP_HOST", ""))
        to_addr = entry.get("to", "")
        if not smtp_host and not os.getenv("STAS_SENDGRID_API_KEY", ""):
            logger.warning(
                "Email notifier for event %r has no SMTP host or SendGrid API key — skipping",
                event_type,
            )
            return False
        if not to_addr:
            logger.warning(
                "Email notifier for event %r has no 'to' address — skipping",
                event_type,
            )
            return False
    return True


def _build_default_payload(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Build a well-structured event payload from the raw input, filling defaults."""
    return {
        "event_type": event_type,
        "issue_id": payload.get("issue_id", "unknown"),
        "issue_title": payload.get("issue_title", ""),
        "issue_url": payload.get("issue_url", ""),
        "pr_url": payload.get("pr_url", ""),
        "status": payload.get("status", event_type),
        "summary": payload.get("summary", ""),
        "timestamp": payload.get("timestamp", ""),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def dispatch_to_webhooks(
    event_type: str,
    payload: dict[str, Any],
    config: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Dispatch an event to every configured webhook notifier.

    Parameters
    ----------
    event_type:
        One of ``fix_completed``, ``review_needed``, ``rework_required``,
        ``merge_completed``, ``pipeline_failed``.
    payload:
        Event payload dict (see module docstring for structure). Missing
        optional fields are filled with defaults.
    config:
        Webhook configuration dict keyed by event type. If ``None``, loads
        from ``STAS_WEBHOOK_CONFIG`` environment variable.

    Returns
    -------
    List of per-notifier result dicts with keys: ``notifier``, ``status``
    (``sent`` / ``skipped`` / ``error``), and optional ``error`` message.

    Notes
    -----
    - Invalid webhook URLs log a warning but do **not** raise.
    - Supports multiple webhooks per event type.
    - ``$VAR_NAME`` references in config values are resolved from
      environment variables.
    """
    if event_type not in SUPPORTED_EVENTS:
        logger.debug("Unsupported event type %r — no webhooks dispatched", event_type)
        return []

    if config is None:
        config = _load_config_from_env()

    config = _resolve_config(config)
    normalised_payload = _build_default_payload(event_type, payload)
    notifiers_list = config.get(event_type, [])

    if not notifiers_list:
        logger.debug("No webhooks configured for event %r", event_type)
        return []

    if COMMENT_RATE_LIMIT_ENABLED:
        issue_id = normalised_payload.get("issue_id", "unknown")
        tier = os.getenv(f"ISSUE_{issue_id.upper()}_TIER", os.getenv("STAS_DEFAULT_TIER", "free"))
        limiter = get_comment_rate_limiter()
        rate_result = limiter.check_and_increment(issue_id, tier=tier)
        if not rate_result.allowed:
            logger.info("Webhook rate limit exceeded issue=%s tier=%s current=%d limit=%d reset_in=%.0fs — skipping dispatch", issue_id, tier, rate_result.current, rate_result.limit, rate_result.reset_after_seconds)
            return [{"notifier": "rate_limiter", "status": "rate_limited", "current": rate_result.current, "limit": rate_result.limit, "reset_after_seconds": rate_result.reset_after_seconds}]

    results: list[dict[str, Any]] = []

    for entry in notifiers_list:
        if not _validate_notifier_entry(entry, event_type):
            results.append({
                "notifier": entry.get("type", "unknown"),
                "status": "skipped",
                "error": "invalid configuration",
            })
            continue

        notifier_type = entry["type"]
        try:
            if notifier_type == "slack":
                result = _dispatch_slack(entry, normalised_payload)
            elif notifier_type == "teams":
                result = _dispatch_teams(entry, normalised_payload)
            elif notifier_type == "email":
                result = _dispatch_email(entry, normalised_payload)
            elif notifier_type == "discord":
                result = _dispatch_discord(entry, normalised_payload)
            else:
                result = {"status": "skipped", "error": f"unsupported notifier: {notifier_type}"}

            results.append({"notifier": notifier_type, **result})

        except Exception as exc:
            logger.warning(
                "Webhook notifier %s failed for event %s — %s",
                notifier_type, event_type, exc,
            )
            results.append({
                "notifier": notifier_type,
                "status": "error",
                "error": str(exc),
            })

    return results


# ---------------------------------------------------------------------------
# Per-notifier dispatch wrappers
# ---------------------------------------------------------------------------


def _dispatch_slack(entry: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    url = entry["url"]
    channel = entry.get("channel", "")
    result = notify_slack(payload, webhook_url=url, channel=channel)
    return result


def _dispatch_teams(entry: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    url = entry["url"]
    result = notify_teams(payload, webhook_url=url)
    return result


def _dispatch_discord(entry: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    url = entry["url"]
    result = notify_discord(payload, webhook_url=url)
    return result


def _dispatch_email(entry: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    to_addr = entry.get("to", "")
    subject_prefix = entry.get("subject_prefix", "[STAS]")
    smtp_host = entry.get("smtp_host", os.getenv("STAS_SMTP_HOST", ""))
    smtp_port = int(entry.get("smtp_port", os.getenv("STAS_SMTP_PORT", "587")))
    smtp_user = entry.get("smtp_user", os.getenv("STAS_SMTP_USER", ""))
    smtp_password = entry.get("smtp_password", os.getenv("STAS_SMTP_PASSWORD", ""))
    from_addr = entry.get("from", os.getenv("STAS_SMTP_FROM", "stas@localhost"))
    use_sendgrid = entry.get("use_sendgrid", False) or bool(os.getenv("STAS_SENDGRID_API_KEY", ""))

    result = notify_email(
        payload,
        to=to_addr,
        from_addr=from_addr,
        subject_prefix=subject_prefix,
        smtp_host=smtp_host if not use_sendgrid else "",
        smtp_port=smtp_port,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        use_sendgrid=use_sendgrid,
    )
    return result
