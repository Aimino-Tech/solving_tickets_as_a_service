"""Tests for evidence snippet store."""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from workers.notifications.snippets import (
    EVIDENCE_LINE_LIMIT,
    _evidence_store,
    _lock,
    capture_evidence,
    clear_evidence,
    evidence_count,
    format_evidence_section,
    get_evidence,
)


@pytest.fixture(autouse=True)
def clear_store():
    with _lock:
        _evidence_store.clear()
    yield
    with _lock:
        _evidence_store.clear()


class TestCaptureEvidence:
    def test_captures_entry(self):
        r = capture_evidence("lin_1", "research", "src/a.ts", "test")
        assert r["status"] == "captured"

    def test_multiple_entries(self):
        capture_evidence("lin_1", "research", "a.ts", "A")
        capture_evidence("lin_1", "research", "b.ts", "B")
        assert len(get_evidence("lin_1", "research")) == 2

    def test_different_stages(self):
        capture_evidence("lin_1", "research", "a.ts", "A")
        capture_evidence("lin_1", "agent", "b.ts", "B")
        assert evidence_count("lin_1") == 2


class TestGetEvidence:
    def test_by_stage(self):
        capture_evidence("lin_1", "research", "a.ts", "A")
        assert get_evidence("lin_1", "research") != []

    def test_empty(self):
        assert get_evidence("nonexistent") == []


class TestClearEvidence:
    def test_clear_single(self):
        capture_evidence("lin_1", "research", "a.ts", "A")
        clear_evidence("lin_1", "research")
        assert evidence_count("lin_1") == 0

    def test_clear_all(self):
        capture_evidence("lin_1", "research", "a.ts", "A")
        capture_evidence("lin_1", "agent", "b.ts", "B")
        r = clear_evidence("lin_1")
        assert r["count"] == 2


class TestFormatEvidenceSection:
    def test_empty(self):
        assert format_evidence_section([]) == ""

    def test_single(self):
        r = format_evidence_section([{"file_path": "a.ts", "snippet": "A"}])
        assert "a.ts" in r

    def test_truncate(self):
        e = [{"file_path": f"f{i}.ts", "snippet": "S"} for i in range(EVIDENCE_LINE_LIMIT + 5)]
        r = format_evidence_section(e)
        assert r.count("`") == EVIDENCE_LINE_LIMIT * 2


class TestEvidenceInStatusComments:
    @patch("workers.notifications.status_comments._post_to_linear")
    def test_started_includes_evidence(self, mock_post):
        from workers.notifications.status_comments import post_stage_comment
        capture_evidence("lin_1", "research", "src/a.ts", "test")
        r = post_stage_comment("lin_1", "research", "started", "Starting")
        assert r["status"] == "posted"
        body = mock_post.call_args[0][1]
        assert "src/a.ts" in body

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_no_evidence_omitted(self, mock_post):
        from workers.notifications.status_comments import post_stage_comment
        r = post_stage_comment("lin_1", "research", "started", "Starting")
        assert r["status"] == "posted"
        body = mock_post.call_args[0][1]
        assert "src/a.ts" not in body

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_single_coalesced_includes_evidence(self, mock_post):
        from workers.notifications.status_comments import _flush_coalesced_events
        capture_evidence("lin_1", "research", "src/a.ts", "A")
        e = [{"issue_id": "lin_1", "stage": "research", "status": "completed", "message": "Done", "timestamp": time.time()}]
        _flush_coalesced_events(e)
        assert "src/a.ts" in mock_post.call_args[0][1]

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_multiple_coalesced_includes_evidence(self, mock_post):
        from workers.notifications.status_comments import _flush_coalesced_events
        capture_evidence("lin_1", "research", "a.ts", "A")
        capture_evidence("lin_1", "agent", "b.ts", "B")
        e = [
            {"issue_id": "lin_1", "stage": "research", "status": "completed", "message": "R", "timestamp": time.time()},
            {"issue_id": "lin_1", "stage": "agent", "status": "completed", "message": "A", "timestamp": time.time()},
        ]
        _flush_coalesced_events(e)
        body = mock_post.call_args[0][1]
        assert "a.ts" in body and "b.ts" in body

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_failed_includes_evidence(self, mock_post):
        from workers.notifications.status_comments import post_stage_comment
        capture_evidence("lin_1", "research", "a.ts", "A")
        r = post_stage_comment("lin_1", "research", "failed", "Error")
        assert r["status"] == "posted"
        body = mock_post.call_args[0][1]
        assert "a.ts" in body
        assert "Error" in body


def teardown_module():
    with _lock:
        _evidence_store.clear()
