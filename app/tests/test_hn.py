"""Tests for HN engagement adapter."""


class TestHNModule:
    def test_imports(self):
        from app.orchestration.engagement.hn_engage import HNEngager, keywords_match
        assert HNEngager is not None

    def test_keywords_match(self):
        from app.orchestration.engagement.hn_engage import keywords_match
        assert keywords_match("Show HN: A new MCP server") is True
        assert keywords_match("open source devtools for data") is True
        assert keywords_match("what is the best programming language") is False
