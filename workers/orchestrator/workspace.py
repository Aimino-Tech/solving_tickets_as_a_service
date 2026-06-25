"""
Workspace lifecycle --- clone, branch, and cleanup.

Provides ``create_workspace`` and ``cleanup_workspace`` as Celery shared tasks
so they can be composed into pipelines.
"""

import logging
import os
import re
import shutil
import subprocess
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", "/workspaces")


def sanitize(name: str) -> str:
    """Replace non-alphanumeric characters with underscores, max 64 chars."""
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:64]


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.orchestrator.workspace.create_workspace",
    autoretry_for=(subprocess.CalledProcessError,),
)
def create_workspace(
    self: Any,
    issue_id: str,
    issue_identifier: str,
    repo_url: str,
) -> dict[str, Any]:
    """Clone *repo_url* into a workspace directory and create a branch.

    Args:
        issue_id: The issue identifier (e.g. ``"42"``).
        issue_identifier: Human-readable identifier for the workspace path
            (e.g. ``"gh-42"``).
        repo_url: Git remote URL to clone.

    Returns:
        A dict with ``workspace_path``, ``branch``, and ``status`` keys.

    Raises:
        ValueError: if *repo_url* is empty.
    """
    logger.info(
        "Creating workspace -- issue=%s identifier=%s repo=%s",
        issue_id,
        issue_identifier,
        repo_url,
    )

    if not repo_url:
        msg = "No repo_url provided"
        raise ValueError(msg)

    workspace_path = os.path.join(WORKSPACE_ROOT, sanitize(issue_identifier))
    os.makedirs(workspace_path, exist_ok=True)

    branch = f"stas/bot/{sanitize(issue_identifier)}"

    try:
        subprocess.run(
            ["git", "clone", "--depth=1", repo_url, workspace_path],
            check=True,
            capture_output=True,
            timeout=120,
        )
        subprocess.run(
            ["git", "checkout", "-b", branch],
            cwd=workspace_path,
            check=True,
            capture_output=True,
            timeout=30,
        )
    except subprocess.CalledProcessError:
        logger.exception("Git operation failed for workspace %s", workspace_path)
        raise

    logger.info("Workspace created at %s branch=%s", workspace_path, branch)
    return {
        "status": "created",
        "workspace_path": workspace_path,
        "branch": branch,
        "repo_url": repo_url,
        "issue_id": issue_id,
    }


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.orchestrator.workspace.cleanup_workspace",
)
def cleanup_workspace(
    self: Any,
    workspace_path: str,
) -> dict[str, Any]:
    """Remove *workspace_path* from disk.

    Returns a status dict (``"cleaned"``, ``"not_found"``, ``"skipped"``,
    or ``"error"``).
    """
    logger.info("Cleaning up workspace at %s", workspace_path)

    if not workspace_path:
        logger.warning("Empty workspace_path, skipping")
        return {"status": "skipped", "workspace_path": workspace_path}

    if not os.path.isdir(workspace_path):
        logger.info("Workspace not found at %s", workspace_path)
        return {"status": "not_found", "workspace_path": workspace_path}

    try:
        shutil.rmtree(workspace_path)
        logger.info("Cleaned up workspace at %s", workspace_path)
        return {"status": "cleaned", "workspace_path": workspace_path}
    except Exception as exc:
        logger.error("Failed to clean up workspace %s: %s", workspace_path, exc)
        return {"status": "error", "workspace_path": workspace_path, "error": str(exc)}
