"""
Create GitHub Pull Requests using GitHub App installation tokens.

Reads GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH from the environment,
generates a JWT, exchanges it for an installation token, and creates a PR.
"""

import json
import logging
import os
import time
from typing import Any

import httpx
import jwt
from celery import shared_task

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# GitHub App JWT helpers
# ---------------------------------------------------------------------------


def _load_private_key() -> str:
    path = os.getenv("GITHUB_APP_PRIVATE_KEY_PATH", "")
    if not path:
        raise ValueError("GITHUB_APP_PRIVATE_KEY_PATH is not set")
    with open(path, "r") as f:
        return f.read()


def _create_jwt(app_id: str, private_key: str) -> str:
    now = int(time.time())
    payload = {
        "iat": now - 60,       # issued 60s ago to avoid clock skew
        "exp": now + 600,      # expires in 10 minutes (max allowed)
        "iss": app_id,
    }
    return jwt.encode(payload, private_key, algorithm="RS256")


def _get_installation_token(installation_id: int) -> str:
    """Exchange JWT for an installation access token via GitHub API."""
    app_id = os.getenv("GITHUB_APP_ID", "")
    if not app_id:
        raise ValueError("GITHUB_APP_ID is not set")

    private_key = _load_private_key()
    jwt_token = _create_jwt(app_id, private_key)

    url = f"https://api.github.com/app/installations/{installation_id}/access_tokens"
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github.v3+json",
    }

    with httpx.Client() as client:
        resp = client.post(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["token"]


def _parse_repo_info(repo_full_name: str) -> tuple[str, str]:
    """Parse 'owner/repo' into (owner, repo)."""
    parts = repo_full_name.split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid repo_full_name: {repo_full_name!r}")
    return parts[0], parts[1]


def _call_github(
    method: str,
    path: str,
    token: str,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Make a GitHub API call with the given token."""
    url = f"https://api.github.com{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "STAS-Bot",
    }
    with httpx.Client() as client:
        resp = client.request(method, url, headers=headers, json=json_body)
        if resp.status_code >= 400:
            logger.error(
                "GitHub API error %s %s: %d %s",
                method, path, resp.status_code, resp.text[:500],
            )
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.pr_creation.create_pull_request",
    autoretry_for=(Exception,),
)
def create_pull_request(
    self,
    fix_result: dict,
    repo_info: dict,
    correlation_id: str = "",
) -> dict:
    """
    Create a Pull Request on GitHub using the installation token flow.

    ``fix_result`` is expected to contain:
        - branch (str) — head branch name
        - base_branch (str, default "main") — target branch
        - summary (str, optional) — PR body
    ``repo_info`` is expected to contain:
        - owner (str)
        - repo (str)
        - installation_id (int)

    Returns the GitHub API response for the created PR.
    """
    owner = repo_info.get("owner", "?")
    repo = repo_info.get("repo", "?")
    branch = fix_result.get("branch", "")
    base_branch = fix_result.get("base_branch", "main")
    summary = fix_result.get("summary", "STAS automated fix")
    installation_id = repo_info.get("installation_id")

    logger.info(
        json.dumps({
            "event": "pr_creation.start",
            "owner": owner,
            "repo": repo,
            "branch": branch,
            "base_branch": base_branch,
            "correlation_id": correlation_id,
        })
    )

    if not branch:
        logger.warning(
            json.dumps({
                "event": "pr_creation.skipped",
                "reason": "no branch provided",
                "correlation_id": correlation_id,
            })
        )
        return {
            "repo_info": repo_info,
            "fix_result": fix_result,
            "html_url": None,
            "status": "skipped_no_branch",
        }

    try:
        token = _get_installation_token(installation_id)

        pr_data = {
            "title": f"fix: {branch.replace('-', ' ').title()}",
            "head": branch,
            "base": base_branch,
            "body": summary,
            "maintainer_can_modify": True,
        }

        result = _call_github(
            "POST",
            f"/repos/{owner}/{repo}/pulls",
            token,
            json_body=pr_data,
        )

        html_url = result.get("html_url", "")
        pr_number = result.get("number")

        logger.info(
            json.dumps({
                "event": "pr_creation.complete",
                "html_url": html_url,
                "pr_number": pr_number,
                "correlation_id": correlation_id,
            })
        )
        return {
            "repo_info": repo_info,
            "fix_result": fix_result,
            "html_url": html_url,
            "number": pr_number,
            "status": "created",
        }

    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 422:
            body = exc.response.json()
            logger.warning(
                json.dumps({
                    "event": "pr_creation.already_exists",
                    "message": body.get("message", ""),
                    "correlation_id": correlation_id,
                })
            )
            return {
                "repo_info": repo_info,
                "fix_result": fix_result,
                "html_url": None,
                "status": "already_exists",
                "error": body.get("errors", body.get("message", "")),
            }
        logger.error(
            json.dumps({
                "event": "pr_creation.error",
                "error": str(exc),
                "correlation_id": correlation_id,
            })
        )
        raise self.retry(exc=exc)

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "pr_creation.error",
                "error": str(exc),
                "correlation_id": correlation_id,
            }),
            exc_info=True,
        )
        raise self.retry(exc=exc)
