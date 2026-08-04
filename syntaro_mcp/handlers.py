"""
MCP Handler implementations — core business logic for SYNTARO MCP tools.

Each handler is an async function that takes typed parameters and returns
a dict suitable for JSON serialization.

Run state is backed by the OpenSymphony PipelineEngine (Celery + Redis)
via PipelineClient, with the SYNTARO API (Node.js backend) as fallback.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from workers.pipeline_client import get_client

logger = logging.getLogger(__name__)

GITHUB_API_BASE = os.getenv("GITHUB_API_BASE", "https://api.github.com")
SYNTARO_API_URL = os.getenv("SYNTARO_API_URL", "http://localhost:3000")
SYNTARO_API_KEY = os.getenv("SYNTARO_API_KEY", "")

_pipeline = get_client()


def _api_headers() -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "syntaro-mcp-server",
    }
    if SYNTARO_API_KEY:
        headers["Authorization"] = f"Bearer {SYNTARO_API_KEY}"
    return headers


async def _call_api(method: str, path: str, json_body: dict | None = None) -> dict[str, Any] | None:
    url = f"{SYNTARO_API_URL.rstrip('/')}/{path.lstrip('/')}"
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
    label = label or os.getenv("SYNTARO_LABEL", "syntaro:fix")

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
                        "User-Agent": "syntaro-mcp-server",
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

    result = _pipeline.submit_fix(
        owner=owner,
        repo=f"{owner}/{repo}",
        issue_number=issue_number,
        issue_url=issue_url,
    )

    if not result.get("success"):
        api_result = await _call_api("POST", "/mcp/submit_issue", {
            "repoOwner": owner,
            "repoName": repo,
            "issueNumber": issue_number,
            "issueTitle": f"Fix for #{issue_number}",
            "issueBody": f"Auto-triggered fix for {owner}/{repo}#{issue_number}",
            "labels": [os.getenv("SYNTARO_LABEL", "syntaro:fix")],
            "channel": "mcp",
        })
        if api_result and api_result.get("runId"):
            return {
                "success": True,
                "run_id": api_result["runId"],
                "status": "queued",
                "issue_url": issue_url,
                "owner": owner, "repo": repo, "issue_number": issue_number,
                "message": f"Fix run {api_result['runId']} created and queued via SYNTARO API",
            }

    return {
        "success": result.get("success", False),
        "run_id": result.get("run_id", ""),
        "pipeline_id": result.get("pipeline_id", ""),
        "status": result.get("status", "queued"),
        "issue_url": issue_url,
        "owner": owner,
        "repo": repo,
        "issue_number": issue_number,
        "message": result.get("message", f"Fix submitted — run_id={result.get('run_id', '')}"),
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

    result = _pipeline.check_status(run_id)

    if not result.get("success"):
        api_run = await _fetch_run_from_api(run_id)
        if api_run:
            result = api_run

    return {
        "success": result.get("success", False),
        "run_id": run_id,
        "status": result.get("status", "unknown"),
        "current_stage": result.get("current_stage", ""),
        "progress": result.get("progress", 0.0),
        "pipeline_id": result.get("pipeline_id", ""),
        "error": result.get("error"),
    }


async def get_pr(run_id: str) -> dict[str, Any]:
    if not run_id:
        return {"success": False, "error": "run_id is required"}

    result = _pipeline.check_status(run_id)
    if not result.get("success"):
        api_run = await _fetch_run_from_api(run_id)
        if api_run:
            result = api_run

    pr_url = result.get("pr_url")
    pr_number = result.get("pr_number")

    if not pr_url:
        return {
            "success": True,
            "run_id": run_id,
            "status": result.get("status", "unknown"),
            "pr_url": None,
            "message": "No PR has been created for this run yet",
        }

    return {
        "success": True,
        "run_id": run_id,
        "status": result.get("status"),
        "pr_url": pr_url,
        "pr_number": pr_number,
    }


async def get_run_resource(run_id: str) -> dict[str, Any]:
    result = _pipeline.check_status(run_id)
    if not result.get("success"):
        api_run = await _fetch_run_from_api(run_id)
        if api_run:
            result = api_run

    if not result.get("success"):
        return {"error": result.get("error", f"Run not found: {run_id}")}

    return {
        "run_id": run_id,
        "status": result.get("status", "unknown"),
        "current_stage": result.get("current_stage", ""),
        "progress": result.get("progress", 0.0),
        "created_at": result.get("created_at"),
        "updated_at": result.get("updated_at"),
        "error": result.get("error"),
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



