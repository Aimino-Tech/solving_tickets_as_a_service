"""Tests for STAS MCP server -- handlers, tools, and resources (AIM-2072)."""

from __future__ import annotations

import json
import os
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ===========================================================================
# Fixtures
# ===========================================================================

@pytest.fixture(autouse=True)
def reset_registry():
    """Reset the fix registry before each test."""
    from stas_mcp.handlers import _reset_registry

    _reset_registry()
    yield
    _reset_registry()


@pytest.fixture
def temp_registry_path():
    """Use a temp file for the fix registry."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    os.environ["STAS_FIX_REGISTRY_PATH"] = path
    yield path
    os.unlink(path)
    os.environ.pop("STAS_FIX_REGISTRY_PATH", None)


# ===========================================================================
# Handler tests
# ===========================================================================

class TestLabelIssue:
    """stas_label_issue handler tests."""

    @pytest.mark.asyncio
    @patch("stas_mcp.handlers.httpx.AsyncClient")
    async def test_success(self, mock_client_cls):
        from stas_mcp.handlers import label_issue

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
    @patch("stas_mcp.handlers.httpx.AsyncClient")
    async def test_404(self, mock_client_cls):
        from stas_mcp.handlers import label_issue

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
        from stas_mcp.handlers import label_issue

        with patch.dict(os.environ, clear=True):
            result = await label_issue("owner", "repo", 1, "stas:fix")

        assert result["success"] is False
        assert result["intent_recorded"] is True

    @pytest.mark.asyncio
    async def test_missing_args(self):
        from stas_mcp.handlers import label_issue

        result = await label_issue("", "", 0, "")
        assert result["success"] is False
        assert "required" in result["error"].lower()


class TestRunFix:
    """stas_run_fix handler tests."""

    @pytest.mark.asyncio
    async def test_success(self, temp_registry_path):
        from stas_mcp.handlers import run_fix

        result = await run_fix("https://github.com/owner/repo/issues/42")

        assert result["success"] is True
        assert result["status"] == "queued"
        assert result["run_id"].startswith("stas-")
        assert result["issue_url"] == "https://github.com/owner/repo/issues/42"

    @pytest.mark.asyncio
    async def test_invalid_url(self):
        from stas_mcp.handlers import run_fix

        result = await run_fix("not-a-url")
        assert result["success"] is False
        assert "invalid" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_empty_url(self):
        from stas_mcp.handlers import run_fix

        result = await run_fix("")
        assert result["success"] is False
        assert "required" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_persistence(self, temp_registry_path):
        from stas_mcp.handlers import run_fix, check_status

        run_result = await run_fix("https://github.com/a/b/issues/7")
        run_id = run_result["run_id"]

        status = await check_status(run_id)
        assert status["success"] is True
        assert status["status"] == "queued"
        assert status["issue_url"] == "https://github.com/a/b/issues/7"

    @pytest.mark.asyncio
    async def test_enqueue_offline(self, temp_registry_path):
        from stas_mcp.handlers import run_fix

        result = await run_fix("https://github.com/owner/repo/issues/1")
        assert result["success"] is True
        assert result["status"] == "queued"


class TestCheckStatus:
    """stas_check_status handler tests."""

    @pytest.mark.asyncio
    async def test_not_found(self):
        from stas_mcp.handlers import check_status

        result = await check_status("non-existent-run")
        assert result["success"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_empty(self):
        from stas_mcp.handlers import check_status

        result = await check_status("")
        assert result["success"] is False

    @pytest.mark.asyncio
    async def test_found(self, temp_registry_path):
        from stas_mcp.handlers import check_status, run_fix

        run = await run_fix("https://github.com/x/y/issues/3")
        result = await check_status(run["run_id"])
        assert result["success"] is True
        assert result["status"] == "queued"


class TestGetPR:
    """stas_get_pr handler tests."""

    @pytest.mark.asyncio
    async def test_not_found(self):
        from stas_mcp.handlers import get_pr

        result = await get_pr("missing-run")
        assert result["success"] is False

    @pytest.mark.asyncio
    async def test_no_pr_yet(self, temp_registry_path):
        from stas_mcp.handlers import get_pr, run_fix

        run = await run_fix("https://github.com/o/r/issues/5")
        result = await get_pr(run["run_id"])
        assert result["success"] is True
        assert result["pr_url"] is None
        assert "No PR" in result["message"]


# ===========================================================================
# Server tests
# ===========================================================================

class TestFastMCPServer:
    """Tests for the FastMCP server tool and resource registration."""

    def test_server_imports(self):
        """Server module imports without error."""
        from stas_mcp.server import mcp, SERVER_NAME

        assert mcp is not None
        assert SERVER_NAME == "stas-agent-discovery"

    def test_tools_registered(self):
        """All four tools are registered with correct names."""
        from stas_mcp.server import mcp

        tool_names = [t.name for t in mcp._tool_manager.list_tools()]
        assert "stas_label_issue" in tool_names
        assert "stas_run_fix" in tool_names
        assert "stas_check_status" in tool_names
        assert "stas_get_pr" in tool_names

    def test_resource_template_registered(self):
        """Resource template is registered."""
        from stas_mcp.server import mcp

        templates = list(mcp._resource_manager._templates.keys())
        assert "stas://runs/{run_id}" in templates

    def test_resource_template_params(self):
        """Resource template has correct parameter."""
        from stas_mcp.server import mcp

        tmpl = mcp._resource_manager._templates["stas://runs/{run_id}"]
        assert tmpl.name == "Fix Run Status"
        assert "run_id" in tmpl.parameters.get("required", [])

    @pytest.mark.asyncio
    async def test_tool_listing(self):
        """list_tools() returns all four tools."""
        from stas_mcp.server import mcp

        tools = await mcp.list_tools()
        names = [t.name for t in tools]
        assert len(names) == 6
        assert "stas_label_issue" in names
        assert "stas_run_fix" in names
        assert "stas_check_status" in names
        assert "stas_get_pr" in names
        assert "list_issues" in names
        assert "search_codebase" in names

    @pytest.mark.asyncio
    async def test_resource_template_listing(self):
        """list_resource_templates() returns the run resource."""
        from stas_mcp.server import mcp

        templates = await mcp.list_resource_templates()
        uris = [t.uriTemplate for t in templates]
        assert "stas://runs/{run_id}" in uris


# ===========================================================================
# URL parsing tests
# ===========================================================================

class TestUrlParsing:
    def test_valid_github_url(self):
        from stas_mcp.handlers import _parse_github_issue_url

        result = _parse_github_issue_url("https://github.com/owner/repo/issues/123")
        assert result == {"owner": "owner", "repo": "repo", "issue_number": 123}

    def test_https_variants(self):
        from stas_mcp.handlers import _parse_github_issue_url

        assert _parse_github_issue_url("http://github.com/a/b/issues/1") is not None
        assert _parse_github_issue_url("https://github.com/a/b/issues/999")["issue_number"] == 999

    def test_invalid_urls(self):
        from stas_mcp.handlers import _parse_github_issue_url

        assert _parse_github_issue_url("") is None
        assert _parse_github_issue_url("not-a-url") is None
        assert _parse_github_issue_url("https://gitlab.com/a/b/issues/1") is None
        assert _parse_github_issue_url("https://github.com/a/b/pulls/1") is None
