"""Tests for marketing.collectors.reddit_collector."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from marketing.collectors.reddit_collector import RedditCollector
from marketing.duckdb_store import DuckDBStore


@pytest.fixture
def store(tmp_path):
    s = DuckDBStore(str(tmp_path / "test.db"))
    yield s
    s.close()


class TestRedditCollector:
    def test_init_fallback_to_pullpush(self, store):
        """Without env creds, should fall back to PullPush (no crash)."""
        with patch.dict("os.environ", {}, clear=True):
            collector = RedditCollector(store)
            assert collector._praw_available is False
            assert collector._reddit is None

    def test_collect_empty_without_creds(self, store):
        """Without any creds, collect should return empty (no crash)."""
        with patch.dict("os.environ", {}, clear=True):
            with patch(
                "marketing.collectors.reddit_collector.RedditCollector._collect_pullpush",
                return_value=[],
            ):
                collector = RedditCollector(store)
                events = collector.collect()
                assert isinstance(events, list)

    def test_match_campaign_opentalk2html(self):
        """_match_campaign should detect OpenTalk2HTML."""
        assert (
            RedditCollector._match_campaign("Check out OpenTalk2HTML")
            == "OpenTalk2HTML"
        )
        assert (
            RedditCollector._match_campaign("talk2html is great")
            == "OpenTalk2HTML"
        )

    def test_match_campaign_opendocswork(self):
        """_match_campaign should detect OpenDocswork."""
        assert (
            RedditCollector._match_campaign("OpenDocswork MCP server")
            == "OpenDocswork"
        )

    def test_match_campaign_aimino(self):
        """_match_campaign should detect Aimino."""
        assert RedditCollector._match_campaign("Aimino project") == "Aimino"

    def test_match_campaign_empty(self):
        """_match_campaign should return empty string for None."""
        assert RedditCollector._match_campaign(None) == ""

    def test_match_campaign_unknown(self):
        """_match_campaign should return empty for non-matching text."""
        assert RedditCollector._match_campaign("Something else") == ""

    def test_pullpush_parse(self, store):
        """_collect_pullpush should handle valid API response."""
        with patch.dict("os.environ", {}, clear=True):
            collector = RedditCollector(store)
            mock_data = {
                "data": [
                    {
                        "id": "abc123",
                        "title": "OpenTalk2HTML is awesome",
                        "author": "testuser",
                        "subreddit": "MCP",
                        "score": 10,
                        "created_utc": datetime.now(timezone.utc).timestamp(),
                    }
                ]
            }
            with patch(
                "marketing.collectors.reddit_collector.urlopen"
            ) as mock_urlopen:
                mock_resp = MagicMock()
                mock_resp.read.return_value = __import__("json").dumps(
                    mock_data
                ).encode()
                mock_urlopen.return_value.__enter__.return_value = mock_resp

                since = datetime.now(timezone.utc) - __import__(
                    "datetime"
                ).timedelta(days=1)
                events = collector._collect_pullpush(since)
                assert len(events) >= 1
                assert events[0]["platform"] == "reddit"
                assert events[0]["source_id"] == "t3_abc123"
