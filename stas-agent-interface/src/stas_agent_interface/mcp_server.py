from __future__ import annotations
import json, logging, os
from datetime import datetime
from typing import Any, Optional
import mcp.server as mcp_server
import mcp.types as mcp_types
from mcp.server import Server
from mcp.server.models import InitializationOptions
from stas_agent_interface.auth import AuthMiddleware, AuthError, get_default_auth_middleware
from stas_agent_interface.engine import STASEngine
from stas_agent_interface.models import AuthScope, AuthToken, SCOPE_HIERARCHY, SubmitIssueRequest, CheckStatusRequest, RunHistoryRequest, ListReposRequest, GetPricingRequest

logger = logging.getLogger(__name__)

class STASMCPServer:
    def __init__(self, auth: Optional[AuthMiddleware] = None, engine: Optional[STASEngine] = None, require_auth: bool = True):
        self._auth = auth or get_default_auth_middleware()
        self._eng = engine or STASEngine()
        self._req_auth = require_auth
        self._srv = Server("stas-agent-interface")
        self._reg()
    def _reg(self):
        @self._srv.list_tools()
        async def lt() -> list[mcp_types.Tool]:
            tools = []
            for c in self._eng.list_capabilities().capabilities:
                p: dict[str, Any] = {}
                if self._req_auth: p["apiKey"] = {"type": "string", "description": "STAS API key"}
                tools.append(mcp_types.Tool(name=c.name, description=c.description, inputSchema={"type":"object","properties":p}))
            return tools
        @self._srv.call_tool()
        async def ct(name: str, args: dict[str, Any] | None) -> list[mcp_types.TextContent]:
            a = args or {}
            try:
                t = self._auth.authenticate_request(a) if self._req_auth else AuthToken(token="", scope=AuthScope.ADMIN, expires_at=datetime.now())
                r = await self._disp(name, a, t)
                return [mcp_types.TextContent(type="text", text=json.dumps(r, default=str, indent=2))]
            except AuthError as e:
                return [mcp_types.TextContent(type="text", text=json.dumps({"error": e.message, "status_code": e.status_code}))]
            except Exception as e:
                logger.exception("tool %s error", name)
                return [mcp_types.TextContent(type="text", text=json.dumps({"error": str(e), "status_code": 500}))]
    async def _disp(self, name: str, args: dict[str, Any], token: AuthToken) -> Any:
        if name == "list_capabilities": return self._eng.list_capabilities().model_dump(mode="json")
        rs = AuthMiddleware.get_required_scope_for_capability(name)
        if rs not in SCOPE_HIERARCHY.get(token.scope, {token.scope}):
            raise AuthError(f"Insufficient scope for '{name}'", 403)
        if name == "submit_issue": return (await self._eng.submit_issue(SubmitIssueRequest(repo=args["repo"], title=args["title"], body=args["body"], labels=args.get("labels",[])))).model_dump(mode="json")
        if name == "check_status": return (await self._eng.check_status(CheckStatusRequest(run_id=args["run_id"]))).model_dump(mode="json")
        if name == "get_run_history": return (await self._eng.get_run_history(RunHistoryRequest(repo=args.get("repo"), limit=args.get("limit",10)))).model_dump(mode="json")
        if name == "list_repos": return (await self._eng.list_repos(ListReposRequest(platform=args.get("platform")))).model_dump(mode="json")
        if name == "get_pricing": return (await self._eng.get_pricing(GetPricingRequest(plan_id=args.get("plan_id")))).model_dump(mode="json")
        raise ValueError(f"Unknown: {name}")
    async def run_stdio(self) -> None:
        async with mcp_server.stdio_server() as (rs, ws):
            await self._srv.run(rs, ws, InitializationOptions(server_name="stas-agent-interface", server_version="0.1.0"))
    async def run_sse(self, host: str = "0.0.0.0", port: int = 4094) -> None:
        from mcp.server.sse import SseServerTransport; from starlette.applications import Starlette; from starlette.routing import Route; import uvicorn
        sse = SseServerTransport("/mcp/messages/")
        async def hs(r): async with sse.connect_sse(r.scope, r.receive, r._send) as (rs, ws): await self._srv.run(rs, ws, InitializationOptions(server_name="stas-agent-interface", server_version="0.1.0"))
        async def hm(r): await sse.handle_post_message(r.scope, r.receive, r._send)
        app = Starlette(routes=[Route("/mcp", endpoint=hs), Route("/mcp/messages/", endpoint=hm, methods=["POST"])])
        await uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="info")).serve()

async def run_server(mode: str = "http", port: int = 0, host: str = "0.0.0.0", require_auth: bool = True) -> None:
    srv = STASMCPServer(require_auth=require_auth)
    if mode == "stdio": await srv.run_stdio()
    else: await srv.run_sse(host=host, port=port or int(os.getenv("STAS_MCP_PORT","4094")))
