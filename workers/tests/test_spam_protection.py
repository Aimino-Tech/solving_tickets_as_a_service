"""Tests for issue comment spam protection (AIM-2059)."""
from __future__ import annotations
import time
from unittest.mock import MagicMock, patch
import pytest
from workers.notifications.rate_limiter import (
    COMMENT_RATE_LIMIT_ENABLED, COMMENT_RATE_LIMIT_FREE, COMMENT_RATE_LIMIT_PRO,
    COMMENT_RATE_LIMIT_ENTERPRISE, COMMENT_RATE_LIMIT_WINDOW_SECONDS,
    CommentRateLimiter, RateLimitResult, get_comment_rate_limiter,
)
from workers.notifications.spam_filter import CommentSpamFilter, FilterResult
from workers.notifications.status_comments import STATUS_COMMENTS_ENABLED, post_stage_comment, set_enabled
from workers.notifications.webhooks import dispatch_to_webhooks


@pytest.fixture(autouse=True)
def reset_status_comments():
    original = STATUS_COMMENTS_ENABLED
    set_enabled(True)
    yield
    set_enabled(original)


class TestRateLimitResult:
    def test_allowed_result(self):
        r = RateLimitResult(allowed=True, current=1, limit=10, reset_after_seconds=3000)
        assert r.allowed and r.current == 1 and r.limit == 10 and r.remaining == 9
    def test_denied_result(self):
        r = RateLimitResult(allowed=False, current=10, limit=10, reset_after_seconds=500)
        assert not r.allowed and r.remaining == 0
    def test_remaining_never_negative(self):
        r = RateLimitResult(allowed=False, current=15, limit=10, reset_after_seconds=100)
        assert r.remaining == 0


class TestCommentRateLimiterConfig:
    def test_defaults(self):
        assert COMMENT_RATE_LIMIT_FREE == 5 and COMMENT_RATE_LIMIT_PRO == 20
        assert COMMENT_RATE_LIMIT_ENTERPRISE == 50 and COMMENT_RATE_LIMIT_WINDOW_SECONDS == 3600
        assert COMMENT_RATE_LIMIT_ENABLED is True


class TestCommentRateLimiter:
    def test_tier_lookup_free(self):
        with patch("workers.notifications.rate_limiter._get_redis") as m:
            c = MagicMock(); c.zcard.return_value = 0; c.zadd.return_value = 1; m.return_value = c
            r = CommentRateLimiter().check_and_increment("lin_1", tier="free")
            assert r.allowed and r.limit == COMMENT_RATE_LIMIT_FREE
    def test_tier_lookup_pro(self):
        with patch("workers.notifications.rate_limiter._get_redis") as m:
            c = MagicMock(); c.zcard.return_value = 0; c.zadd.return_value = 1; m.return_value = c
            r = CommentRateLimiter().check_and_increment("lin_1", tier="pro")
            assert r.allowed and r.limit == COMMENT_RATE_LIMIT_PRO
    def test_tier_lookup_enterprise(self):
        with patch("workers.notifications.rate_limiter._get_redis") as m:
            c = MagicMock(); c.zcard.return_value = 0; c.zadd.return_value = 1; m.return_value = c
            r = CommentRateLimiter().check_and_increment("lin_1", tier="enterprise")
            assert r.allowed and r.limit == COMMENT_RATE_LIMIT_ENTERPRISE
    def test_unknown_tier_falls_back_to_free(self):
        with patch("workers.notifications.rate_limiter._get_redis") as m:
            c = MagicMock(); c.zcard.return_value = 0; c.zadd.return_value = 1; m.return_value = c
            r = CommentRateLimiter().check_and_increment("lin_1", tier="platinum")
            assert r.allowed and r.limit == COMMENT_RATE_LIMIT_FREE
    def test_check_at_limit_denies(self):
        with patch("workers.notifications.rate_limiter._get_redis") as m:
            c = MagicMock(); c.zcard.return_value = COMMENT_RATE_LIMIT_FREE
            c.zrange.return_value = [(str(time.time() - 100), time.time() - 100)]; m.return_value = c
            r = CommentRateLimiter().check_and_increment("lin_1", tier="free")
            assert not r.allowed and r.remaining == 0
    def test_dry_run_does_not_increment(self):
        with patch("workers.notifications.rate_limiter._get_redis") as m:
            c = MagicMock(); c.zcard.return_value = 0; m.return_value = c
            r = CommentRateLimiter().check_and_increment("lin_1", tier="free", dry_run=True)
            assert r.allowed and r.current == 0
            c.zadd.assert_not_called()
    def test_fail_open_on_redis_error(self):
        with patch("workers.notifications.rate_limiter._get_redis") as m:
            c = MagicMock(); c.zcard.side_effect = Exception("err"); m.return_value = c
            r = CommentRateLimiter().check_and_increment("lin_1", tier="free")
            assert r.allowed
    def test_fail_open_redis_unavailable(self):
        with patch("workers.notifications.rate_limiter._get_redis", return_value=None):
            r = CommentRateLimiter().check_and_increment("lin_1", tier="free")
            assert r.allowed
    def test_singleton(self):
        assert get_comment_rate_limiter() is get_comment_rate_limiter()


class TestCommentSpamFilter:
    def test_initial_state(self):
        assert CommentSpamFilter().pending_count == 0
    def test_first_event_accepted(self):
        assert CommentSpamFilter().filter("lin_1", "triage", "completed", "Triage passed").action == "accept"
    def test_duplicate_within_window_skipped(self):
        f = CommentSpamFilter(dedup_window_seconds=30.0)
        f.filter("lin_1", "triage", "completed", "Triage passed")
        assert f.filter("lin_1", "triage", "completed", "Triage passed").action == "skip"
    def test_duplicate_different_message_not_skipped(self):
        f = CommentSpamFilter(dedup_window_seconds=30.0)
        f.filter("lin_1", "triage", "completed", "Triage passed")
        assert f.filter("lin_1", "triage", "completed", "Triage updated").action != "skip"
    def test_duplicate_outside_window_accepted(self):
        f = CommentSpamFilter(dedup_window_seconds=0.05)
        f.filter("lin_1", "triage", "completed", "Triage passed")
        time.sleep(0.1)
        assert f.filter("lin_1", "triage", "completed", "Triage passed").action == "accept"
    def test_rapid_events_coalesced(self):
        f = CommentSpamFilter(coalesce_window_seconds=10.0)
        f.filter("lin_1", "triage", "completed", "Triage passed")
        r = f.filter("lin_1", "agent", "completed", "Agent done")
        assert r.action == "coalesce" and f.pending_count == 2
    def test_flush_returns_events(self):
        f = CommentSpamFilter()
        f.filter("lin_1", "triage", "completed", "Triage passed")
        f.filter("lin_1", "agent", "completed", "Agent done")
        assert len(f.flush()) == 2 and f.pending_count == 0
    def test_flush_callback_invoked(self):
        cb = MagicMock(); f = CommentSpamFilter(flush_callback=cb)
        f.filter("lin_1", "triage", "completed", "Triage passed"); f.flush()
        cb.assert_called_once()
    def test_different_issues_separate_dedup(self):
        f = CommentSpamFilter(dedup_window_seconds=30.0)
        f.filter("lin_1", "triage", "completed", "Triage passed")
        assert f.filter("lin_2", "triage", "completed", "Triage passed").action == "accept"
    def test_reset_issue_clears_dedup(self):
        f = CommentSpamFilter(dedup_window_seconds=30.0)
        f.filter("lin_1", "triage", "completed", "Triage passed")
        f.reset_issue("lin_1")
        assert f.filter("lin_1", "triage", "completed", "Triage passed").action == "accept"


class TestPostStageCommentSpamProtection:
    @patch("workers.notifications.status_comments._post_to_linear")
    @patch("workers.notifications.rate_limiter._get_redis")
    def test_posts_normally(self, mr, mp):
        c = MagicMock(); c.zcard.return_value = 0; c.zadd.return_value = 1; mr.return_value = c
        r = post_stage_comment("lin_1", "triage", "started", "Triage started")
        assert r["status"] == "posted"; mp.assert_called_once()
    @patch("workers.notifications.status_comments._post_to_linear")
    @patch("workers.notifications.rate_limiter._get_redis")
    def test_rate_limited(self, mr, mp):
        c = MagicMock(); c.zcard.return_value = COMMENT_RATE_LIMIT_FREE
        c.zrange.return_value = [(str(time.time() - 100), time.time() - 100)]; mr.return_value = c
        r = post_stage_comment("lin_1", "triage", "started", "Triage started")
        assert r["status"] == "rate_limited"; mp.assert_not_called()
    @patch("workers.notifications.status_comments._post_to_linear")
    @patch("workers.notifications.rate_limiter._get_redis")
    def test_duplicate_skipped(self, mr, mp):
        c = MagicMock(); c.zcard.return_value = 0; c.zadd.return_value = 1; mr.return_value = c
        post_stage_comment("lin_1", "triage", "completed", "Triage passed")
        mp.reset_mock()
        r = post_stage_comment("lin_1", "triage", "completed", "Triage passed")
        assert r["status"] == "skipped"; mp.assert_not_called()
    @patch("workers.notifications.status_comments._post_to_linear")
    @patch("workers.notifications.rate_limiter._get_redis")
    def test_disabled_bypasses_all(self, mr, mp):
        set_enabled(False)
        r = post_stage_comment("lin_1", "triage", "started", "Starting")
        assert r["status"] == "disabled"; mp.assert_not_called(); mr.assert_not_called()


class TestDispatchWebhooksSpamProtection:
    SAMPLE = {"event_type": "fix_completed", "issue_id": "AIM-123", "issue_title": "Bug", "issue_url": "https://linear.app/issue/AIM-123", "pr_url": "https://github.com/o/r/p/1", "status": "completed", "summary": "Fix", "timestamp": "2026-06-25T14:30:00Z"}
    CONFIG = {"fix_completed": [{"type": "slack", "url": "http://hooks.example.com/w"}]}

    def test_dispatch_normally(self):
        with patch("workers.notifications.webhooks.notify_slack") as mn:
            mn.return_value = {"status": "sent"}
            with patch("workers.notifications.rate_limiter._get_redis") as mr:
                c = MagicMock(); c.zcard.return_value = 0; c.zadd.return_value = 1; mr.return_value = c
                r = dispatch_to_webhooks("fix_completed", self.SAMPLE, self.CONFIG)
                assert len(r) == 1 and r[0]["status"] == "sent"

    def test_dispatch_rate_limited(self):
        with patch("workers.notifications.webhooks.notify_slack") as mn:
            with patch("workers.notifications.rate_limiter._get_redis") as mr:
                c = MagicMock(); c.zcard.return_value = COMMENT_RATE_LIMIT_FREE
                c.zrange.return_value = [(str(time.time() - 100), time.time() - 100)]; mr.return_value = c
                r = dispatch_to_webhooks("fix_completed", self.SAMPLE, self.CONFIG)
                assert r[0]["status"] == "rate_limited"; mn.assert_not_called()
