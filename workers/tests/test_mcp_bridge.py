"""Tests for Syntaro MCP Bridge -- tools, resources, and REST compatibility (AIM-4477)."""

from __future__ import annotations

import pytest


class TestListIssues:
    @pytest.mark.asyncio
    async def test_list_all(self, fake_pipeline):
        fake_pipeline.add_run(
            "r1",
            status="completed",
            issue_url="https://github.com/o/r/issues/1",
            pr_url="https://github.com/o/r/pull/1",
            pr_number=1,
        )
        fake_pipeline.add_run("r2", status="queued", issue_url="https://github.com/o/r/issues/2")
        from syntaro_mcp.server import _list_issues_handler

        r = await _list_issues_handler()
        assert r["total"] == 2

    @pytest.mark.asyncio
    async def test_filter_falls_back_to_api(self, fake_pipeline, monkeypatch):
        """Empty pipeline history falls back to the SYNTARO API with the status filter (AIM-4477)."""
        from syntaro_mcp.server import _list_issues_handler

        async def fake_api(status=None, repo=None, limit=20):
            return {"runs": [{"run_id": "api-1", "status": status}]} if status else {"runs": []}

        monkeypatch.setattr("syntaro_mcp.server.list_runs_from_api", fake_api)
        r = await _list_issues_handler(status="completed")
        assert r["total"] == 1

    @pytest.mark.asyncio
    async def test_empty(self, fake_pipeline, monkeypatch):
        """No pipeline runs and an unreachable API yield an empty (but successful) list."""
        from syntaro_mcp.server import _list_issues_handler

        async def fake_api(status=None, repo=None, limit=20):
            return None

        monkeypatch.setattr("syntaro_mcp.server.list_runs_from_api", fake_api)
        assert (await _list_issues_handler())["total"] == 0


class TestSearch:
    @pytest.mark.asyncio
    async def test_query(self, fake_pipeline):
        fake_pipeline.add_run(
            "r1",
            status="completed",
            issue_url="https://github.com/o/r/issues/1",
            pr_url="https://github.com/o/r/pull/1",
            pr_number=1,
        )
        from syntaro_mcp.server import _search_codebase_handler

        r = await _search_codebase_handler(query="o/r")
        assert r["total"] >= 1

    @pytest.mark.asyncio
    async def test_empty_q(self):
        from syntaro_mcp.server import _search_codebase_handler

        assert (await _search_codebase_handler(query=""))["success"] is False


class TestIssueResource:
    @pytest.mark.asyncio
    async def test_by_url(self, fake_pipeline):
        fake_pipeline.add_run(
            "r1",
            status="completed",
            issue_url="https://github.com/o/r/issues/1",
            pr_url="https://github.com/o/r/pull/1",
            pr_number=1,
        )
        from syntaro_mcp.server import _get_issue_resource_handler

        r = await _get_issue_resource_handler("https://github.com/o/r/issues/1")
        assert r["total_runs"] == 1

    @pytest.mark.asyncio
    async def test_unknown_url(self, fake_pipeline):
        from syntaro_mcp.server import _get_issue_resource_handler

        r = await _get_issue_resource_handler("https://github.com/o/r/issues/404")
        assert r.get("total_runs", 0) == 0
        assert r["status"] == "unknown"


class TestBridge:
    @pytest.mark.asyncio
    async def test_run_fix(self, fake_pipeline):
        import syntaro_mcp.handlers as h

        r = await h.run_fix("https://github.com/o/r/issues/99")
        assert r["success"] is True
        assert r["status"] == "queued"


class TestServerReg:
    def test_tools(self):
        from syntaro_mcp.server import mcp

        names = [t.name for t in mcp._tool_manager.list_tools()]
        assert "list_issues" in names and "search_codebase" in names

    def test_resources(self):
        from syntaro_mcp.server import mcp

        uris = list(mcp._resource_manager._templates.keys())
        assert "syntaro://issues/{issue_id}" in uris
