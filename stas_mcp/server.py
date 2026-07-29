"""
FastMCP server — expose STAS as auto-discoverable agent infrastructure.

Tools:
  - stas_label_issue   — Label a GitHub issue.
  - stas_run_fix       — Trigger a fix pipeline for a GitHub issue.
  - stas_check_status  — Check the status of a fix run.
  - stas_get_pr        — Get PR details for a completed fix run.
  - list_issues        — List tracked issues and their fix status.
  - search_codebase    — Search the STAS codebase for symbols or patterns.

Resources:
  - stas://runs/{run_id}    — Real-time status + PR link for a fix run.
  - stas://issues/{issue_id} — Issue details with fix status.

Run modes:
  - python -m stas_mcp.server         (SSE mode, default port 4095)
  - python -m stas_mcp.server stdio   (stdio mode for OpenCode integration)

SSL/TLS:
  - python -m stas_mcp.server sse --ssl-keyfile key.pem --ssl-certfile cert.pem
"""

from __future__ import annotations
import argparse, json, logging, os, sys
from mcp.server.fastmcp import FastMCP
from workers.pipeline_client import get_client
from stas_mcp.handlers import _parse_github_issue_url, check_status, get_pr, get_run_resource, label_issue, list_runs_from_api, run_fix

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
SERVER_NAME = "stas-agent-discovery"
SERVER_VERSION = "0.1.0"

mcp = FastMCP(SERVER_NAME, instructions="""STAS (Solving Tickets As A Service) — label a GitHub issue and get a PR.

Tools:
- **stas_label_issue**: Add a label (e.g. "stas:fix") to a GitHub issue.
- **stas_run_fix**: Trigger the full STAS pipeline for an issue URL. Returns a run_id.
- **stas_check_status**: Poll the status of a fix run by run_id.
- **stas_get_pr**: Get the PR URL and details for a completed run.
- **list_issues**: List tracked issues with their fix status.
- **search_codebase**: Search the STAS codebase for symbols or patterns.

Resources:
- **stas://runs/{run_id}**: Full run details.
- **stas://issues/{issue_id}**: Issue details with fix status and run history.
""")

@mcp.tool(name="stas_label_issue", description="Label a GitHub issue with the STAS fix label (or custom label).")
async def stas_label_issue(owner: str, repo: str, issue_number: int, label: str = "stas:fix") -> str:
    return json.dumps(await label_issue(owner, repo, issue_number, label), indent=2, default=str)

@mcp.tool(name="stas_run_fix", description="Trigger the STAS fix pipeline for a GitHub issue URL.")
async def stas_run_fix(issue_url: str) -> str:
    return json.dumps(await run_fix(issue_url), indent=2, default=str)

@mcp.tool(name="stas_check_status", description="Check the current status of a STAS fix run by run_id.")
async def stas_check_status(run_id: str) -> str:
    return json.dumps(await check_status(run_id), indent=2, default=str)

@mcp.tool(name="stas_get_pr", description="Get the pull request URL and details for a completed STAS fix run.")
async def stas_get_pr(run_id: str) -> str:
    return json.dumps(await get_pr(run_id), indent=2, default=str)

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

@mcp.tool(name="list_issues", description="List tracked issues with their STAS fix status, with optional filters.")
async def list_issues_tool(status=None, repo=None, limit=20):
    return json.dumps(await _list_issues_handler(status=status, repo=repo, limit=limit), indent=2, default=str)

@mcp.tool(name="search_codebase", description="Search the STAS codebase for symbols, files, or patterns.")
async def search_codebase_tool(query, repo=None, max_results=10):
    return json.dumps(await _search_codebase_handler(query=query, repo=repo, max_results=max_results), indent=2, default=str)

@mcp.resource(uri="stas://runs/{run_id}", name="Fix Run Status",
              description="Full run details including status, timestamps, issue info, and PR link.", mime_type="application/json")
async def run_status(run_id):
    return json.dumps(await get_run_resource(run_id), indent=2, default=str)

@mcp.resource(uri="stas://issues/{issue_id}", name="Issue Fix Status",
              description="Issue details including current fix status, run history, and linked PRs.", mime_type="application/json")
async def issue_status(issue_id):
    return json.dumps(await _get_issue_resource_handler(issue_id), indent=2, default=str)

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
