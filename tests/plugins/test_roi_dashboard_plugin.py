"""Tests for the ROI Dashboard plugin — API endpoints, frontend files, manifest.

Tests cover:
    - Plugin manifest data integrity (required fields, valid tab config)
    - Frontend files exist (index.js, style.css) and parse correctly
    - API endpoints return valid JSON with expected structure
    - Health endpoint
    - Endpoints gracefully handle empty / missing data
    - Endpoints gracefully handle missing store
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from unittest.mock import patch

import pytest

from plugins.roi.dashboard.plugin_api import router

# ── Paths ───────────────────────────────────────────────────────────────────

PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugins" / "roi" / "dashboard"
MANIFEST_PATH = PLUGIN_DIR / "manifest.json"
INDEX_JS_PATH = PLUGIN_DIR / "dist" / "index.js"
STYLE_CSS_PATH = PLUGIN_DIR / "dist" / "style.css"


# ===========================================================================
#  Manifest Tests
# ===========================================================================


class TestManifest:
    """Plugin manifest must have required fields and valid tab configuration."""

    def test_manifest_exists(self) -> None:
        assert MANIFEST_PATH.exists(), f"Manifest not found at {MANIFEST_PATH}"

    def test_manifest_valid_json(self) -> None:
        raw = MANIFEST_PATH.read_text()
        data = json.loads(raw)
        assert isinstance(data, dict)

    def test_manifest_required_fields(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        required = {"name", "label", "description", "icon", "version", "tab", "entry", "css", "api"}
        missing = required - set(data.keys())
        assert not missing, f"Manifest missing fields: {missing}"

    def test_manifest_name_is_roi_dashboard(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        assert data["name"] == "roi-dashboard"

    def test_manifest_has_tab_path(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        assert "path" in data["tab"]
        assert data["tab"]["path"] == "/roi"

    def test_manifest_tab_position_after_monitoring(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        assert data["tab"].get("position") == "after:monitoring"

    def test_manifest_entry_points_to_index_js(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        assert data["entry"] == "dist/index.js"

    def test_manifest_css_points_to_style_css(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        assert data["css"] == "dist/style.css"

    def test_manifest_api_points_to_plugin_api(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        assert data["api"] == "plugin_api.py"

    def test_manifest_version_is_semver(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        assert re.match(r"^\d+\.\d+\.\d+$", data["version"]), f"Invalid semver: {data['version']}"

    def test_manifest_label_is_roi(self) -> None:
        data = json.loads(MANIFEST_PATH.read_text())
        assert data["label"] == "ROI"


# ===========================================================================
#  Frontend File Tests
# ===========================================================================


class TestFrontendFiles:
    """Frontend assets must exist, be loadable, and have valid structure."""

    def test_index_js_exists(self) -> None:
        assert INDEX_JS_PATH.exists(), f"index.js not found at {INDEX_JS_PATH}"

    def test_index_js_not_empty(self) -> None:
        content = INDEX_JS_PATH.read_text()
        assert len(content) > 500, "index.js is suspiciously short"

    def test_index_js_is_valid_js(self) -> None:
        """Verify index.js has balanced braces and parens as a basic syntactic check."""
        content = INDEX_JS_PATH.read_text()
        assert content.count("{") == content.count("}"), "Unbalanced braces in index.js"
        assert content.count("(") == content.count(")"), "Unbalanced parens in index.js"

    def test_index_js_has_iife(self) -> None:
        """index.js should be wrapped in an IIFE like the monitoring plugin."""
        content = INDEX_JS_PATH.read_text().strip()
        assert content.startswith("(function () {"), "index.js should start with IIFE"

    def test_index_js_has_api_base_url(self) -> None:
        content = INDEX_JS_PATH.read_text()
        assert "/api/plugins/roi" in content, "index.js should reference the ROI API base URL"

    def test_index_js_has_auth_pattern(self) -> None:
        content = INDEX_JS_PATH.read_text()
        assert "__HERMES_SESSION_TOKEN__" in content, "index.js should use token auth"

    def test_index_js_uses_hash_based_routing(self) -> None:
        content = INDEX_JS_PATH.read_text()
        assert "hashchange" in content, "index.js should listen for hashchange events"

    def test_index_js_has_mutation_observer(self) -> None:
        content = INDEX_JS_PATH.read_text()
        assert "MutationObserver" in content, "index.js should use MutationObserver for mount detection"

    def test_index_js_has_all_tabs(self) -> None:
        content = INDEX_JS_PATH.read_text()
        for tab in ("campaigns", "funnel", "engagement", "cron", "forecast", "alerts"):
            assert tab in content, f"index.js missing tab: #{tab}"

    def test_style_css_exists(self) -> None:
        assert STYLE_CSS_PATH.exists(), f"style.css not found at {STYLE_CSS_PATH}"

    def test_style_css_not_empty(self) -> None:
        content = STYLE_CSS_PATH.read_text()
        assert len(content) > 500, "style.css is suspiciously short"

    def test_style_css_has_roi_prefix_classes(self) -> None:
        content = STYLE_CSS_PATH.read_text()
        # All ROI classes should use the roi- prefix
        roi_classes = re.findall(r"\.roi-[\w-]+", content)
        assert len(roi_classes) > 10, f"Expected many .roi-* classes, got {len(roi_classes)}"

    def test_style_css_has_grade_badges(self) -> None:
        content = STYLE_CSS_PATH.read_text()
        for grade in ("a", "b", "c", "d", "f"):
            assert f"roi-grade--{grade}" in content, f"Missing grade style for {grade}"

    def test_style_css_has_funnel_styles(self) -> None:
        content = STYLE_CSS_PATH.read_text()
        assert "roi-funnel-bar" in content, "Missing funnel bar styles"
        assert "roi-funnel-viz" in content, "Missing funnel visualization styles"


# ===========================================================================
#  Router Tests
# ===========================================================================


class TestRouterRegistration:
    """The APIRouter must be properly configured."""

    def test_router_is_exported(self) -> None:
        from plugins.roi.dashboard.plugin_api import router as r
        assert r is router

    def test_router_has_routes(self) -> None:
        assert len(router.routes) > 0, "Router should have registered routes"

    def test_router_has_all_expected_routes(self) -> None:
        """Verify all expected endpoint paths are registered on the router."""
        expected_paths = {
            "/health",
            "/campaigns",
            "/campaign/{campaign_id}",
            "/engagement",
            "/funnel",
            "/forecast",
            "/quality-score",
            "/cron",
            "/alerts",
        }
        actual_paths = {r.path for r in router.routes}
        for path in expected_paths:
            assert path in actual_paths, f"Missing route: {path}"

    def test_all_routes_are_get(self) -> None:
        for route in router.routes:
            methods = getattr(route, "methods", {"GET"})
            assert "GET" in methods, f"Route {route.path} should accept GET"


# ===========================================================================
#  Endpoint Structure Tests (using mock store)
# ===========================================================================


class MockCampaignStore:
    """A fully mocked CampaignStore returning deterministic data."""

    def __init__(self) -> None:
        self.campaigns: list[dict] = []
        self.actions: list[dict] = []
        self.metrics_list: list[dict] = []
        self.funnel_events_list: list[dict] = []
        self.cron_log: list[dict] = []

    def list_campaigns(self, status: str | None = None) -> list[dict]:
        if status:
            return [c for c in self.campaigns if c.get("status") == status]
        return list(self.campaigns)

    def get_campaign(self, campaign_id: str) -> dict | None:
        for c in self.campaigns:
            if c["id"] == campaign_id:
                return c
        return None

    def get_actions(self, campaign_id: str, **kwargs) -> list[dict]:
        return [a for a in self.actions if a.get("campaign_id") == campaign_id]

    def get_metrics(self, campaign_id: str, **kwargs) -> list[dict]:
        return [m for m in self.metrics_list if m.get("campaign_id") == campaign_id]

    def get_funnel_events(self, campaign_id: str, **kwargs) -> list[dict]:
        return [e for e in self.funnel_events_list if e.get("campaign_id") == campaign_id]

    def get_cron_job_log(self, limit: int = 20, **kwargs) -> list[dict]:
        return list(self.cron_log)


@pytest.fixture
def mock_store() -> MockCampaignStore:
    """Return a fresh MockCampaignStore with sample data."""
    store = MockCampaignStore()
    store.campaigns = [
        {
            "id": "camp-001",
            "name": "OpenTalk2HTML Launch",
            "product": "OpenTalk2HTML-NotMD",
            "status": "active",
            "start_date": "2026-05-01",
            "config_json": json.dumps({"marketplace_published": True}),
            "created_at": "2026-05-01T00:00:00Z",
            "updated_at": "2026-05-15T00:00:00Z",
        },
        {
            "id": "camp-002",
            "name": "OC-Vision Awareness",
            "product": "oc-vision",
            "status": "draft",
            "start_date": "",
            "config_json": json.dumps({"marketplace_published": False}),
            "created_at": "2026-05-10T00:00:00Z",
            "updated_at": "2026-05-10T00:00:00Z",
        },
    ]
    store.actions = [
        {"id": 1, "campaign_id": "camp-001", "platform": "reddit", "action_type": "post", "status": "completed", "timestamp": "2026-05-14T10:00:00Z"},
        {"id": 2, "campaign_id": "camp-001", "platform": "reddit", "action_type": "reply", "status": "completed", "timestamp": "2026-05-14T11:00:00Z"},
        {"id": 3, "campaign_id": "camp-001", "platform": "twitter", "action_type": "tweet", "status": "pending", "timestamp": "2026-05-14T12:00:00Z"},
        {"id": 4, "campaign_id": "camp-001", "platform": "hn", "action_type": "show hn", "status": "completed", "timestamp": "2026-05-15T08:00:00Z"},
        {"id": 5, "campaign_id": "camp-002", "platform": "reddit", "action_type": "post", "status": "draft", "timestamp": "2026-05-12T00:00:00Z"},
    ]
    store.metrics_list = [
        {"campaign_id": "camp-001", "collected_at": "2026-05-15T00:00:00Z", "github_stars": 42, "npm_downloads": 150, "x_mentions": 8, "sheet_row_count": 12},
        {"campaign_id": "camp-002", "collected_at": "2026-05-15T00:00:00Z", "github_stars": 5, "npm_downloads": 0, "x_mentions": 1, "sheet_row_count": 3},
    ]
    store.funnel_events_list = [
        {"campaign_id": "camp-001", "event_type": "awareness", "signal_direction": "positive", "occurred_at": "2026-05-14T10:00:00Z"},
        {"campaign_id": "camp-001", "event_type": "awareness", "signal_direction": "positive", "occurred_at": "2026-05-14T11:00:00Z"},
        {"campaign_id": "camp-001", "event_type": "engagement", "signal_direction": "positive", "occurred_at": "2026-05-14T12:00:00Z"},
        {"campaign_id": "camp-001", "event_type": "interest", "signal_direction": "neutral", "occurred_at": "2026-05-15T08:00:00Z"},
        {"campaign_id": "camp-002", "event_type": "awareness", "signal_direction": "neutral", "occurred_at": "2026-05-12T00:00:00Z"},
    ]
    store.cron_log = [
        {"id": 1, "job_name": "marketing-check", "job_type": "monitor", "status": "completed", "started_at": "2026-05-15T06:00:00Z", "duration_ms": 1200, "result_summary": "All checks passed"},
        {"id": 2, "job_name": "sheet-sync", "job_type": "sync", "status": "completed", "started_at": "2026-05-15T07:00:00Z", "duration_ms": 3400, "result_summary": "Synced 5 rows"},
        {"id": 3, "job_name": "daily-digest", "job_type": "analysis", "status": "failed", "started_at": "2026-05-15T08:00:00Z", "duration_ms": 500, "error_message": "API timeout"},
        {"id": 4, "job_name": "marketing-check", "job_type": "monitor", "status": "completed", "started_at": "2026-05-15T12:00:00Z", "duration_ms": 800, "result_summary": "All checks passed"},
        {"id": 5, "job_name": "daily-digest", "job_type": "analysis", "status": "failed", "started_at": "2026-05-16T08:00:00Z", "duration_ms": 600, "error_message": "API timeout"},
        {"id": 6, "job_name": "daily-digest", "job_type": "analysis", "status": "failed", "started_at": "2026-05-17T08:00:00Z", "duration_ms": 700, "error_message": "API timeout"},
    ]
    return store


def _patch_store(mock_store: MockCampaignStore):
    """Return a context manager that patches _get_store to return mock_store."""
    return patch("plugins.roi.dashboard.plugin_api._get_store", return_value=mock_store)


@pytest.fixture
def client():
    """Return a TestClient for the ROI router."""
    from fastapi.testclient import TestClient
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(router, prefix="/api/plugins/roi")
    return TestClient(app)


class TestHealthEndpoint:
    """The /health endpoint must return a valid status."""

    def test_health_returns_ok_with_store(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "generated_at" in data

    def test_health_returns_error_on_failure(self, client) -> None:
        with patch("plugins.roi.dashboard.plugin_api._get_store", side_effect=RuntimeError("DB down")):
            resp = client.get("/api/plugins/roi/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "error"
        assert "detail" in data


class TestCampaignsEndpoint:
    """The /campaigns endpoint must return campaigns with quality scores."""

    def test_returns_campaigns(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/campaigns")
        assert resp.status_code == 200
        data = resp.json()
        assert "campaigns" in data
        assert data["total"] == 2
        assert "generated_at" in data

    def test_each_campaign_has_quality_fields(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/campaigns")
        data = resp.json()
        for c in data["campaigns"]:
            assert "quality_score" in c
            assert "quality_grade" in c
            assert c["quality_grade"] in ("A", "B", "C", "D", "F")

    def test_campaign_has_required_fields(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/campaigns")
        data = resp.json()
        for c in data["campaigns"]:
            for field in ("id", "name", "status", "total_actions", "completed_actions", "last_activity"):
                assert field in c, f"Campaign missing field: {field}"

    def test_empty_campaigns_returns_empty_list(self, client) -> None:
        empty_store = MockCampaignStore()
        with _patch_store(empty_store):
            resp = client.get("/api/plugins/roi/campaigns")
        assert resp.status_code == 200
        data = resp.json()
        assert data["campaigns"] == []
        assert data["total"] == 0

    def test_error_returns_empty_list(self, client) -> None:
        with patch("plugins.roi.dashboard.plugin_api._get_store", side_effect=RuntimeError("DB error")):
            resp = client.get("/api/plugins/roi/campaigns")
        assert resp.status_code == 200
        data = resp.json()
        assert data["campaigns"] == []


class TestCampaignDetailEndpoint:
    """The /campaign/{id} endpoint must return detailed data."""

    def test_returns_campaign_detail(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/campaign/camp-001")
        assert resp.status_code == 200
        data = resp.json()
        assert "campaign" in data
        assert data["campaign"]["id"] == "camp-001"
        assert data["campaign"]["name"] == "OpenTalk2HTML Launch"
        assert "quality_score" in data
        assert "actions" in data
        assert "metrics" in data
        assert "funnel" in data

    def test_funnel_has_all_stages(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/campaign/camp-001")
        data = resp.json()
        stages = data["funnel"]
        for stage in ("awareness", "engagement", "interest", "consideration", "conversion", "retention"):
            assert stage in stages, f"Missing funnel stage: {stage}"

    def test_not_found_returns_error(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/campaign/nonexistent")
        assert resp.status_code == 200
        data = resp.json()
        assert "error" in data
        assert data["error"] == "Campaign not found"


class TestEngagementEndpoint:
    """The /engagement endpoint must return per-platform metrics."""

    def test_returns_platforms(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/engagement")
        assert resp.status_code == 200
        data = resp.json()
        assert "platforms" in data
        assert data["total_platforms"] >= 2

    def test_platform_has_required_fields(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/engagement")
        data = resp.json()
        for p in data["platforms"]:
            for field in ("platform", "total_actions", "completed", "signal_ratio", "engagement_rate", "unique_campaigns"):
                assert field in p, f"Platform missing field: {field}"

    def test_empty_returns_empty(self, client) -> None:
        empty_store = MockCampaignStore()
        with _patch_store(empty_store):
            resp = client.get("/api/plugins/roi/engagement")
        assert resp.status_code == 200
        data = resp.json()
        assert data["platforms"] == []


class TestFunnelEndpoint:
    """The /funnel endpoint must return funnel conversion data."""

    def test_returns_funnel_data(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/funnel")
        assert resp.status_code == 200
        data = resp.json()
        assert "funnel_order" in data
        assert "global" in data
        assert "campaigns" in data

    def test_global_has_all_stages(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/funnel")
        data = resp.json()
        for stage in ("awareness", "engagement", "interest", "consideration", "conversion", "retention"):
            assert stage in data["global"]["stages"], f"Missing global stage: {stage}"

    def test_global_has_conversion_rates(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/funnel")
        data = resp.json()
        rates = data["global"]["conversion_rates"]
        assert len(rates) > 0

    def test_empty_returns_empty_funnel(self, client) -> None:
        empty_store = MockCampaignStore()
        with _patch_store(empty_store):
            resp = client.get("/api/plugins/roi/funnel")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_campaigns"] == 0


class TestForecastEndpoint:
    """The /forecast endpoint must return predictive indicators."""

    def test_returns_forecasts(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/forecast?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert "forecasts" in data
        assert "summary" in data

    def test_forecast_has_trend_summary(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/forecast")
        data = resp.json()
        summary = data["summary"]
        for field in ("total", "increasing", "decreasing", "stable", "anomalies_detected"):
            assert field in summary, f"Missing summary field: {field}"

    def test_empty_returns_empty_forecasts(self, client) -> None:
        empty_store = MockCampaignStore()
        with _patch_store(empty_store):
            resp = client.get("/api/plugins/roi/forecast")
        assert resp.status_code == 200
        data = resp.json()
        assert data["forecasts"] == []


class TestQualityScoreEndpoint:
    """The /quality-score endpoint must return live quality scores."""

    def test_returns_scores(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/quality-score")
        assert resp.status_code == 200
        data = resp.json()
        assert "scores" in data
        assert len(data["scores"]) == 2

    def test_score_has_required_fields(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/quality-score")
        data = resp.json()
        for s in data["scores"]:
            for field in ("campaign_id", "campaign_name", "quality_score", "quality_grade"):
                assert field in s, f"Score missing field: {field}"

    def test_summary_has_grade_distribution(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/quality-score")
        data = resp.json()
        summary = data["summary"]
        for field in ("total", "average_score", "grade_distribution", "highest_score", "lowest_score"):
            assert field in summary, f"Missing summary field: {field}"

    def test_empty_returns_empty_scores(self, client) -> None:
        empty_store = MockCampaignStore()
        with _patch_store(empty_store):
            resp = client.get("/api/plugins/roi/quality-score")
        assert resp.status_code == 200
        data = resp.json()
        assert data["scores"] == []


class TestCronEndpoint:
    """The /cron endpoint must return cron job status."""

    def test_returns_cron_jobs(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/cron")
        assert resp.status_code == 200
        data = resp.json()
        assert "jobs" in data
        assert data["total_jobs"] >= 2
        assert "healthy_jobs" in data
        assert "failed_jobs" in data

    def test_job_has_required_fields(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/cron")
        data = resp.json()
        for j in data["jobs"]:
            for field in ("name", "last_status", "last_run", "healthy", "history"):
                assert field in j, f"Job missing field: {field}"

    def test_failed_job_detected(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/cron")
        data = resp.json()
        # daily-digest has 3 failures in last 10 → should be unhealthy
        digest = next(j for j in data["jobs"] if j["name"] == "daily-digest")
        assert digest["healthy"] is False, "daily-digest with 3 failures should be unhealthy"

    def test_empty_returns_empty(self, client) -> None:
        empty_store = MockCampaignStore()
        with _patch_store(empty_store):
            resp = client.get("/api/plugins/roi/cron")
        assert resp.status_code == 200
        data = resp.json()
        assert data["jobs"] == []


class TestAlertsEndpoint:
    """The /alerts endpoint must return alert history."""

    def test_returns_alerts(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/alerts")
        assert resp.status_code == 200
        data = resp.json()
        assert "alerts" in data
        assert data["total"] >= 1

    def test_alert_has_required_fields(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/alerts")
        data = resp.json()
        for a in data["alerts"]:
            for field in ("job_name", "started_at", "error_message"):
                assert field in a, f"Alert missing field: {field}"

    def test_empty_returns_empty(self, client) -> None:
        empty_store = MockCampaignStore()
        with _patch_store(empty_store):
            resp = client.get("/api/plugins/roi/alerts")
        assert resp.status_code == 200
        data = resp.json()
        assert data["alerts"] == []


# ===========================================================================
#  Plugin Module Import Test
# ===========================================================================


class TestPluginModule:
    """The plugin module must be importable and expose expected names."""

    def test_plugin_api_is_importable(self) -> None:
        import plugins.roi.dashboard.plugin_api as mod
        assert hasattr(mod, "router")
        assert hasattr(mod, "log")

    def test_plugin_init_exists(self) -> None:
        init_path = PLUGIN_DIR / "__init__.py"
        # The plugin may or may not have an __init__.py — should not error
        if init_path.exists():
            content = init_path.read_text()
            assert isinstance(content, str)


# ===========================================================================
#  Response Format Tests (all endpoints return consistent JSON envelope)
# ===========================================================================


class TestResponseFormat:
    """All endpoints should return JSON with consistent top-level structure."""

    ENDPOINTS = [
        "/api/plugins/roi/campaigns",
        "/api/plugins/roi/engagement",
        "/api/plugins/roi/funnel",
        "/api/plugins/roi/forecast",
        "/api/plugins/roi/quality-score",
        "/api/plugins/roi/cron",
        "/api/plugins/roi/alerts",
    ]

    def test_all_endpoints_return_json(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            for endpoint in self.ENDPOINTS:
                resp = client.get(endpoint)
                assert resp.status_code == 200, f"{endpoint} returned {resp.status_code}"
                assert "application/json" in resp.headers.get("content-type", ""), f"{endpoint} not JSON"

    def test_all_endpoints_have_generated_at(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            for endpoint in self.ENDPOINTS:
                resp = client.get(endpoint)
                data = resp.json()
                assert "generated_at" in data, f"{endpoint} missing generated_at"

    def test_campaign_detail_returns_json(self, client, mock_store) -> None:
        with _patch_store(mock_store):
            resp = client.get("/api/plugins/roi/campaign/camp-001")
        assert resp.status_code == 200
        assert "application/json" in resp.headers.get("content-type", "")
