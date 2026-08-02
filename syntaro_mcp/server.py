"""
FastMCP server — expose Syntaro as auto-discoverable agent infrastructure.

Tools:
  - syntaro_label_issue   — Label a GitHub issue.
  - syntaro_run_fix       — Trigger a fix pipeline for a GitHub issue.
  - syntaro_check_status  — Check the status of a fix run.
  - syntaro_get_pr        — Get PR details for a completed fix run.
  - list_issues        — List tracked issues and their fix status.
  - search_codebase    — Search the Syntaro codebase for symbols or patterns.
  - linear_ticket      — Check whether a Linear ticket exists and its details.
  - linear_create_ticket — Create a Linear ticket in the workspace.
  - memory_read        — Read a Hermes-style agent memory file.
  - memory_write       — Write a Hermes-style agent memory file.
  - slack_send         — Post a message to a Slack channel/thread.
  - session_resume     — Return a conversation's maintained MEMORY.md.

Resources:
  - syntaro://runs/{run_id}    — Real-time status + PR link for a fix run.
  - syntaro://issues/{issue_id} — Issue details with fix status.

Run modes:
  - python -m syntaro_mcp.server         (SSE mode, default port 4095)
  - python -m syntaro_mcp.server stdio   (stdio mode for OpenCode integration)

SSL/TLS:
  - python -m syntaro_mcp.server sse --ssl-keyfile key.pem --ssl-certfile cert.pem
"""

from __future__ import annotations
import argparse, json, logging, os, sys
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from workers.pipeline_client import get_client
from syntaro_mcp.agent_handlers import (
    linear_create_ticket,
    linear_ticket,
    memory_read,
    memory_write,
    session_resume,
    slack_send,
)
from syntaro_mcp.handlers import _parse_github_issue_url, check_status, get_pr, get_run_resource, label_issue, list_runs_from_api, run_fix

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sentry SDK initialization for MCP Agent Server
# ---------------------------------------------------------------------------
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
SENTRY_ENV = os.getenv("SENTRY_ENVIRONMENT", os.getenv("NODE_ENV", "development"))
SENTRY_RELEASE = os.getenv("SENTRY_RELEASE", "stas@unknown")

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
            "Sentry initialized for MCP Server — env=%s release=%s",
            SENTRY_ENV,
            SENTRY_RELEASE,
        )
    except Exception as e:
        logger.warning("Failed to initialize Sentry for MCP Server: %s", e)
else:
    logger.info("SENTRY_DSN not configured — Sentry monitoring disabled for MCP Server")
SERVER_NAME = "syntaro-agent-discovery"
SERVER_VERSION = "0.1.0"

# Viral hook on every answer (product requirement): same brand mark as Slack replies.
VIRAL_HOOK = "⚡ Powered by Syntaro — syntaro.io"


def _hook(payload):
    """Attach the viral hook to a JSON-able tool answer (dicts only)."""
    if isinstance(payload, dict):
        return {**payload, "viral_hook": VIRAL_HOOK}
    return payload

mcp = FastMCP(
    SERVER_NAME,
    instructions="""Syntaro (Solving Tickets As A Service) — label a GitHub issue and get a PR.

Tools:
- **syntaro_label_issue**: Add a label (e.g. "stas:fix") to a GitHub issue.
- **syntaro_run_fix**: Trigger the full Syntaro pipeline for an issue URL. Returns a run_id.
- **syntaro_check_status**: Poll the status of a fix run by run_id.
- **syntaro_get_pr**: Get the PR URL and details for a completed run.
- **list_issues**: List tracked issues with their fix status.
- **search_codebase**: Search the Syntaro codebase for symbols or patterns.
- **linear_ticket**: Check whether a Linear ticket exists (identifier like AIM-4477) and return its title/state/url/description.
- **linear_create_ticket**: Create a Linear ticket in the workspace (title, description, priority).
- **memory_read**: Read a Hermes-style agent memory file by name.
- **memory_write**: Write a Hermes-style agent memory file by name (facts/decisions/preferences/plan in markdown).
- **slack_send**: Post a message to a Slack channel or thread with the Syntaro bot token.
- **session_resume**: Return a conversation workspace's maintained MEMORY.md so an agent can resume it.

Resources:
- **syntaro://runs/{run_id}**: Full run details.
- **syntaro://issues/{issue_id}**: Issue details with fix status and run history.
""",
    # The service runs inside k8s behind a ClusterIP service; FastMCP's
    # DNS-rebinding protection (auto-enabled for 127.0.0.1) would reject the
    # in-cluster Host header (symphony-mcp.symphony.svc.cluster.local:4095)
    # with 421. Disable it; the service is cluster-internal only.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)

@mcp.tool(name="syntaro_label_issue", description="Label a GitHub issue with the Syntaro fix label (or custom label).")
async def syntaro_label_issue(owner: str, repo: str, issue_number: int, label: str = "stas:fix") -> str:
    return json.dumps(_hook(await label_issue(owner, repo, issue_number, label)), indent=2, default=str)

@mcp.tool(name="syntaro_run_fix", description="Trigger the Syntaro fix pipeline for a GitHub issue URL.")
async def syntaro_run_fix(issue_url: str) -> str:
    return json.dumps(_hook(await run_fix(issue_url)), indent=2, default=str)

@mcp.tool(name="syntaro_check_status", description="Check the current status of a Syntaro fix run by run_id.")
async def syntaro_check_status(run_id: str) -> str:
    return json.dumps(_hook(await check_status(run_id)), indent=2, default=str)

@mcp.tool(name="syntaro_get_pr", description="Get the pull request URL and details for a completed Syntaro fix run.")
async def syntaro_get_pr(run_id: str) -> str:
    return json.dumps(_hook(await get_pr(run_id)), indent=2, default=str)

# Agent-First Architecture: new tools (AIM-2071)

async def _list_issues_handler(status=None, repo=None, limit=20):
    _pl = get_client()
    l = max(1, min(limit, 100))
    result = _pl.get_run_history(repo=repo or "", limit=l)
    issues = result.get("runs", [])
    if not issues:
        api_result = await list_runs_from_api(status=status, repo=repo, limit=l)
        if api_result and "runs" in api_result:
            issues = api_result["runs"]
    return {"success": True, "issues": issues, "total": len(issues), "limit": l}

async def _search_codebase_handler(query, repo=None, max_results=10):
    if not query:
        return {"success": False, "error": "query is required"}
    _pl = get_client()
    l = max(1, min(max_results, 50))
    result = _pl.get_run_history(repo=repo or "", limit=l)
    runs = result.get("runs", [])
    q = query.lower()
    results = []
    for r in runs:
        score = 0
        fields = []
        if q in r.get("run_id", "").lower(): score += 10; fields.append("run_id")
        if q in r.get("issue_url", "").lower(): score += 8; fields.append("issue_url")
        if q in r.get("status", "").lower(): score += 3; fields.append("status")
        if score > 0:
            results.append({**r, "score": score, "matched_fields": fields})
    results.sort(key=lambda x: (-x["score"], x.get("created_at", "") or ""))
    return {"success": True, "query": query, "results": results[:l], "total": len(results), "limit": l}

async def _get_issue_resource_handler(issue_id):
    _pl = get_client()
    result = _pl.check_status(issue_id)
    parsed = _parse_github_issue_url(issue_id)
    owner = parsed["owner"] if parsed else ""
    repo = parsed["repo"] if parsed else ""
    number = parsed["issue_number"] if parsed else None
    if not result.get("success"):
        return {"issue_id": issue_id, "owner": owner, "repo": repo, "issue_number": number,
                "status": "unknown", "runs": [], "message": result.get("error", "No fix runs found")}
    return {"issue_id": issue_id, "owner": owner, "repo": repo, "issue_number": number,
            "total_runs": 1, "runs": [result]}

@mcp.tool(name="syntaro_list_issues", description="List tracked issues with their Syntaro fix status, with optional filters.")
async def list_issues_tool(status=None, repo=None, limit=20):
    return json.dumps(_hook(await _list_issues_handler(status=status, repo=repo, limit=limit)), indent=2, default=str)

@mcp.tool(name="syntaro_search_codebase", description="Search the Syntaro codebase for symbols, files, or patterns.")
async def search_codebase_tool(query, repo=None, max_results=10):
    return json.dumps(_hook(await _search_codebase_handler(query=query, repo=repo, max_results=max_results)), indent=2, default=str)

@mcp.tool(name="syntaro_linear_ticket", description="Check whether a Linear ticket exists (identifier like AIM-4477) and return its details.")
async def linear_ticket_tool(identifier: str) -> str:
    return json.dumps(_hook(await linear_ticket(identifier)), indent=2, default=str)

@mcp.tool(name="syntaro_linear_create_ticket", description="Create a Linear ticket in the workspace (title required, description and priority optional, team_key like 'AIM' optional).")
async def linear_create_ticket_tool(title: str, description: str = "", priority: int | None = None, team_key: str = "") -> str:
    return json.dumps(_hook(await linear_create_ticket(title, description or None, priority, team_key or None)), indent=2, default=str)

@mcp.tool(name="syntaro_memory_read", description="Read a Hermes-style agent memory file by name (default 'user').")
async def memory_read_tool(name: str = "user") -> str:
    return json.dumps(_hook(memory_read(name)), indent=2, default=str)

@mcp.tool(name="syntaro_memory_write", description="Write a Hermes-style agent memory file by name (facts/decisions/preferences/plan in markdown).")
async def memory_write_tool(name: str, content: str) -> str:
    return json.dumps(_hook(memory_write(name, content)), indent=2, default=str)

@mcp.tool(name="syntaro_slack_send", description="Post a message to a Slack channel or thread using the Syntaro bot token.")
async def slack_send_tool(channel: str, text: str, thread_ts: str = "") -> str:
    return json.dumps(_hook(await slack_send(channel, text, thread_ts or None)), indent=2, default=str)

@mcp.tool(name="syntaro_session_resume", description="Return a conversation workspace's maintained MEMORY.md so an agent can resume the conversation.")
async def session_resume_tool(workspace_path: str) -> str:
    return json.dumps(_hook(session_resume(workspace_path)), indent=2, default=str)

@mcp.resource(uri="syntaro://runs/{run_id}", name="Fix Run Status",
              description="Full run details including status, timestamps, issue info, and PR link.", mime_type="application/json")
async def run_status(run_id):
    return json.dumps(_hook(await get_run_resource(run_id)), indent=2, default=str)

@mcp.resource(uri="syntaro://issues/{issue_id}", name="Issue Fix Status",
              description="Issue details including current fix status, run history, and linked PRs.", mime_type="application/json")
async def issue_status(issue_id):
    return json.dumps(_hook(await _get_issue_resource_handler(issue_id)), indent=2, default=str)

def run_stdio(): mcp.run(transport="stdio")

def run_sse(host="0.0.0.0", port=4095, ssl_keyfile=None, ssl_certfile=None):
    """Run MCP server in SSE mode with optional SSL/TLS support."""
    import uvicorn
    from mcp.server.fastmcp import FastMCP as FastMCPType

    app = mcp.sse_app()  # Access the underlying ASGI app

    ssl_kwargs = {}
    if ssl_keyfile and ssl_certfile:
        ssl_kwargs["ssl_keyfile"] = ssl_keyfile
        ssl_kwargs["ssl_certfile"] = ssl_certfile
        logger.info("SSL/TLS enabled for MCP SSE endpoint")

    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        **ssl_kwargs,
    )

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", default="sse", choices=["sse", "stdio"], help="Transport mode")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.getenv("STAS_MCP_PORT", "4095")))
    parser.add_argument("--ssl-keyfile", default=os.getenv("STAS_MCP_SSL_KEY_PATH"), help="SSL key file path")
    parser.add_argument("--ssl-certfile", default=os.getenv("STAS_MCP_SSL_CERT_PATH"), help="SSL cert file path")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    if args.mode == "stdio":
        run_stdio()
    else:
        run_sse(host=args.host, port=args.port, ssl_keyfile=args.ssl_keyfile, ssl_certfile=args.ssl_certfile)

if __name__ == "__main__": main()
