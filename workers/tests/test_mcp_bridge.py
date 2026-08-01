"""Tests for STAS MCP Bridge — tools, resources, and REST compatibility."""

from __future__ import annotations
import os, tempfile, pytest


@pytest.fixture(autouse=True)
def iso_reg():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        p = f.name
    os.environ["STAS_FIX_REGISTRY_PATH"] = p
    import syntaro_mcp.handlers as h
    h.FIX_REGISTRY_PATH = p; h._reset_registry()
    yield p
    h._reset_registry()
    try: os.unlink(p)
    except FileNotFoundError: pass
    os.environ.pop("STAS_FIX_REGISTRY_PATH", None)


@pytest.fixture
def pop_reg():
    import syntaro_mcp.handlers as h
    h.FIX_REGISTRY_PATH = os.environ["STAS_FIX_REGISTRY_PATH"]; h._reset_registry()
    r = h._load_registry()
    r["r1"] = {"run_id": "r1", "issue_url": "https://github.com/o/r/issues/1", "owner": "o", "repo": "r", "issue_number": 1, "status": "completed", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z", "pr_url": "https://github.com/o/r/pull/1", "pr_number": 1}
    r["r2"] = {"run_id": "r2", "issue_url": "https://github.com/o/r/issues/2", "owner": "o", "repo": "r", "issue_number": 2, "status": "queued", "created_at": "2026-01-02T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"}
    h._save_registry(); return True


class TestListIssues:
    @pytest.mark.asyncio
    async def test_list_all(self, pop_reg):
        from syntaro_mcp.server import _list_issues_handler
        r = await _list_issues_handler()
        assert r["total"] == 2

    @pytest.mark.asyncio
    async def test_filter(self, pop_reg):
        from syntaro_mcp.server import _list_issues_handler
        r = await _list_issues_handler(status="completed")
        assert r["total"] == 1

    @pytest.mark.asyncio
    async def test_empty(self):
        import syntaro_mcp.handlers as h
        h.FIX_REGISTRY_PATH = os.environ["STAS_FIX_REGISTRY_PATH"]; h._reset_registry()
        from syntaro_mcp.server import _list_issues_handler
        assert (await _list_issues_handler())["total"] == 0


class TestSearch:
    @pytest.mark.asyncio
    async def test_query(self, pop_reg):
        from syntaro_mcp.server import _search_codebase_handler
        r = await _search_codebase_handler(query="o/r")
        assert r["total"] >= 1

    @pytest.mark.asyncio
    async def test_empty_q(self):
        from syntaro_mcp.server import _search_codebase_handler
        assert (await _search_codebase_handler(query=""))["success"] is False


class TestIssueResource:
    @pytest.mark.asyncio
    async def test_by_url(self, pop_reg):
        from syntaro_mcp.server import _get_issue_resource_handler
        r = await _get_issue_resource_handler("https://github.com/o/r/issues/1")
        assert r["total_runs"] == 1


class TestBridge:
    @pytest.mark.asyncio
    async def test_run_fix(self):
        import syntaro_mcp.handlers as h
        h.FIX_REGISTRY_PATH = os.environ["STAS_FIX_REGISTRY_PATH"]; h._reset_registry()
        r = await h.run_fix("https://github.com/o/r/issues/99")
        assert r["success"] is True


class TestServerReg:
    def test_tools(self):
        from syntaro_mcp.server import mcp
        names = [t.name for t in mcp._tool_manager.list_tools()]
        assert "list_issues" in names and "search_codebase" in names

    def test_resources(self):
        from syntaro_mcp.server import mcp
        uris = list(mcp._resource_manager._templates.keys())
        assert "syntaro://issues/{issue_id}" in uris
