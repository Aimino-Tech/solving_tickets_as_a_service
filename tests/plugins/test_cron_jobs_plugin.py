"""Tests for the GET /cron-jobs endpoint in the monitoring dashboard plugin.

The endpoint reads from the cron_job_log table in CampaignStore and returns
a status summary grouped by job_name.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_plugin_router():
    """Dynamically load plugins/monitoring/dashboard/plugin_api.py and return its router."""
    repo_root = Path(__file__).resolve().parents[2]
    plugin_file = repo_root / "plugins" / "monitoring" / "dashboard" / "plugin_api.py"
    assert plugin_file.exists(), f"plugin file missing: {plugin_file}"

    spec = importlib.util.spec_from_file_location(
        "hermes_dashboard_plugin_monitoring_test", plugin_file,
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.router


@pytest.fixture
def client():
    """FastAPI TestClient with the monitoring dashboard router."""
    app = FastAPI()
    app.include_router(_load_plugin_router(), prefix="/api/plugins/monitoring")
    return TestClient(app)


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

_SAMPLE_ROWS = [
    # sheet-sync: 5 entries, all completed
    {"job_name": "sheet-sync", "status": "completed", "started_at": "2026-06-16T10:00:00", "duration_ms": 1200, "result_summary": "Sync completed: 42 actions synced", "error_message": None},
    {"job_name": "sheet-sync", "status": "completed", "started_at": "2026-06-16T09:00:00", "duration_ms": 1100, "result_summary": "Sync completed: 38 actions synced", "error_message": None},
    {"job_name": "sheet-sync", "status": "completed", "started_at": "2026-06-16T08:00:00", "duration_ms": 1300, "result_summary": "Sync completed: 50 actions synced", "error_message": None},
    {"job_name": "sheet-sync", "status": "completed", "started_at": "2026-06-16T07:00:00", "duration_ms": 1050, "result_summary": "Sync completed: 30 actions synced", "error_message": None},
    {"job_name": "sheet-sync", "status": "completed", "started_at": "2026-06-16T06:00:00", "duration_ms": 1400, "result_summary": "Sync completed: 45 actions synced", "error_message": None},
    # metric-poller: healthy (completed with 1 failure, but not >2)
    {"job_name": "metric-poller", "status": "completed", "started_at": "2026-06-16T10:05:00", "duration_ms": 800, "result_summary": "Pulled metrics for 3 campaigns", "error_message": None},
    {"job_name": "metric-poller", "status": "failed", "started_at": "2026-06-16T09:05:00", "duration_ms": 5000, "result_summary": None, "error_message": "Rate limited by GitHub API"},
    {"job_name": "metric-poller", "status": "completed", "started_at": "2026-06-16T08:05:00", "duration_ms": 750, "result_summary": "Pulled metrics for 3 campaigns", "error_message": None},
    # report-gen: unhealthy — last status failed + 3 failures in last 10
    {"job_name": "report-gen", "status": "failed", "started_at": "2026-06-16T10:10:00", "duration_ms": 30000, "result_summary": None, "error_message": "Out of memory"},
    {"job_name": "report-gen", "status": "failed", "started_at": "2026-06-16T09:10:00", "duration_ms": 28000, "result_summary": None, "error_message": "Out of memory"},
    {"job_name": "report-gen", "status": "failed", "started_at": "2026-06-16T08:10:00", "duration_ms": 31000, "result_summary": None, "error_message": "Out of memory"},
    {"job_name": "report-gen", "status": "failed", "started_at": "2026-06-16T07:10:00", "duration_ms": 29000, "result_summary": None, "error_message": "Timeout"},
]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_cron_jobs_returns_correct_shape(client, monkeypatch):
    """Endpoint returns the expected JSON structure with grouped jobs."""
    import marketing.store as ms
    monkeypatch.setattr(ms.CampaignStore, "get_cron_job_log", lambda self, **kw: _SAMPLE_ROWS)

    r = client.get("/api/plugins/monitoring/cron-jobs")
    assert r.status_code == 200
    data = r.json()

    # Top-level keys
    assert "jobs" in data
    assert "total_jobs" in data
    assert "healthy_jobs" in data
    assert "failed_jobs" in data
    assert "generated_at" in data

    # All 3 jobs present
    assert data["total_jobs"] == 3
    assert len(data["jobs"]) == 3

    # Job entries have the expected fields
    for job in data["jobs"]:
        assert "name" in job
        assert "last_status" in job
        assert "last_run" in job
        assert "last_duration_ms" in job
        assert "last_result" in job
        assert "last_error" in job
        assert "history" in job


def test_cron_jobs_sheet_sync_details(client, monkeypatch):
    """sheet-sync job should show completed status with correct history."""
    import marketing.store as ms
    monkeypatch.setattr(ms.CampaignStore, "get_cron_job_log", lambda self, **kw: _SAMPLE_ROWS)

    r = client.get("/api/plugins/monitoring/cron-jobs")
    data = r.json()

    sheet = next(j for j in data["jobs"] if j["name"] == "sheet-sync")
    assert sheet["last_status"] == "completed"
    assert sheet["last_run"] == "2026-06-16T10:00:00"
    assert sheet["last_duration_ms"] == 1200
    assert sheet["last_result"] == "Sync completed: 42 actions synced"
    assert sheet["last_error"] is None
    # History should contain 5 entries (all 5 sheet-sync entries)
    assert len(sheet["history"]) == 5
    assert all(h["status"] == "completed" for h in sheet["history"])


def test_cron_jobs_unhealthy_job(client, monkeypatch):
    """report-gen with last=failed + 3 failures should be marked unhealthy."""
    import marketing.store as ms
    monkeypatch.setattr(ms.CampaignStore, "get_cron_job_log", lambda self, **kw: _SAMPLE_ROWS)

    r = client.get("/api/plugins/monitoring/cron-jobs")
    data = r.json()

    report = next(j for j in data["jobs"] if j["name"] == "report-gen")
    assert report["last_status"] == "failed"
    assert report["last_error"] == "Out of memory"
    assert len(report["history"]) == 4
    assert all(h["status"] == "failed" for h in report["history"])

    # report-gen is the only unhealthy job (4 failures > 2)
    assert data["healthy_jobs"] == 2  # sheet-sync + metric-poller
    assert data["failed_jobs"] == 1   # report-gen


def test_cron_jobs_healthy_despite_one_failure(client, monkeypatch):
    """metric-poller has a single failure; should still be healthy."""
    import marketing.store as ms
    monkeypatch.setattr(ms.CampaignStore, "get_cron_job_log", lambda self, **kw: _SAMPLE_ROWS)

    r = client.get("/api/plugins/monitoring/cron-jobs")
    data = r.json()

    poller = next(j for j in data["jobs"] if j["name"] == "metric-poller")
    assert poller["last_status"] == "completed"
    assert poller["last_error"] is None
    # One failure in history
    failures = [h for h in poller["history"] if h["status"] == "failed"]
    assert len(failures) == 1
    assert failures[0]["duration_ms"] == 5000


def test_cron_jobs_empty_db(client, monkeypatch):
    """Empty database returns empty summary with zero counts."""
    import marketing.store as ms
    monkeypatch.setattr(ms.CampaignStore, "get_cron_job_log", lambda self, **kw: [])

    r = client.get("/api/plugins/monitoring/cron-jobs")
    assert r.status_code == 200
    data = r.json()

    assert data["jobs"] == []
    assert data["total_jobs"] == 0
    assert data["healthy_jobs"] == 0
    assert data["failed_jobs"] == 0
    # generated_at should be a valid ISO timestamp
    assert isinstance(data["generated_at"], str)
    assert len(data["generated_at"]) > 10


def test_cron_jobs_store_unavailable(client, monkeypatch):
    """When CampaignStore fails, return empty summary (not a 500)."""
    import marketing.store as ms
    monkeypatch.setattr(ms.CampaignStore, "get_cron_job_log", lambda self, **kw: (_ for _ in ()).throw(RuntimeError("DB unavailable")))

    r = client.get("/api/plugins/monitoring/cron-jobs")
    assert r.status_code == 200
    data = r.json()

    assert data["jobs"] == []
    assert data["total_jobs"] == 0
    assert data["healthy_jobs"] == 0
    assert data["failed_jobs"] == 0
    assert isinstance(data["generated_at"], str)


def test_cron_jobs_import_error_returns_empty(client, monkeypatch):
    """When marketing.store cannot be imported, return empty summary."""
    import builtins
    real_import = builtins.__import__

    def _block_marketing_store(name, *args, **kwargs):
        if name == "marketing.store":
            raise ImportError("marketing module not available")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _block_marketing_store)

    r = client.get("/api/plugins/monitoring/cron-jobs")
    assert r.status_code == 200
    data = r.json()

    assert data["jobs"] == []
    assert data["total_jobs"] == 0


def test_cron_jobs_history_limited_to_10(client, monkeypatch):
    """History for a job should be capped at the last 10 entries."""
    # get_cron_job_log returns newest first (ORDER BY id DESC), so
    # we construct rows with i descending (newest = highest i first).
    rows = []
    for i in range(14, -1, -1):
        rows.append({
            "job_name": "frequent-job",
            "status": "completed",
            "started_at": f"2026-06-16T{i:02d}:00:00",
            "duration_ms": 100 + i,
            "result_summary": f"run {i}",
            "error_message": None,
        })

    import marketing.store as ms
    monkeypatch.setattr(ms.CampaignStore, "get_cron_job_log", lambda self, **kw: rows)

    r = client.get("/api/plugins/monitoring/cron-jobs")
    data = r.json()

    freq = next(j for j in data["jobs"] if j["name"] == "frequent-job")
    assert len(freq["history"]) == 10
    # Most recent entries first (i=14 is newest, i=5 is the 10th)
    assert freq["history"][0]["started_at"] == "2026-06-16T14:00:00"
    assert freq["history"][-1]["started_at"] == "2026-06-16T05:00:00"


def test_cron_jobs_multiple_jobs_all_healthy(client, monkeypatch):
    """All jobs completed successfully — healthy_jobs == total_jobs."""
    rows = [
        {"job_name": "job-a", "status": "completed", "started_at": "2026-06-16T12:00:00", "duration_ms": 500, "result_summary": "ok", "error_message": None},
        {"job_name": "job-b", "status": "completed", "started_at": "2026-06-16T12:00:00", "duration_ms": 300, "result_summary": "ok", "error_message": None},
    ]

    import marketing.store as ms
    monkeypatch.setattr(ms.CampaignStore, "get_cron_job_log", lambda self, **kw: rows)

    r = client.get("/api/plugins/monitoring/cron-jobs")
    data = r.json()

    assert data["total_jobs"] == 2
    assert data["healthy_jobs"] == 2
    assert data["failed_jobs"] == 0
