from __future__ import annotations
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from app.tracking import tracker

DIRECTORY_CONFIGS: list[dict[str, Any]] = [
    {"name": "smithery", "url": "https://smithery.ai/server/@surfsense/fast-html-mcp", "method": "api", "api_url": "https://api.smithery.ai/v1/servers"},
    {"name": "mcp.so", "url": "https://mcp.so/server/@surfsense/fast-html-mcp", "method": "api", "api_url": "https://api.mcp.so/v1/servers"},
    {"name": "glama", "url": "https://glama.ai/mcp/servers/@surfsense/fast-html-mcp", "method": "api", "api_url": "https://api.glama.ai/v1/mcp-servers"},
    {"name": "github (mcp-servers)", "url": "https://github.com/punkpeye/awesome-mcp-servers", "method": "pr", "repo": "punkpeye/awesome-mcp-servers"},
    {"name": "mcp-get", "url": "https://mcp-get.com/", "method": "manual", "note": "Manual listing request required"},
    {"name": "mcp-marketplace", "url": "https://mcp-marketplace.dev", "method": "api", "api_url": "https://api.mcp-marketplace.dev/v1/servers"},
    {"name": "mcp-hub", "url": "https://mcp-hub.com", "method": "api", "api_url": "https://api.mcp-hub.com/v1/servers"},
    {"name": "mcp-registry", "url": "https://mcp-registry.com", "method": "api", "api_url": "https://api.mcp-registry.com/v1/servers"},
    {"name": "npm (registry)", "url": "https://www.npmjs.com/package/@surfsense/fast-html-mcp", "method": "npm", "package": "@surfsense/fast-html-mcp"},
    {"name": "mcp-cheatsheet", "url": "https://mcp-cheatsheet.com/", "method": "manual", "note": "Submit via web form"},
]

SERVER_MANIFEST = {
    "name": "fast-html-mcp",
    "version": "0.1.0",
    "description": "High-performance HTML-to-MCP server for fetching, processing, and converting web content into structured MCP resources",
    "repository": "https://github.com/Aimino-Tech/fast-html-mcp",
    "npm": "@surfsense/fast-html-mcp",
    "categories": ["web-content", "html-processing", "mcp-server"],
    "tags": ["html", "mcp", "web-scraping", "content-extraction"],
    "license": "MIT",
    "author": "Aimino Tech",
    "languages": ["typescript"],
    "runtime": "node",
    "features": ["html-to-markdown", "content extraction", "web scraping", "mcp resources"],
    "install": "npx @surfsense/fast-html-mcp",
    "config_schema": {
        "type": "object",
        "properties": {
            "apiKey": {"type": "string", "description": "API key for premium features"}
        }
    }
}


def _log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", file=sys.stderr)


def submit_to_directory(dir_config: dict[str, Any], gh_token: str | None = None) -> dict[str, Any]:
    name = dir_config["name"]
    method = dir_config.get("method", "manual")

    if method == "api":
        api_url = dir_config.get("api_url")
        if api_url and gh_token:
            try:
                resp = httpx.post(
                    api_url,
                    headers={"Authorization": f"Bearer {gh_token}", "Content-Type": "application/json"},
                    json=SERVER_MANIFEST,
                    timeout=30,
                )
                if resp.status_code in (200, 201):
                    _log(f"{name}: submitted via API (HTTP {resp.status_code})")
                    tracker.track_directory_submission(name, "submitted", "api", api_url)
                    return {"directory": name, "status": "submitted", "method": "api", "url": api_url}
                elif resp.status_code == 404:
                    _log(f"{name}: API endpoint not found (404), marking as manual")
                    tracker.track_directory_submission(name, "manual", "api", api_url, "API 404")
                    return {"directory": name, "status": "manual", "method": "manual", "note": "API 404, check docs"}
                else:
                    _log(f"{name}: API returned {resp.status_code}, marking as manual")
                    tracker.track_directory_submission(name, "error", "api", api_url, f"HTTP {resp.status_code}")
                    return {"directory": name, "status": "error", "method": "api", "error": f"HTTP {resp.status_code}"}
            except Exception as e:
                _log(f"{name}: API error: {e}")
                tracker.track_directory_submission(name, "error", "api", api_url, str(e))
                return {"directory": name, "status": "error", "method": "api", "error": str(e)}
        _log(f"{name}: API method with no token configured, marking as manual")
        tracker.track_directory_submission(name, "manual", "api", dir_config.get("url"), "No API token")
        return {"directory": name, "status": "manual", "method": "manual", "note": "No API token available"}

    elif method == "npm":
        _log(f"{name}: Requires npm publish: `npm publish`")
        tracker.track_directory_submission(name, "manual", "npm", dir_config.get("url"), "Requires npm publish")
        return {"directory": name, "status": "manual", "method": "npm", "note": "Run: npm publish"}

    else:
        _log(f"{name}: Manual submission required - {dir_config.get('note', '')}")
        tracker.track_directory_submission(name, "manual", "manual", dir_config.get("url"), dir_config.get("note", ""))
        return {"directory": name, "status": "manual", "method": "manual", "note": dir_config.get("note", "")}


def generate_server_json(output_path: str | None = None) -> str:
    path = output_path or str(Path(__file__).parent.parent / "server.json")
    with open(path, "w") as f:
        json.dump(SERVER_MANIFEST, f, indent=2)
    _log(f"server.json written to {path}")
    return path


def generate_pr_body() -> str:
    return f"""# Add @surfsense/fast-html-mcp to awesome-mcp-servers

## Server Details

- **Name**: fast-html-mcp
- **Description**: {SERVER_MANIFEST['description']}
- **Repository**: {SERVER_MANIFEST['repository']}
- **Install**: {SERVER_MANIFEST['install']}
- **License**: {SERVER_MANIFEST['license']}

## Checklist
- [x] Server is publicly available on npm: @surfsense/fast-html-mcp
- [x] Repository is open-source with MIT license
- [x] Server fetches and processes HTML content into structured MCP resources
- [x] Follows MCP protocol specification

## Categories
{SERVER_MANIFEST['categories']}
"""


def find_awesome_mcp_servers_pr_target(repo_path: str | None = None) -> dict[str, Any]:
    servers_md = Path(repo_path or ".") / "servers.md" if repo_path else Path("servers.md")
    if servers_md.exists():
        content = servers_md.read_text()
        _log(f"Found servers.md ({len(content)} chars), checking for insertion point")
        return {"found": True, "path": str(servers_md), "preview": content[:200] if content else ""}
    _log("servers.md not found locally, will need to fork and clone")
    return {"found": False, "note": "Clone github.com/punkpeye/awesome-mcp-servers first"}


def submit_all(gh_token: str | None = None) -> list[dict[str, Any]]:
    results = []
    for cfg in DIRECTORY_CONFIGS:
        result = submit_to_directory(cfg, gh_token)
        results.append(result)
    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Submit fast-html-mcp to MCP directories")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("submit-all", help="Submit to all MCP directories")
    sub.add_parser("list", help="List all target directories")
    sub.add_parser("server-json", help="Generate server.json manifest")
    sub.add_parser("pr-body", help="Generate awesome-mcp-servers PR body")
    sub.add_parser("find-pr-target", help="Find awesome-mcp-servers PR insertion point")

    p_submit_one = sub.add_parser("submit", help="Submit to a specific directory")
    p_submit_one.add_argument("name", choices=[d["name"] for d in DIRECTORY_CONFIGS])

    args = parser.parse_args()
    gh_token = os.getenv("MCP_MARKETING_GH_TOKEN")

    if args.command == "submit-all":
        results = submit_all(gh_token)
        print(json.dumps(results, indent=2))
    elif args.command == "list":
        print(json.dumps(DIRECTORY_CONFIGS, indent=2))
    elif args.command == "server-json":
        path = generate_server_json()
        print(json.dumps({"path": path}))
    elif args.command == "pr-body":
        print(generate_pr_body())
    elif args.command == "find-pr-target":
        result = find_awesome_mcp_servers_pr_target()
        print(json.dumps(result, indent=2))
    elif args.command == "submit":
        cfg = next(d for d in DIRECTORY_CONFIGS if d["name"] == args.name)
        result = submit_to_directory(cfg, gh_token)
        print(json.dumps(result, indent=2))
