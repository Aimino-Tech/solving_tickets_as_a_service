"""
FastMCP server — expose STAS as auto-discoverable agent infrastructure.

Tools:
  - stas_label_issue   — Label a GitHub issue.
  - stas_run_fix       — Trigger a fix pipeline for a GitHub issue.
  - stas_check_status  — Check the status of a fix run.
  - stas_get_pr        — Get PR details for a completed fix run.

Resources:
  - stas://runs/{run_id} — Real-time status + PR link for a fix run.

Run modes:
  - ``python -m stas_mcp.server``        (SSE mode, default port 4095)
  - ``python -m stas_mcp.server stdio``  (stdio mode for OpenCode integration)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from mcp.server.fastmcp import FastMCP

from stas_mcp.handlers import (
    check_status,
    get_pr,
    get_run_resource,
    label_issue,
    run_fix,
)

logger = logging.getLogger(__name__)

SERVER_NAME = "stas-agent-discovery"
SERVER_VERSION = "0.1.0"

mcp = FastMCP(
    SERVER_NAME,
    instructions="""STAS (Solving Tickets As A Service) — label a GitHub issue and get a PR.

Available tools:
- **stas_label_issue**: Add a label (e.g. "stas:fix") to a GitHub issue.
- **stas_run_fix**: Trigger the full STAS pipeline for an issue URL. Returns a run_id for polling.
- **stas_check_status**: Poll the status of a fix run by run_id.
- **stas_get_pr**: Get the PR URL and details for a completed run.

Resources:
- **stas://runs/{run_id}**: Full run details including status, timestamps, and PR link.
""",
)


@mcp.tool(
    name="stas_label_issue",
    description="Label a GitHub issue with the STAS fix label (or custom label).",
)
async def stas_label_issue(
    owner: str,
    repo: str,
    issue_number: int,
    label: str = "stas:fix",
) -> str:
    result = await label_issue(owner, repo, issue_number, label)
    return json.dumps(result, indent=2, default=str)


@mcp.tool(
    name="stas_run_fix",
    description="Trigger the STAS fix pipeline for a GitHub issue URL. Returns a run_id for polling.",
)
async def stas_run_fix(issue_url: str) -> str:
    result = await run_fix(issue_url)
    return json.dumps(result, indent=2, default=str)


@mcp.tool(
    name="stas_check_status",
    description="Check the current status of a STAS fix run by run_id.",
)
async def stas_check_status(run_id: str) -> str:
    result = await check_status(run_id)
    return json.dumps(result, indent=2, default=str)


@mcp.tool(
    name="stas_get_pr",
    description="Get the pull request URL and details for a completed STAS fix run.",
)
async def stas_get_pr(run_id: str) -> str:
    result = await get_pr(run_id)
    return json.dumps(result, indent=2, default=str)


@mcp.resource(
    uri="stas://runs/{run_id}",
    name="Fix Run Status",
    description="Real-time status and PR link for a STAS fix run.",
    mime_type="application/json",
)
async def run_status(run_id: str) -> str:
    result = await get_run_resource(run_id)
    return json.dumps(result, indent=2, default=str)


def run_stdio() -> None:
    logger.info("Starting STAS MCP server in stdio mode")
    mcp.run(transport="stdio")


def run_sse(host: str = "0.0.0.0", port: int = 4095) -> None:
    logger.info("Starting STAS MCP server on %s:%d (SSE)", host, port)
    mcp.run(transport="sse", host=host, port=port)


def main() -> None:
    parser = argparse.ArgumentParser(description="STAS MCP Agent Discovery Server")
    parser.add_argument("mode", nargs="?", default="sse", choices=["sse", "stdio"],
                        help="Transport mode (default: sse)")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host (SSE mode)")
    parser.add_argument("--port", type=int, default=int(os.getenv("STAS_MCP_PORT", "4095")),
                        help="Bind port (SSE mode)")
    parser.add_argument("--log-level", default="INFO",
                        choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    if args.mode == "stdio":
        run_stdio()
    else:
        run_sse(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
