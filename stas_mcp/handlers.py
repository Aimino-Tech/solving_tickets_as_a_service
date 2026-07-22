"""
MCP Handler implementations — core business logic for STAS MCP tools.

Each handler is an async function that takes typed parameters and returns
a dict suitable for JSON serialization.  No MCP library dependency here;
handlers are pure domain logic.

All run state is backed by the STAS API (Node.js backend) via HTTP calls.
A local JSON file cache provides fallback when the API is unreachable.
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
STAS_API_URL = os.getenv("STAS_API_URL", "http://localhost:3000")
STAS_API_KEY = os.getenv("STAS_API_KEY", "")

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


def _api_headers() -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "stas-mcp-server",
    }
    if STAS_API_KEY:
        headers["Authorization"] = f"Bearer {STAS_API_KEY}"
    return headers


async def _call_api(method: str, path: str, json_body: dict | None = None) -> dict[str, Any] | None:
    url = f"{STAS_API_URL.rstrip('/')}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.request(
                method=method,
                url=url,
                headers=_api_headers(),
                json=json_body,
                timeout=15,
            )
            if resp.status_code in (200, 201):
                return resp.json()
            logger.warning("API returned %s for %s %s: %s", resp.status_code, method, path, resp.text[:200])
            return None
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.debug("API unreachable at %s — fallback to local cache: %s", url, exc)
        return None


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

    # Try the real API first
    api_result = await _call_api("POST", "/mcp/submit_issue", {
        "repoOwner": owner,
        "repoName": repo,
        "issueNumber": issue_number,
        "issueTitle": f"Fix for #{issue_number}",
        "issueBody": f"Auto-triggered fix for {owner}/{repo}#{issue_number}",
        "labels": [os.getenv("STAS_LABEL", "stas:fix")],
        "channel": "mcp",
    })

    if api_result and api_result.get("runId"):
        run_id = api_result["runId"]
        return {
            "success": True,
            "run_id": run_id,
            "status": "queued",
            "issue_url": issue_url,
            "message": f"Fix run {run_id} created and queued via STAS API",
        }

    # Fallback: create a local run entry
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
        "message": f"Fix run {run_id} created and queued (local fallback)",
    }


async def _fetch_run_from_api(run_id: str) -> dict[str, Any] | None:
    api_result = await _call_api("GET", f"/mcp/status/{run_id}")
    if api_result:
        return {
            "run_id": api_result.get("runId", run_id),
            "status": api_result.get("status", "unknown"),
            "issue_url": None,
            "pr_url": api_result.get("prUrl"),
            "pr_number": None,
            "created_at": api_result.get("createdAt"),
            "updated_at": api_result.get("updatedAt"),
            "completed_at": api_result.get("completedAt"),
        }
    return None


async def check_status(run_id: str) -> dict[str, Any]:
    if not run_id:
        return {"success": False, "error": "run_id is required"}

    # Try the real API
    api_run = await _fetch_run_from_api(run_id)
    if api_run:
        return {
            "success": True,
            "run_id": run_id,
            "status": api_run.get("status", "unknown"),
            "issue_url": api_run.get("issue_url"),
            "pr_url": api_run.get("pr_url"),
            "pr_number": api_run.get("pr_number"),
            "created_at": api_run.get("created_at"),
            "updated_at": api_run.get("updated_at"),
            "completed_at": api_run.get("completed_at"),
        }

    # Fallback to local cache
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

    # Try the real API
    api_run = await _fetch_run_from_api(run_id)
    if api_run:
        pr_url = api_run.get("pr_url")
        pr_number = api_run.get("pr_number")
        if not pr_url and not pr_number:
            return {
                "success": True,
                "run_id": run_id,
                "status": api_run.get("status"),
                "pr_url": None,
                "message": "No PR has been created for this run yet",
            }
        return {
            "success": True,
            "run_id": run_id,
            "status": api_run.get("status"),
            "pr_url": pr_url,
            "pr_number": pr_number,
            "owner": None,
            "repo": None,
        }

    # Fallback to local cache
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


async def get_run_resource(run_id: str) -> dict[str, Any]:
    # Try the real API
    api_run = await _fetch_run_from_api(run_id)
    if api_run:
        return api_run

    # Fallback to local cache
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


async def list_runs_from_api(status: str | None = None, repo: str | None = None, limit: int = 20) -> dict[str, Any] | None:
    params = {}
    if status:
        params["status"] = status
    if repo:
        params["repo"] = repo
    params["limit"] = str(max(1, min(limit, 100)))

    query_string = "&".join(f"{k}={v}" for k, v in params.items())
    path = f"/mcp/history?{query_string}" if query_string else "/mcp/history"
    api_result = await _call_api("GET", path)
    if api_result and "runs" in api_result:
        return api_result
    return None


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
