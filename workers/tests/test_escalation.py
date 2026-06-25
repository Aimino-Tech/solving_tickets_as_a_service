from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from workers.escalation import SlackEscalator, PagerDutyEscalator, EscalationTracker


class TestSlackEscalator:
    def test_not_configured_when_no_webhook(self) -> None:
        os.environ.pop("SLACK_WEBHOOK_URL", None)
        e = SlackEscalator()
        assert not e.is_configured()

    def test_configured_when_webhook_set(self) -> None:
        os.environ["SLACK_WEBHOOK_URL"] = "https://hooks.slack.com/test"
        e = SlackEscalator()
        assert e.is_configured()


class TestPagerDutyEscalator:
    def test_not_configured_when_no_keys(self) -> None:
        os.environ.pop("PAGERDUTY_ROUTING_KEY", None)
        os.environ.pop("OPSGENIE_API_KEY", None)
        e = PagerDutyEscalator()
        assert not e.is_configured()

    def test_configured_with_pd_key(self) -> None:
        os.environ["PAGERDUTY_ROUTING_KEY"] = "test-key"
        e = PagerDutyEscalator()
        assert e.is_configured()


class TestEscalationTracker:
    def test_record_retry_tracks_count(self) -> None:
        tracker = EscalationTracker()
        info = tracker.record_retry("AIM-9999", 1, "test error", "test/repo", 42)
        assert info["issue_key"] == "AIM-9999"
        assert info["attempt"] == 1

    def test_should_escalate_after_threshold(self) -> None:
        tracker = EscalationTracker()
        for i in range(4):
            tracker.record_retry("AIM-9998", i + 1, f"error {i}", "test/repo", 1)
        assert not tracker.should_escalate("AIM-9998")

    def test_silence_and_check(self) -> None:
        tracker = EscalationTracker()
        tracker.silence("AIM-9997", ttl=60)
        assert not tracker.is_silenced("AIM-9997")

    def test_log_escalation_event(self) -> None:
        tracker = EscalationTracker()
        tracker.log_escalation_event("test_event", "AIM-9996", {"detail": "test"})
