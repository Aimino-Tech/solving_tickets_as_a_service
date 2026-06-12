"""Tests for the Slack workspace introspection and messaging tool."""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from tools.slack_tool import (
    SlackAPIError,
    _ACTIONS,
    _get_bot_token,
    _get_webhook_url,
    _has_bot_token,
    _build_schema,
    _HANDLER_DEFAULTS,
    check_slack_requirements,
    slack_handler,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_urlopen_factory(response_data, status=200):
    """Create a mock for urllib.request.urlopen."""
    mock_resp = MagicMock()
    mock_resp.status = status
    mock_resp.read.return_value = json.dumps(response_data).encode("utf-8")
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


# ---------------------------------------------------------------------------
# Token / check_fn
# ---------------------------------------------------------------------------


class TestCheckRequirements:
    def test_no_token_no_webhook(self, monkeypatch):
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
        monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
        assert check_slack_requirements() is False

    def test_empty_token(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "")
        monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
        assert check_slack_requirements() is False

    def test_valid_token(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
        assert check_slack_requirements() is True

    def test_webhook_only(self, monkeypatch):
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
        monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T00/B00/xxx")
        assert check_slack_requirements() is True

    def test_get_bot_token(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "  xoxb-my-token  ")
        assert _get_bot_token() == "xoxb-my-token"

    def test_get_bot_token_missing(self, monkeypatch):
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
        assert _get_bot_token() is None

    def test_get_webhook_url(self, monkeypatch):
        monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")
        assert _get_webhook_url() == "https://hooks.slack.com/test"

    def test_get_webhook_url_missing(self, monkeypatch):
        monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
        assert _get_webhook_url() is None


# ---------------------------------------------------------------------------
# SlackAPIError
# ---------------------------------------------------------------------------


class TestSlackAPIError:
    def test_error_message(self):
        err = SlackAPIError("channel_not_found")
        assert "channel_not_found" in str(err)

    def test_error_with_raw(self):
        err = SlackAPIError("invalid_auth", {"error": "invalid_auth"})
        assert "invalid_auth" in str(err)
        assert err.raw["error"] == "invalid_auth"


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------


class TestSchema:
    def test_schema_contains_actions(self):
        schema = _build_schema()
        assert schema is not None
        assert schema["name"] == "slack"
        params = schema["parameters"]
        assert "action" in params["properties"]
        action_enum = params["properties"]["action"]["enum"]
        for action in _ACTIONS:
            assert action in action_enum

    def test_schema_requires_action(self):
        schema = _build_schema()
        assert "action" in schema["parameters"]["required"]


# ---------------------------------------------------------------------------
# Handler: unknown action
# ---------------------------------------------------------------------------


class TestHandlerUnknownAction:
    def test_unknown_action(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        result = json.loads(slack_handler(action="unknown_action"))
        assert "error" in result
        assert "Unknown action" in result["error"]


# ---------------------------------------------------------------------------
# Handler: send_message
# ---------------------------------------------------------------------------


class TestSendMessage:
    def test_send_message_missing_text(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        result = json.loads(slack_handler(action="send_message", channel="C123"))
        assert "error" in result
        assert "text" in result["error"]

    def test_send_message_no_creds(self, monkeypatch):
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
        monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
        result = json.loads(slack_handler(
            action="send_message", channel="C123", text="hello",
        ))
        assert "error" in result
        assert "SLACK_BOT_TOKEN" in result["error"] or "SLACK_WEBHOOK_URL" in result["error"]

    @patch("tools.slack_tool._slack_api_call")
    def test_send_message_success(self, mock_api, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        mock_api.return_value = {"ok": True, "ts": "1718000000.000001", "channel": "C123"}
        result = json.loads(slack_handler(
            action="send_message", channel="C123", text="Hello from test",
        ))
        assert result.get("success") is True
        assert result["channel"] == "C123"
        assert result["message_id"] == "1718000000.000001"

    @patch("tools.slack_tool._slack_api_call")
    def test_send_message_api_error(self, mock_api, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        mock_api.side_effect = SlackAPIError("channel_not_found")
        result = json.loads(slack_handler(
            action="send_message", channel="C999", text="Hello",
        ))
        assert "error" in result
        assert "channel_not_found" in result["error"]

    @patch("tools.slack_tool._send_via_webhook")
    def test_send_message_webhook(self, mock_webhook, monkeypatch):
        """When only webhook is configured, send_message should use it."""
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
        monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")
        mock_webhook.return_value = {"success": True, "mode": "webhook"}
        # channel is not required in webhook mode
        result = json.loads(slack_handler(
            action="send_message", text="Webhook test",
        ))
        assert result.get("success") is True
        assert result.get("mode") == "webhook"


# ---------------------------------------------------------------------------
# Handler: list_channels
# ---------------------------------------------------------------------------


class TestListChannels:
    def test_list_channels_no_token(self, monkeypatch):
        monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
        result = json.loads(slack_handler(action="list_channels"))
        assert "error" in result

    @patch("tools.slack_tool._slack_api_call")
    def test_list_channels_success(self, mock_api, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        mock_api.return_value = {
            "ok": True,
            "channels": [
                {"id": "C001", "name": "general", "num_members": 10},
                {"id": "C002", "name": "random", "num_members": 5},
            ],
        }
        result = json.loads(slack_handler(action="list_channels"))
        assert "channels" in result
        assert result["total"] == 2
        assert result["channels"][0]["name"] == "general"


# ---------------------------------------------------------------------------
# Handler: fetch_messages
# ---------------------------------------------------------------------------


class TestFetchMessages:
    def test_fetch_messages_missing_channel(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        result = json.loads(slack_handler(action="fetch_messages"))
        assert "error" in result

    @patch("tools.slack_tool._slack_api_call")
    def test_fetch_messages_success(self, mock_api, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        mock_api.return_value = {
            "ok": True,
            "messages": [
                {"ts": "1718000000.000001", "user": "U001", "text": "Hello world"},
            ],
            "has_more": False,
        }
        result = json.loads(slack_handler(
            action="fetch_messages", channel="C123", limit=5,
        ))
        assert result["count"] == 1
        assert result["messages"][0]["text"] == "Hello world"
        assert result["has_more"] is False


# ---------------------------------------------------------------------------
# Handler: list_members
# ---------------------------------------------------------------------------


class TestListMembers:
    def test_list_members_missing_channel(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        result = json.loads(slack_handler(action="list_members"))
        assert "error" in result

    @patch("tools.slack_tool._slack_api_call")
    def test_list_members_success(self, mock_api, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        # First call: conversations.members
        # Subsequent calls: users.info for each member
        mock_api.side_effect = [
            {"ok": True, "members": ["U001", "U002"]},
            {"ok": True, "user": {"name": "alice", "real_name": "Alice", "profile": {"display_name": "Ali"}, "is_bot": False}},
            {"ok": True, "user": {"name": "bob", "real_name": "Bob", "profile": {"display_name": ""}, "is_bot": False}},
        ]
        result = json.loads(slack_handler(
            action="list_members", channel="C123",
        ))
        assert result["count"] == 2
        assert result["members"][0]["name"] == "alice"
        assert result["members"][1]["name"] == "bob"


# ---------------------------------------------------------------------------
# Handler: get_channel_info
# ---------------------------------------------------------------------------


class TestGetChannelInfo:
    def test_get_channel_info_missing_channel(self, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        result = json.loads(slack_handler(action="get_channel_info"))
        assert "error" in result

    @patch("tools.slack_tool._slack_api_call")
    def test_get_channel_info_success(self, mock_api, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        mock_api.return_value = {
            "ok": True,
            "channel": {
                "id": "C123",
                "name": "general",
                "is_channel": True,
                "is_archived": False,
                "num_members": 42,
            },
        }
        result = json.loads(slack_handler(
            action="get_channel_info", channel="C123",
        ))
        assert result["name"] == "general"
        assert result["num_members"] == 42

    @patch("tools.slack_tool._slack_api_call")
    def test_get_channel_info_api_error(self, mock_api, monkeypatch):
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        mock_api.side_effect = SlackAPIError("channel_not_found")
        result = json.loads(slack_handler(
            action="get_channel_info", channel="C999",
        ))
        assert "error" in result
        assert "channel_not_found" in result["error"]


# ---------------------------------------------------------------------------
# Handler defaults
# ---------------------------------------------------------------------------


class TestHandlerDefaults:
    def test_default_values(self):
        assert _HANDLER_DEFAULTS["action"] == ""
        assert _HANDLER_DEFAULTS["limit"] == 20
        assert _HANDLER_DEFAULTS["types"] == "public_channel,private_channel"


# ---------------------------------------------------------------------------
# Registry integration
# ---------------------------------------------------------------------------


class TestRegistryIntegration:
    def test_tool_registered_in_registry(self):
        from tools.registry import registry
        entry = registry.get_entry("slack")
        assert entry is not None
        assert entry.name == "slack"
        assert entry.toolset == "slack"
        assert entry.emoji == "💬"
        assert "SLACK_BOT_TOKEN" in entry.requires_env
