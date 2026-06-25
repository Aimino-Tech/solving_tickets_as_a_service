import logging
import os
import shutil
import subprocess

from celery import shared_task

logger = logging.getLogger(__name__)

WORKSPACE_BASE = os.getenv("WORKSPACE_BASE", "/workspaces")


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.orchestrator.workspace.create_workspace",
)
def create_workspace(
    self,
    issue_id: str,
    issue_identifier: str,
    repo_url: str,
) -> dict:
    import re
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', issue_identifier)[:64]
    workspace_path = os.path.join(WORKSPACE_BASE, safe_name)

    if os.path.exists(workspace_path):
        logger.info("Workspace already exists at %s (retry)", workspace_path)
        return {"workspace_path": workspace_path, "branch": f"stas/fix/{safe_name}"}

    os.makedirs(WORKSPACE_BASE, exist_ok=True)

    try:
        subprocess.run(
            ["git", "clone", "--depth=1", repo_url, workspace_path],
            check=True, capture_output=True, text=True, timeout=120,
        )
        branch = f"stas/fix/{safe_name}"
        subprocess.run(
            ["git", "checkout", "-b", branch],
            cwd=workspace_path, check=True, capture_output=True, text=True, timeout=30,
        )
        logger.info("Created workspace at %s (branch=%s)", workspace_path, branch)
        return {"workspace_path": workspace_path, "branch": branch}
    except subprocess.CalledProcessError as exc:
        logger.error("Workspace creation failed: %s", exc.stderr)
        if os.path.exists(workspace_path):
            shutil.rmtree(workspace_path, ignore_errors=True)
        raise self.retry(exc=exc)
    except subprocess.TimeoutExpired:
        logger.error("Workspace creation timed out")
        if os.path.exists(workspace_path):
            shutil.rmtree(workspace_path, ignore_errors=True)
        return {"error": "timeout", "workspace_path": "", "branch": ""}


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.orchestrator.workspace.cleanup_workspace",
)
def cleanup_workspace(self, workspace_path: str) -> dict:
    if not workspace_path or not os.path.exists(workspace_path):
        return {"status": "skipped", "reason": "path does not exist"}

    try:
        shutil.rmtree(workspace_path)
        logger.info("Cleaned up workspace at %s", workspace_path)
        return {"status": "cleaned", "workspace_path": workspace_path}
    except OSError as exc:
        logger.error("Workspace cleanup failed: %s", exc)
        raise self.retry(exc=exc)
