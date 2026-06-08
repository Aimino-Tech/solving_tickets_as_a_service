"""Tests for Twitter engagement adapter (no auth required for import)."""


class TestTwitterModule:
    def test_imports(self):
        from app.orchestration.engagement.twitter_engage import TwitterEngager
        assert TwitterEngager is not None
