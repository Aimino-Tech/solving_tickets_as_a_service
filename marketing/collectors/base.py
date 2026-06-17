"""Base collector interface.

Every collector extends :class:`BaseCollector` and implements
:meth:`collect` which returns a list of event dicts.  The base class
provides retry logic, error counting, and a convenience ``run_and_store``
method that inserts results into DuckDB.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from marketing.duckdb_store import DuckDBStore

logger = logging.getLogger(__name__)


class BaseCollector(ABC):
    """Abstract collector with retry logic and error counting.

    Subclasses implement :meth:`collect` which returns a list of event
    dicts conforming to the schema expected by ``DuckDBStore.insert_raw_events``.

    Schema (keys per event dict)::

        platform      str   — "reddit", "github", "hackernews", "npm"
        source_id     str   — Unique ID from the source platform
        event_type    str   — "post", "comment", "star", "download", …
        content       str   — Preview of the content (max 500 chars)
        author        str   — Username or "[deleted]"
        url           str   — Permanent link to the content
        score         int   — Upvotes, stars, points, download count
        metadata      dict  — Extra platform-specific data
        campaign_name str   — Auto-matched campaign or ""
        occurred_at   str   — ISO-8601 timestamp of when it happened

    Retry behaviour
    ---------------
    :meth:`run_with_retry` uses exponential backoff (1s, 2s, 4s) for up
    to ``max_retries`` attempts.  Transient failures are logged as
    warnings; permanent failures (all retries exhausted) are logged as
    errors.
    """

    def __init__(self, duckdb_store: DuckDBStore) -> None:
        self.store = duckdb_store
        self.error_count = 0
        self.success_count = 0

    # ── subclass API ──────────────────────────────────────────────────────

    @abstractmethod
    def collect(self, since: datetime | None = None) -> list[dict[str, Any]]:
        """Collect events since the given timestamp.

        Returns a list of event dicts.  Each dict must contain:

        ==============  ========  ============================================
        Key             Type      Description
        ==============  ========  ============================================
        ``platform``    ``str``   Source platform name
        ``source_id``   ``str``   Platform-unique identifier
        ``event_type``  ``str``   Type of event (post, comment, star, …)
        ``content``     ``str``   Text preview (max 500 chars)
        ``author``      ``str``   Author name or ``"[deleted]"``
        ``url``         ``str``   Permanent URL
        ``score``       ``int``   Engagement score
        ``metadata``    ``dict``  Extra platform-specific data
        ``campaign_name`` ``str`` Matched campaign name or ``""``
        ``occurred_at`` ``str``   ISO-8601 timestamp
        ==============  ========  ============================================
        """
        ...

    # ── retry + store ─────────────────────────────────────────────────────

    def run_with_retry(
        self,
        since: datetime | None = None,
        max_retries: int = 3,
    ) -> list[dict[str, Any]]:
        """Collect with exponential backoff retry.

        Args:
            since: Collect events after this timestamp.  ``None`` means
                use the collector's default lookback (usually 7–30 days).
            max_retries: Maximum number of attempts (default 3).

        Returns:
            List of event dicts, or ``[]`` if all retries were exhausted.
        """
        last_error: Exception | None = None
        for attempt in range(max_retries):
            try:
                events = self.collect(since)
                self.success_count += len(events)
                return events
            except Exception as e:
                self.error_count += 1
                last_error = e
                if attempt < max_retries - 1:
                    wait = 2 ** attempt  # 1s, 2s, 4s
                    logger.warning(
                        "%s attempt %d failed: %s. Retrying in %ds...",
                        type(self).__name__,
                        attempt + 1,
                        e,
                        wait,
                    )
                    time.sleep(wait)
        logger.error(
            "%s failed after %d retries: %s",
            type(self).__name__,
            max_retries,
            last_error,
        )
        return []

    def run_and_store(self, since: datetime | None = None) -> int:
        """Collect and insert into DuckDB.

        Args:
            since: Passed through to :meth:`collect`.

        Returns:
            Number of events inserted into the database.
        """
        events = self.run_with_retry(since)
        if events:
            return self.store.insert_raw_events(events)
        return 0
