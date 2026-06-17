"""Tests for marketing.sentiment.analyzer."""

from unittest.mock import MagicMock, patch

import pytest

from marketing.sentiment.analyzer import SentimentAnalyzer


@pytest.fixture
def mock_sia():
    """Return a MagicMock with VADER-like polarity_scores behaviour."""
    sia = MagicMock()
    sia.polarity_scores.return_value = {
        "compound": 0.5,
        "pos": 0.4,
        "neu": 0.5,
        "neg": 0.1,
    }
    return sia


class TestSentimentAnalyzer:
    """SentimentAnalyzer unit tests (mock VADER, no real nltk download)."""

    def test_score_returns_correct_keys(self, mock_sia):
        """score() should return dict with compound/positive/neutral/negative."""
        with patch("marketing.sentiment.analyzer._get_sia", return_value=mock_sia):
            analyzer = SentimentAnalyzer()
            result = analyzer.score("Test text")

        assert isinstance(result, dict)
        assert "compound" in result
        assert "positive" in result
        assert "neutral" in result
        assert "negative" in result
        assert result["compound"] == 0.5
        assert result["positive"] == 0.4
        assert result["neutral"] == 0.5
        assert result["negative"] == 0.1

    def test_score_remaps_vader_keys(self, mock_sia):
        """score() should remap VADER 'pos'/'neu'/'neg' to full names."""
        mock_sia.polarity_scores.return_value = {
            "compound": -0.8,
            "pos": 0.0,
            "neu": 0.2,
            "neg": 0.8,
        }
        with patch("marketing.sentiment.analyzer._get_sia", return_value=mock_sia):
            analyzer = SentimentAnalyzer()
            result = analyzer.score("Terrible.")

        assert result["positive"] == 0.0
        assert result["neutral"] == 0.2
        assert result["negative"] == 0.8
        assert result["compound"] == -0.8

    def test_score_calls_polarity_scores(self, mock_sia):
        """score() should delegate to SIA.polarity_scores with the input text."""
        with patch("marketing.sentiment.analyzer._get_sia", return_value=mock_sia):
            analyzer = SentimentAnalyzer()
            analyzer.score("Hello world")

        mock_sia.polarity_scores.assert_called_once_with("Hello world")

    def test_score_batch_returns_list(self, mock_sia):
        """score_batch() should return one score dict per input text."""
        with patch("marketing.sentiment.analyzer._get_sia", return_value=mock_sia):
            analyzer = SentimentAnalyzer()
            results = analyzer.score_batch(["Text A", "Text B", "Text C"])

        assert isinstance(results, list)
        assert len(results) == 3
        for r in results:
            assert "compound" in r
            assert "positive" in r
            assert "neutral" in r
            assert "negative" in r

    def test_score_batch_empty(self, mock_sia):
        """score_batch([]) should return an empty list."""
        with patch("marketing.sentiment.analyzer._get_sia", return_value=mock_sia):
            analyzer = SentimentAnalyzer()
            results = analyzer.score_batch([])

        assert results == []

    def test_score_batch_calls_sia_per_text(self, mock_sia):
        """score_batch() should call polarity_scores once per text."""
        with patch("marketing.sentiment.analyzer._get_sia", return_value=mock_sia):
            analyzer = SentimentAnalyzer()
            analyzer.score_batch(["one", "two", "three"])

        assert mock_sia.polarity_scores.call_count == 3
