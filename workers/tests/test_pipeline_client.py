"""Tests for PipelineClient.get_run_history (AIM-4477)."""

from __future__ import annotations

from workers.pipeline_client import PipelineClient


def test_offline_returns_empty_runs():
    """No engine and no API URL -> graceful unavailable result with 'runs' key."""
    client = PipelineClient()
    client._api_url = ""
    result = client.get_run_history()
    assert result == {"success": False, "runs": [], "error": "Pipeline engine unavailable"}


def test_http_path(monkeypatch):
    """API URL configured -> delegate to _http_call with keyword args."""
    client = PipelineClient()
    client._api_url = "http://engine:8080"
    captured = {}

    def fake_http_call(method, *args, **kwargs):
        captured["method"] = method
        captured["kwargs"] = kwargs
        return {"success": True, "runs": [{"run_id": "r1"}], "total": 1}

    monkeypatch.setattr(client, "_http_call", fake_http_call)
    result = client.get_run_history(repo="o/r", limit=5)

    assert result["success"] is True
    assert captured["method"] == "get_run_history"
    assert captured["kwargs"] == {"repo": "o/r", "limit": 5}


def test_engine_path_list_result(monkeypatch):
    """Engine exposing get_run_history returning a bare list."""
    client = PipelineClient()
    client._api_url = ""

    class FakeEngine:
        def get_run_history(self, repo=None, limit=10):
            return [{"run_id": "r1"}]

    monkeypatch.setattr(client, "_get_engine", lambda: FakeEngine())
    result = client.get_run_history(limit=5)
    assert result == {"success": True, "runs": [{"run_id": "r1"}], "total": 1}


def test_engine_path_dict_result(monkeypatch):
    """Engine exposing get_run_history returning a dict with 'runs'."""
    client = PipelineClient()
    client._api_url = ""

    class FakeEngine:
        def get_run_history(self, repo=None, limit=10):
            return {"runs": [{"run_id": "r1"}, {"run_id": "r2"}], "total": 2}

    monkeypatch.setattr(client, "_get_engine", lambda: FakeEngine())
    result = client.get_run_history()
    assert result["success"] is True
    assert result["total"] == 2


def test_engine_error_is_caught(monkeypatch):
    """Engine raising -> surfaced as an error dict, never an exception."""
    client = PipelineClient()
    client._api_url = ""

    class BoomEngine:
        def get_run_history(self, repo=None, limit=10):
            raise RuntimeError("boom")

    monkeypatch.setattr(client, "_get_engine", lambda: BoomEngine())
    result = client.get_run_history()
    assert result["success"] is False
    assert "boom" in result["error"]
