"""Slack workspace introspection and messaging tool.

Provides the agent with the ability to interact with Slack workspaces
using the Slack Bot Token API or incoming webhooks. Supports sending
messages, listing channels, fetching message history, and looking up
channel members.

Two authentication modes:

1. **Bot Token** (``SLACK_BOT_TOKEN``) — full read/write access via the
   Slack Web API. Requires OAuth scopes:
   ``chat:write``, ``channels:read``, ``groups:read``, ``mpim:read``,
   ``im:read``, ``channels:history``, ``groups:history``, ``users:read``.

2. **Webhook URL** (``SLACK_WEBHOOK_URL``) — write-only. Can only send
   messages via the configured webhook. Channel listing and reading are
   unavailable in this mode.

Only included in the ``slack`` toolset, so it has zero cost for users
on other platforms.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from tools.registry import registry

logger = logging.getLogger(__name__)

SLACK_API_BASE = "https://slack.com/api"

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def _get_bot_token() -> Optional[str]:
    """Resolve the Slack bot token from environment."""
    return os.getenv("SLACK_BOT_TOKEN", "").strip() or None


def _get_webhook_url() -> Optional[str]:
    """Resolve the Slack webhook URL from environment."""
    return os.getenv("SLACK_WEBHOOK_URL", "").strip() or None


def _has_bot_token() -> bool:
    """Check if a bot token is available for full API access."""
    return _get_bot_token() is not None


# ---------------------------------------------------------------------------
# Slack API helpers
# ---------------------------------------------------------------------------


def _slack_api_call(
    method: str,
    api_path: str,
    token: str,
    body: Optional[Dict[str, Any]] = None,
    timeout: int = 15,
) -> Any:
    """Make a request to the Slack Web API.

    Args:
        method: HTTP method (GET, POST, etc.).
        api_path: API path (e.g. ``/conversations.list``).
        token: Bot token for authorization.
        body: JSON body for POST requests.
        timeout: Request timeout in seconds.

    Returns:
        Parsed JSON response dict.

    Raises:
        SlackAPIError: on non-2xx or API ``ok: false`` responses.
    """
    import urllib.error
    import urllib.request

    url = f"{SLACK_API_BASE}{api_path}"
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
            if not raw.get("ok"):
                error = raw.get("error", "unknown_error")
                raise SlackAPIError(error, raw)
            return raw
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise SlackAPIError(f"HTTP {e.code}", {"error": error_body}) from e


class SlackAPIError(Exception):
    """Raised when a Slack API call returns an error."""

    def __init__(self, error: str, raw: Any = None):
        self.error = error
        self.raw = raw
        super().__init__(f"Slack API error: {error}")


# ---------------------------------------------------------------------------
# Webhook sender
# ---------------------------------------------------------------------------


def _send_via_webhook(webhook_url: str, message: str) -> Dict[str, Any]:
    """Send a message via a Slack incoming webhook.

    Returns a dict with ``success`` or ``error``.
    """
    import urllib.error
    import urllib.request

    payload = json.dumps({"text": message}).encode("utf-8")
    try:
        req = urllib.request.Request(
            webhook_url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                return {"success": True, "mode": "webhook"}
            return {"error": f"Webhook returned HTTP {resp.status}"}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return {"error": f"Webhook HTTP {e.code}: {body}"}
    except Exception as e:
        return {"error": f"Webhook send failed: {e}"}


# ---------------------------------------------------------------------------
# Action implementations
# ---------------------------------------------------------------------------


def _send_message(
    token: str,
    channel: str,
    text: str,
    thread_ts: Optional[str] = None,
    **_kwargs: Any,
) -> str:
    """Send a message to a Slack channel.

    When no bot token is available but a webhook URL is configured, sends
    via the webhook (the ``channel`` parameter is ignored in webhook mode).
    """
    # Webhook mode (no bot token)
    if not token:
        wh_url = _get_webhook_url()
        if wh_url:
            result = _send_via_webhook(wh_url, text)
            return json.dumps(result)
        return json.dumps({
            "error": "No Slack credentials configured. Set SLACK_BOT_TOKEN or SLACK_WEBHOOK_URL.",
        })

    # Bot Token mode
    payload: Dict[str, Any] = {
        "channel": channel,
        "text": text,
        "mrkdwn": True,
    }
    if thread_ts:
        payload["thread_ts"] = thread_ts

    try:
        data = _slack_api_call("POST", "/chat.postMessage", token, body=payload)
        message_ts = data.get("ts", "")
        channel_id = data.get("channel", channel)
        return json.dumps({
            "success": True,
            "channel": channel_id,
            "message_id": message_ts,
        })
    except SlackAPIError as e:
        return json.dumps({"error": f"Slack send failed: {e.error}"})
    except Exception as e:
        return json.dumps({"error": f"Slack send failed: {e}"})


def _list_channels(
    token: str,
    limit: int = 100,
    types: str = "public_channel,private_channel",
    **_kwargs: Any,
) -> str:
    """List accessible conversation channels in the workspace."""
    try:
        params: Dict[str, Any] = {
            "limit": min(limit, 200),
            "types": types,
            "exclude_archived": True,
        }
        data = _slack_api_call("POST", "/conversations.list", token, body=params)
        channels_raw = data.get("channels", [])
        channels = []
        for ch in channels_raw:
            channels.append({
                "id": ch.get("id", ""),
                "name": ch.get("name", ""),
                "is_channel": ch.get("is_channel", False),
                "is_group": ch.get("is_group", False),
                "is_im": ch.get("is_im", False),
                "is_mpim": ch.get("is_mpim", False),
                "is_archived": ch.get("is_archived", False),
                "topic": (ch.get("topic") or {}).get("value", ""),
                "purpose": (ch.get("purpose") or {}).get("value", ""),
                "num_members": ch.get("num_members", 0),
            })
        return json.dumps({
            "channels": channels,
            "total": len(channels),
        })
    except SlackAPIError as e:
        return json.dumps({"error": f"Failed to list channels: {e.error}"})
    except Exception as e:
        return json.dumps({"error": f"Failed to list channels: {e}"})


def _fetch_messages(
    token: str,
    channel: str,
    limit: int = 20,
    **_kwargs: Any,
) -> str:
    """Fetch recent messages from a Slack channel."""
    try:
        limit = min(max(limit, 1), 100)
        payload: Dict[str, Any] = {
            "channel": channel,
            "limit": limit,
        }
        data = _slack_api_call("POST", "/conversations.history", token, body=payload)
        messages_raw = data.get("messages", [])
        messages = []
        for msg in messages_raw:
            user = msg.get("user", "") or msg.get("bot_id", "")
            messages.append({
                "id": msg.get("ts", ""),
                "user": user,
                "text": msg.get("text", ""),
                "timestamp": msg.get("ts", ""),
                "thread_ts": msg.get("thread_ts"),
                "reply_count": msg.get("reply_count", 0),
                "reply_users_count": msg.get("reply_users_count", 0),
                "is_starred": msg.get("is_starred", False),
                "pinned_to": msg.get("pinned_to"),
                "attachments": [
                    {
                        "title": a.get("title", ""),
                        "fallback": a.get("fallback", ""),
                    }
                    for a in msg.get("attachments", [])
                ],
            })
        return json.dumps({
            "messages": messages,
            "count": len(messages),
            "has_more": data.get("has_more", False),
        })
    except SlackAPIError as e:
        return json.dumps({"error": f"Failed to fetch messages: {e.error}"})
    except Exception as e:
        return json.dumps({"error": f"Failed to fetch messages: {e}"})


def _list_members(
    token: str,
    channel: str,
    limit: int = 50,
    **_kwargs: Any,
) -> str:
    """List members in a Slack channel."""
    try:
        limit = min(max(limit, 1), 200)
        payload: Dict[str, Any] = {
            "channel": channel,
            "limit": limit,
        }
        data = _slack_api_call("POST", "/conversations.members", token, body=payload)
        member_ids = data.get("members", [])

        # Resolve member names (users.info for each)
        members = []
        for uid in member_ids:
            member_info: Dict[str, Any] = {"id": uid, "name": uid}
            try:
                user_data = _slack_api_call(
                    "POST", "/users.info", token, body={"user": uid},
                )
                user = user_data.get("user", {})
                member_info["name"] = user.get("name", uid)
                member_info["real_name"] = user.get("real_name", "")
                member_info["display_name"] = (user.get("profile") or {}).get("display_name", "")
                member_info["is_bot"] = user.get("is_bot", False)
            except (SlackAPIError, Exception):
                pass
            members.append(member_info)

        return json.dumps({
            "members": members,
            "count": len(members),
        })
    except SlackAPIError as e:
        return json.dumps({"error": f"Failed to list members: {e.error}"})
    except Exception as e:
        return json.dumps({"error": f"Failed to list members: {e}"})


def _get_channel_info(
    token: str,
    channel: str,
    **_kwargs: Any,
) -> str:
    """Get detailed info about a specific Slack channel."""
    try:
        data = _slack_api_call("POST", "/conversations.info", token, body={"channel": channel})
        ch = data.get("channel", {})
        return json.dumps({
            "id": ch.get("id", ""),
            "name": ch.get("name", ""),
            "is_channel": ch.get("is_channel", False),
            "is_group": ch.get("is_group", False),
            "is_im": ch.get("is_im", False),
            "is_mpim": ch.get("is_mpim", False),
            "is_archived": ch.get("is_archived", False),
            "is_general": ch.get("is_general", False),
            "topic": (ch.get("topic") or {}).get("value", ""),
            "purpose": (ch.get("purpose") or {}).get("value", ""),
            "created": ch.get("created", 0),
            "creator": ch.get("creator", ""),
            "num_members": ch.get("num_members", 0),
            "locale": ch.get("locale", ""),
        })
    except SlackAPIError as e:
        return json.dumps({"error": f"Failed to get channel info: {e.error}"})
    except Exception as e:
        return json.dumps({"error": f"Failed to get channel info: {e}"})


# ---------------------------------------------------------------------------
# Action dispatch + metadata
# ---------------------------------------------------------------------------

_ACTIONS: Dict[str, Any] = {
    "send_message": _send_message,
    "list_channels": _list_channels,
    "fetch_messages": _fetch_messages,
    "list_members": _list_members,
    "get_channel_info": _get_channel_info,
}

_ACTION_MANIFEST: List[tuple] = [
    ("send_message", "(channel, text)", "send a message to a channel; optional thread_ts for threads"),
    ("list_channels", "()", "list accessible conversations (public + private channels)"),
    ("fetch_messages", "(channel)", "recent messages in a channel; optional limit"),
    ("list_members", "(channel)", "list members in a specific channel"),
    ("get_channel_info", "(channel)", "detailed info about a specific channel"),
]

# send_message requires text; channel is optional (webhook mode omits it).
# For all other actions, channel is required.
_REQUIRED_PARAMS: Dict[str, List[str]] = {
    "send_message": ["text"],
    "list_channels": [],
    "fetch_messages": ["channel"],
    "list_members": ["channel"],
    "get_channel_info": ["channel"],
}


# ---------------------------------------------------------------------------
# Schema construction
# ---------------------------------------------------------------------------


STATIC_SCHEMA: Optional[Dict[str, Any]] = None


def _build_schema() -> Optional[Dict[str, Any]]:
    """Build the tool schema from the registered action manifest."""
    actions = list(_ACTIONS.keys())

    manifest_lines = [
        f"  {name}{sig}  — {desc}"
        for name, sig, desc in _ACTION_MANIFEST
    ]
    manifest_block = "\n".join(manifest_lines)

    token_available = _has_bot_token()
    webhook_available = _get_webhook_url() is not None
    auth_modes = []
    if token_available:
        auth_modes.append("Bot Token (full API access)")
    if webhook_available:
        auth_modes.append("Webhook (send-only)")
    auth_note = ""
    if auth_modes:
        auth_note = f"\n\nAuthenticated via: {', '.join(auth_modes)}."
    else:
        auth_note = (
            "\n\nNo Slack credentials configured. Set SLACK_BOT_TOKEN for full API access "
            "or SLACK_WEBHOOK_URL for webhook-only mode."
        )

    description = (
        "Interact with a Slack workspace.\n\n"
        "Available actions:\n"
        f"{manifest_block}\n\n"
        "Call list_channels first to discover channel IDs, then use those IDs "
        "for send_message, fetch_messages, etc. Channel IDs start with C (public), "
        "G (private/group), or D (DM)."
        f"{auth_note}"
    )

    properties: Dict[str, Any] = {
        "action": {
            "type": "string",
            "enum": actions,
            "description": "Action to perform.",
        },
        "channel": {
            "type": "string",
            "description": (
                "Slack channel ID (e.g. C0123456789) or channel name (e.g. #general). "
                "Use list_channels to discover IDs. Not required in webhook mode."
            ),
        },
        "text": {
            "type": "string",
            "description": "Message text to send (supports Slack mrkdwn formatting). Required for send_message.",
        },
        "thread_ts": {
            "type": "string",
            "description": "Timestamp of parent message to reply in thread (send_message only).",
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 200,
            "description": (
                "Max results (default 20 for fetch_messages, "
                "50 for list_members, 100 for list_channels)."
            ),
        },
        "types": {
            "type": "string",
            "enum": [
                "public_channel",
                "private_channel",
                "public_channel,private_channel",
                "im",
                "mpim",
            ],
            "description": (
                "Channel types to include (list_channels only). "
                "Default: public_channel,private_channel."
            ),
        },
    }

    return {
        "name": "slack",
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": ["action"],
        },
    }


# ---------------------------------------------------------------------------
# Check function
# ---------------------------------------------------------------------------


def check_slack_requirements() -> bool:
    """Tool is available when either a Bot Token or Webhook URL is configured."""
    return bool(_get_bot_token() or _get_webhook_url())


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


def slack_handler(action: str, **kwargs) -> str:
    """Execute a Slack action."""
    token = _get_bot_token()
    is_webhook_mode = not token and bool(_get_webhook_url())

    # Non-send actions require a bot token
    if action != "send_message" and not token:
        return json.dumps({
            "error": (
                "This action requires a Slack Bot Token (SLACK_BOT_TOKEN). "
                "Webhook-only mode (SLACK_WEBHOOK_URL) only supports send_message."
            ),
        })

    action_fn = _ACTIONS.get(action)
    if not action_fn:
        return json.dumps({
            "error": f"Unknown action: {action}",
            "available_actions": list(_ACTIONS.keys()),
        })

    # For webhook-only send_message, channel is not required
    local_vars = {
        "channel": kwargs.get("channel", ""),
        "text": kwargs.get("text", ""),
        "thread_ts": kwargs.get("thread_ts", ""),
        "limit": kwargs.get("limit", 20),
        "types": kwargs.get("types", "public_channel,private_channel"),
    }

    missing = [p for p in _REQUIRED_PARAMS.get(action, []) if not local_vars.get(p)]
    if missing:
        return json.dumps({
            "error": f"Missing required parameters for '{action}': {', '.join(missing)}",
        })

    try:
        return action_fn(
            token=token or "",
            channel=local_vars["channel"],
            text=local_vars["text"],
            thread_ts=local_vars["thread_ts"],
            limit=local_vars["limit"],
            types=local_vars["types"],
        )
    except SlackAPIError as e:
        logger.warning("Slack API error in action '%s': %s", action, e)
        return json.dumps({"error": str(e)})
    except Exception as e:
        logger.exception("Unexpected error in Slack action '%s'", action)
        return json.dumps({"error": f"Unexpected error: {e}"})


# ---------------------------------------------------------------------------
# Handler defaults and registration
# ---------------------------------------------------------------------------

_HANDLER_DEFAULTS = {
    "action": "",
    "channel": "",
    "text": "",
    "thread_ts": "",
    "limit": 20,
    "types": "public_channel,private_channel",
}


def _make_handler():
    """Create a registry-compatible handler lambda."""
    def handler(args, **kw):
        resolved = {k: args.get(k, v) for k, v in _HANDLER_DEFAULTS.items()}
        return slack_handler(**resolved)
    return handler


STATIC_SCHEMA = _build_schema()

registry.register(
    name="slack",
    toolset="slack",
    schema=STATIC_SCHEMA,
    handler=_make_handler(),
    check_fn=check_slack_requirements,
    requires_env=["SLACK_BOT_TOKEN"],
    emoji="💬",
)
