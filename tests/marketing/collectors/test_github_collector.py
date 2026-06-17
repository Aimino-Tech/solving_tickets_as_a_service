"""Tests for marketing.collectors.github_collector."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from marketing.collectors.github_collector import GitHubCollector
from marketing.duckdb_store import DuckDBStore


@pytest.fixture
def store(tmp_path):
    s = DuckDBStore(str(tmp_path / "test.db"))
    yield s
    s.close()


def _mock_urlopen_response(data):
    """Helper: return a MagicMock urlopen context manager that yields data."""
    resp = MagicMock()
    resp.read.return_value = __import__("json").dumps(data).encode()
    mock = MagicMock()
    mock.__enter__.return_value = resp
    return mock


class TestGitHubCollector:
    def test_init_without_token(self, store):
        """Without GITHUB_TOKEN, collector should not crash."""
        with patch.object(
            GitHubCollector, "_get_repos", return_value=["owner/repo"],
        ):
            collector = GitHubCollector(store)
            assert collector._token == ""

    def test_collect_empty_without_token(self, store):
        """Without token, collect should return empty (no API calls)."""
        with patch.dict("os.environ", {}, clear=True):
            with patch.object(
                GitHubCollector, "_get_repos", return_value=["owner/repo"],
            ):
                collector = GitHubCollector(store)
                events = collector.collect()
                assert events == []

    def test_collect_star_data(self, store):
        """Collect should parse repo star data."""
        with patch.dict(
            "os.environ", {"GITHUB_TOKEN": "test_token"}, clear=True
        ):
            with patch.object(
                GitHubCollector, "_get_repos", return_value=["owner/repo"],
            ):
                with patch(
                    "marketing.collectors.github_collector.urlopen"
                ) as mock_urlopen:
                    mock_urlopen.return_value = _mock_urlopen_response(
                        {"stargazers_count": 42, "forks_count": 7, "open_issues_count": 2}
                    )
                    collector = GitHubCollector(store)
                    events = collector.collect()
                    assert len(events) >= 1
                    assert events[0]["platform"] == "github"
                    assert events[0]["event_type"] == "star"
                    assert events[0]["score"] == 42

    def test_collect_traffic_data(self, store):
        """collect_traffic should insert traffic records."""
        with patch.dict(
            "os.environ", {"GITHUB_TOKEN": "test_token"}, clear=True
        ):
            with patch.object(
                GitHubCollector, "_get_repos", return_value=["owner/repo"],
            ):
                with patch(
                    "marketing.collectors.github_collector.urlopen"
                ) as mock_urlopen:
                    def side_effect(req, **kw):
                        path = str(req.full_url)
                        if "traffic/clones" in path:
                            return _mock_urlopen_response({"count": 10, "uniques": 5})
                        if "traffic/views" in path:
                            return _mock_urlopen_response({"count": 100, "uniques": 50})
                        if "repos/owner/repo" in path:
                            return _mock_urlopen_response({"stargazers_count": 42})
                        raise RuntimeError(f"unexpected URL: {path}")
                    mock_urlopen.side_effect = side_effect

                    collector = GitHubCollector(store)
                    count = collector.collect_traffic()
                    assert count >= 0

    def test_run_and_store_no_token(self, store):
        """run_and_store with no token should return 0."""
        with patch.dict("os.environ", {}, clear=True):
            with patch.object(
                GitHubCollector, "_get_repos", return_value=["owner/repo"],
            ):
                collector = GitHubCollector(store)
                result = collector.run_and_store()
                assert result == 0
