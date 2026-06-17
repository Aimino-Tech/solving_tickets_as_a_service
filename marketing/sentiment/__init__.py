"""VADER sentiment analysis for marketing content.

Provides SentimentAnalyzer and batch pipeline for scoring
raw_events and writing results to the DuckDB analytics store.
"""

from marketing.sentiment.analyzer import SentimentAnalyzer
from marketing.sentiment.pipeline import run_sentiment_pipeline

__all__ = [
    "SentimentAnalyzer",
    "run_sentiment_pipeline",
]
