"""Tests for Reddit engagement adapter (no auth required for import)."""


class TestRedditModule:
    def test_imports(self):
        from app.orchestration.engagement.reddit_engage import (
            RedditEngager, keywords_match, search_subreddits, reply_to_submission
        )
        assert RedditEngager is not None

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
