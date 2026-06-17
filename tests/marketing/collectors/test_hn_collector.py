"""Tests for marketing.collectors.hn_collector."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from marketing.collectors.hn_collector import HNCollector
from marketing.duckdb_store import DuckDBStore


@pytest.fixture
def store(tmp_path):
    s = DuckDBStore(str(tmp_path / "test.db"))
    yield s
    s.close()


class TestHNCollector:
    def test_collect_empty_when_no_matches(self, store):
        """No query matches should return empty list."""
        collector = HNCollector(store)
        with patch("marketing.collectors.hn_collector.urlopen") as mock_urlopen:
            mock_resp = MagicMock()
            mock_resp.read.return_value = __import__("json").dumps(
                {"hits": []}
            ).encode()
            mock_urlopen.return_value.__enter__.return_value = mock_resp

            events = collector.collect()
            assert events == []

    def test_collect_parses_hits(self, store):
        """Algolia hits should be parsed into event dicts."""
        collector = HNCollector(store)
        mock_hits = {
            "hits": [
                {
                    "objectID": "post1",
                    "title": "Show HN: OpenTalk2HTML demo",
                    "author": "testdev",
                    "points": 15,
                    "num_comments": 3,
                    "created_at_i": int(datetime.now(timezone.utc).timestamp()),
                    "url": "https://example.com",
                }
            ]
        }
        mock_comments = {
            "children": [
                {
                    "id": "c1",
                    "type": "comment",
                    "text": "Great project!",
                    "author": "user2",
                    "points": 2,
                    "created_at_i": int(datetime.now(timezone.utc).timestamp()),
                }
            ]
        }
        call_count = [0]

        def side_effect(req, **kw):
            call_count[0] += 1
            resp = MagicMock()
            if call_count[0] == 1:
                resp.read.return_value = __import__("json").dumps(mock_hits).encode()
            else:
                resp.read.return_value = __import__("json").dumps(mock_comments).encode()
            mock = MagicMock()
            mock.__enter__.return_value = resp
            return mock

        with patch(
            "marketing.collectors.hn_collector.urlopen", side_effect=side_effect,
        ):
            events = collector.collect()
            assert len(events) >= 1
            assert events[0]["platform"] == "hackernews"
            assert events[0]["source_id"] == "post1"
            assert events[0]["author"] == "testdev"
            assert events[0]["score"] == 15

    def test_network_error_returns_empty(self, store):
        """Network errors should be caught and return empty list."""
        collector = HNCollector(store)
        with patch(
            "marketing.collectors.hn_collector.urlopen",
            side_effect=Exception("Network error"),
        ):
            events = collector.collect()
            assert events == []
