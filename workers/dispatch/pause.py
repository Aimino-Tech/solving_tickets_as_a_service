from __future__ import annotations
import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)
DEFAULT_STATE_DIR = os.getenv("PAUSE_STATE_DIR", "/tmp/syntaro-pause-state")


class PauseManager:
    def __init__(self, state_dir: str = DEFAULT_STATE_DIR) -> None:
        self._state_dir = state_dir
        os.makedirs(self._state_dir, exist_ok=True)
        self._locks: dict[str, threading.Lock] = {}
        self._global_lock = threading.Lock()

    def pause(self, project_slug: str, paused_by: str = "unknown") -> dict[str, Any]:
        state = {"paused": True, "paused_at": _now_iso(), "paused_by": paused_by}
        self._write(project_slug, state)
        logger.info("Paused project=%s paused_by=%s", project_slug, paused_by)
        return state

    def resume(self, project_slug: str, resumed_by: str = "unknown") -> dict[str, Any]:
        state = {"paused": False, "resumed_at": _now_iso(), "resumed_by": resumed_by}
        self._write(project_slug, state)
        logger.info("Resumed project=%s resumed_by=%s", project_slug, resumed_by)
        return state

    def is_paused(self, project_slug: str) -> bool:
        try:
            return bool(self._read(project_slug).get("paused", False))
        except (FileNotFoundError, json.JSONDecodeError):
            return False

    def get_status(self, project_slug: str) -> dict[str, Any]:
        try:
            state = self._read(project_slug)
        except (FileNotFoundError, json.JSONDecodeError):
            return {"paused": False, "project_slug": project_slug}
        return {"project_slug": project_slug, **state}

    def list_paused(self) -> list[dict[str, Any]]:
        paused = []
        if not os.path.isdir(self._state_dir):
            return paused
        for fn in os.listdir(self._state_dir):
            if not fn.endswith(".json"):
                continue
            slug = fn[: -5]
            if self.is_paused(slug):
                paused.append(self.get_status(slug))
        return paused

    def list_all(self) -> list[dict[str, Any]]:
        projects = []
        if not os.path.isdir(self._state_dir):
            return projects
        for fn in sorted(os.listdir(self._state_dir)):
            if not fn.endswith(".json"):
                continue
            slug = fn[: -5]
            projects.append(self.get_status(slug))
        return projects

    def _state_path(self, slug: str) -> str:
        return os.path.join(self._state_dir, f"{slug}.json")

    def _read(self, slug: str) -> dict[str, Any]:
        with open(self._state_path(slug)) as f:
            return json.load(f)

    def _write(self, slug: str, state: dict[str, Any]) -> None:
        lock = self._locks.setdefault(slug, threading.Lock())
        with lock:
            path = self._state_path(slug)
            tmp = f"{path}.{os.getpid()}.tmp"
            try:
                with open(tmp, "w") as f:
                    json.dump(state, f, indent=2, default=str)
                os.rename(tmp, path)
            except Exception:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise


_manager: PauseManager | None = None


def get_pause_manager() -> PauseManager:
    global _manager
    if _manager is None:
        _manager = PauseManager()
    return _manager


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
