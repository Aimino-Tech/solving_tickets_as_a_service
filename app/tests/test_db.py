from app.common.db import get_repository
from app.common.models import EngagementRecord


def test_schema_creation():
    repo = get_repository(":memory:")
    tables = repo.conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = [t[0] for t in tables]
    assert "engagements" in table_names
    assert "rate_limits" in table_names


def test_log_and_query_engagement(repo, sample_engagement):
    repo.log_engagement(sample_engagement)
    records = repo.query(platform="linkedin")
    assert len(records) == 1
    assert records[0].id == sample_engagement.id
    assert records[0].status == "pending_approval"


def test_update_status(repo, sample_engagement):
    repo.log_engagement(sample_engagement)
    repo.update_status(sample_engagement.id, "sent", approved_by="test-operator")
    records = repo.query(platform="linkedin", status="sent")
    assert len(records) == 1
    assert records[0].approved_by == "test-operator"
    assert records[0].sent_at is not None


def test_get_pending_approval(repo, sample_engagement):
    repo.log_engagement(sample_engagement)
    record2 = EngagementRecord(
        platform="discord",
        engagement_type="reply",
        content="Test reply",
        status="pending_approval",
    )
    repo.log_engagement(record2)
    pending = repo.get_pending_approval()
    assert len(pending) == 2
    pending_li = repo.get_pending_approval(platform="linkedin")
    assert len(pending_li) == 1


def test_rate_limit_operations(repo):
    count = repo.get_rate_limit_count("linkedin", "2026-01-01")
    assert count == 0
    repo.increment_rate_limit("linkedin", "2026-01-01")
    count = repo.get_rate_limit_count("linkedin", "2026-01-01")
    assert count == 1
    repo.increment_rate_limit("linkedin", "2026-01-01")
    count = repo.get_rate_limit_count("linkedin", "2026-01-01")
    assert count == 2


def test_summary(repo, sample_engagement):
    repo.log_engagement(sample_engagement)
    sample_engagement.id = "test-2"
    sample_engagement.status = "sent"
    sample_engagement.engagement_type = "dm"
    repo.log_engagement(sample_engagement)
    summary = repo.summary(days=7)
    assert len(summary) > 0
    assert any(s["platform"] == "linkedin" for s in summary)


"""Tests for engagement database schema and helpers."""

import os
import json
import duckdb


class TestDuckDBEngagements:
    def test_schema_creation(self, test_db_path):
        from app.orchestration.engagement.db import get_connection
        con = get_connection()
        tables = [t[0] for t in con.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"
        ).fetchall()]
        assert "engagements" in tables
        assert "leads" in tables
        assert "tokens" in tables
        assert "orchestrator_state" in tables
        con.close()

    def test_engagement_columns(self, test_db_path):
        from app.orchestration.engagement.db import get_connection
        con = get_connection()
        cols = [c[0] for c in con.execute("DESCRIBE engagements").fetchall()]
        for col in ["id", "platform", "external_id", "action", "content", "status", "created_at"]:
            assert col in cols, f"Missing column: {col}"
        con.close()

    def test_log_engagement(self, test_db_path):
        from app.orchestration.engagement.db import log_engagement, get_connection
        eid = log_engagement("reddit", "abc123", "reply", "test content", {"url": "http://example.com"})
        assert eid is not None

        con = get_connection()
        row = con.execute("SELECT * FROM engagements WHERE id = ?", [eid]).fetchone()
        assert row is not None
        assert row[1] == "reddit"
        assert row[4] == "test content"
        con.close()

    def test_log_lead(self, test_db_path):
        from app.orchestration.engagement.db import log_engagement, log_lead, get_connection
        eid = log_engagement("twitter", "tweet1", "reply", "hello")
        lid = log_lead("twitter", "user123", eid, score=85, notes="interested")
        assert lid is not None

        con = get_connection()
        row = con.execute("SELECT * FROM leads WHERE id = ?", [lid]).fetchone()
        assert row is not None
        assert row[2] == "user123"
        assert row[4] == 85
        con.close()

    def test_update_status(self, test_db_path):
        from app.orchestration.engagement.db import log_engagement, update_engagement_status, get_connection
        eid = log_engagement("hn", "story1", "reply", "test")
        update_engagement_status(eid, "posted")

        con = get_connection()
        row = con.execute("SELECT status FROM engagements WHERE id = ?", [eid]).fetchone()
        assert row[0] == "posted"
        con.close()

    def test_pending_engagements(self, test_db_path):
        from app.orchestration.engagement.db import log_engagement, get_pending_engagements
        log_engagement("reddit", "r1", "reply", "pending1")
        log_engagement("hn", "h1", "reply", "pending2")
        df = get_pending_engagements()
        assert len(df) == 2

        df_reddit = get_pending_engagements(platform="reddit")
        assert len(df_reddit) == 1

    def test_orchestrator_state(self, test_db_path):
        from app.orchestration.engagement.db import set_state, get_state
        set_state("last_scan", {"reddit": "2026-01-01T00:00:00"})
        val = get_state("last_scan")
        assert val is not None
        assert val["reddit"] == "2026-01-01T00:00:00"

    def test_indexes_exist(self, test_db_path):
        from app.orchestration.engagement.db import get_connection
        con = get_connection()
        indexes = [i[0] for i in con.execute(
            "SELECT index_name FROM duckdb_indexes()"
        ).fetchall()]
        assert "idx_engagements_platform" in indexes
        assert "idx_leads_score" in indexes
        con.close()
