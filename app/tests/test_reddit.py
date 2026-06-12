"""Tests for Reddit engagement adapter (no auth required for import)."""

import pytest


class TestRedditModule:
    def test_imports(self):
        from app.orchestration.engagement.reddit_engage import (
            RedditEngager, keywords_match, search_subreddits, reply_to_submission,
            _call_with_backoff,
        )
        assert RedditEngager is not None
        assert _call_with_backoff is not None

    def test_keywords_match(self):
        from app.orchestration.engagement.reddit_engage import keywords_match
        assert keywords_match("check out this MCP tool") is True
        assert keywords_match("building a data pipeline with ETL") is True
        assert keywords_match("I like pizza") is False

    def test_keywords_match_edge_cases(self):
        from app.orchestration.engagement.reddit_engage import keywords_match
        assert keywords_match("") is False
        assert keywords_match("MCP") is True
        assert keywords_match("model context protocol server") is True

    def test_reddit_rate_limiter_imports(self):
        from app.platforms.reddit_ratelimit import (
            RedditRateLimiter, RedditProxyPool, RedditBanAlert,
            call_with_backoff, handle_http_error, is_rate_limit_error,
            rotate_user_agent, parse_ratelimit_headers,
            reddit_rate_limiter, reddit_proxy_pool, reddit_ban_alert,
            init_proxy_pool_from_env,
        )
        assert RedditRateLimiter is not None
        assert RedditProxyPool is not None
        assert RedditBanAlert is not None
        assert call_with_backoff is not None
        assert handle_http_error is not None
        assert is_rate_limit_error is not None
        assert rotate_user_agent is not None
        assert parse_ratelimit_headers is not None

    def test_reddit_engage_rate_limiter_integration(self):
        """Verify that reddit_engage imports rate limiter components."""
        from app.orchestration.engagement.reddit_engage import (
            reddit_rate_limiter, reddit_proxy_pool, reddit_ban_alert,
        )
        from app.platforms.reddit_ratelimit import (
            reddit_rate_limiter as base_limiter,
            reddit_proxy_pool as base_pool,
            reddit_ban_alert as base_alert,
        )
        # Same global instances
        assert reddit_rate_limiter is base_limiter
        assert reddit_proxy_pool is base_pool
        assert reddit_ban_alert is base_alert
