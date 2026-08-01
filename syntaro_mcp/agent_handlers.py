"""
Agent-facing MCP handlers — expose OpenSymphony/STAS capabilities to external agents.

Covers the viral user-story matrix that the first-generation server did not:
  - Linear ticket check + create        (agents verify/create tickets in our tracker)
  - Hermes-style memory read + write    (agents persist/recall conversation memory)
  - Slack send                          (agents post to our Slack workspace)
  - Session resume                      (agents rehydrate a conversation's context)

Each handler is an async function taking typed params and returning a dict
suitable for JSON serialization. Credentials come from env vars so the server
can be run anywhere (local dev, the K8s warm pod, or as an open-source binary).
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

LINEAR_API_URL = os.getenv("LINEAR_API_URL", "https://api.linear.app/graphql")
LINEAR_API_KEY = os.getenv("SYMPHONY_LINEAR_API_KEY") or os.getenv("LINEAR_API_KEY", "")
SLACK_API_URL = os.getenv("SLACK_API_URL", "https://slack.com/api")
SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
MEMORY_DIR = os.getenv("MEMORY_DIR", "/tmp/symphony-workspaces/memory")

# Matches Linear identifiers like AIM-4477 or OSY-12.
_LINEAR_IDENTIFIER_RE = re.compile(r"^([A-Z][A-Z0-9]*)-(\d+)$", re.IGNORECASE)


def _linear_headers() -> dict[str, str]:
    # Linear accepts the API key as the raw Authorization value (no Bearer prefix).
    return {
        "Authorization": LINEAR_API_KEY,
        "Content-Type": "application/json",
    }


async def _linear_query(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    if not LINEAR_API_KEY:
        return {"success": False, "error": "Linear API key not configured (SYMPHONY_LINEAR_API_KEY or LINEAR_API_KEY)"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                LINEAR_API_URL,
                headers=_linear_headers(),
                json={"query": query, "variables": variables},
                timeout=15,
            )
            if resp.status_code != 200:
                return {"success": False, "error": f"Linear API error: HTTP {resp.status_code} {resp.text[:200]}"}
            body = resp.json()
            if body.get("errors"):
                return {"success": False, "error": "Linear API error: " + "; ".join(e.get("message", "") for e in body["errors"])}
            return {"success": True, "data": body.get("data", {})}
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return {"success": False, "error": f"Linear API unreachable: {exc}"}


async def linear_ticket(identifier: str) -> dict[str, Any]:
    """Check whether a Linear ticket exists and return its details."""
    if not identifier:
        return {"success": False, "error": "identifier is required (e.g. AIM-4477)"}

    match = _LINEAR_IDENTIFIER_RE.match(identifier.strip())
    if not match:
        return {"success": False, "error": f"Invalid Linear identifier: {identifier} (expected e.g. AIM-4477)"}

    team_key, number = match.group(1).upper(), int(match.group(2))
    query = """
        query Issue($teamKey: String!, $number: Float!) {
          issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
            nodes {
              id identifier title url description state { name }
            }
          }
        }
    """
    result = await _linear_query(query, {"teamKey": team_key, "number": number})
    if not result.get("success"):
        return result

    nodes = result["data"].get("issues", {}).get("nodes", [])
    if not nodes:
        return {
            "success": True,
            "exists": False,
            "identifier": identifier.strip().upper(),
            "message": f"Ticket {identifier.strip().upper()} does not exist in Linear",
        }

    issue = nodes[0]
    return {
        "success": True,
        "exists": True,
        "id": issue.get("id"),
        "identifier": issue.get("identifier"),
        "title": issue.get("title"),
        "url": issue.get("url"),
        "state": (issue.get("state") or {}).get("name"),
        "description": issue.get("description"),
    }


async def _resolve_team_id(team_key: str | None = None) -> str | None:
    query = """
        query Teams {
          teams(first: 50) {
            nodes { id key name }
          }
        }
    """
    result = await _linear_query(query, {})
    if not result.get("success"):
        return None
    teams = result["data"].get("teams", {}).get("nodes", [])
    if not teams:
        return None
    if team_key:
        key = team_key.strip().upper()
        for team in teams:
            if str(team.get("key", "")).upper() == key:
                return team.get("id")
    return teams[0].get("id")


async def linear_create_ticket(title: str, description: str | None = None, priority: int | None = None, team_key: str | None = None) -> dict[str, Any]:
    """Create a Linear ticket in our workspace (team resolved by key, defaulting to the first team)."""
    if not title or not str(title).strip():
        return {"success": False, "error": "title is required"}

    team_id = await _resolve_team_id(team_key)
    if not team_id:
        return {"success": False, "error": "Could not resolve a Linear team (teams query failed or returned none)"}

    query = """
        mutation CreateIssue($title: String!, $description: String, $priority: Int, $teamId: String!) {
          issueCreate(input: { title: $title, description: $description, priority: $priority, teamId: $teamId }) {
            success
            issue { id identifier title description priority url createdAt }
          }
        }
    """
    variables: dict[str, Any] = {"title": str(title).strip(), "teamId": team_id}
    if description:
        variables["description"] = description
    if priority is not None:
        variables["priority"] = priority

    result = await _linear_query(query, variables)
    if not result.get("success"):
        return result

    issue = result["data"].get("issueCreate", {}).get("issue")
    if not issue:
        return {"success": False, "error": "Linear API returned success=false"}
    return {"success": True, "issue": issue}


def _safe_memory_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_\-]", "", name.strip())
    if not cleaned:
        return "user"
    return cleaned


def memory_read(name: str = "user") -> dict[str, Any]:
    """Read a Hermes-style agent memory file (facts/decisions/preferences/plan in markdown)."""
    safe = _safe_memory_name(name)
    path = Path(MEMORY_DIR) / f"{safe}.md"
    try:
        content = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return {"success": True, "name": safe, "path": str(path), "content": None, "message": f"No memory file yet at {path}"}
    except OSError as exc:
        return {"success": False, "error": f"Failed to read memory file: {exc}"}
    return {"success": True, "name": safe, "path": str(path), "content": content}


def memory_write(name: str, content: str) -> dict[str, Any]:
    """Write a Hermes-style agent memory file (facts/decisions/preferences/plan in markdown)."""
    if content is None:
        return {"success": False, "error": "content is required"}
    safe = _safe_memory_name(name)
    path = Path(MEMORY_DIR) / f"{safe}.md"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    except OSError as exc:
        return {"success": False, "error": f"Failed to write memory file: {exc}"}
    return {"success": True, "name": safe, "path": str(path), "bytes": path.stat().st_size}


async def slack_send(channel: str, text: str, thread_ts: str | None = None) -> dict[str, Any]:
    """Post a message to a Slack channel/thread using the STAS bot token."""
    if not channel or not text:
        return {"success": False, "error": "channel and text are required"}
    if not SLACK_BOT_TOKEN:
        return {"success": False, "error": "SLACK_BOT_TOKEN not configured"}
    body: dict[str, Any] = {"channel": channel, "text": text}
    if thread_ts:
        body["thread_ts"] = thread_ts
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{SLACK_API_URL}/chat.postMessage",
                headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}", "Content-Type": "application/json"},
                json=body,
                timeout=15,
            )
            payload = resp.json()
            if payload.get("ok"):
                return {"success": True, "channel": channel, "ts": payload.get("ts")}
            return {"success": False, "error": f"Slack API error: {payload.get('error', 'unknown')}"}
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return {"success": False, "error": f"Slack API unreachable: {exc}"}


def session_resume(workspace_path: str) -> dict[str, Any]:
    """Return a conversation's maintained MEMORY.md so an agent can resume it."""
    if not workspace_path:
        return {"success": False, "error": "workspace_path is required"}
    memory_file = Path(workspace_path) / "MEMORY.md"
    try:
        content = memory_file.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return {"success": True, "workspace_path": workspace_path, "content": None, "message": "No MEMORY.md yet in this workspace"}
    except OSError as exc:
        return {"success": False, "error": f"Failed to read workspace memory: {exc}"}
    return {"success": True, "workspace_path": workspace_path, "content": content}
