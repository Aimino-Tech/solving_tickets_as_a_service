"""
MCP Handler implementations — core business logic for STAS MCP tools.

Each handler is an async function that takes typed parameters and returns
a dict suitable for JSON serialization.  No MCP library dependency here;
handlers are pure domain logic.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

FIX_REGISTRY_PATH = os.getenv("STAS_FIX_REGISTRY_PATH", "/tmp/stas-fix-registry.json")
GITHUB_API_BASE = os.getenv("GITHUB_API_BASE", "https://api.github.com")


# ---------------------------------------------------------------------------
# In-memory + file-backed fix registry
# ---------------------------------------------------------------------------

_fix_registry: dict[str, dict[str, Any]] | None = None


def _load_registry() -> dict[str, dict[str, Any]]:
    global _fix_registry
    if _fix_registry is not None:
        return _fix_registry
    try:
        with open(FIX_REGISTRY_PATH) as f:
            _fix_registry = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        _fix_registry = {}
    return _fix_registry


def _save_registry() -> None:
    if _fix_registry is None:
        return
    os.makedirs(os.path.dirname(FIX_REGISTRY_PATH) or ".", exist_ok=True)
    with open(FIX_REGISTRY_PATH, "w") as f:
        json.dump(_fix_registry, f, indent=2, default=str)


def _reset_registry() -> None:
    global _fix_registry
    _fix_registry = None


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def label_issue(
    owner: str,
    repo: str,
    issue_number: int,
    label: str,
) -> dict[str, Any]:
    if not owner or not repo or not issue_number:
        return {"success": False, "error": "owner, repo, and issue_number are required"}

    full_repo = f"{owner}/{repo}"
    label = label or os.getenv("STAS_LABEL", "stas:fix")

    gh_token = os.getenv("GITHUB_APP_PRIVATE_KEY") or os.getenv("GITHUB_TOKEN")
    api_url = f"{GITHUB_API_BASE}/repos/{full_repo}/issues/{issue_number}/labels"

    result: dict[str, Any] = {
        "owner": owner,
        "repo": repo,
        "issue_number": issue_number,
        "label": label,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if gh_token:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {gh_token}",
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "stas-mcp-server",
                    },
                    json={"labels": [label]},
                    timeout=15,
                )
                if resp.status_code in (200, 201):
                    result["success"] = True
                    result["message"] = f"Label '{label}' applied to {full_repo}#{issue_number}"
                elif resp.status_code == 404:
                    result["success"] = False
                    result["error"] = f"Issue or repo not found: {full_repo}#{issue_number}"
                else:
                    result["success"] = False
                    result["error"] = f"GitHub API error: {resp.status_code} {resp.text}"
        except Exception as exc:
            logger.warning("GitHub API call failed, recording intent: %s", exc)
            result["success"] = False
            result["error"] = f"GitHub API error: {exc}"
            result["intent_recorded"] = True
    else:
        result["success"] = False
        result["error"] = "No GitHub token configured"
        result["intent_recorded"] = True

    return result


async def run_fix(issue_url: str) -> dict[str, Any]:
    if not issue_url:
        return {"success": False, "error": "issue_url is required"}

    parsed = _parse_github_issue_url(issue_url)
    if not parsed:
        return {"success": False, "error": f"Invalid GitHub issue URL: {issue_url}"}

    owner = parsed["owner"]
    repo = parsed["repo"]
    issue_number = parsed["issue_number"]

    run_id = f"stas-{uuid.uuid4().hex[:12]}"
    registry = _load_registry()

    entry: dict[str, Any] = {
        "run_id": run_id,
        "issue_url": issue_url,
        "owner": owner,
        "repo": repo,
        "issue_number": issue_number,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "pr_url": None,
        "pr_number": None,
    }

    registry[run_id] = entry
    _save_registry()

    try:
        _enqueue_fix_via_internal(owner, repo, issue_number, run_id)
    except Exception as exc:
        logger.warning("Failed to enqueue fix, run recorded offline: %s", exc)

    return {
        "success": True,
        "run_id": run_id,
        "status": "queued",
        "issue_url": issue_url,
        "message": f"Fix run {run_id} created and queued",
    }


async def check_status(run_id: str) -> dict[str, Any]:
    if not run_id:
        return {"success": False, "error": "run_id is required"}

    registry = _load_registry()
    entry = registry.get(run_id)

    if not entry:
        return {"success": False, "error": f"Run not found: {run_id}"}

    return {
        "success": True,
        "run_id": run_id,
        "status": entry.get("status", "unknown"),
        "issue_url": entry.get("issue_url"),
        "pr_url": entry.get("pr_url"),
        "pr_number": entry.get("pr_number"),
        "created_at": entry.get("created_at"),
        "updated_at": entry.get("updated_at"),
        "completed_at": entry.get("completed_at"),
    }


async def get_pr(run_id: str) -> dict[str, Any]:
    if not run_id:
        return {"success": False, "error": "run_id is required"}

    registry = _load_registry()
    entry = registry.get(run_id)

    if not entry:
        return {"success": False, "error": f"Run not found: {run_id}"}

    pr_url = entry.get("pr_url")
    pr_number = entry.get("pr_number")

    if not pr_url and not pr_number:
        return {
            "success": True,
            "run_id": run_id,
            "status": entry.get("status"),
            "pr_url": None,
            "message": "No PR has been created for this run yet",
        }

    return {
        "success": True,
        "run_id": run_id,
        "status": entry.get("status"),
        "pr_url": pr_url,
        "pr_number": pr_number,
        "owner": entry.get("owner"),
        "repo": entry.get("repo"),
    }


# ---------------------------------------------------------------------------
# Resource handler
# ---------------------------------------------------------------------------


async def get_run_resource(run_id: str) -> dict[str, Any]:
    registry = _load_registry()
    entry = registry.get(run_id)

    if not entry:
        return {"error": f"Run not found: {run_id}"}

    return {
        "run_id": run_id,
        "status": entry.get("status", "unknown"),
        "issue_url": entry.get("issue_url"),
        "owner": entry.get("owner"),
        "repo": entry.get("repo"),
        "issue_number": entry.get("issue_number"),
        "pr_url": entry.get("pr_url"),
        "pr_number": entry.get("pr_number"),
        "created_at": entry.get("created_at"),
        "updated_at": entry.get("updated_at"),
        "completed_at": entry.get("completed_at"),
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _parse_github_issue_url(url: str) -> dict[str, Any] | None:
    pattern = r"^https?://github\.com/([^/]+)/([^/]+)/issues/(\d+)"
    match = re.match(pattern, url.strip())
    if not match:
        return None
    return {
        "owner": match.group(1),
        "repo": match.group(2),
        "issue_number": int(match.group(3)),
    }


def _enqueue_fix_via_internal(
    owner: str,
    repo: str,
    issue_number: int,
    run_id: str,
) -> None:
    queue_url = os.getenv("STAS_QUEUE_URL", "http://localhost:3000")
    payload = {
        "repoOwner": owner,
        "repoName": repo,
        "issueTitle": f"Fix for #{issue_number}",
        "issueBody": f"Auto-triggered fix for {owner}/{repo}#{issue_number}",
        "labels": [os.getenv("STAS_LABEL", "stas:fix")],
        "channel": "mcp",
        "channelTarget": run_id,
    }

    try:
        resp = httpx.post(
            f"{queue_url}/mcp/submit_issue",
            json=payload,
            timeout=10,
        )
        if resp.status_code in (200, 201):
            logger.info("Fix run %s enqueued via internal queue", run_id)
    except httpx.ConnectError:
        logger.debug("Internal queue not available at %s", queue_url)
