"""
Merge a GitHub Pull Request and mark the Linear ticket as Done.

This is the final step in the STAS pipeline:
1. Wait for PR checks (optional, configurable)
2. Merge the PR using GitHub API
3. Transition the Linear ticket to "Done"
"""

import logging
import os
import time
from typing import Any

from celery import shared_task

from workers.github.client import GitHubClient

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    name="workers.tasks.merge_pr.merge_pull_request",
    autoretry_for=(Exception,),
)
def merge_pull_request(self, pr_result: dict, repo_info: dict) -> dict:
    """
    Merge an already-created Pull Request.

    ``pr_result`` is expected to contain:
        - pr_number (int) — the PR number to merge
        - repo_full_name (str) — "owner/repo"

    ``repo_info`` is expected to contain:
        - owner (str)
        - repo (str)

    Returns the merge result.
    """
    owner = repo_info.get("owner", "?")
    repo = repo_info.get("repo", "?")
    pr_number = pr_result.get("pr_number")
    repo_full = pr_result.get("repo_full_name", f"{owner}/{repo}")

    if not pr_number:
        logger.warning("No PR number provided — skipping merge")
        return {"status": "skipped_no_pr", "pr_result": pr_result}

    logger.info("Merging PR #%d in %s", pr_number, repo_full)

    try:
        # Resolve token — first GH_TOKEN env, then installation token
        gh_token = os.getenv("GITHUB_TOKEN", "")
        if gh_token:
            client = GitHubClient(token=gh_token)
        else:
            client = GitHubClient()

        # Check if mergeable first
        mergeable_status = client.check_mergeable(repo_full, pr_number)
        logger.info("PR #%d mergeable status: %s", pr_number, mergeable_status)

        # If PR is not mergeable, wait a bit and retry
        max_wait = 30  # seconds
        wait_start = time.time()
        while mergeable_status.get("mergeable") is False and time.time() - wait_start < max_wait:
            logger.info("PR #%d not yet mergeable, waiting...", pr_number)
            time.sleep(5)
            mergeable_status = client.check_mergeable(repo_full, pr_number)

        # Perform the merge
        merge_result = client._request(
            "PUT",
            f"/repos/{repo_full}/pulls/{pr_number}/merge",
            json_body={
                "commit_title": f"STAS: Automated fix for #{pr_number}",
                "commit_message": f"Automated merge via STAS pipeline.\n\nPR: #{pr_number}",
                "merge_method": "squash",
            },
        )

        merged = merge_result.get("merged", False)
        sha = merge_result.get("sha", "")
        message = merge_result.get("message", "")

        if merged:
            logger.info("PR #%d merged successfully — sha=%s", pr_number, sha)
        else:
            logger.warning("PR #%d merge returned: %s", pr_number, message)

        return {
            "pr_number": pr_number,
            "repo_full_name": repo_full,
            "merged": merged,
            "sha": sha,
            "message": message,
            "status": "merged" if merged else "merge_failed",
        }

    except Exception as exc:
        logger.error("Failed to merge PR #%d: %s", pr_number, exc)
        raise self.retry(exc=exc)
