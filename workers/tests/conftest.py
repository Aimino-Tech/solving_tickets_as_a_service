"""Shared test fixtures for the Syntaro MCP test suite (AIM-4477)."""

from __future__ import annotations

import pytest


class FakePipeline:
    """In-memory stand-in for PipelineClient used by MCP handler tests.

    Keeps the MCP tests hermetic: no real engine, no HTTP, no side effects.
    """

    def __init__(self):
        self.runs: dict[str, dict] = {}
        self.counter = 0

    def add_run(self, run_id, status="queued", issue_url="", pr_url=None, pr_number=None, **extra):
        run = {
            "run_id": run_id,
            "issue_url": issue_url,
            "owner": "",
            "repo": "",
            "issue_number": 0,
            "status": status,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        if pr_url:
            run["pr_url"] = pr_url
        if pr_number:
            run["pr_number"] = pr_number
        run.update(extra)
        self.runs[run_id] = run
        return run

    def submit_fix(self, owner, repo, issue_number, issue_url="", pipeline_name="stas:fix"):
        self.counter += 1
        run_id = f"stas-fake{self.counter:03d}"
        self.runs[run_id] = {
            "run_id": run_id,
            "pipeline_id": f"pl-{run_id}",
            "issue_id": issue_number,
            "issue_url": issue_url,
            "owner": owner,
            "repo": repo,
            "issue_number": issue_number,
            "status": "queued",
            "created_at": "2026-01-01T00:00:00Z",
            "success": True,
        }
        return dict(self.runs[run_id])

    def check_status(self, issue_id_or_run_id):
        run = self.runs.get(issue_id_or_run_id) or next(
            (r for r in self.runs.values() if r.get("issue_url") == issue_id_or_run_id),
            None,
        )
        if run is None:
            return {"success": False, "error": "Pipeline engine unavailable"}
        return {
            "success": True,
            "run_id": run["run_id"],
            "issue_id": run.get("issue_id"),
            "status": run["status"],
            "current_stage": run["status"],
            "progress": 1.0 if run["status"] == "completed" else 0.0,
            "pipeline_id": run.get("pipeline_id", ""),
            "issue_url": run.get("issue_url", ""),
            "pr_url": run.get("pr_url"),
            "pr_number": run.get("pr_number"),
            "error": None,
        }

    def get_events(self, issue_id, limit=20):
        return {"success": True, "events": []}

    def cancel_fix(self, issue_id):
        return {"success": True}

    def get_run_history(self, repo=None, limit=10):
        runs = [r for r in self.runs.values() if not repo or repo in r.get("issue_url", "")]
        return {"success": True, "runs": runs[:limit], "total": len(runs)}


@pytest.fixture
def fake_pipeline(monkeypatch):
    """Patch the pipeline singleton in both handlers and the MCP server."""
    fake = FakePipeline()
    monkeypatch.setattr("syntaro_mcp.handlers._pipeline", fake)
    monkeypatch.setattr("syntaro_mcp.server.get_client", lambda: fake)
    return fake
