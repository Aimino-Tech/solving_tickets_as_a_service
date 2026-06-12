"""
Unit tests for the Slack notification service (``app.notifications.slack_notifier``).

Covers:
  - ``notify_campaign_status``
  - ``notify_error``
  - ``notify_daily_summary``
  - Gating via ``SLACK_NOTIFICATIONS_ENABLED``
  - Graceful no-op when env vars are missing
  - Block Kit payload structure
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from app.notifications.slack_notifier import (
    notify_campaign_status,
    notify_error,
    notify_daily_summary,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    """Remove all Slack-related env vars before each test."""
    for key in (
        "SLACK_BOT_TOKEN",
        "SLACK_NOTIFICATION_CHANNEL",
        "SLACK_NOTIFICATIONS_ENABLED",
    ):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def _enable_notifications(monkeypatch):
    """Set the env vars needed for notifications to work."""
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
    monkeypatch.setenv("SLACK_NOTIFICATION_CHANNEL", "C0123456789")
    monkeypatch.setenv("SLACK_NOTIFICATIONS_ENABLED", "true")


@pytest.fixture
def mock_webclient():
    """Mock the Slack WebClient so no real API call is made."""
    with patch("app.notifications.slack_notifier.WebClient") as mc:
        instance = MagicMock()
        instance.chat_postMessage.return_value = {"ok": True}
        mc.return_value = instance
        yield mc, instance


# ---------------------------------------------------------------------------
# Tests: gating / graceful no-op
# ---------------------------------------------------------------------------


class TestGating:
    def test_disabled_when_no_token(self, mock_webclient):
        """Should silently return False when SLACK_BOT_TOKEN is not set."""
        _, instance = mock_webclient
        result = notify_campaign_status("test", "launched")
        assert result is False
        instance.chat_postMessage.assert_not_called()

    def test_disabled_when_no_channel(self, monkeypatch, mock_webclient):
        """Should silently return False when notification channel is not set."""
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        _, instance = mock_webclient
        result = notify_campaign_status("test", "launched")
        assert result is False
        instance.chat_postMessage.assert_not_called()

    def test_disabled_when_toggle_off(self, monkeypatch, mock_webclient):
        """Should return False when SLACK_NOTIFICATIONS_ENABLED is not 'true'."""
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        monkeypatch.setenv("SLACK_NOTIFICATION_CHANNEL", "C0123456789")
        monkeypatch.setenv("SLACK_NOTIFICATIONS_ENABLED", "false")
        _, instance = mock_webclient
        result = notify_campaign_status("test", "launched")
        assert result is False
        instance.chat_postMessage.assert_not_called()

    def test_disabled_by_default(self, monkeypatch, mock_webclient):
        """Should return False when SLACK_NOTIFICATIONS_ENABLED is unset."""
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        monkeypatch.setenv("SLACK_NOTIFICATION_CHANNEL", "C0123456789")
        _, instance = mock_webclient
        result = notify_campaign_status("test", "launched")
        assert result is False
        instance.chat_postMessage.assert_not_called()

    def test_channel_override(self, _enable_notifications, mock_webclient):
        """A channel kwarg should override the env-var default."""
        _, instance = mock_webclient
        result = notify_campaign_status("test", "launched", channel="C_OVERRIDE")
        assert result is True
        instance.chat_postMessage.assert_called_once_with(
            channel="C_OVERRIDE",
            text="\U0001f4e2 *Campaign Status*: *test* -- launched",
            blocks=instance.chat_postMessage.call_args[1].get("blocks"),
        )


# ---------------------------------------------------------------------------
# Tests: notify_campaign_status
# ---------------------------------------------------------------------------


class TestNotifyCampaignStatus:
    def test_basic_status(self, _enable_notifications, mock_webclient):
        """A simple status update sends a header + status section."""
        _, instance = mock_webclient
        result = notify_campaign_status("Q4 Launch", "launched")
        assert result is True
        instance.chat_postMessage.assert_called_once()
        _call_kwargs = instance.chat_postMessage.call_args[1]
        assert _call_kwargs["channel"] == "C0123456789"
        assert "Campaign Status" in _call_kwargs["text"]
        blocks = _call_kwargs["blocks"]
        assert blocks[0]["type"] == "header"
        assert "Q4 Launch" in blocks[0]["text"]["text"]

    def test_status_with_details(self, _enable_notifications, mock_webclient):
        """Details dict should be rendered as section fields."""
        _, instance = mock_webclient
        details = {"day": 3, "platforms": "devto, x", "status": "published"}
        result = notify_campaign_status("Q4 Launch", "in_progress", details=details)
        assert result is True
        blocks = instance.chat_postMessage.call_args[1]["blocks"]
        # Find section blocks with fields
        field_sections = [b for b in blocks if b.get("type") == "section" and b.get("fields")]
        assert len(field_sections) >= 1
        all_field_text = " ".join(
            f["text"] for sec in field_sections for f in sec["fields"]
        )
        assert "*day:*" in all_field_text
        assert "3" in all_field_text

    def test_status_context_block(self, _enable_notifications, mock_webclient):
        """Every status message should include a context footer."""
        _, instance = mock_webclient
        notify_campaign_status("test", "done")
        blocks = instance.chat_postMessage.call_args[1]["blocks"]
        context_blocks = [b for b in blocks if b.get("type") == "context"]
        assert len(context_blocks) == 1
        assert "Hermes Agent" in context_blocks[0]["elements"][0]["text"]

    def test_returns_false_on_api_error(self, _enable_notifications, mock_webclient):
        """Should return False when Slack API returns not-ok."""
        _, instance = mock_webclient
        instance.chat_postMessage.return_value = {"ok": False, "error": "channel_not_found"}
        result = notify_campaign_status("test", "launched")
        assert result is False

    def test_returns_false_on_exception(self, _enable_notifications, mock_webclient):
        """Should return False when WebClient raises."""
        _, instance = mock_webclient
        instance.chat_postMessage.side_effect = Exception("connection error")
        result = notify_campaign_status("test", "launched")
        assert result is False


# ---------------------------------------------------------------------------
# Tests: notify_error
# ---------------------------------------------------------------------------


class TestNotifyError:
    def test_error_message_structure(self, _enable_notifications, mock_webclient):
        """Error notification should contain header and code block."""
        _, instance = mock_webclient
        result = notify_error("Q4 Launch", "API rate limit exceeded")
        assert result is True
        blocks = instance.chat_postMessage.call_args[1]["blocks"]
        assert blocks[0]["type"] == "header"
        assert "Campaign Error" in blocks[0]["text"]["text"]
        section_text = blocks[1]["text"]["text"]
        assert "API rate limit exceeded" in section_text

    def test_error_context_block(self, _enable_notifications, mock_webclient):
        """Error messages should include a context element."""
        _, instance = mock_webclient
        notify_error("test", "something broke")
        blocks = instance.chat_postMessage.call_args[1]["blocks"]
        context_blocks = [b for b in blocks if b.get("type") == "context"]
        assert len(context_blocks) == 1
        assert "Action may be required" in context_blocks[0]["elements"][0]["text"]

    def test_error_text_fallback(self, _enable_notifications, mock_webclient):
        """The plain text fallback should contain the error."""
        _, instance = mock_webclient
        notify_error("test", "failure details")
        text = instance.chat_postMessage.call_args[1]["text"]
        assert "Campaign Error" in text
        assert "failure details" in text


# ---------------------------------------------------------------------------
# Tests: notify_daily_summary
# ---------------------------------------------------------------------------


class TestNotifyDailySummary:
    def test_summary_with_date(self, _enable_notifications, mock_webclient):
        """A summary with a date entry should render it in the subtitle."""
        _, instance = mock_webclient
        data = {"date": "2024-06-12", "posts": 5, "engagements": 42}
        result = notify_daily_summary(data)
        assert result is True
        blocks = instance.chat_postMessage.call_args[1]["blocks"]
        # Date should appear in a section text
        section_texts = [
            b["text"]["text"] for b in blocks
            if b.get("type") == "section" and b.get("text")
        ]
        assert any("2024-06-12" in t for t in section_texts)

    def test_summary_fields(self, _enable_notifications, mock_webclient):
        """Metric entries become section fields."""
        _, instance = mock_webclient
        data = {"date": "2024-06-12", "posts": 5, "engagements": 42, "reactions": 12}
        notify_daily_summary(data)
        blocks = instance.chat_postMessage.call_args[1]["blocks"]
        field_sections = [b for b in blocks if b.get("type") == "section" and b.get("fields")]
        assert len(field_sections) >= 1
        all_text = " ".join(f["text"] for s in field_sections for f in s["fields"])
        assert "*posts:*" in all_text
        assert "*engagements:*" in all_text
        assert "*reactions:*" in all_text

    def test_summary_no_date(self, _enable_notifications, mock_webclient):
        """When no date key is present, 'Unknown date' is shown."""
        _, instance = mock_webclient
        data = {"posts": 3}
        notify_daily_summary(data)
        blocks = instance.chat_postMessage.call_args[1]["blocks"]
        section_texts = [
            b["text"]["text"] for b in blocks
            if b.get("type") == "section" and b.get("text")
        ]
        assert any("Unknown date" in t for t in section_texts)

    def test_summary_empty_data(self, _enable_notifications, mock_webclient):
        """An empty dict should send a header with no field sections."""
        _, instance = mock_webclient
        result = notify_daily_summary({})
        assert result is True
        blocks = instance.chat_postMessage.call_args[1]["blocks"]
        field_sections = [b for b in blocks if b.get("type") == "section" and b.get("fields")]
        assert len(field_sections) == 0


# ---------------------------------------------------------------------------
# Tests: integration with launch_campaign (env-var gating)
# ---------------------------------------------------------------------------


class TestEnvVarGating:
    """Verify that the notifier correctly reads the env-var toggle."""

    @pytest.mark.parametrize("truthy", ["true", "1", "yes", "on", "TRUE", "Yes"])
    def test_enabled_toggle_truthy_values(self, monkeypatch, mock_webclient, truthy):
        """Any truthy value should enable notifications (when token+channel set)."""
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        monkeypatch.setenv("SLACK_NOTIFICATION_CHANNEL", "C0123456789")
        monkeypatch.setenv("SLACK_NOTIFICATIONS_ENABLED", truthy)
        _, instance = mock_webclient
        result = notify_campaign_status("test", "launched")
        assert result is True

    @pytest.mark.parametrize("falsy", ["false", "0", "no", "off", "", "bogus"])
    def test_disabled_toggle_falsy_values(self, monkeypatch, mock_webclient, falsy):
        """Any non-truthy value should disable notifications."""
        monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test-token")
        monkeypatch.setenv("SLACK_NOTIFICATION_CHANNEL", "C0123456789")
        monkeypatch.setenv("SLACK_NOTIFICATIONS_ENABLED", falsy)
        _, instance = mock_webclient
        result = notify_campaign_status("test", "launched")
        assert result is False
        instance.chat_postMessage.assert_not_called()
