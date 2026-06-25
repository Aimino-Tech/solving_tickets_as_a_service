"""Tests for the shareable run page API and badge endpoint."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Run data fixtures
# ---------------------------------------------------------------------------

MOCK_RUN = {
    "id": 42,
    "accountId": 1,
    "repoId": 1,
    "issueNumber": 123,
    "issueTitle": "Fix login redirect bug",
    "status": "completed",
    "confidence": "high",
    "summary": "Fixed the login redirect loop by checking the origin header.",
    "prUrl": "https://github.com/owner/repo/pull/42",
    "branchName": "stas/fix/123-abc12345",
    "error": None,
    "durationMs": 45000,
    "modelUsed": "claude-sonnet-4",
    "createdAt": "2026-06-25T10:00:00Z",
}

MOCK_RUN_RUNNING = {**MOCK_RUN, "id": 43, "status": "running", "confidence": None}
MOCK_RUN_FAILED = {**MOCK_RUN, "id": 44, "status": "failed", "confidence": "low"}


# ---------------------------------------------------------------------------
# Badge endpoint
# ---------------------------------------------------------------------------


class TestBadgeEndpoint:
    """Tests for the shields.io-compatible badge SVG generation."""

    def test_status_to_badge_completed(self):
        from routes.badge import statusToBadge

        badge = statusToBadge("completed")
        assert badge["label"] == "fix"
        assert badge["message"] == "passed"
        assert badge["color"] == "success"

    def test_status_to_badge_failed(self):
        from routes.badge import statusToBadge

        badge = statusToBadge("failed")
        assert badge["message"] == "failed"
        assert badge["color"] == "critical"

    def test_status_to_badge_running(self):
        from routes.badge import statusToBadge

        badge = statusToBadge("running")
        assert badge["message"] == "running"
        assert badge["color"] == "blue"

    def test_status_to_badge_queued(self):
        from routes.badge import statusToBadge

        badge = statusToBadge("queued")
        assert badge["message"] == "queued"
        assert badge["color"] == "yellow"

    def test_status_to_badge_cancelled(self):
        from routes.badge import statusToBadge

        badge = statusToBadge("cancelled")
        assert badge["message"] == "cancelled"
        assert badge["color"] == "inactive"

    def test_status_to_badge_unknown(self):
        from routes.badge import statusToBadge

        badge = statusToBadge("weird_status")
        assert badge["color"] == "lightgrey"

    def test_render_badge_svg_valid(self):
        from routes.badge import renderBadgeSvg

        svg = renderBadgeSvg({"label": "fix", "message": "passed", "color": "success"})
        assert "fix" in svg
        assert "passed" in svg
        assert "#2ea44f" in svg
        assert "<svg" in svg
        assert "</svg>" in svg

    def test_render_badge_svg_escapes_xml(self):
        from routes.badge import renderBadgeSvg

        svg = renderBadgeSvg({"label": "fix<bug>", "message": "done&dust", "color": "blue"})
        assert "&lt;" in svg
        assert "&amp;" in svg

    def test_render_badge_svg_all_statuses(self):
        from routes.badge import renderBadgeSvg, statusToBadge

        for status in ["completed", "failed", "running", "queued", "cancelled"]:
            badge = statusToBadge(status)
            svg = renderBadgeSvg(badge)
            assert "<svg" in svg
            assert "</svg>" in svg
            assert badge["message"] in svg

    def test_escape_xml(self):
        from routes.badge import escapeXml

        assert escapeXml("<tag>") == "&lt;tag&gt;"
        assert escapeXml("a&b") == "a&amp;b"


# ---------------------------------------------------------------------------
# PublicRunResponse and HTML rendering
# ---------------------------------------------------------------------------


class TestPublicRunResponse:
    """Tests for the public run response data shape and rendering."""

    def test_confidence_label_mapping(self):
        from routes.runs import renderRunPage

        for confidence in ["high", "medium", "low", None]:
            run = {
                "id": 1,
                "repoOwner": "owner",
                "repoName": "repo",
                "issueNumber": 1,
                "issueTitle": "Test",
                "status": "completed",
                "confidence": confidence,
                "summary": "Fixed it",
                "prUrl": None,
                "branchName": None,
                "error": None,
                "durationMs": 1000,
                "modelUsed": "test-model",
                "createdAt": "2026-06-25T00:00:00Z",
            }
            html = renderRunPage(run)
            assert "<!DOCTYPE html>" in html
            assert "owner/repo" in html

    def test_render_run_page_includes_cta(self):
        from routes.runs import renderRunPage

        run = {
            "id": 1,
            "repoOwner": "owner",
            "repoName": "repo",
            "issueNumber": 1,
            "issueTitle": "Test",
            "status": "completed",
            "confidence": "high",
            "summary": "Fixed it",
            "prUrl": "https://github.com/o/r/pull/1",
            "branchName": "stas/fix/1",
            "error": None,
            "durationMs": 1000,
            "modelUsed": "test",
            "createdAt": "2026-06-25T00:00:00Z",
        }
        html = renderRunPage(run)
        assert "Get STAS for your repo" in html
        assert "solving_tickets_as_a_service" in html

    def test_render_run_page_shows_error(self):
        from routes.runs import renderRunPage

        run = {
            "id": 1,
            "repoOwner": "owner",
            "repoName": "repo",
            "issueNumber": 1,
            "issueTitle": "Test",
            "status": "failed",
            "confidence": "low",
            "summary": "Fix attempted",
            "prUrl": None,
            "branchName": None,
            "error": "TypeError: Cannot read property of undefined",
            "durationMs": 5000,
            "modelUsed": "test",
            "createdAt": "2026-06-25T00:00:00Z",
        }
        html = renderRunPage(run)
        assert "Cannot read property" in html
        assert "Fix attempted" in html

    def test_render_run_page_empty_summary(self):
        from routes.runs import renderRunPage

        run = {
            "id": 1,
            "repoOwner": "owner",
            "repoName": "repo",
            "issueNumber": 1,
            "issueTitle": "Test",
            "status": "queued",
            "confidence": None,
            "summary": None,
            "prUrl": None,
            "branchName": None,
            "error": None,
            "durationMs": None,
            "modelUsed": None,
            "createdAt": "2026-06-25T00:00:00Z",
        }
        html = renderRunPage(run)
        assert "<!DOCTYPE html>" in html
        assert "queued" in html

    def test_escape_html(self):
        from routes.runs import escapeHtml

        assert escapeHtml("<script>") == "&lt;script&gt;"
        assert escapeHtml('a"b') == "a&quot;b"
        assert escapeHtml("c'd") == "c&#039;d"
        assert escapeHtml("a&b") == "a&amp;b"
