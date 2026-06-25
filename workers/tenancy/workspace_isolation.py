import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = os.getenv("STAS_WORKSPACE_ROOT", "/workspaces")


class WorkspaceIsolation:
    def __init__(self, root: str = WORKSPACE_ROOT):
        self.root = root

    def get_workspace_path(self, tenant_id: str, issue_key: str) -> str:
        return os.path.join(self.root, tenant_id, issue_key)

    def create_workspace(self, tenant_id: str, issue_key: str) -> str:
        path = self.get_workspace_path(tenant_id, issue_key)
        os.makedirs(path, exist_ok=True)
        os.chmod(path, 0o755)
        logger.info("Created tenant workspace: %s", path)
        return path

    def clean_workspace(self, tenant_id: str, issue_key: str) -> bool:
        path = self.get_workspace_path(tenant_id, issue_key)
        if os.path.isdir(path):
            import shutil
            shutil.rmtree(path, ignore_errors=True)
            logger.info("Cleaned tenant workspace: %s", path)
            return True
        return False

    def tenant_workspace_exists(self, tenant_id: str) -> bool:
        path = os.path.join(self.root, tenant_id)
        return os.path.isdir(path)

    def list_tenant_workspaces(self, tenant_id: str) -> list[str]:
        path = os.path.join(self.root, tenant_id)
        if not os.path.isdir(path):
            return []
        return [
            d for d in os.listdir(path)
            if os.path.isdir(os.path.join(path, d))
        ]

    def get_workspace_size(self, tenant_id: str, issue_key: str) -> int:
        path = self.get_workspace_path(tenant_id, issue_key)
        if not os.path.isdir(path):
            return 0
        total = 0
        for dirpath, _dirnames, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
        return total
