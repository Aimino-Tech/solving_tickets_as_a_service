"""Batch sentiment pipeline: read unscored raw_events → score → write results.

Orchestrates the full scoring workflow:

    1. Query DuckDBStore for raw_events without a corresponding sentiment_scores row.
    2. Score each event's content via SentimentAnalyzer (VADER).
    3. Write results in batches via DuckDBStore.insert_sentiment_scores().

Usage:
    from marketing.duckdb_store import DuckDBStore
    from marketing.sentiment.pipeline import run_sentiment_pipeline

    store = DuckDBStore()
    result = run_sentiment_pipeline(store)
    print(f"Scored {result['scored']} events")
"""

from __future__ import annotations

import logging
from typing import Any

from marketing.sentiment.analyzer import SentimentAnalyzer

logger = logging.getLogger(__name__)

_BATCH_SIZE = 100


def run_sentiment_pipeline(
    duckdb_store: Any,
    batch_size: int = _BATCH_SIZE,
) -> dict[str, int]:
    """Score all unscored raw_events and write sentiment_scores.

    Queries ``raw_events`` whose ``id`` does not appear in
    ``sentiment_scores.raw_event_id``, scores the ``content`` field
    in batches, and persists results via
    ``duckdb_store.insert_sentiment_scores()``.

    Args:
        duckdb_store: A DuckDBStore instance (duckdb_store.py).
        batch_size: Rows per batch (default 100).

    Returns:
        dict with keys:
            ``scored``  — events successfully scored and inserted.
            ``skipped`` — events with empty/null content (skipped).
            ``errors``  — events that raised an exception during scoring or insert.
    """
    analyzer = SentimentAnalyzer()

    unscored = duckdb_store.query(
        """SELECT id, content FROM raw_events
           WHERE id NOT IN (SELECT raw_event_id FROM sentiment_scores)
           ORDER BY id"""
    )

    if not unscored:
        return {"scored": 0, "skipped": 0, "errors": 0}

    scored = 0
    skipped = 0
    errors = 0
    total = len(unscored)

    for i in range(0, total, batch_size):
        batch = unscored[i : i + batch_size]
        scores_to_insert: list[dict[str, Any]] = []

        for row in batch:
            raw_event_id = row["id"]
            content: str = row.get("content") or ""
            if not content.strip():
                skipped += 1
                continue
            try:
                result = analyzer.score(content)
                scores_to_insert.append(
                    {
                        "raw_event_id": raw_event_id,
                        "compound": result["compound"],
                        "positive": result["positive"],
                        "neutral": result["neutral"],
                        "negative": result["negative"],
                    }
                )
            except Exception:
                logger.exception("Error scoring raw_event id=%s", raw_event_id)
                errors += 1

        if scores_to_insert:
            try:
                duckdb_store.insert_sentiment_scores(scores_to_insert)
                scored += len(scores_to_insert)
            except Exception:
                logger.exception(
                    "Failed to insert batch of %d scores", len(scores_to_insert)
                )
                errors += len(scores_to_insert)

    return {"scored": scored, "skipped": skipped, "errors": errors}
