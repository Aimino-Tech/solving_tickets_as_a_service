"""VADER sentiment analyzer wrapper for marketing text content.

Usage:
    analyzer = SentimentAnalyzer()
    result = analyzer.score("This product is amazing!")
    # {'compound': 0.7, 'positive': 0.5, 'neutral': 0.5, 'negative': 0.0}

The VADER lexicon is auto-downloaded on first use.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_sia: Any | None = None


def _get_sia() -> Any:
    """Lazy-load the VADER SentimentIntensityAnalyzer (downloads lexicon once)."""
    global _sia
    if _sia is None:
        import nltk

        try:
            nltk.data.find("sentiment/vader_lexicon")
        except LookupError:
            nltk.download("vader_lexicon", quiet=True)
        from nltk.sentiment.vader import SentimentIntensityAnalyzer

        _sia = SentimentIntensityAnalyzer()
    return _sia


class SentimentAnalyzer:
    """Wraps NLTK VADER for scoring marketing text content.

    Thread-safe after initialization (VADER is stateless).
    """

    def score(self, text: str) -> dict[str, float]:
        """Score a single text string.

        Returns:
            dict with keys: compound, positive, neutral, negative.
        """
        sia = _get_sia()
        scores = sia.polarity_scores(text)
        return {
            "compound": scores["compound"],
            "positive": scores["pos"],
            "neutral": scores["neu"],
            "negative": scores["neg"],
        }

    def score_batch(self, texts: list[str]) -> list[dict[str, float]]:
        """Score a list of text strings.

        Returns:
            List of score dicts, one per input text, in the same order.
        """
        return [self.score(t) for t in texts]
