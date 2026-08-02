"""Tests for Syntaro MCP server -- handlers, tools, and resources (AIM-2072, AIM-4477)."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ===========================================================================
# Handler tests
# ===========================================================================

class TestLabelIssue:
    """syntaro_label_issue handler tests."""

    @pytest.mark.asyncio
    @patch("syntaro_mcp.handlers.httpx.AsyncClient")
    async def test_success(self, mock_client_cls):
        from syntaro_mcp.handlers import label_issue

        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.post.return_value = mock_response

        with patch.dict(os.environ, {"GITHUB_TOKEN": "test-token"}, clear=False):
            result = await label_issue("test-owner", "test-repo", 42, "stas:fix")

        assert result["success"] is True
        assert result["owner"] == "test-owner"
        assert result["repo"] == "test-repo"
        assert result["issue_number"] == 42
        assert result["label"] == "stas:fix"
        assert "applied" in result["message"].lower()

    @pytest.mark.asyncio
    @patch("syntaro_mcp.handlers.httpx.AsyncClient")
    async def test_404(self, mock_client_cls):
        from syntaro_mcp.handlers import label_issue

        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_client.post.return_value = mock_response

        with patch.dict(os.environ, {"GITHUB_TOKEN": "test-token"}, clear=False):
            result = await label_issue("bad-owner", "bad-repo", 999, "stas:fix")

        assert result["success"] is False
        assert "not found" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_no_token(self):
        from syntaro_mcp.handlers import label_issue

        with patch.dict(os.environ, clear=True):
            result = await label_issue("owner", "repo", 1, "stas:fix")

        assert result["success"] is False
        assert result["intent_recorded"] is True

    @pytest.mark.asyncio
    async def test_missing_args(self):
        from syntaro_mcp.handlers import label_issue

        result = await label_issue("", "", 0, "")
        assert result["success"] is False
        assert "required" in result["error"].lower()


class TestRunFix:
    """syntaro_run_fix handler tests."""

    @pytest.mark.asyncio
    async def test_success(self, fake_pipeline):
        from syntaro_mcp.handlers import run_fix

        result = await run_fix("https://github.com/owner/repo/issues/42")

        assert result["success"] is True
        assert result["status"] == "queued"
        assert result["run_id"].startswith("stas-fake")
        assert result["issue_url"] == "https://github.com/owner/repo/issues/42"

    @pytest.mark.asyncio
    async def test_invalid_url(self):
        from syntaro_mcp.handlers import run_fix

        result = await run_fix("not-a-url")
        assert result["success"] is False
        assert "invalid" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_empty_url(self):
        from syntaro_mcp.handlers import run_fix

        result = await run_fix("")
        assert result["success"] is False
        assert "required" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_offline_reports_unavailable(self, monkeypatch):
        """Without a pipeline engine or API URL, run_fix reports unavailable (AIM-4477)."""
        from syntaro_mcp.handlers import run_fix

        class OfflinePipeline:
            def submit_fix(self, **kwargs):
                return {
                    "success": False,
                    "run_id": "stas-offline",
                    "status": "unavailable",
                    "error": "No pipeline engine or API URL configured",
                }

        monkeypatch.setattr("syntaro_mcp.handlers._pipeline", OfflinePipeline())
        result = await run_fix("https://github.com/owner/repo/issues/1")
        assert result["success"] is False
        assert result["status"] == "unavailable"

    @pytest.mark.asyncio
    async def test_api_fallback(self, monkeypatch):
        """When the pipeline client fails, run_fix falls back to the STAS API (AIM-4477)."""
        from syntaro_mcp.handlers import run_fix

        class FailingPipeline:
            def submit_fix(self, **kwargs):
                return {"success": False, "error": "engine down"}

        monkeypatch.setattr("syntaro_mcp.handlers._pipeline", FailingPipeline())

        async def fake_api(method, path, json_body=None):
            assert method == "POST"
            assert path == "/mcp/submit_issue"
            return {"runId": "api-run-1"}

        monkeypatch.setattr("syntaro_mcp.handlers._call_api", fake_api)
        result = await run_fix("https://github.com/owner/repo/issues/42")
        assert result["success"] is True
        assert result["run_id"] == "api-run-1"
        assert result["status"] == "queued"


class TestCheckStatus:
    """syntaro_check_status handler tests."""

    @pytest.mark.asyncio
    async def test_not_found(self, fake_pipeline):
        from syntaro_mcp.handlers import check_status

        result = await check_status("non-existent-run")
        assert result["success"] is False
        assert "unavailable" in result["error"]

    @pytest.mark.asyncio
    async def test_empty(self):
        from syntaro_mcp.handlers import check_status

        result = await check_status("")
        assert result["success"] is False
        assert "required" in result["error"]

    @pytest.mark.asyncio
    async def test_found(self, fake_pipeline):
        from syntaro_mcp.handlers import check_status, run_fix

        run = await run_fix("https://github.com/x/y/issues/3")
        result = await check_status(run["run_id"])
        assert result["success"] is True
        assert result["status"] == "queued"


class TestGetPR:
    """syntaro_get_pr handler tests."""

    @pytest.mark.asyncio
    async def test_not_found(self, fake_pipeline):
        """Unknown run: no PR yet, not an error."""
        from syntaro_mcp.handlers import get_pr

        result = await get_pr("missing-run")
        assert result["success"] is True
        assert result["pr_url"] is None
        assert "No PR" in result["message"]

    @pytest.mark.asyncio
    async def test_no_pr_yet(self, fake_pipeline):
        from syntaro_mcp.handlers import get_pr, run_fix

        run = await run_fix("https://github.com/o/r/issues/5")
        result = await get_pr(run["run_id"])
        assert result["success"] is True
        assert result["pr_url"] is None
        assert "No PR" in result["message"]

    @pytest.mark.asyncio
    async def test_with_pr(self, fake_pipeline):
        from syntaro_mcp.handlers import get_pr

        fake_pipeline.add_run(
            "r1",
            status="completed",
            issue_url="https://github.com/o/r/issues/9",
            pr_url="https://github.com/o/r/pull/9",
            pr_number=9,
        )
        result = await get_pr("r1")
        assert result["success"] is True
        assert result["pr_url"] == "https://github.com/o/r/pull/9"
        assert result["pr_number"] == 9


# ===========================================================================
# Server tests
# ===========================================================================

class TestFastMCPServer:
    """Tests for the FastMCP server tool and resource registration."""

    def test_server_imports(self):
        """Server module imports without error."""
        from syntaro_mcp.server import mcp, SERVER_NAME

        assert mcp is not None
        assert SERVER_NAME == "syntaro-agent-discovery"

    def test_tools_registered(self):
        """Fix-pipeline tools are registered with correct names."""
        from syntaro_mcp.server import mcp

        tool_names = [t.name for t in mcp._tool_manager.list_tools()]
        assert "syntaro_label_issue" in tool_names
        assert "syntaro_run_fix" in tool_names
        assert "syntaro_check_status" in tool_names
        assert "syntaro_get_pr" in tool_names

    def test_resource_template_registered(self):
        """Resource template is registered."""
        from syntaro_mcp.server import mcp

        templates = list(mcp._resource_manager._templates.keys())
        assert "syntaro://runs/{run_id}" in templates

    def test_resource_template_params(self):
        """Resource template has correct parameter."""
        from syntaro_mcp.server import mcp

        tmpl = mcp._resource_manager._templates["syntaro://runs/{run_id}"]
        assert tmpl.name == "Fix Run Status"
        assert "run_id" in tmpl.parameters.get("required", [])

    @pytest.mark.asyncio
    async def test_tool_listing(self):
        """list_tools() returns all 12 tools (AIM-4477)."""
        from syntaro_mcp.server import mcp

        tools = await mcp.list_tools()
        names = [t.name for t in tools]
        assert len(names) == 12
        for expected in (
            "syntaro_label_issue",
            "syntaro_run_fix",
            "syntaro_check_status",
            "syntaro_get_pr",
            "list_issues",
            "search_codebase",
            "linear_ticket",
            "linear_create_ticket",
            "memory_read",
            "memory_write",
            "slack_send",
            "session_resume",
        ):
            assert expected in names

    @pytest.mark.asyncio
    async def test_resource_template_listing(self):
        """list_resource_templates() returns the run resource."""
        from syntaro_mcp.server import mcp

        templates = await mcp.list_resource_templates()
        uris = [t.uriTemplate for t in templates]
        assert "syntaro://runs/{run_id}" in uris


# ===========================================================================
# URL parsing tests
# ===========================================================================

class TestUrlParsing:
    def test_valid_github_url(self):
        from syntaro_mcp.handlers import _parse_github_issue_url

        result = _parse_github_issue_url("https://github.com/owner/repo/issues/123")
        assert result == {"owner": "owner", "repo": "repo", "issue_number": 123}

    def test_https_variants(self):
        from syntaro_mcp.handlers import _parse_github_issue_url

        assert _parse_github_issue_url("http://github.com/a/b/issues/1") is not None
        assert _parse_github_issue_url("https://github.com/a/b/issues/999")["issue_number"] == 999

    def test_invalid_urls(self):
        from syntaro_mcp.handlers import _parse_github_issue_url

        assert _parse_github_issue_url("") is None
        assert _parse_github_issue_url("not-a-url") is None
        assert _parse_github_issue_url("https://gitlab.com/a/b/issues/1") is None
        assert _parse_github_issue_url("https://github.com/a/b/pulls/1") is None
