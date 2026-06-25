"""STAS MCP Server — re-exports FastMCP server from stas_mcp.server."""
from stas_mcp.server import (  # noqa: F401
    _get_issue_resource_handler, _list_issues_handler, _search_codebase_handler,
    check_status, get_pr, issue_status, list_issues_tool, main, mcp, run_fix,
    run_sse, run_stdio, run_status, search_codebase_tool, stas_check_status,
    stas_get_pr, stas_label_issue, stas_run_fix,
)
