"""Tests for marketing.sentiment.pipeline."""

from unittest.mock import patch

import pytest

from marketing.duckdb_store import DuckDBStore
from marketing.sentiment.pipeline import run_sentiment_pipeline


@pytest.fixture
def store(tmp_path):
    """Create a DuckDBStore backed by a temp file (pattern from test_duckdb_store.py)."""
    db_path = tmp_path / "test_sentiment.db"
    s = DuckDBStore(db_path)
    yield s
    s.close()


class TestRunSentimentPipeline:
    """Pipeline integration tests with mock VADER and real DuckDBStore."""

    def test_pipeline_scores_unscored_events(self, store):
        """Pipeline should score events that have no existing sentiment row."""
        store.insert_raw_events([
            {
                "platform": "reddit",
                "source_id": "e1",
                "event_type": "comment",
                "content": "This is great!",
                "occurred_at": "2026-06-01T12:00:00Z",
            },
            {
                "platform": "reddit",
                "source_id": "e2",
                "event_type": "comment",
                "content": "Terrible experience",
                "occurred_at": "2026-06-01T12:00:00Z",
            },
        ])

        with patch("marketing.sentiment.analyzer._get_sia") as mock_get_sia:
            mock_sia = mock_get_sia.return_value
            mock_sia.polarity_scores.side_effect = [
                {"compound": 0.8, "pos": 0.6, "neu": 0.3, "neg": 0.1},
                {"compound": -0.7, "pos": 0.1, "neu": 0.3, "neg": 0.6},
            ]
            result = run_sentiment_pipeline(store)

        assert result["scored"] == 2
        assert result["errors"] == 0

        scores = store.query(
            "SELECT * FROM sentiment_scores ORDER BY raw_event_id"
        )
        assert len(scores) == 2
        assert scores[0]["compound"] == pytest.approx(0.8, abs=1e-5)
        assert scores[0]["positive"] == pytest.approx(0.6, abs=1e-5)
        assert scores[1]["compound"] == pytest.approx(-0.7, abs=1e-5)
        assert scores[1]["negative"] == pytest.approx(0.6, abs=1e-5)

    def test_pipeline_skips_already_scored(self, store):
        """Pipeline should not re-score events that already have a sentiment_scores row."""
        store.insert_raw_events([
            {
                "platform": "reddit",
                "source_id": "e1",
                "event_type": "comment",
                "content": "Already scored",
                "occurred_at": "2026-06-01T12:00:00Z",
            },
        ])
        raw = store.query_raw_events()
        event_id = raw[0]["id"]
        store.insert_sentiment_scores([
            {
                "raw_event_id": event_id,
                "compound": 0.5,
                "positive": 0.4,
                "neutral": 0.5,
                "negative": 0.1,
            },
        ])

        with patch("marketing.sentiment.analyzer._get_sia") as mock_get_sia:
            mock_sia = mock_get_sia.return_value
            result = run_sentiment_pipeline(store)

        assert result["scored"] == 0
        assert result["skipped"] == 0
        mock_sia.polarity_scores.assert_not_called()

    def test_pipeline_no_unscored_events(self, store):
        """Pipeline should handle an empty database gracefully."""
        with patch("marketing.sentiment.analyzer._get_sia") as mock_get_sia:
            result = run_sentiment_pipeline(store)

        assert result["scored"] == 0
        assert result["errors"] == 0
        mock_get_sia.assert_not_called()

    def test_pipeline_returns_summary_dict(self, store):
        """Pipeline should return a dict with the expected three keys."""
        with patch("marketing.sentiment.analyzer._get_sia"):
            result = run_sentiment_pipeline(store)

        assert isinstance(result, dict)
        assert "scored" in result
        assert "skipped" in result
        assert "errors" in result

    def test_pipeline_skips_empty_content(self, store):
        """Pipeline should skip events with empty/null content."""
        store.insert_raw_events([
            {
                "platform": "reddit",
                "source_id": "e1",
                "event_type": "comment",
                "content": "Valid text",
                "occurred_at": "2026-06-01T12:00:00Z",
            },
            {
                "platform": "reddit",
                "source_id": "e2",
                "event_type": "comment",
                "content": "",
                "occurred_at": "2026-06-01T12:00:00Z",
            },
            {
                "platform": "reddit",
                "source_id": "e3",
                "event_type": "comment",
                "content": "   ",
                "occurred_at": "2026-06-01T12:00:00Z",
            },
        ])

        with patch("marketing.sentiment.analyzer._get_sia") as mock_get_sia:
            mock_sia = mock_get_sia.return_value
            mock_sia.polarity_scores.return_value = {
                "compound": 0.0,
                "pos": 0.1,
                "neu": 0.8,
                "neg": 0.1,
            }
            result = run_sentiment_pipeline(store)

        assert result["scored"] == 1
        assert result["skipped"] == 2
        assert result["errors"] == 0
