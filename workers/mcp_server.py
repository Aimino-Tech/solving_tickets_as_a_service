"""
MCP Server — expose SYNTARO pipeline as MCP tools and resources.

Backed by the real OpenSymphony PipelineEngine (Celery + Redis)
instead of a local JSON file registry.

Runs on port 4095 (default) and auto-registers with OpenCode MCP configuration.
"""
import json
import logging
import os
import sys
from typing import Any

from workers.pipeline_client import get_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sentry SDK initialization for MCP Agent Server
# ---------------------------------------------------------------------------
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
SENTRY_ENV = os.getenv("SENTRY_ENVIRONMENT", os.getenv("NODE_ENV", "development"))
SENTRY_RELEASE = os.getenv("SENTRY_RELEASE", "syntaro@unknown")

if SENTRY_DSN:
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=SENTRY_ENV,
            release=SENTRY_RELEASE,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        )
        logger.info(
            "Sentry initialized for workers MCP Server — env=%s release=%s",
            SENTRY_ENV,
            SENTRY_RELEASE,
        )
    except Exception as e:
        logger.warning("Failed to initialize Sentry for workers MCP Server: %s", e)
else:
    logger.info("SENTRY_DSN not configured — Sentry monitoring disabled for workers MCP Server")

MCP_PORT = int(os.getenv("MCP_SERVER_PORT", "4095"))
OPENCODE_CONFIG_DIR = os.path.expanduser(os.getenv("OPENCODE_CONFIG_DIR", "~/.config/opencode"))
MCP_SERVER_NAME = "syntaro-pipeline"

_pipeline = get_client()


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
    parts = repo.split("/")
    owner = parts[0] if len(parts) > 1 else "unknown"
    result = _pipeline.submit_fix(owner=owner, repo=repo, issue_number=issue_number)
    return result


def handle_get_fix_status(params: dict) -> dict:
    fix_id = params.get("fix_id", "")
    issue_id = params.get("issue_id", fix_id)
    result = _pipeline.check_status(issue_id)
    result["fix_id"] = fix_id
    result["issue_id"] = issue_id
    return result


def handle_get_fix_history(params: dict) -> dict:
    repo = params.get("repo", "")
    limit = int(params.get("limit", 10))
    result = _pipeline.get_run_history(repo=repo, limit=limit)
    return result


def handle_cancel_fix(params: dict) -> dict:
    fix_id = params.get("fix_id", "")
    result = _pipeline.cancel_fix(fix_id)
    result["fix_id"] = fix_id
    return result


def handle_resource_status() -> dict:
    return {
        "description": "SYNTARO pipeline system status",
        "system_status": "online",
        "pipeline": "PipelineEngine (Celery + Redis)",
    }


def handle_resource_fix(fix_id: str) -> dict:
    result = _pipeline.check_status(fix_id)
    if not result.get("success"):
        return {"error": result.get("error", f"Fix not found: {fix_id}")}
    return result


def handle_resource_queue() -> dict:
    return {
        "queue": [],
        "depth": 0,
        "description": "Use pipeline check_status for individual fix tracking",
    }


def handle_list_tools() -> list[dict]:
    return [
        {"name": "dispatch_fix", "description": "Trigger the SYNTARO pipeline for a GitHub issue (backed by Celery + PipelineEngine)", "inputSchema": {"type": "object", "properties": {"repo": {"type": "string"}, "issue_number": {"type": "integer"}}, "required": ["repo", "issue_number"]}},
        {"name": "get_fix_status", "description": "Return pipeline status for a fix ID or issue ID", "inputSchema": {"type": "object", "properties": {"fix_id": {"type": "string"}, "issue_id": {"type": "string"}}}},
        {"name": "get_fix_history", "description": "Return recent pipeline runs", "inputSchema": {"type": "object", "properties": {"repo": {"type": "string"}, "limit": {"type": "integer"}}}},
        {"name": "cancel_fix", "description": "Cancel an in-progress pipeline run", "inputSchema": {"type": "object", "properties": {"fix_id": {"type": "string"}}, "required": ["fix_id"]}},
    ]


def handle_list_resources() -> list[dict]:
    return [
        {"uri": "syntaro://status", "name": "Pipeline Status", "description": "Real OpenSymphony pipeline system health"},
        {"uri": "syntaro://fixes/{fix_id}", "name": "Fix Details", "description": "Full pipeline details for a specific fix"},
        {"uri": "syntaro://queue", "name": "Fix Queue", "description": "Pipeline dispatch queue overview"},
    ]


TOOL_HANDLERS = {
    "dispatch_fix": handle_dispatch_fix,
    "get_fix_status": handle_get_fix_status,
    "get_fix_history": handle_get_fix_history,
    "cancel_fix": handle_cancel_fix,
}

RESOURCE_HANDLERS = {
    "syntaro://status": lambda: handle_resource_status(),
    "syntaro://queue": lambda: handle_resource_queue(),
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
                if uri.startswith("syntaro://status"):
                    result = handle_resource_status()
                    response = {"jsonrpc": "2.0", "id": msg_id, "result": {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(result, indent=2)}]}}
                elif uri.startswith("syntaro://fixes/"):
                    fix_id = uri.replace("syntaro://fixes/", "")
                    result = handle_resource_fix(fix_id)
                    response = {"jsonrpc": "2.0", "id": msg_id, "result": {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(result, indent=2)}]}}
                elif uri == "syntaro://queue":
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
