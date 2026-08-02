"""Tests for the viral agent-facing handlers: Linear, memory, Slack, session (AIM-4477)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestLinearTicket:
    """linear_ticket -- check whether a Linear ticket exists."""

    @pytest.mark.asyncio
    async def test_exists(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        async def fake_query(query, variables):
            assert variables == {"teamKey": "AIM", "number": 4477}
            return {
                "success": True,
                "data": {
                    "issues": {
                        "nodes": [
                            {
                                "id": "abc",
                                "identifier": "AIM-4477",
                                "title": "MCP server",
                                "url": "https://linear.app/aimino/issue/AIM-4477",
                                "state": {"name": "Backlog"},
                                "description": "Build it",
                            }
                        ]
                    }
                },
            }

        monkeypatch.setattr(ah, "_linear_query", fake_query)
        result = await ah.linear_ticket("AIM-4477")

        assert result["success"] is True
        assert result["exists"] is True
        assert result["identifier"] == "AIM-4477"
        assert result["title"] == "MCP server"
        assert result["state"] == "Backlog"

    @pytest.mark.asyncio
    async def test_not_exists(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        async def fake_query(query, variables):
            return {"success": True, "data": {"issues": {"nodes": []}}}

        monkeypatch.setattr(ah, "_linear_query", fake_query)
        result = await ah.linear_ticket("AIM-9999")

        assert result["success"] is True
        assert result["exists"] is False
        assert "does not exist" in result["message"]

    @pytest.mark.asyncio
    async def test_invalid_identifier(self):
        from syntaro_mcp import agent_handlers as ah

        result = await ah.linear_ticket("AIM4477")
        assert result["success"] is False
        assert "invalid linear identifier" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_empty_identifier(self):
        from syntaro_mcp import agent_handlers as ah

        result = await ah.linear_ticket("")
        assert result["success"] is False
        assert "required" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_no_api_key(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "LINEAR_API_KEY", "")
        result = await ah.linear_ticket("AIM-4477")
        assert result["success"] is False
        assert "not configured" in result["error"].lower()


class TestLinearQuery:
    """_linear_query -- raw GraphQL transport (Bearer regression)."""

    @pytest.mark.asyncio
    async def test_bearer_regression(self, monkeypatch):
        """Authorization must be the raw API key, never 'Bearer <key>' (AIM-4477)."""
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "LINEAR_API_KEY", "lin-key-123")

        mock_client = AsyncMock()
        resp = MagicMock()
        resp.status_code = 200
        resp.text = ""
        resp.json.return_value = {"data": {}}
        mock_client.post.return_value = resp

        with patch("syntaro_mcp.agent_handlers.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client
            result = await ah._linear_query("query { viewer { id } }", {})

        assert result["success"] is True
        headers = mock_client.post.call_args.kwargs["headers"]
        assert headers["Authorization"] == "lin-key-123"
        assert not headers["Authorization"].startswith("Bearer")

    @pytest.mark.asyncio
    async def test_no_key(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "LINEAR_API_KEY", "")
        result = await ah._linear_query("query { viewer { id } }", {})
        assert result["success"] is False
        assert "not configured" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_http_error(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "LINEAR_API_KEY", "lin-key-123")
        mock_client = AsyncMock()
        resp = MagicMock()
        resp.status_code = 401
        resp.text = "unauthorized"
        mock_client.post.return_value = resp

        with patch("syntaro_mcp.agent_handlers.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client
            result = await ah._linear_query("query { viewer { id } }", {})

        assert result["success"] is False
        assert "401" in result["error"]

    @pytest.mark.asyncio
    async def test_graphql_errors(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "LINEAR_API_KEY", "lin-key-123")
        mock_client = AsyncMock()
        resp = MagicMock()
        resp.status_code = 200
        resp.text = ""
        resp.json.return_value = {"errors": [{"message": "boom"}]}
        mock_client.post.return_value = resp

        with patch("syntaro_mcp.agent_handlers.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client
            result = await ah._linear_query("query { viewer { id } }", {})

        assert result["success"] is False
        assert "boom" in result["error"]


class TestLinearCreateTicket:
    """linear_create_ticket -- create a Linear ticket, team resolved by key."""

    @pytest.mark.asyncio
    async def test_success(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        async def fake_query(query, variables):
            assert "issueCreate" in query
            assert variables["teamId"] == "team-1"
            assert variables["title"] == "Test title"
            return {
                "success": True,
                "data": {
                    "issueCreate": {
                        "issue": {"id": "iss-1", "identifier": "AIM-5000"}
                    }
                },
            }

        async def fake_resolve(team_key=None):
            return "team-1"

        monkeypatch.setattr(ah, "_resolve_team_id", fake_resolve)
        monkeypatch.setattr(ah, "_linear_query", fake_query)
        result = await ah.linear_create_ticket("Test title")

        assert result["success"] is True
        assert result["issue"]["identifier"] == "AIM-5000"

    @pytest.mark.asyncio
    async def test_missing_title(self):
        from syntaro_mcp import agent_handlers as ah

        result = await ah.linear_create_ticket("")
        assert result["success"] is False
        assert "required" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_no_team(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        async def fake_resolve(team_key=None):
            return None

        monkeypatch.setattr(ah, "_resolve_team_id", fake_resolve)
        result = await ah.linear_create_ticket("Test title")
        assert result["success"] is False
        assert "team" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_resolve_team_by_key(self, monkeypatch):
        """Team is resolved by key (case-insensitive), defaulting to the first team."""
        from syntaro_mcp import agent_handlers as ah

        async def fake_query(query, variables):
            return {
                "success": True,
                "data": {
                    "teams": {
                        "nodes": [
                            {"id": "t1", "key": "AIM", "name": "Aimino"},
                            {"id": "t2", "key": "STAS", "name": "STAS"},
                        ]
                    }
                },
            }

        monkeypatch.setattr(ah, "_linear_query", fake_query)
        assert await ah._resolve_team_id("stas") == "t2"
        assert await ah._resolve_team_id("STAS") == "t2"
        assert await ah._resolve_team_id("nope") == "t1"
        assert await ah._resolve_team_id(None) == "t1"


class TestMemory:
    """memory_read / memory_write -- per-agent markdown memory files."""

    def test_round_trip(self, monkeypatch, tmp_path):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "MEMORY_DIR", str(tmp_path))
        written = ah.memory_write("notes", "hello world")
        assert written["success"] is True
        assert written["bytes"] == len("hello world")

        read = ah.memory_read("notes")
        assert read["success"] is True
        assert read["content"] == "hello world"
        assert str(tmp_path / "notes.md") == read["path"]

    def test_read_missing(self, monkeypatch, tmp_path):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "MEMORY_DIR", str(tmp_path))
        result = ah.memory_read("ghost")
        assert result["success"] is True
        assert result["content"] is None
        assert "no memory file" in result["message"].lower()

    def test_safe_name(self, monkeypatch, tmp_path):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "MEMORY_DIR", str(tmp_path))
        ah.memory_write("bad/name!", "x")
        assert (tmp_path / "badname.md").exists()

    def test_write_requires_content(self):
        from syntaro_mcp import agent_handlers as ah

        result = ah.memory_write("notes", None)
        assert result["success"] is False
        assert "required" in result["error"].lower()


class TestSlackSend:
    """slack_send -- post to a Slack channel or thread."""

    @pytest.mark.asyncio
    async def test_success(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "SLACK_BOT_TOKEN", "xoxb-test")
        mock_client = AsyncMock()
        resp = MagicMock()
        resp.json.return_value = {"ok": True, "ts": "1234.5678", "channel": "C123"}
        mock_client.post.return_value = resp

        with patch("syntaro_mcp.agent_handlers.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client
            result = await ah.slack_send("C123", "hello", thread_ts="1.2")

        assert result["success"] is True
        assert result["channel"] == "C123"
        assert result["ts"] == "1234.5678"
        post_kwargs = mock_client.post.call_args.kwargs
        assert post_kwargs["headers"]["Authorization"] == "Bearer xoxb-test"
        assert post_kwargs["json"]["thread_ts"] == "1.2"

    @pytest.mark.asyncio
    async def test_no_token(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "SLACK_BOT_TOKEN", "")
        result = await ah.slack_send("C123", "hello")
        assert result["success"] is False
        assert "slack_bot_token not configured" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_missing_args(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "SLACK_BOT_TOKEN", "xoxb-test")
        result = await ah.slack_send("", "")
        assert result["success"] is False
        assert "required" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_api_error(self, monkeypatch):
        from syntaro_mcp import agent_handlers as ah

        monkeypatch.setattr(ah, "SLACK_BOT_TOKEN", "xoxb-test")
        mock_client = AsyncMock()
        resp = MagicMock()
        resp.json.return_value = {"ok": False, "error": "not_in_channel"}
        mock_client.post.return_value = resp

        with patch("syntaro_mcp.agent_handlers.httpx.AsyncClient") as mock_cls:
            mock_cls.return_value.__aenter__.return_value = mock_client
            result = await ah.slack_send("C123", "hello")

        assert result["success"] is False
        assert "not_in_channel" in result["error"]


class TestSessionResume:
    """session_resume -- read the workspace MEMORY.md."""

    def test_with_memory(self, tmp_path):
        from syntaro_mcp import agent_handlers as ah

        (tmp_path / "MEMORY.md").write_text("context from last run")
        result = ah.session_resume(str(tmp_path))
        assert result["success"] is True
        assert result["content"] == "context from last run"

    def test_without_memory(self, tmp_path):
        from syntaro_mcp import agent_handlers as ah

        result = ah.session_resume(str(tmp_path))
        assert result["success"] is True
        assert result["content"] is None
        assert "no memory.md" in result["message"].lower()

    def test_empty_workspace(self):
        from syntaro_mcp import agent_handlers as ah

        result = ah.session_resume("")
        assert result["success"] is False
        assert "required" in result["error"].lower()
