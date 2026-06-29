"""
Direct fix task — creates a simple test commit and branch in the target repo.

This replaces the OpenCode agent dispatch for testing purposes.
In production, this would be replaced by dispatch_opencode.
"""

import logging
import os
import subprocess
import tempfile
from datetime import datetime
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.direct_fix.create_fix",
    autoretry_for=(Exception,),
)
def create_fix(self, ctx: dict) -> dict:
    """
    Clone the target repo, create a trivial change, commit and push.

    Context (ctx) expects:
        - repo_owner: str
        - repo_name: str
        - repo_branch: str (default: main)
        - issue_title: str
        - issue_description: str
        - issue_identifier: str

    Returns:
        dict with branch_name, commit_sha, repo_full_name
    """
    owner = ctx.get("repo_owner", "")
    repo = ctx.get("repo_name", "")
    branch = ctx.get("repo_branch", "main")
    issue_title = ctx.get("issue_title", "Untitled")
    issue_id = ctx.get("issue_identifier", "unknown")

    if not owner or not repo:
        raise ValueError(f"Missing repo_owner/repo_name in ctx: {ctx}")

    repo_full = f"{owner}/{repo}"
    branch_name = f"stas/fix-{issue_id.lower().replace('_', '-')[:40]}"
    timestamp = datetime.utcnow().isoformat()

    logger.info(
        "Creating fix for %s — repo=%s branch=%s",
        issue_id, repo_full, branch_name,
    )

    with tempfile.TemporaryDirectory(prefix="stas-fix-") as tmpdir:
        # Clone the repo
        clone_url = f"https://x-access-token:{os.environ['GH_TOKEN']}@github.com/{repo_full}.git"
        subprocess.run(
            ["git", "clone", clone_url, tmpdir],
            check=True, capture_output=True, text=True,
            cwd="/tmp",
        )

        # Create and switch to a new branch
        subprocess.run(
            ["git", "checkout", "-b", branch_name],
            check=True, capture_output=True, text=True,
            cwd=tmpdir,
        )

        # Make a trivial change — update or create a tracking file
        tracking_dir = os.path.join(tmpdir, ".stas")
        os.makedirs(tracking_dir, exist_ok=True)
        tracking_file = os.path.join(tracking_dir, "fixes.log")

        fix_entry = (
            f"[{timestamp}] Fix for {issue_id}: {issue_title}\n"
        )
        with open(tracking_file, "a") as f:
            f.write(fix_entry)

        commit_msg = (
            f"fix({issue_id}): Automated fix via STAS\n\n"
            f"Ticket: {issue_id}\n"
            f"Title: {issue_title}\n"
            f"Timestamp: {timestamp}\n"
        )

        subprocess.run(["git", "add", "."], check=True, capture_output=True, text=True, cwd=tmpdir)
        subprocess.run(
            ["git", "commit", "--allow-empty", "-m", commit_msg],
            check=False, capture_output=True, text=True,
            cwd=tmpdir,
        )

        push_result = subprocess.run(
            ["git", "push", "--force", "origin", branch_name],
            check=True, capture_output=True, text=True,
            cwd=tmpdir,
        )

        # Get the commit SHA
        sha_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True, capture_output=True, text=True,
            cwd=tmpdir,
        )
        commit_sha = sha_result.stdout.strip()

        logger.info(
            "Fix pushed — repo=%s branch=%s sha=%s",
            repo_full, branch_name, commit_sha,
        )

    return {
        "repo_owner": owner,
        "repo_name": repo,
        "repo_full_name": repo_full,
        "branch_name": branch_name,
        "base_branch": branch,
        "commit_sha": commit_sha,
        "issue_id": issue_id,
        "issue_title": issue_title,
        "fix_entry": fix_entry.strip(),
    }
