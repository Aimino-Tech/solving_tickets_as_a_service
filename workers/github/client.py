import json
import logging
import os
import subprocess
import time
from typing import Any

import httpx
import jwt

logger = logging.getLogger(__name__)


def load_private_key() -> str:
    path = os.getenv("GITHUB_APP_PRIVATE_KEY_PATH", "")
    if not path:
        raise ValueError("GITHUB_APP_PRIVATE_KEY_PATH is not set")
    with open(path) as f:
        return f.read()


def create_jwt(app_id: str, private_key: str) -> str:
    now = int(time.time())
    payload = {
        "iat": now - 60,
        "exp": now + 600,
        "iss": app_id,
    }
    return jwt.encode(payload, private_key, algorithm="RS256")


def get_installation_token(installation_id: int) -> str:
    app_id = os.getenv("GITHUB_APP_ID", "")
    if not app_id:
        raise ValueError("GITHUB_APP_ID is not set")
    private_key = load_private_key()
    jwt_token = create_jwt(app_id, private_key)
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


def parse_repo_info(repo_full_name: str) -> tuple[str, str]:
    parts = repo_full_name.split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid repo_full_name: {repo_full_name!r}")
    return parts[0], parts[1]


class GitHubClient:
    def __init__(
        self,
        token: str | None = None,
        installation_id: int | None = None,
    ) -> None:
        self._token = token
        self._installation_id = installation_id

    def _resolve_token(self) -> str:
        if self._token:
            return self._token
        if self._installation_id:
            return get_installation_token(self._installation_id)
        env_token = os.getenv("GITHUB_TOKEN", "")
        if env_token:
            return env_token
        raise ValueError(
            "No GitHub token available. Set GITHUB_TOKEN env, "
            "pass token=, or pass installation_id=."
        )

    def _request(
        self,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        token = self._resolve_token()
        url = f"https://api.github.com{path}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "SYNTARO-Bot",
        }
        with httpx.Client() as client:
            resp = client.request(method, url, headers=headers, json=json_body)
            if resp.status_code >= 400:
                logger.error(
                    "GitHub API error %s %s: %d %s",
                    method,
                    path,
                    resp.status_code,
                    resp.text[:500],
                )
            resp.raise_for_status()
            return resp.json()

    def push_branch(self, workspace_path: str, branch_name: str) -> None:
        subprocess.run(
            ["git", "push", "origin", branch_name],
            cwd=workspace_path,
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Pushed branch '%s' to origin", branch_name)

    def create_pr(
        self,
        repo_name: str,
        branch_name: str,
        base_branch: str,
        title: str,
        body: str,
        labels: list[str] | None = None,
    ) -> dict[str, Any]:
        pr_data = {
            "title": title,
            "head": branch_name,
            "base": base_branch,
            "body": body,
            "maintainer_can_modify": True,
        }
        result = self._request("POST", f"/repos/{repo_name}/pulls", json_body=pr_data)
        pr_url = result.get("html_url", "")
        pr_number = result.get("number")
        logger.info("PR created — %s (#%s)", pr_url, pr_number)
        output = {
            "pr_url": pr_url,
            "pr_number": pr_number,
            "status": "opened",
        }
        if labels:
            self._add_labels(repo_name, pr_number, labels)
            output["labels"] = labels
        return output

    def update_pr(
        self,
        repo_name: str,
        pr_number: int,
        title: str | None = None,
        body: str | None = None,
        state: str | None = None,
    ) -> dict[str, Any]:
        update: dict[str, Any] = {}
        if title is not None:
            update["title"] = title
        if body is not None:
            update["body"] = body
        if state is not None:
            update["state"] = state
        result = self._request(
            "PATCH",
            f"/repos/{repo_name}/pulls/{pr_number}",
            json_body=update,
        )
        logger.info("PR #%d updated — %s", pr_number, result.get("html_url", ""))
        return {
            "pr_url": result.get("html_url", ""),
            "pr_number": result.get("number"),
            "status": "updated",
        }

    def find_existing_pr(
        self,
        repo_name: str,
        branch_name: str,
    ) -> dict[str, Any] | None:
        params = f"head={branch_name}&state=open"
        result = self._request("GET", f"/repos/{repo_name}/pulls?{params}")
        if isinstance(result, list) and len(result) > 0:
            existing = result[0]
            return {
                "pr_url": existing.get("html_url", ""),
                "pr_number": existing.get("number"),
                "status": existing.get("state", "open"),
            }
        return None

    def check_mergeable(self, repo_name: str, pr_number: int) -> dict[str, Any]:
        result = self._request("GET", f"/repos/{repo_name}/pulls/{pr_number}")
        return {
            "mergeable": result.get("mergeable"),
            "mergeable_state": result.get("mergeable_state", ""),
        }

    def _add_labels(self, repo_name: str, pr_number: int, labels: list[str]) -> None:
        self._request(
            "POST",
            f"/repos/{repo_name}/issues/{pr_number}/labels",
            json_body={"labels": labels},
        )
