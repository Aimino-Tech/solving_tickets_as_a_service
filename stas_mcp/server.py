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
from stas_mcp.handlers import _load_registry, _parse_github_issue_url, check_status, get_pr, get_run_resource, label_issue, run_fix

logger = logging.getLogger(__name__)
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
    reg = _load_registry()
    l = max(1, min(limit, 100))
    issues = []
    for rid, e in reg.items():
        if status and e.get("status") != status: continue
        if repo and f"{e.get('owner', '')}/{e.get('repo', '')}" != repo: continue
        issues.append({"run_id": rid, "issue_url": e.get("issue_url"), "owner": e.get("owner"),
                       "repo": e.get("repo"), "issue_number": e.get("issue_number"),
                       "status": e.get("status", "unknown"), "pr_url": e.get("pr_url"),
                       "created_at": e.get("created_at"), "updated_at": e.get("updated_at")})
    issues.sort(key=lambda x: x.get("updated_at", "") or "", reverse=True)
    return {"success": True, "issues": issues[:l], "total": len(issues), "limit": l}

async def _search_codebase_handler(query, repo=None, max_results=10):
    if not query: return {"success": False, "error": "query is required"}
    l = max(1, min(max_results, 50))
    results, reg, q = [], _load_registry(), query.lower()
    for rid, e in reg.items():
        if repo and f"{e.get('owner', '')}/{e.get('repo', '')}" != repo: continue
        score, fields = 0, []
        if q in rid.lower(): score += 10; fields.append("run_id")
        if q in (e.get("issue_url", "") or "").lower(): score += 8; fields.append("issue_url")
        if q in (e.get("owner", "") or "").lower() or q in (e.get("repo", "") or "").lower(): score += 5; fields.append("repo")
        if q in (e.get("status", "") or "").lower(): score += 3; fields.append("status")
        if score > 0:
            results.append({"run_id": rid, "score": score, "matched_fields": fields,
                            "issue_url": e.get("issue_url"), "owner": e.get("owner"),
                            "repo": e.get("repo"), "issue_number": e.get("issue_number"),
                            "status": e.get("status"), "pr_url": e.get("pr_url"),
                            "created_at": e.get("created_at")})
    results.sort(key=lambda x: (-x["score"], x.get("created_at", "") or ""))
    return {"success": True, "query": query, "results": results[:l], "total": len(results), "limit": l}

async def _get_issue_resource_handler(issue_id):
    reg = _load_registry()
    parsed = _parse_github_issue_url(issue_id)
    owner = repo = number = None
    if parsed: owner, repo, number = parsed["owner"], parsed["repo"], parsed["issue_number"]
    matching = []
    for rid, e in reg.items():
        if parsed:
            if e.get("owner") == owner and e.get("repo") == repo and e.get("issue_number") == number:
                matching.append({"run_id": rid, "status": e.get("status"), "pr_url": e.get("pr_url"),
                                 "pr_number": e.get("pr_number"), "created_at": e.get("created_at"),
                                 "updated_at": e.get("updated_at")})
        elif rid == issue_id or e.get("issue_url") == issue_id:
            matching.append({"run_id": rid, "status": e.get("status"), "pr_url": e.get("pr_url"),
                             "pr_number": e.get("pr_number"), "created_at": e.get("created_at"),
                             "updated_at": e.get("updated_at")})
    matching.sort(key=lambda x: x.get("updated_at", "") or "", reverse=True)
    if not matching and parsed:
        return {"issue_id": issue_id, "owner": owner, "repo": repo, "issue_number": number,
                "status": "unknown", "runs": [], "message": "No fix runs found"}
    return {"issue_id": issue_id, "owner": owner, "repo": repo, "issue_number": number,
            "total_runs": len(matching), "runs": matching}

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
