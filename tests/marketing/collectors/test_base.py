"""Tests for marketing.collectors.base."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from marketing.collectors.base import BaseCollector
from marketing.duckdb_store import DuckDBStore


class MockCollector(BaseCollector):
    """Minimal collector that returns a single test event."""

    def collect(self, since: datetime | None = None) -> list[dict]:
        return [{
            "platform": "test",
            "source_id": "test1",
            "event_type": "test",
            "content": "test",
            "author": "tester",
            "url": "https://example.com",
            "score": 1,
            "metadata": {},
            "campaign_name": "",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }]


class FailingCollector(BaseCollector):
    """Collector that fails N times then succeeds."""

    def __init__(self, duckdb_store: DuckDBStore, fail_count: int = 1) -> None:
        super().__init__(duckdb_store)
        self._attempts = 0
        self._fail_count = fail_count

    def collect(self, since: datetime | None = None) -> list[dict]:
        self._attempts += 1
        if self._attempts <= self._fail_count:
            raise RuntimeError(f"transient error (attempt {self._attempts})")
        return [{
            "platform": "test",
            "source_id": "ok",
            "event_type": "test",
            "content": "",
            "author": "",
            "url": "",
            "score": 0,
            "metadata": {},
            "campaign_name": "",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }]


# ===================================================================
# collect_and_store
# ===================================================================


class TestCollectAndStore:
    def test_collect_and_store(self, tmp_path: pytest.TempPathFactory) -> None:
        """A successful collect should insert one row into DuckDB."""
        store = DuckDBStore(str(tmp_path / "test.db"))
        c = MockCollector(store)
        count = c.run_and_store()
        assert count > 0
        rows = store.query_raw_events()
        assert len(rows) >= 1
        assert rows[0]["platform"] == "test"
        store.close()

    def test_empty_collect_returns_zero(
        self, tmp_path: pytest.TempPathFactory,
    ) -> None:
        """An empty collect should return 0 inserts."""
        store = DuckDBStore(str(tmp_path / "test.db"))
        c = MockCollector(store)

        original = c.collect
        c.collect = lambda since=None: []  # type: ignore[method-assign]

        count = c.run_and_store()
        assert count == 0
        c.collect = original  # type: ignore[method-assign]
        store.close()


# ===================================================================
# retry
# ===================================================================


class TestRetryOnFailure:
    def test_retry_then_succeeds(self, tmp_path: pytest.TempPathFactory) -> None:
        """A collector that fails once then succeeds should recover."""
        store = DuckDBStore(str(tmp_path / "test.db"))
        c = FailingCollector(store, fail_count=1)
        events = c.run_with_retry(max_retries=3)
        assert len(events) == 1
        assert c.error_count == 1
        assert c.success_count == 1
        store.close()

    def test_all_retries_exhausted(
        self, tmp_path: pytest.TempPathFactory,
    ) -> None:
        """A collector that always fails should return an empty list."""
        store = DuckDBStore(str(tmp_path / "test.db"))

        class AlwaysFails(BaseCollector):
            def collect(self, since=None):  # type: ignore[no-untyped-def]
                raise RuntimeError("always fails")

        c = AlwaysFails(store)
        events = c.run_with_retry(max_retries=2)
        assert events == []
        assert c.error_count == 2
        store.close()
