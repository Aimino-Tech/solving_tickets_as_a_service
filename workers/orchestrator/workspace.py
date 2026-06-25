import os
import re
import shutil
import subprocess
import logging
from typing import Any

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", "/workspaces")


def sanitize(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:64]


def create_workspace(
    issue_id: str,
    identifier: str,
    repo_url: str,
) -> dict[str, str]:
    workspace_path = os.path.join(WORKSPACE_ROOT, sanitize(identifier))
    if os.path.exists(workspace_path):
        logger.info("Workspace already exists at %s", workspace_path)
        return {"workspace_path": workspace_path, "branch": f"stas/fix/{sanitize(identifier)}"}

    os.makedirs(workspace_path, exist_ok=True)

    if repo_url:
        try:
            subprocess.run(
                ["git", "clone", "--depth=1", repo_url, workspace_path],
                check=True, capture_output=True, timeout=120,
            )
        except subprocess.CalledProcessError as e:
            logger.error("Failed to clone %s: %s", repo_url, e.stderr.decode())
            return {"workspace_path": workspace_path, "branch": ""}

        branch = f"stas/fix/{sanitize(identifier)}"
        subprocess.run(
            ["git", "checkout", "-b", branch],
            cwd=workspace_path, check=True, capture_output=True, timeout=30,
        )
        return {"workspace_path": workspace_path, "branch": branch}

    return {"workspace_path": workspace_path, "branch": ""}


def cleanup_workspace(workspace_path: str) -> None:
    if os.path.exists(workspace_path):
        shutil.rmtree(workspace_path)
        logger.info("Cleaned up workspace at %s", workspace_path)
