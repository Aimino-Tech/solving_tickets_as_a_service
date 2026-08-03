"""
Tests for the Webhook Notification System.

Covers:
  - ``dispatch_to_webhooks`` with valid/invalid configs, env var resolution
  - Slack notifier: message formatting, HTTP calls, rate limiting
  - Teams notifier: card building, HTTP calls
  - Email notifier: SMTP/SendGrid paths, template rendering
  - Celery ``dispatch_webhook_event`` task
  - Pipeline integration (notification steps registered in pipeline config)
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from workers.notifications import dispatch_to_webhooks
from workers.notifications.notifiers.email import (
    _TEMPLATES,
    _render_body,
    notify_email,
)
from workers.notifications.notifiers.slack import (
    _BLOCK_BUILDERS,
    _build_blocks,
    _post_with_retry,
    notify_slack,
)
from workers.notifications.notifiers.teams import _build_teams_card, notify_teams
from workers.notifications.webhooks import (
    SUPPORTED_EVENTS,
    _load_config_from_env,
    _resolve_config,
    _resolve_env_ref,
    _validate_notifier_entry,
)

# ---------------------------------------------------------------------------
# Sample event payloads
# ---------------------------------------------------------------------------

SAMPLE_PAYLOAD = {
    "event_type": "fix_completed",
    "issue_id": "AIM-123",
    "issue_title": "Bug in login",
    "issue_url": "https://linear.app/aimino/issue/AIM-123",
    "pr_url": "https://github.com/owner/repo/pull/42",
    "status": "completed",
    "summary": "Fixed login validation",
    "timestamp": "2026-06-25T14:30:00Z",
}

SAMPLE_PAYLOAD_REVIEW = {
    **SAMPLE_PAYLOAD,
    "event_type": "review_needed",
}

SAMPLE_PAYLOAD_FAILED = {
    **SAMPLE_PAYLOAD,
    "event_type": "pipeline_failed",
    "summary": "Verification step failed: tests did not pass",
}

SAMPLE_PAYLOAD_REWORK = {
    **SAMPLE_PAYLOAD,
    "event_type": "rework_required",
    "summary": "Self-audit found anti-mockup violations",
}

SAMPLE_PAYLOAD_MERGE = {
    **SAMPLE_PAYLOAD,
    "event_type": "merge_completed",
}


# =========================================================================
# Support / Config helpers
# =========================================================================


class TestConfigHelpers:
    """Config resolution, env var substitution, validation."""

    def test_resolve_env_ref_known(self):
        with patch.dict(os.environ, {"SYNTARO_TEST_VAL": "resolved"}):
            assert _resolve_env_ref("$SYNTARO_TEST_VAL") == "resolved"

    def test_resolve_env_ref_unknown(self):
        result = _resolve_env_ref("$MISSING_VAR_XYZ")
        # Unknown vars are left in place
        assert "$MISSING_VAR_XYZ" in result

    def test_resolve_env_ref_mixed(self):
        with patch.dict(os.environ, {"TOKEN": "abc123"}):
            result = _resolve_env_ref("https://hooks.slack.com/services/$TOKEN")
            assert result == "https://hooks.slack.com/services/abc123"

    def test_resolve_env_ref_no_match(self):
        assert _resolve_env_ref("plain string") == "plain string"

    def test_resolve_config_filters_unknown_events(self):
        config = {
            "fix_completed": [{"type": "slack", "url": "http://example.com"}],
            "unknown_event": [{"type": "slack", "url": "http://example.com"}],
        }
        resolved = _resolve_config(config)
        assert "fix_completed" in resolved
        assert "unknown_event" not in resolved

    def test_resolve_config_resolves_env_refs(self):
        with patch.dict(os.environ, {"WH_URL": "http://hooks.example.com"}):
            config = {
                "fix_completed": [{"type": "slack", "url": "$WH_URL"}],
            }
            resolved = _resolve_config(config)
            assert resolved["fix_completed"][0]["url"] == "http://hooks.example.com"

    def test_load_config_from_env_valid_json(self):
        cfg = {"fix_completed": [{"type": "slack", "url": "http://example.com"}]}
        with patch.dict(os.environ, {"SYNTARO_WEBHOOK_CONFIG": json.dumps(cfg)}):
            loaded = _load_config_from_env()
            assert loaded == cfg

    def test_load_config_from_env_invalid_json(self):
        with patch.dict(os.environ, {"SYNTARO_WEBHOOK_CONFIG": "not-json"}):
            loaded = _load_config_from_env()
            assert loaded == {}

    def test_load_config_from_env_empty(self):
        with patch.dict(os.environ, {"SYNTARO_WEBHOOK_CONFIG": ""}):
            loaded = _load_config_from_env()
            assert loaded == {}

    def test_validate_notifier_entry_slack_valid(self):
        entry = {"type": "slack", "url": "http://hooks.slack.com/abc"}
        assert _validate_notifier_entry(entry, "fix_completed") is True

    def test_validate_notifier_entry_slack_no_url(self):
        entry = {"type": "slack", "url": ""}
        assert _validate_notifier_entry(entry, "fix_completed") is False

    def test_validate_notifier_entry_teams_valid(self):
        entry = {"type": "teams", "url": "http://outlook.office.com/webhook/abc"}
        assert _validate_notifier_entry(entry, "fix_completed") is True

    def test_validate_notifier_entry_email_valid(self):
        entry = {"type": "email", "to": "user@example.com"}
        with patch.dict(os.environ, {"SYNTARO_SMTP_HOST": "smtp.example.com"}):
            assert _validate_notifier_entry(entry, "fix_completed") is True

    def test_validate_notifier_entry_email_no_smtp_no_sendgrid(self):
        entry = {"type": "email", "to": "user@example.com"}
        with patch.dict(os.environ, {}, clear=True):
            assert _validate_notifier_entry(entry, "fix_completed") is False

    def test_validate_notifier_entry_email_no_recipient(self):
        entry = {"type": "email", "to": ""}
        with patch.dict(os.environ, {"SYNTARO_SMTP_HOST": "smtp.example.com"}):
            assert _validate_notifier_entry(entry, "fix_completed") is False

    def test_validate_notifier_entry_unknown_type(self):
        entry = {"type": "pagerduty", "url": "http://example.com"}
        assert _validate_notifier_entry(entry, "fix_completed") is False

    def test_supported_events_set(self):
        assert "fix_completed" in SUPPORTED_EVENTS
        assert "review_needed" in SUPPORTED_EVENTS
        assert "rework_required" in SUPPORTED_EVENTS
        assert "merge_completed" in SUPPORTED_EVENTS
        assert "pipeline_failed" in SUPPORTED_EVENTS


# =========================================================================
# dispatch_to_webhooks — main dispatcher
# =========================================================================


class TestDispatchToWebhooks:
    """Main dispatcher behavior with various configs."""

    def test_unsupported_event_type_returns_empty(self):
        payload = {"issue_id": "AIM-123"}
        results = dispatch_to_webhooks("unsupported_event", payload, {})
        assert results == []

    def test_no_config_returns_empty_list(self):
        payload = {"issue_id": "AIM-123"}
        results = dispatch_to_webhooks("fix_completed", payload, {})
        assert results == []

    def test_no_notifiers_for_event_returns_empty(self):
        config = {"review_needed": [{"type": "slack", "url": "http://example.com"}]}
        results = dispatch_to_webhooks("fix_completed", SAMPLE_PAYLOAD, config)
        assert results == []

    @patch("workers.notifications.webhooks.notify_slack")
    def test_dispatch_slack_success(self, mock_notify):
        mock_notify.return_value = {"status": "sent"}
        config = {"fix_completed": [{"type": "slack", "url": "http://hooks.example.com"}]}
        results = dispatch_to_webhooks("fix_completed", SAMPLE_PAYLOAD, config)
        assert len(results) == 1
        assert results[0]["status"] == "sent"

    @patch("workers.notifications.webhooks.notify_teams")
    def test_dispatch_teams_success(self, mock_notify):
        mock_notify.return_value = {"status": "sent"}
        config = {"fix_completed": [{"type": "teams", "url": "http://hooks.example.com"}]}
        results = dispatch_to_webhooks("fix_completed", SAMPLE_PAYLOAD, config)
        assert len(results) == 1
        assert results[0]["status"] == "sent"

    @patch("workers.notifications.webhooks.notify_email")
    def test_dispatch_email_success(self, mock_notify):
        mock_notify.return_value = {"status": "sent"}
        config = {"fix_completed": [{"type": "email", "to": "user@example.com"}]}
        with patch.dict(os.environ, {"SYNTARO_SMTP_HOST": "smtp.example.com"}):
            results = dispatch_to_webhooks("fix_completed", SAMPLE_PAYLOAD, config)
        assert len(results) == 1
        assert results[0]["status"] == "sent"

    @patch("workers.notifications.webhooks.notify_slack")
    def test_multiple_webhooks_per_event(self, mock_notify):
        mock_notify.return_value = {"status": "sent"}
        config = {
            "fix_completed": [
                {"type": "slack", "url": "http://hooks1.example.com"},
                {"type": "slack", "url": "http://hooks2.example.com"},
            ]
        }
        results = dispatch_to_webhooks("fix_completed", SAMPLE_PAYLOAD, config)
        assert len(results) == 2
        assert all(r["status"] == "sent" for r in results)

    @patch("workers.notifications.webhooks.notify_slack")
    def test_slack_notifier_failure_does_not_block_teams(self, mock_slack):
        """One failing notifier should not prevent others from running."""
        mock_slack.return_value = {"status": "error", "error": "HTTP 500"}
        config = {
            "fix_completed": [
                {"type": "slack", "url": "http://hooks1.example.com"},
                {"type": "teams", "url": "http://hooks2.example.com"},
            ]
        }
        with patch("workers.notifications.webhooks.notify_teams") as mock_teams:
            mock_teams.return_value = {"status": "sent"}
            results = dispatch_to_webhooks("fix_completed", SAMPLE_PAYLOAD, config)

        assert len(results) == 2
        assert results[0]["status"] == "error"
        assert results[1]["status"] == "sent"

    def test_invalid_config_skipped(self):
        config = {"fix_completed": [{"type": "slack", "url": ""}]}
        results = dispatch_to_webhooks("fix_completed", SAMPLE_PAYLOAD, config)
        assert len(results) == 1
        assert results[0]["status"] == "skipped"

    def test_mixed_valid_and_invalid(self):
        config = {
            "fix_completed": [
                {"type": "slack", "url": "http://valid.com/webhook"},
                {"type": "slack", "url": ""},  # invalid
            ]
        }
        with patch("workers.notifications.webhooks.notify_slack") as mock_notify:
            mock_notify.return_value = {"status": "sent"}
            results = dispatch_to_webhooks("fix_completed", SAMPLE_PAYLOAD, config)

        assert len(results) == 2
        assert results[0]["status"] == "sent"
        assert results[1]["status"] == "skipped"


# =========================================================================
# Slack Notifier
# =========================================================================


class TestSlackNotifier:
    """Slack Block Kit formatting and HTTP behaviour."""

    def test_build_blocks_fix_completed(self):
        blocks = _build_blocks("fix_completed", SAMPLE_PAYLOAD)
        assert len(blocks) >= 2
        header = blocks[0]
        assert header["type"] == "header"
        assert "AIM-123" in header["text"]["text"]

    def test_build_blocks_review_needed(self):
        blocks = _build_blocks("review_needed", SAMPLE_PAYLOAD_REVIEW)
        header = blocks[0]
        assert "Review Needed" in header["text"]["text"]

    def test_build_blocks_rework_required(self):
        blocks = _build_blocks("rework_required", SAMPLE_PAYLOAD_REWORK)
        header = blocks[0]
        assert "Rework Required" in header["text"]["text"]

    def test_build_blocks_merge_completed(self):
        blocks = _build_blocks("merge_completed", SAMPLE_PAYLOAD_MERGE)
        header = blocks[0]
        assert "Merged" in header["text"]["text"]

    def test_build_blocks_pipeline_failed(self):
        blocks = _build_blocks("pipeline_failed", SAMPLE_PAYLOAD_FAILED)
        header = blocks[0]
        assert "Pipeline Failed" in header["text"]["text"]

    def test_build_blocks_unknown_event_fallback(self):
        payload = {"event_type": "unknown", "summary": "generic event"}
        blocks = _build_blocks("unknown", payload)
        assert len(blocks) == 1
        assert blocks[0]["type"] == "section"

    def test_all_event_types_have_builders(self):
        for event_type in SUPPORTED_EVENTS:
            assert event_type in _BLOCK_BUILDERS, f"Missing block builder for {event_type}"

    def test_build_blocks_contains_pr_url(self):
        blocks = _build_blocks("fix_completed", SAMPLE_PAYLOAD)
        block_text = json.dumps(blocks)
        assert "pull/42" in block_text

    def test_build_blocks_contains_timestamp(self):
        blocks = _build_blocks("fix_completed", SAMPLE_PAYLOAD)
        block_text = json.dumps(blocks)
        assert "2026-06-25" in block_text

    @patch("workers.notifications.notifiers.slack.httpx.Client")
    def test_notify_slack_success(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.post.return_value = mock_response

        result = notify_slack(SAMPLE_PAYLOAD, "http://hooks.slack.com/abc")
        assert result["status"] == "sent"

    @patch("workers.notifications.notifiers.slack.httpx.Client")
    def test_notify_slack_http_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = "Bad Request"
        mock_client.post.return_value = mock_response

        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "400 error", request=MagicMock(), response=mock_response,
        )

        result = notify_slack(SAMPLE_PAYLOAD, "http://hooks.slack.com/abc")
        assert result["status"] == "error"

    @patch("workers.notifications.notifiers.slack.httpx.Client")
    def test_notify_slack_request_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.side_effect = httpx.RequestError("Connection refused")

        result = notify_slack(SAMPLE_PAYLOAD, "http://hooks.slack.com/abc")
        assert result["status"] == "error"

    @patch("workers.notifications.notifiers.slack.httpx.Client")
    def test_notify_slack_with_channel(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.post.return_value = mock_response

        result = notify_slack(SAMPLE_PAYLOAD, "http://hooks.slack.com/abc", channel="#syntaro-alerts")
        assert result["status"] == "sent"
        # Verify channel was passed
        call_kwargs = mock_client.post.call_args[1]
        assert call_kwargs["json"].get("channel") == "#syntaro-alerts"

    @patch("workers.notifications.notifiers.slack.time.sleep")
    @patch("workers.notifications.notifiers.slack.httpx.Client")
    def test_post_with_retry_rate_limit(self, mock_client_cls, mock_sleep):
        """Test that 429 responses trigger retry logic."""
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client

        # First call is rate-limited, second succeeds
        rate_limit_response = MagicMock()
        rate_limit_response.status_code = 429
        rate_limit_response.headers = {"Retry-After": "1"}

        success_response = MagicMock()
        success_response.status_code = 200

        mock_client.post.side_effect = [rate_limit_response, success_response]

        result = _post_with_retry(mock_client, "http://hooks.slack.com/abc", {"text": "test"}, max_retries=3)
        assert result.status_code == 200
        assert mock_client.post.call_count == 2
        assert mock_sleep.called


# =========================================================================
# Teams Notifier
# =========================================================================


class TestTeamsNotifier:
    """Teams Adaptive/Connector Card formatting and HTTP behaviour."""

    def test_build_card_fix_completed(self):
        card = _build_teams_card("fix_completed", SAMPLE_PAYLOAD)
        assert card["@type"] == "MessageCard"
        assert "Fix Completed" in card["title"]
        assert card["themeColor"] == "00A859"

    def test_build_card_review_needed(self):
        card = _build_teams_card("review_needed", SAMPLE_PAYLOAD_REVIEW)
        assert "Review Needed" in card["title"]
        assert card["themeColor"] == "FFC107"

    def test_build_card_rework_required(self):
        card = _build_teams_card("rework_required", SAMPLE_PAYLOAD_REWORK)
        assert "Rework Required" in card["title"]
        assert card["themeColor"] == "FF6B35"

    def test_build_card_merge_completed(self):
        card = _build_teams_card("merge_completed", SAMPLE_PAYLOAD_MERGE)
        assert "Merged" in card["title"]
        assert card["themeColor"] == "005A9E"

    def test_build_card_pipeline_failed(self):
        card = _build_teams_card("pipeline_failed", SAMPLE_PAYLOAD_FAILED)
        assert "Pipeline Failed" in card["title"]
        assert card["themeColor"] == "E81123"

    def test_build_card_contains_issue_info(self):
        card = _build_teams_card("fix_completed", SAMPLE_PAYLOAD)
        section = card["sections"][0]
        assert "AIM-123" in section["activityTitle"]

    def test_build_card_contains_pr_link(self):
        card = _build_teams_card("fix_completed", SAMPLE_PAYLOAD)
        section_text = json.dumps(card["sections"])
        assert "pull/42" in section_text

    def test_build_card_potential_action(self):
        card = _build_teams_card("fix_completed", SAMPLE_PAYLOAD)
        assert "potentialAction" in card
        assert card["potentialAction"][0]["@type"] == "OpenUri"

    @patch("workers.notifications.notifiers.teams.httpx.Client")
    def test_notify_teams_success(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.post.return_value = mock_response

        result = notify_teams(SAMPLE_PAYLOAD, "http://outlook.office.com/webhook/abc")
        assert result["status"] == "sent"

    @patch("workers.notifications.notifiers.teams.httpx.Client")
    def test_notify_teams_http_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = "Bad Request"
        mock_client.post.return_value = mock_response
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "400 error", request=MagicMock(), response=mock_response,
        )

        result = notify_teams(SAMPLE_PAYLOAD, "http://outlook.office.com/webhook/abc")
        assert result["status"] == "error"

    @patch("workers.notifications.notifiers.teams.httpx.Client")
    def test_notify_teams_request_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.side_effect = httpx.RequestError("Connection refused")

        result = notify_teams(SAMPLE_PAYLOAD, "http://outlook.office.com/webhook/abc")
        assert result["status"] == "error"


# =========================================================================
# Email Notifier
# =========================================================================


class TestEmailNotifier:
    """Email template rendering and SMTP/SendGrid sending."""

    def test_render_body_fix_completed(self):
        body = _render_body("fix_completed", SAMPLE_PAYLOAD)
        assert "Fix Completed" in body
        assert "AIM-123" in body
        assert "Bug in login" in body

    def test_render_body_review_needed(self):
        body = _render_body("review_needed", SAMPLE_PAYLOAD_REVIEW)
        assert "Review Needed" in body

    def test_render_body_rework_required(self):
        body = _render_body("rework_required", SAMPLE_PAYLOAD_REWORK)
        assert "Rework Required" in body

    def test_render_body_merge_completed(self):
        body = _render_body("merge_completed", SAMPLE_PAYLOAD_MERGE)
        assert "Merge Completed" in body

    def test_render_body_pipeline_failed(self):
        body = _render_body("pipeline_failed", SAMPLE_PAYLOAD_FAILED)
        assert "Pipeline Failed" in body
        assert "Verification step failed" in body

    def test_render_body_unknown_event(self):
        body = _render_body("unknown_event", {"summary": "something happened"})
        assert "unknown_event" in body

    def test_all_event_types_have_templates(self):
        for event_type in SUPPORTED_EVENTS:
            assert event_type in _TEMPLATES, f"Missing email template for {event_type}"

    @patch("workers.notifications.notifiers.email.smtplib.SMTP")
    def test_notify_email_smtp_success(self, mock_smtp):
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server

        result = notify_email(
            SAMPLE_PAYLOAD,
            to="user@example.com",
            from_addr="syntaro@example.com",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_user="user",
            smtp_password="pass",
        )
        assert result["status"] == "sent"
        assert mock_server.sendmail.called

    @patch("workers.notifications.notifiers.email.httpx.Client")
    def test_notify_email_sendgrid_success(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_client.post.return_value = mock_response

        with patch.dict(os.environ, {"SYNTARO_SENDGRID_API_KEY": "SG.test.key"}):
            result = notify_email(
                SAMPLE_PAYLOAD,
                to="user@example.com",
                from_addr="syntaro@example.com",
                use_sendgrid=True,
            )
        assert result["status"] == "sent"

    def test_notify_email_sendgrid_no_api_key(self):
        result = notify_email(
            SAMPLE_PAYLOAD,
            to="user@example.com",
            from_addr="syntaro@example.com",
            use_sendgrid=True,
        )
        assert result["status"] == "error"
        assert "SYNTARO_SENDGRID_API_KEY" in result["error"]

    def test_notify_email_no_smtp_host(self):
        result = notify_email(
            SAMPLE_PAYLOAD,
            to="user@example.com",
            from_addr="syntaro@example.com",
            smtp_host="",
        )
        assert result["status"] == "error"
        assert "SMTP host" in result["error"]

    @patch("workers.notifications.notifiers.email.smtplib.SMTP")
    def test_notify_email_smtp_failure(self, mock_smtp):
        mock_smtp.side_effect = ConnectionRefusedError("Connection refused")

        result = notify_email(
            SAMPLE_PAYLOAD,
            to="user@example.com",
            from_addr="syntaro@example.com",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_user="user",
            smtp_password="pass",
        )
        assert result["status"] == "error"

    def test_notify_email_subject_prefix(self):
        """Subject prefix should be configurable."""
        with patch("workers.notifications.notifiers.email.smtplib.SMTP") as mock_smtp:
            mock_server = MagicMock()
            mock_smtp.return_value.__enter__.return_value = mock_server

            result = notify_email(
                SAMPLE_PAYLOAD,
                to="user@example.com",
                from_addr="syntaro@example.com",
                subject_prefix="[CUSTOM]",
                smtp_host="smtp.example.com",
            )
            assert result["status"] == "sent"


# =========================================================================
# Celery task — dispatch_webhook_event
# =========================================================================


class TestDispatchWebhookEventTask:
    """Workers.tasks.notifications.dispatch_webhook_event."""

    def test_task_registered(self):
        # Check the task name is bound on the decorator even if app autodiscovery
        # may not have run (the app.__init__ has a broken tasks/__init__.py import).
        from workers.tasks.notifications import dispatch_webhook_event

        assert dispatch_webhook_event.name == "workers.tasks.notifications.dispatch_webhook_event"

    @patch("workers.notifications.dispatch_to_webhooks")
    def test_dispatch_event_success(self, mock_dispatch):
        from workers.tasks.notifications import dispatch_webhook_event

        mock_dispatch.return_value = [{"notifier": "slack", "status": "sent"}]
        ctx = {"issue_id": "AIM-123", "issue_title": "Test", "issue_url": "http://example.com"}

        result = dispatch_webhook_event.run("fix_completed", ctx)
        assert result["status"] == "dispatched"
        assert len(result["results"]) == 1

    @patch("workers.notifications.dispatch_to_webhooks")
    def test_dispatch_event_with_step_results(self, mock_dispatch):
        from workers.tasks.notifications import dispatch_webhook_event

        mock_dispatch.return_value = [{"notifier": "slack", "status": "sent"}]
        ctx = {"issue_id": "AIM-123"}
        step_results = {
            "pr_creation": {"html_url": "https://github.com/owner/repo/pull/42"}
        }

        result = dispatch_webhook_event.run("fix_completed", ctx, step_results)
        assert result["status"] == "dispatched"

    @patch("workers.notifications.dispatch_to_webhooks")
    def test_dispatch_event_graceful_failure(self, mock_dispatch):
        """Notification failure should not raise -- pipeline continues."""
        from workers.tasks.notifications import dispatch_webhook_event

        mock_dispatch.side_effect = RuntimeError("Unexpected error")

        result = dispatch_webhook_event.run("fix_completed", {"issue_id": "AIM-123"})
        assert result["status"] == "error"
        assert "Unexpected error" in result.get("error", "")

    def test_build_event_payload(self):
        from workers.tasks.notifications import _build_event_payload

        ctx = {
            "issue_id": "AIM-456",
            "issue_title": "Broken feature",
            "issue_url": "https://linear.app/issue/AIM-456",
        }
        payload = _build_event_payload("fix_completed", ctx)
        assert payload["event_type"] == "fix_completed"
        assert payload["issue_id"] == "AIM-456"
        assert payload["issue_title"] == "Broken feature"

    def test_build_event_payload_with_pr_url(self):
        from workers.tasks.notifications import _build_event_payload

        ctx = {"issue_id": "AIM-456"}
        step_results = {"pr_creation": {"html_url": "http://github.com/pr/1"}}
        payload = _build_event_payload("fix_completed", ctx, step_results)
        assert payload["pr_url"] == "http://github.com/pr/1"


# =========================================================================
# Pipeline integration
# =========================================================================


class TestPipelineIntegration:
    """Notification steps are properly registered in pipeline configs."""

    PIPELINE_FILE = os.path.join(os.path.dirname(__file__), "..", "orchestrator", "pipelines.py")

    @staticmethod
    def _parse_steps_for_pipeline(pipeline_name: str) -> list[str]:
        """Parse pipeline steps directly from source to avoid broken import chain."""
        import ast
        with open(TestPipelineIntegration.PIPELINE_FILE) as f:
            tree = ast.parse(f.read())

        steps: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Dict):
                # Look for the pipeline with matching name key
                name_val = None
                steps_val = None
                for k, v in zip(node.keys, node.values):
                    if isinstance(k, ast.Constant) and k.value == "name":
                        if isinstance(v, ast.Constant) and v.value == pipeline_name:
                            name_val = v.value
                    if isinstance(k, ast.Constant) and k.value == "steps":
                        steps_val = v
                if name_val and steps_val and isinstance(steps_val, ast.List):
                    for item in steps_val.elts:
                        if isinstance(item, ast.Dict):
                            for k, v in zip(item.keys, item.values):
                                if isinstance(k, ast.Constant) and k.value == "task" and isinstance(v, ast.Constant):
                                    steps.append(v.value)
                    break
        return steps

    def test_fix_pipeline_has_notification_steps(self):
        task_names = self._parse_steps_for_pipeline("syntaro:fix")

        assert "workers.tasks.notifications.dispatch_webhook_event" in task_names

        pr_creation_idx = task_names.index("workers.tasks.pr_creation.create_pull_request")
        notify_idx = task_names.index("workers.tasks.notifications.dispatch_webhook_event")
        assert notify_idx > pr_creation_idx

    def test_feature_pipeline_has_notification_steps(self):
        task_names = self._parse_steps_for_pipeline("syntaro:feature")
        assert "workers.tasks.notifications.dispatch_webhook_event" in task_names

    def test_research_pipeline_has_notification_step(self):
        task_names = self._parse_steps_for_pipeline("syntaro:research")
        assert "workers.tasks.notifications.dispatch_webhook_event" in task_names
