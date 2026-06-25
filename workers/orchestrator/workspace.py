"""
Workspace lifecycle --- clone, branch, and cleanup as Celery tasks.
"""
import logging, os, re, shutil, subprocess
from typing import Any
from celery import shared_task

logger = logging.getLogger(__name__)
WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", "/workspaces")

def sanitize(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:64]

@shared_task(bind=True, max_retries=2, default_retry_delay=30, name="workers.orchestrator.workspace.create_workspace", autoretry_for=(subprocess.CalledProcessError,))
def create_workspace(self: Any, issue_id: str, issue_identifier: str, repo_url: str) -> dict[str, Any]:
    if not repo_url: raise ValueError("No repo_url provided")
    ws = os.path.join(WORKSPACE_ROOT, sanitize(issue_identifier))
    os.makedirs(ws, exist_ok=True)
    branch = f"stas/bot/{sanitize(issue_identifier)}"
    subprocess.run(["git", "clone", "--depth=1", repo_url, ws], check=True, capture_output=True, timeout=120)
    subprocess.run(["git", "checkout", "-b", branch], cwd=ws, check=True, capture_output=True, timeout=30)
    return {"status": "created", "workspace_path": ws, "branch": branch, "repo_url": repo_url, "issue_id": issue_id}

@shared_task(bind=True, max_retries=1, default_retry_delay=10, name="workers.orchestrator.workspace.cleanup_workspace")
def cleanup_workspace(self: Any, workspace_path: str) -> dict[str, Any]:
    if not workspace_path: return {"status": "skipped", "workspace_path": workspace_path}
    if not os.path.isdir(workspace_path): return {"status": "not_found", "workspace_path": workspace_path}
    try:
        shutil.rmtree(workspace_path)
        return {"status": "cleaned", "workspace_path": workspace_path}
    except Exception as exc:
        return {"status": "error", "workspace_path": workspace_path, "error": str(exc)}
