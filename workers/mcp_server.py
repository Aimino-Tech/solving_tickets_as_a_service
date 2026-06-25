"""
MCP Server — expose STAS pipeline as MCP tools and resources.

Runs on port 4095 (default) and auto-registers with OpenCode MCP configuration.
"""
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

MCP_PORT = int(os.getenv("MCP_SERVER_PORT", "4095"))
OPENCODE_CONFIG_DIR = os.path.expanduser(os.getenv("OPENCODE_CONFIG_DIR", "~/.config/opencode"))
MCP_SERVER_NAME = "stas-pipeline"

_fix_registry: dict[str, dict] = {}


def _get_fix_registry() -> dict[str, dict]:
    global _fix_registry
    if not _fix_registry:
        try:
            registry_path = os.getenv("FIX_REGISTRY_PATH", "/tmp/stas-fix-registry.json")
            with open(registry_path) as f:
                _fix_registry = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            _fix_registry = {}
    return _fix_registry


def _save_fix_registry():
    registry_path = os.getenv("FIX_REGISTRY_PATH", "/tmp/stas-fix-registry.json")
    os.makedirs(os.path.dirname(registry_path) or ".", exist_ok=True)
    with open(registry_path, "w") as f:
        json.dump(_fix_registry, f, indent=2, default=str)


def _register_with_opencode():
    config_file = os.path.join(OPENCODE_CONFIG_DIR, "mcp.json")
    server_config = {
        "name": MCP_SERVER_NAME,
        "transport": "stdio",
        "command": sys.executable,
        "args": ["-m", "workers.mcp_server", "--mode", "stdio"],
    }
    try:
        os.makedirs(OPENCODE_CONFIG_DIR, exist_ok=True)
        existing = {}
        try:
            with open(config_file) as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        existing[MCP_SERVER_NAME] = server_config
        with open(config_file, "w") as f:
            json.dump(existing, f, indent=2)
        logger.info("Registered MCP server '%s' with OpenCode", MCP_SERVER_NAME)
    except Exception as exc:
        logger.warning("Failed to register MCP server: %s", exc)


def handle_dispatch_fix(params: dict) -> dict:
    repo = params.get("repo", "")
    issue_number = params.get("issue_number", 0)
    if not repo or not issue_number:
        return {"error": "Missing required params: repo, issue_number", "success": False}
    fix_id = f"fix-{repo.replace('/', '-')}-{issue_number}-{int(datetime.now(timezone.utc).timestamp())}"
    from workers.tasks.triage import triage_issue
    issue_data = {"issue_url": f"https://github.com/{repo}/issues/{issue_number}", "repo": repo, "issue_number": issue_number}
    try:
        triage_result = triage_issue(issue_data)
        status = "triaging"
    except Exception as exc:
        triage_result = {"error": str(exc)}
        status = "failed"
    registry = _get_fix_registry()
    registry[fix_id] = {
        "fix_id": fix_id,
        "repo": repo,
        "issue_number": issue_number,
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "triage_result": triage_result,
    }
    _save_fix_registry()
    return {"fix_id": fix_id, "status": status, "success": True}


def handle_get_fix_status(params: dict) -> dict:
    fix_id = params.get("fix_id", "")
    registry = _get_fix_registry()
    fix = registry.get(fix_id)
    if not fix:
        return {"error": f"Fix not found: {fix_id}", "success": False}
    return {"fix_id": fix_id, "status": fix.get("status", "unknown"), "fix": fix, "success": True}


def handle_get_fix_history(params: dict) -> dict:
    repo = params.get("repo", "")
    limit = int(params.get("limit", 10))
    registry = _get_fix_registry()
    fixes = [v for v in registry.values() if not repo or v.get("repo") == repo]
    fixes.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"fixes": fixes[:limit], "total": len(fixes), "success": True}


def handle_cancel_fix(params: dict) -> dict:
    fix_id = params.get("fix_id", "")
    registry = _get_fix_registry()
    if fix_id not in registry:
        return {"error": f"Fix not found: {fix_id}", "success": False}
    registry[fix_id]["status"] = "cancelled"
    registry[fix_id]["cancelled_at"] = datetime.now(timezone.utc).isoformat()
    _save_fix_registry()
    return {"fix_id": fix_id, "status": "cancelled", "success": True}


def handle_resource_status() -> dict:
    import psutil
    registry = _get_fix_registry()
    active = [k for k, v in registry.items() if v.get("status") in ("triaging", "dispatching", "verifying", "reviewing")]
    return {
        "description": "STAS pipeline system status",
        "system_status": "online",
        "queue_depth": len(active),
        "active_fixes": len(active),
        "total_fixes": len(registry),
        "worker_status": "available",
        "memory_usage_mb": round(psutil.Process().memory_info().rss / 1024 / 1024, 1) if hasattr(psutil, "Process") else 0,
    }


def handle_resource_fix(fix_id: str) -> dict:
    registry = _get_fix_registry()
    fix = registry.get(fix_id)
    if not fix:
        return {"error": f"Fix not found: {fix_id}"}
    return fix


def handle_resource_queue() -> dict:
    registry = _get_fix_registry()
    active = {k: v for k, v in registry.items() if v.get("status") in ("triaging", "dispatching", "verifying", "reviewing")}
    queued_list = [{"fix_id": k, "status": v.get("status"), "repo": v.get("repo"), "issue_number": v.get("issue_number"), "created_at": v.get("created_at")} for k, v in sorted(active.items(), key=lambda x: x[1].get("created_at", ""))]
    return {"queue": queued_list, "depth": len(queued_list), "description": "Current fix dispatch queue"}


def handle_list_tools() -> list[dict]:
    return [
        {"name": "dispatch_fix", "description": "Trigger the STAS pipeline for a GitHub issue", "inputSchema": {"type": "object", "properties": {"repo": {"type": "string"}, "issue_number": {"type": "integer"}}, "required": ["repo", "issue_number"]}},
        {"name": "get_fix_status", "description": "Return pipeline status for a fix ID", "inputSchema": {"type": "object", "properties": {"fix_id": {"type": "string"}}, "required": ["fix_id"]}},
        {"name": "get_fix_history", "description": "Return recent fixes for a repo", "inputSchema": {"type": "object", "properties": {"repo": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["repo"]}},
        {"name": "cancel_fix", "description": "Cancel an in-progress fix", "inputSchema": {"type": "object", "properties": {"fix_id": {"type": "string"}}, "required": ["fix_id"]}},
    ]


def handle_list_resources() -> list[dict]:
    return [
        {"uri": "stas://status", "name": "Pipeline Status", "description": "Overall system health and queue depth"},
        {"uri": "stas://fixes/{fix_id}", "name": "Fix Details", "description": "Full fix details for a specific fix ID"},
        {"uri": "stas://queue", "name": "Fix Queue", "description": "Current dispatch queue with positions"},
    ]


TOOL_HANDLERS = {
    "dispatch_fix": handle_dispatch_fix,
    "get_fix_status": handle_get_fix_status,
    "get_fix_history": handle_get_fix_history,
    "cancel_fix": handle_cancel_fix,
}

RESOURCE_HANDLERS = {
    "stas://status": lambda: handle_resource_status(),
    "stas://queue": lambda: handle_resource_queue(),
}


def run_stdio_server():
    _register_with_opencode()
    logger.info("MCP server starting in stdio mode")
    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
            msg_id = msg.get("id", 0)
            method = msg.get("method", "")
            params = msg.get("params", {})

            if method == "tools/list":
                response = {"jsonrpc": "2.0", "id": msg_id, "result": handle_list_tools()}
            elif method == "resources/list":
                response = {"jsonrpc": "2.0", "id": msg_id, "result": handle_list_resources()}
            elif method == "tools/call":
                tool_name = params.get("name", "")
                tool_params = params.get("arguments", {})
                handler = TOOL_HANDLERS.get(tool_name)
                if handler:
                    result = handler(tool_params)
                    response = {"jsonrpc": "2.0", "id": msg_id, "result": result}
                else:
                    response = {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}}
            elif method == "resources/read":
                uri = params.get("uri", "")
                if uri.startswith("stas://status"):
                    result = handle_resource_status()
                    response = {"jsonrpc": "2.0", "id": msg_id, "result": {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(result, indent=2)}]}}
                elif uri.startswith("stas://fixes/"):
                    fix_id = uri.replace("stas://fixes/", "")
                    result = handle_resource_fix(fix_id)
                    response = {"jsonrpc": "2.0", "id": msg_id, "result": {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(result, indent=2)}]}}
                elif uri == "stas://queue":
                    result = handle_resource_queue()
                    response = {"jsonrpc": "2.0", "id": msg_id, "result": {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(result, indent=2)}]}}
                else:
                    response = {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"Unknown resource: {uri}"}}
            elif method == "initialize":
                response = {"jsonrpc": "2.0", "id": msg_id, "result": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}, "resources": {}}, "serverInfo": {"name": MCP_SERVER_NAME, "version": "1.0.0"}}}
            elif method == "notifications/initialized":
                response = None
            else:
                response = {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"Unknown method: {method}"}}

            if response is not None:
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
        except json.JSONDecodeError:
            continue
        except Exception as exc:
            logger.error("MCP handler error: %s", exc, exc_info=True)
            try:
                err_response = {"jsonrpc": "2.0", "id": msg.get("id", 0), "error": {"code": -32603, "message": str(exc)}}
                sys.stdout.write(json.dumps(err_response) + "\n")
                sys.stdout.flush()
            except Exception:
                pass


def run_http_server():
    from http.server import HTTPServer, BaseHTTPRequestHandler

    _register_with_opencode()

    class MCPHTTPHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                msg = json.loads(body)
                msg_id = msg.get("id", 0)
                method = msg.get("method", "")
                params = msg.get("params", {})

                if method == "tools/list":
                    result = handle_list_tools()
                    response = {"jsonrpc": "2.0", "id": msg_id, "result": result}
                elif method == "tools/call":
                    tool_name = params.get("name", "")
                    tool_params = params.get("arguments", {})
                    handler = TOOL_HANDLERS.get(tool_name)
                    if handler:
                        response = {"jsonrpc": "2.0", "id": msg_id, "result": handler(tool_params)}
                    else:
                        response = {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}}
                else:
                    response = {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"Unknown method: {method}"}}

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
            except Exception as exc:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(exc)}).encode())

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            health = {"status": "ok", "server": MCP_SERVER_NAME, "port": MCP_PORT, "tools": [t["name"] for t in handle_list_tools()]}
            self.wfile.write(json.dumps(health).encode())

        def log_message(self, fmt, *args):
            logger.debug("HTTP: %s", fmt % args)

    server = HTTPServer(("0.0.0.0", MCP_PORT), MCPHTTPHandler)
    logger.info("MCP HTTP server listening on :%d", MCP_PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    mode = "--mode" in sys.argv
    mode_value = sys.argv[sys.argv.index("--mode") + 1] if mode else "http"
    if mode_value == "stdio":
        run_stdio_server()
    else:
        run_http_server()
