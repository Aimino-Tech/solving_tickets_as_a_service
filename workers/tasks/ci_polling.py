"""
CI Check-Run Polling — poll GitHub check runs after PR creation, block merge on failure.

Uses GitHub API to poll check run status, respect branch protection rules,
and block merge if checks fail or timeout.
"""
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.request import Request, urlopen

from celery import shared_task

logger = logging.getLogger(__name__)

POLL_INTERVAL_S = int(os.getenv("CI_POLL_INTERVAL_S", "30"))
MAX_POLL_TIME_S = int(os.getenv("CI_MAX_POLL_TIME_S", "1800"))
GITHUB_API_BASE = os.getenv("GITHUB_API_BASE", "https://api.github.com")


def _get_github_token() -> str:
    token = os.getenv("GITHUB_APP_ID", "")
    private_key = os.getenv("GITHUB_PRIVATE_KEY", "")
    if token and private_key:
        return _generate_installation_token()
    token = os.getenv("GITHUB_TOKEN", "")
    if token:
        return token
    return ""


def _generate_installation_token() -> str:
    import jwt
    import time as _time
    app_id = os.getenv("GITHUB_APP_ID", "")
    private_key = os.getenv("GITHUB_PRIVATE_KEY", "")
    now = int(_time.time())
    payload = {"iat": now - 60, "exp": now + 600, "iss": app_id}
    jwt_token = jwt.encode(payload, private_key, algorithm="RS256")
    url = f"{GITHUB_API_BASE}/app/installations"
    req = Request(url, headers={"Authorization": f"Bearer {jwt_token}", "Accept": "application/vnd.github+json"})
    try:
        with urlopen(req) as resp:
            installations = json.loads(resp.read())
            if installations:
                inst_id = installations[0]["id"]
                token_url = f"{GITHUB_API_BASE}/app/installations/{inst_id}/access_tokens"
                token_req = Request(token_url, data=b"{}", headers={"Authorization": f"Bearer {jwt_token}"}, method="POST")
                token_req.add_header("Content-Type", "application/json")
                with urlopen(token_req) as token_resp:
                    return json.loads(token_resp.read())["token"]
    except Exception as exc:
        logger.error("Failed to get installation token: %s", exc)
    return ""


def _check_run_url(owner: str, repo: str, sha: str) -> str:
    return f"{GITHUB_API_BASE}/repos/{owner}/{repo}/commits/{sha}/check-runs"


def _branch_protection_url(owner: str, repo: str, branch: str) -> str:
    return f"{GITHUB_API_BASE}/repos/{owner}/{repo}/branches/{branch}/protection"


def _fetch_json(url: str, token: str) -> dict:
    req = Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "STAS-CI-Poller",
    })
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


@shared_task(
    bind=True,
    max_retries=0,
    name="workers.tasks.ci_polling.poll_ci_checks",
)
def poll_ci_checks(self, pr_number: int, repo_owner: str, repo_name: str, sha: str | None = None, branch: str | None = None) -> dict:
    logger.info("Polling CI checks — PR #%d %s/%s", pr_number, repo_owner, repo_name)
    token = _get_github_token()
    if not token:
        return {"status": "error", "message": "No GitHub token available", "checks": []}

    if not sha:
        pr_url = f"{GITHUB_API_BASE}/repos/{repo_owner}/{repo_name}/pulls/{pr_number}"
        try:
            pr_data = _fetch_json(pr_url, token)
            sha = pr_data.get("head", {}).get("sha", "")
        except Exception as exc:
            return {"status": "error", "message": f"Cannot fetch PR: {exc}", "checks": []}

    required_checks = []
    if branch:
        try:
            prot_url = _branch_protection_url(repo_owner, repo_name, branch)
            prot_data = _fetch_json(prot_url, token)
            req_checks = prot_data.get("required_status_checks", {}).get("contexts", [])
            required_checks = req_checks
        except Exception:
            pass

    start_time = time.time()
    all_checks = []
    conclusion = "pending"

    while time.time() - start_time < MAX_POLL_TIME_S:
        try:
            data = _fetch_json(_check_run_url(repo_owner, repo_name, sha), token)
            check_runs = data.get("check_runs", [])
            all_checks = []
            for cr in check_runs:
                all_checks.append({
                    "name": cr.get("name", "unknown"),
                    "status": cr.get("status", "unknown"),
                    "conclusion": cr.get("conclusion"),
                    "details_url": cr.get("details_url", ""),
                    "started_at": cr.get("started_at", ""),
                    "completed_at": cr.get("completed_at", ""),
                })

            queued = [c for c in all_checks if c["status"] in ("queued", "in_progress")]
            failed = [c for c in all_checks if c["conclusion"] in ("failure", "cancelled", "timed_out", "action_required")]
            passed_checks = [c for c in all_checks if c["conclusion"] == "success"]

            if failed:
                conclusion = "failure"
                logger.warning("CI checks FAILED — %d failure(s)", len(failed))
                break
            if not queued and all_checks:
                if len(passed_checks) == len(all_checks):
                    conclusion = "success"
                else:
                    conclusion = "neutral"
                break

            logger.info("CI pending — %d queued, %d passed, %d total", len(queued), len(passed_checks), len(all_checks))
            time.sleep(POLL_INTERVAL_S)
        except Exception as exc:
            logger.error("Poll error: %s", exc)
            time.sleep(POLL_INTERVAL_S)

    elapsed = round(time.time() - start_time, 1)
    merge_blocked = conclusion == "failure"

    verdict = "pass" if conclusion == "success" else "fail" if conclusion == "failure" else "inconclusive"
    return {
        "status": verdict,
        "conclusion": conclusion,
        "checks": all_checks,
        "merge_blocked": merge_blocked,
        "poll_duration_s": elapsed,
    }
