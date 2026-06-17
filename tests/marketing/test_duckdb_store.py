"""Tests for marketing.duckdb_store."""

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from marketing.duckdb_store import DuckDBStore


@pytest.fixture
def store(tmp_path):
    db_path = tmp_path / "test_marketing.db"
    s = DuckDBStore(db_path)
    yield s
    s.close()


class TestSchemaCreation:
    def test_schema_creation(self, store):
        """Verify all tables are created."""
        tables = store.query(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        table_names = {t["name"] for t in tables}
        for expected in [
            "raw_events",
            "github_traffic",
            "github_referrers",
            "npm_downloads",
            "sentiment_scores",
            "costs",
            "sheet_import_log",
        ]:
            assert expected in table_names, f"Missing table: {expected}"

    def test_daily_aggregates_view(self, store):
        """Verify the daily_aggregates view exists."""
        views = store.query(
            "SELECT name FROM sqlite_master WHERE type='view' ORDER BY name"
        )
        view_names = {v["name"] for v in views}
        assert "daily_aggregates" in view_names


class TestInsertRawEvents:
    def test_insert_raw_events(self, store):
        events = [
            {
                "platform": "reddit",
                "source_id": "abc123",
                "event_type": "comment",
                "content": "Test comment",
                "author": "user1",
                "score": 5,
                "occurred_at": "2026-06-01T12:00:00Z",
            },
            {
                "platform": "github",
                "source_id": "def456",
                "event_type": "star",
                "author": "user2",
                "occurred_at": "2026-06-02T12:00:00Z",
            },
        ]
        count = store.insert_raw_events(events)
        assert count == 2
        rows = store.query_raw_events()
        assert len(rows) == 2

    def test_insert_with_metadata(self, store):
        events = [
            {
                "platform": "reddit",
                "source_id": "meta1",
                "event_type": "post",
                "content": "With metadata",
                "metadata": {"subreddit": "test", "flair": "discussion"},
                "occurred_at": "2026-06-01T12:00:00Z",
            }
        ]
        count = store.insert_raw_events(events)
        assert count == 1
        rows = store.query_raw_events()
        meta = json.loads(rows[0]["metadata"])
        assert meta["subreddit"] == "test"

    def test_query_raw_events_with_filters(self, store):
        store.insert_raw_events([
            {"platform": "reddit", "source_id": "r1", "event_type": "comment",
             "occurred_at": "2026-06-01T12:00:00Z"},
            {"platform": "github", "source_id": "g1", "event_type": "star",
             "occurred_at": "2026-06-02T12:00:00Z"},
            {"platform": "reddit", "source_id": "r2", "event_type": "post",
             "occurred_at": "2026-06-03T12:00:00Z"},
        ])
        reddit_rows = store.query_raw_events(platform="reddit")
        assert len(reddit_rows) == 2
        since_rows = store.query_raw_events(since="2026-06-02T00:00:00Z")
        assert len(since_rows) == 2  # r2 and g1
        limit_rows = store.query_raw_events(limit=1)
        assert len(limit_rows) == 1

    def test_insert_empty_events_list(self, store):
        count = store.insert_raw_events([])
        assert count == 0


class TestInsertGitHubTraffic:
    def test_insert_github_traffic(self, store):
        rows = [
            {
                "repo": "owner/repo",
                "clones_unique": 10,
                "clones_count": 20,
                "views_unique": 50,
                "views_count": 100,
            }
        ]
        count = store.insert_github_traffic(rows)
        assert count == 1
        result = store.query("SELECT * FROM github_traffic")
        assert len(result) == 1
        assert result[0]["clones_unique"] == 10
        assert result[0]["views_count"] == 100


class TestInsertNpmDownloads:
    def test_insert_npm_downloads(self, store):
        rows = [
            {
                "package": "@scope/pkg",
                "downloads_last_day": 100,
                "downloads_last_week": 700,
                "downloads_last_month": 3000,
            }
        ]
        count = store.insert_npm_downloads(rows)
        assert count == 1
        result = store.query("SELECT * FROM npm_downloads")
        assert result[0]["downloads_last_week"] == 700


class TestDailyAggregatesView:
    def test_daily_aggregates(self, store):
        store.insert_raw_events([
            {"platform": "reddit", "source_id": "e1", "event_type": "comment",
             "score": 5, "occurred_at": "2026-06-01T12:00:00Z"},
            {"platform": "reddit", "source_id": "e2", "event_type": "comment",
             "score": 3, "occurred_at": "2026-06-01T14:00:00Z"},
            {"platform": "github", "source_id": "e3", "event_type": "star",
             "score": 0, "occurred_at": "2026-06-02T12:00:00Z"},
        ])
        aggregates = store.query(
            "SELECT * FROM daily_aggregates ORDER BY day, platform"
        )
        # 2 rows: reddit/comment (2 events, score 8), github/star (1 event, score 0)
        assert len(aggregates) == 2
        reddit_rows = [r for r in aggregates if r["platform"] == "reddit"]
        assert len(reddit_rows) == 1
        assert reddit_rows[0]["event_count"] == 2
        assert reddit_rows[0]["total_score"] == 8


class TestInsertCosts:
    def test_insert_costs(self, store):
        costs = [
            {
                "campaign_id": "camp1",
                "platform": "reddit",
                "hours": 2.5,
                "hourly_rate": 50,
                "date": "2026-06-01",
            }
        ]
        count = store.insert_costs(costs)
        assert count == 1
        result = store.query("SELECT * FROM costs")
        assert result[0]["total_cost"] == 125.0  # 2.5 * 50

    def test_insert_costs_zero_hours(self, store):
        costs = [
            {
                "campaign_id": "camp2",
                "platform": "twitter",
                "hours": 0,
                "hourly_rate": 0,
                "date": "2026-06-02",
            }
        ]
        count = store.insert_costs(costs)
        assert count == 1
        result = store.query("SELECT * FROM costs")
        assert result[0]["total_cost"] == 0.0

    def test_insert_costs_with_sheet_row(self, store):
        costs = [
            {
                "campaign_id": "camp3",
                "platform": "linkedin",
                "hours": 1.0,
                "hourly_rate": 75,
                "date": "2026-06-03",
                "sheet_row": 42,
                "notes": "Sponsored post",
            }
        ]
        count = store.insert_costs(costs)
        assert count == 1
        result = store.query("SELECT * FROM costs")
        assert result[0]["sheet_row"] == 42
        assert result[0]["notes"] == "Sponsored post"


class TestInsertSentiment:
    def test_insert_sentiment(self, store):
        # First insert a raw event to link to
        store.insert_raw_events([
            {
                "platform": "reddit",
                "source_id": "e1",
                "event_type": "comment",
                "occurred_at": "2026-06-01T12:00:00Z",
            }
        ])
        raw = store.query_raw_events()
        event_id = raw[0]["id"]
        scores = [
            {
                "raw_event_id": event_id,
                "compound": 0.5,
                "positive": 0.3,
                "neutral": 0.6,
                "negative": 0.1,
            }
        ]
        count = store.insert_sentiment_scores(scores)
        assert count == 1
        result = store.query("SELECT * FROM sentiment_scores")
        assert result[0]["compound"] == 0.5

    def test_insert_sentiment_replace(self, store):
        store.insert_raw_events([
            {
                "platform": "reddit",
                "source_id": "e2",
                "event_type": "post",
                "occurred_at": "2026-06-01T12:00:00Z",
            }
        ])
        raw = store.query_raw_events()
        event_id = raw[0]["id"]

        # Insert initial score
        store.insert_sentiment_scores([
            {"raw_event_id": event_id, "compound": 0.1,
             "positive": 0.1, "neutral": 0.8, "negative": 0.1}
        ])
        # Replace with new score
        store.insert_sentiment_scores([
            {"raw_event_id": event_id, "compound": 0.9,
             "positive": 0.8, "neutral": 0.1, "negative": 0.1}
        ])
        result = store.query("SELECT * FROM sentiment_scores")
        assert result[0]["compound"] == pytest.approx(0.9, abs=1e-6)


class TestQueryHelper:
    def test_query_daily_aggregates(self, store):
        """query_daily_aggregates should return rows without error."""
        store.insert_raw_events([
            {"platform": "reddit", "source_id": "qa1", "event_type": "comment",
             "score": 1, "occurred_at": "2026-06-01T12:00:00Z"},
        ])
        # Use a large days window to ensure the test event is included
        result = store.query_daily_aggregates(days=365)
        assert len(result) >= 1

    def test_raw_query(self, store):
        """Arbitrary SQL via query() returns list of dicts."""
        store.insert_raw_events([
            {"platform": "test", "source_id": "rq1", "event_type": "post",
             "occurred_at": "2026-06-01T12:00:00Z"},
        ])
        result = store.query(
            "SELECT platform, COUNT(*) as cnt FROM raw_events GROUP BY platform"
        )
        assert len(result) >= 1
        assert "platform" in result[0]
        assert "cnt" in result[0]


class TestSheetImportTracking:
    def test_sheet_import_tracking(self, store):
        conn = store._get_conn()
        conn.execute(
            """INSERT OR IGNORE INTO sheet_import_log
               (tab_name, row_number, content_id, imported_at)
               VALUES (?, ?, ?, ?)""",
            [
                "reddit-campaign",
                1,
                "row1",
                datetime.now(timezone.utc).isoformat(),
            ],
        )
        result = store.query(
            "SELECT * FROM sheet_import_log WHERE tab_name = 'reddit-campaign'"
        )
        assert len(result) == 1
        assert result[0]["row_number"] == 1

    def test_sheet_import_unique_constraint(self, store):
        conn = store._get_conn()
        conn.execute(
            """INSERT INTO sheet_import_log
               (tab_name, row_number, content_id, imported_at)
               VALUES (?, ?, ?, ?)""",
            ["test-tab", 1, "first", datetime.now(timezone.utc).isoformat()],
        )
        # Second insert with same tab_name + row_number should be ignored
        conn.execute(
            """INSERT OR IGNORE INTO sheet_import_log
               (tab_name, row_number, content_id, imported_at)
               VALUES (?, ?, ?, ?)""",
            ["test-tab", 1, "second", datetime.now(timezone.utc).isoformat()],
        )
        result = store.query(
            "SELECT * FROM sheet_import_log WHERE tab_name = 'test-tab'"
        )
        assert len(result) == 1
        assert result[0]["content_id"] == "first"


class TestContextManager:
    def test_context_manager(self, tmp_path):
        db_path = tmp_path / "ctx_test.db"
        with DuckDBStore(db_path) as s:
            assert s._conn is not None
            s.insert_raw_events([
                {"platform": "test", "source_id": "ctx1", "event_type": "post",
                 "occurred_at": "2026-06-01T12:00:00Z"},
            ])
        # After exit, conn should be closed
        assert s._conn is None


class TestConcurrentAccess:
    def test_concurrent_inserts(self, store):
        """Multiple sequential inserts (simulating concurrent access)."""
        for i in range(10):
            store.insert_raw_events([
                {
                    "platform": "reddit",
                    "source_id": f"concurrent-{i}",
                    "event_type": "comment",
                    "occurred_at": "2026-06-01T12:00:00Z",
                }
            ])
        rows = store.query_raw_events()
        assert len(rows) == 10
