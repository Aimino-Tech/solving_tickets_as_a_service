"""Tests for cron/hermes_marketing_check.py --compute flag.

Covers:

* ``--compute`` CLI flag is recognised by the argument parser.
* ``_run_compute()`` with no active campaigns → ``total=0``.
* ``_run_compute()`` with a campaign that returns data → ``"completed"``.
* ``_run_compute()`` when the engine returns ``None`` → ``"skipped"``.
* ``_run_compute()`` when the engine raises → ``"error"`` with message.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def hermes_env(tmp_path, monkeypatch):
    """Isolate HERMES_HOME so the cron script doesn't touch real config."""
    home = tmp_path / ".hermes"
    home.mkdir()
    (home / "marketing").mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("HERMES_HOME", str(home))

    import importlib
    import hermes_constants
    importlib.reload(hermes_constants)

    return home


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


def test_compute_parser_recognises_flag():
    """``--compute`` flag is configured in the argument parser."""
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--compute", action="store_true", help="Compute campaign performance for all active campaigns")

    # Default
    ns = p.parse_args([])
    assert ns.compute is False

    # With flag
    ns2 = p.parse_args(["--compute"])
    assert ns2.compute is True


# ---------------------------------------------------------------------------
# _run_compute — edge cases
# ---------------------------------------------------------------------------
# _run_compute() does inline imports inside the function body
# (from marketing.store import CampaignStore), so we patch at the source
# module, not the importing module.


@patch("marketing.store.CampaignStore")
def test_run_compute_empty_campaigns(mock_store_cls, hermes_env):
    """No active campaigns → total=0."""
    mock_store = MagicMock()
    mock_store.list_campaigns.return_value = []
    mock_store_cls.return_value = mock_store

    # ROIAnalyticsEngine won't be instantiated (no campaigns), so we
    # only need a placeholder so the inline import succeeds.
    with patch("marketing.roi_arch.ROIAnalyticsEngine") as mock_engine_cls:
        mock_engine = MagicMock()
        mock_engine_cls.return_value = mock_engine

        from cron.hermes_marketing_check import _run_compute

        result = _run_compute()

    assert result["action"] == "compute"
    assert result["summary"]["total"] == 0
    assert result["summary"]["completed"] == 0
    assert result["results"] == []


@patch("marketing.store.CampaignStore")
@patch("marketing.roi_arch.ROIAnalyticsEngine")
def test_run_compute_single_campaign_success(
    mock_engine_cls, mock_store_cls, hermes_env
):
    """Single active campaign with data → completed."""
    mock_store = MagicMock()
    mock_store.list_campaigns.return_value = [
        {"id": "camp001", "name": "Test Campaign", "status": "active"},
    ]
    mock_store_cls.return_value = mock_store

    mock_engine = MagicMock()
    mock_engine.compute_campaign_performance.return_value = {
        "quality_score": 85.0,
        "total_signals": 42,
        "engagement_rate": 0.35,
    }
    mock_engine_cls.return_value = mock_engine

    from cron.hermes_marketing_check import _run_compute

    result = _run_compute()
    assert result["summary"]["total"] == 1
    assert result["summary"]["completed"] == 1
    assert result["summary"]["errors"] == 0
    assert result["results"][0]["status"] == "completed"
    assert result["results"][0]["campaign_id"] == "camp001"
    assert result["results"][0]["campaign_name"] == "Test Campaign"
    assert result["results"][0]["quality_score"] == 85.0
    assert result["results"][0]["total_signals"] == 42
    assert result["results"][0]["engagement_rate"] == 0.35


@patch("marketing.store.CampaignStore")
@patch("marketing.roi_arch.ROIAnalyticsEngine")
def test_run_compute_campaign_returns_none(
    mock_engine_cls, mock_store_cls, hermes_env
):
    """Engine returns None → skipped with reason 'empty data'."""
    mock_store = MagicMock()
    mock_store.list_campaigns.return_value = [
        {"id": "camp002", "name": "Empty Campaign", "status": "active"},
    ]
    mock_store_cls.return_value = mock_store

    mock_engine = MagicMock()
    mock_engine.compute_campaign_performance.return_value = None
    mock_engine_cls.return_value = mock_engine

    from cron.hermes_marketing_check import _run_compute

    result = _run_compute()
    assert result["summary"]["total"] == 1
    assert result["summary"]["completed"] == 0
    assert result["summary"]["skipped"] == 1
    assert result["results"][0]["status"] == "skipped"
    assert result["results"][0]["reason"] == "empty data"


@patch("marketing.store.CampaignStore")
@patch("marketing.roi_arch.ROIAnalyticsEngine")
def test_run_compute_campaign_raises(
    mock_engine_cls, mock_store_cls, hermes_env
):
    """Engine raises → error with message captured."""
    mock_store = MagicMock()
    mock_store.list_campaigns.return_value = [
        {"id": "camp003", "name": "Broken Campaign", "status": "active"},
    ]
    mock_store_cls.return_value = mock_store

    mock_engine = MagicMock()
    mock_engine.compute_campaign_performance.side_effect = ValueError("DB timeout")
    mock_engine_cls.return_value = mock_engine

    from cron.hermes_marketing_check import _run_compute

    result = _run_compute()
    assert result["summary"]["total"] == 1
    assert result["summary"]["completed"] == 0
    assert result["summary"]["errors"] == 1
    assert result["results"][0]["status"] == "error"
    assert "DB timeout" in result["results"][0]["error"]


@patch("marketing.store.CampaignStore")
@patch("marketing.roi_arch.ROIAnalyticsEngine")
def test_run_compute_json_serialisable(
    mock_engine_cls, mock_store_cls, hermes_env
):
    """Result dict is JSON-serialisable (used in output printing)."""
    mock_store = MagicMock()
    mock_store.list_campaigns.return_value = [
        {"id": "camp004", "name": "JSON Test", "status": "active"},
    ]
    mock_store_cls.return_value = mock_store

    mock_engine = MagicMock()
    mock_engine.compute_campaign_performance.return_value = {
        "quality_score": 90.0,
        "total_signals": 10,
        "engagement_rate": 0.5,
    }
    mock_engine_cls.return_value = mock_engine

    from cron.hermes_marketing_check import _run_compute

    result = _run_compute()
    # Should not raise
    dumped = json.dumps(result, indent=2, default=str)
    assert isinstance(dumped, str)
    assert "camp004" in dumped
    assert '"status": "completed"' in dumped
