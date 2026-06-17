"""Tests for marketing.collectors.npm_collector."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from marketing.collectors.npm_collector import NPMCollector
from marketing.duckdb_store import DuckDBStore


@pytest.fixture
def store(tmp_path):
    s = DuckDBStore(str(tmp_path / "test.db"))
    yield s
    s.close()


class TestNPMCollector:
    def test_collect_parses_response(self, store):
        """npm API response should be parsed into event dicts."""
        with patch.object(
            NPMCollector, "_get_packages", return_value=["@scope/pkg"],
        ):
            collector = NPMCollector(store)
            with patch("marketing.collectors.npm_collector.urlopen") as mock_urlopen:
                resp = MagicMock()
                resp.read.return_value = __import__("json").dumps(
                    {"downloads": 100}
                ).encode()
                mock_urlopen.return_value.__enter__.return_value = resp

                events = collector.collect()
                assert len(events) == 3
                assert events[0]["platform"] == "npm"
                assert events[0]["event_type"] == "download"
                assert events[0]["score"] == 100

    def test_collect_empty_on_error(self, store):
        """Network errors should return empty list."""
        with patch.object(
            NPMCollector, "_get_packages", return_value=["@scope/pkg"],
        ):
            collector = NPMCollector(store)
            with patch(
                "marketing.collectors.npm_collector.urlopen",
                side_effect=Exception("Network error"),
            ):
                events = collector.collect()
                assert events == []

    def test_run_and_store(self, store):
        """run_and_store should insert events into DuckDB."""
        with patch.object(
            NPMCollector, "_get_packages", return_value=["@scope/pkg"],
        ):
            collector = NPMCollector(store)
            with patch("marketing.collectors.npm_collector.urlopen") as mock_urlopen:
                resp = MagicMock()
                resp.read.return_value = __import__("json").dumps(
                    {"downloads": 50}
                ).encode()
                mock_urlopen.return_value.__enter__.return_value = resp

                count = collector.run_and_store()
                assert count > 0

    def test_collect_handles_empty_downloads(self, store):
        """Empty downloads should still produce events with score 0."""
        with patch.object(
            NPMCollector, "_get_packages", return_value=["@scope/pkg"],
        ):
            collector = NPMCollector(store)
            with patch("marketing.collectors.npm_collector.urlopen") as mock_urlopen:
                resp = MagicMock()
                resp.read.return_value = __import__("json").dumps(
                    {"downloads": 0}
                ).encode()
                mock_urlopen.return_value.__enter__.return_value = resp

                events = collector.collect()
                assert len(events) == 3
                assert all(e["score"] == 0 for e in events)
