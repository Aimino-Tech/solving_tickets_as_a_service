"""OnboardingStateMachine -- per-tenant onboarding wizard state machine.

States
------
    not_started      -> Initial state before any action is taken
    github_installed -> GitHub App installed / installation recorded
    linear_authed    -> Linear OAuth flow completed
    repo_selected    -> At least one repository selected for monitoring
    completed        -> All steps done; triggers first-issue wizard

Transitions
-----------
    not_started      --[install_github]-->  github_installed
    github_installed --[auth_linear]----->  linear_authed
    github_installed --[select_repo]----->  repo_selected
    linear_authed    --[select_repo]----->  repo_selected
    repo_selected    --[complete]-------->  completed
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional
import urllib.request

logger = logging.getLogger(__name__)

_ONBOARDING_REDIS_PREFIX = "syntaro:onboarding:"
_ONBOARDING_TTL_S = int(os.getenv("ONBOARDING_TTL_S", str(7 * 24 * 3600)))
_N8N_ONBOARDING_WEBHOOK_URL: str | None = os.getenv("N8N_ONBOARDING_WEBHOOK_URL")


def _get_file_dir() -> str:
    return os.getenv("ONBOARDING_FILE_DIR", "/tmp/syntaro-onboarding")


_VALID_STATES = frozenset({
    "not_started", "github_installed", "linear_authed", "repo_selected", "completed",
})

_VALID_TRANSITIONS: dict[str, set[str]] = {
    "not_started": {"github_installed"},
    "github_installed": {"linear_authed", "repo_selected"},
    "linear_authed": {"repo_selected"},
    "repo_selected": {"completed"},
}

_REDIS_CLIENT: Optional[Any] = None


def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod
        url = os.getenv("REDIS_URL", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Onboarding Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


def _file_path(tenant_id: str) -> Path:
    sanitized = tenant_id.replace("/", "_").replace(":", "_")[:128]
    return Path(_get_file_dir()) / f"{sanitized}.json"


def _read_file(tenant_id: str) -> dict[str, Any] | None:
    path = _file_path(tenant_id)
    try:
        if path.exists():
            with open(path, "r") as f:
                return json.loads(f.read())
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read onboarding file for %s -- %s", tenant_id, exc)
    return None


def _write_file(tenant_id: str, data: dict[str, Any]) -> None:
    path = _file_path(tenant_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            f.write(json.dumps(data, indent=2))
    except OSError as exc:
        logger.error("Failed to write onboarding file for %s -- %s", tenant_id, exc)


@dataclass
class OnboardingState:
    tenant_id: str
    state: str = "not_started"
    github_installed: bool = False
    linear_authed: bool = False
    repo_selected: bool = False
    completed: bool = False
    installation_id: int | None = None
    linear_org_id: str | None = None
    installed_repos: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> OnboardingState:
        return cls(
            tenant_id=data["tenant_id"],
            state=data.get("state", "not_started"),
            github_installed=data.get("github_installed", False),
            linear_authed=data.get("linear_authed", False),
            repo_selected=data.get("repo_selected", False),
            completed=data.get("completed", False),
            installation_id=data.get("installation_id"),
            linear_org_id=data.get("linear_org_id"),
            installed_repos=data.get("installed_repos", 0),
            created_at=data.get("created_at", time.time()),
            updated_at=data.get("updated_at", time.time()),
        )


class OnboardingStateMachine:
    @staticmethod
    def _redis_key(tenant_id: str) -> str:
        return f"{_ONBOARDING_REDIS_PREFIX}{tenant_id}"

    def get_state(self, tenant_id: str) -> OnboardingState | None:
        client = _get_redis()
        if client is not None:
            try:
                raw = client.get(self._redis_key(tenant_id))
                if raw:
                    data = json.loads(raw)
                    return OnboardingState.from_dict(data)
            except Exception as exc:
                logger.warning("Redis read failed for %s -- %s", tenant_id, exc)
        file_data = _read_file(tenant_id)
        if file_data:
            return OnboardingState.from_dict(file_data)
        return None

    def _persist(self, state: OnboardingState) -> None:
        state.updated_at = time.time()
        data = state.to_dict()
        raw = json.dumps(data)
        client = _get_redis()
        if client is not None:
            try:
                client.setex(self._redis_key(state.tenant_id), _ONBOARDING_TTL_S, raw)
                return
            except Exception as exc:
                logger.warning("Redis write failed for %s -- %s", state.tenant_id, exc)
        _write_file(state.tenant_id, data)

    def transition(self, tenant_id: str, event: str, **kwargs: Any) -> OnboardingState:
        event_targets: dict[str, str] = {
            "install_github": "github_installed",
            "auth_linear": "linear_authed",
            "select_repo": "repo_selected",
            "complete": "completed",
        }
        target_state = event_targets.get(event)
        if target_state is None:
            raise ValueError(f"Unknown onboarding event: {event!r}")
        current = self.get_state(tenant_id)
        if current is None:
            current = OnboardingState(tenant_id=tenant_id)
        allowed = _VALID_TRANSITIONS.get(current.state, set())
        if target_state not in allowed:
            raise ValueError(
                f"Invalid transition: {current.state!r} --[{event}]--> {target_state!r}. "
                f"Allowed transitions from {current.state!r}: {sorted(allowed)}"
            )
        current.state = target_state
        if target_state == "github_installed":
            current.github_installed = True
            inst_id = kwargs.get("installation_id")
            if inst_id is not None:
                current.installation_id = int(inst_id)
        elif target_state == "linear_authed":
            current.linear_authed = True
            org_id = kwargs.get("linear_org_id")
            if org_id is not None:
                current.linear_org_id = str(org_id)
        elif target_state == "repo_selected":
            current.repo_selected = True
            rcnt = kwargs.get("installed_repos")
            if rcnt is not None:
                current.installed_repos = int(rcnt)
        elif target_state == "completed":
            current.completed = True
        self._persist(current)
        logger.info("Onboarding transition tenant=%s event=%s state=%s", tenant_id, event, target_state)
        if target_state == "completed":
            try:
                self._trigger_first_issue_wizard(tenant_id, current)
            except Exception as exc:
                logger.error("First-issue wizard trigger failed for %s -- %s", tenant_id, exc)
        return current

    @staticmethod
    def _trigger_first_issue_wizard(tenant_id: str, state: OnboardingState) -> None:
        logger.info("Triggering first-issue wizard tenant=%s installation_id=%s", tenant_id, state.installation_id)
        # Fire n8n onboarding email webhook
        if _N8N_ONBOARDING_WEBHOOK_URL:
            try:
                payload = json.dumps({
                    "tenant_id": tenant_id,
                    "email": "",
                    "account_name": None,
                    "credits_granted": 100,
                    "event": "onboarding_complete",
                }).encode("utf-8")
                req = urllib.request.Request(
                    _N8N_ONBOARDING_WEBHOOK_URL,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=10)
                logger.info("n8n onboarding webhook fired tenant=%s", tenant_id)
            except Exception as exc:
                logger.warning("n8n onboarding webhook failed for %s -- %s", tenant_id, exc)
        else:
            logger.debug("N8N_ONBOARDING_WEBHOOK_URL not set — skipping n8n webhook")
        try:
            from workers.tasks import dispatch_first_issue_wizard
            dispatch_first_issue_wizard.delay(tenant_id=tenant_id, installation_id=state.installation_id)
            logger.info("First-issue wizard task dispatched tenant=%s", tenant_id)
            return
        except ImportError:
            logger.debug("workers.tasks.dispatch_first_issue_wizard not available")
        except Exception as exc:
            logger.warning("Celery dispatch failed for first-issue wizard %s -- %s", tenant_id, exc)
        trigger_dir = Path(_get_file_dir()) / "triggers"
        trigger_dir.mkdir(parents=True, exist_ok=True)
        trigger_file = trigger_dir / f"{tenant_id}.json"
        try:
            trigger_file.write_text(json.dumps({
                "tenant_id": tenant_id,
                "installation_id": state.installation_id,
                "triggered_at": time.time(),
                "type": "first_issue_wizard",
            }))
            logger.info("First-issue wizard trigger file written %s", trigger_file)
        except OSError as exc:
            logger.error("Failed to write first-issue wizard trigger for %s -- %s", tenant_id, exc)

    def get_status(self, tenant_id: str) -> dict[str, Any]:
        state = self.get_state(tenant_id)
        if state is None:
            return {
                "tenant_id": tenant_id, "state": "not_started",
                "github_installed": False, "linear_authed": False,
                "repo_selected": False, "completed": False,
                "installed_repos": 0, "created_at": None, "updated_at": None,
            }
        return state.to_dict()

    def reset(self, tenant_id: str) -> None:
        client = _get_redis()
        if client is not None:
            try:
                client.delete(self._redis_key(tenant_id))
            except Exception as exc:
                logger.warning("Redis delete failed for %s -- %s", tenant_id, exc)
        path = _file_path(tenant_id)
        try:
            if path.exists():
                path.unlink()
        except OSError as exc:
            logger.warning("Failed to remove onboarding file for %s -- %s", tenant_id, exc)
        logger.info("Onboarding reset tenant=%s", tenant_id)


_machine: Optional[OnboardingStateMachine] = None


def get_onboarding_machine() -> OnboardingStateMachine:
    global _machine
    if _machine is None:
        _machine = OnboardingStateMachine()
    return _machine
