"""
Linear issue polling and pipeline dispatch.

Polls Linear for issues in active workflow states, classifies them,
and dispatches them through the full STAS pipeline: triage -> fix -> PR -> merge -> done.

Deduplication is handled via Redis locks (stas:dedup:{issue_id})
and an in-memory tracking set.
"""

import json
import logging
import os
from typing import Any

from celery import Task

from workers.celery_app import app
from workers.dispatch.dedup import get_dedup_manager
from workers.dispatch.pause import get_pause_manager
from workers.linear import client_sync as linear
from workers.orchestrator.concurrency import get_limiter
from workers.tracker.routing import classify_pipeline, PipelineType
from workers.tracker.state_machine import get_active_states

logger = logging.getLogger(__name__)

_CONFIG_PATH = os.getenv("STAS_REPOS_CONFIG", "/home/malek/solving_tickets_as_a_service/stas-repos.json")
_REPOS_CACHE: dict | None = None


def _load_repos_config() -> dict:
    global _REPOS_CACHE
    if _REPOS_CACHE is not None:
        return _REPOS_CACHE
    try:
        with open(_CONFIG_PATH) as f:
            _REPOS_CACHE = json.load(f)
        logger.info("Loaded repos config with %d project mappings", len(_REPOS_CACHE.get("projects", {})))
    except Exception as exc:
        logger.warning("Failed to load repos config: %s — falling back to env vars", exc)
        _REPOS_CACHE = {"projects": {}}
    return _REPOS_CACHE


def _resolve_repo(linear_project_name: str | None) -> tuple[str, str, str]:
    """Resolve a Linear project name to a GitHub repo."""
    cfg = _load_repos_config()
    if not linear_project_name:
        return _fallback_repo()
    for entry in cfg.get("projects", {}).values():
        if entry.get("linear_project_name") == linear_project_name:
            parts = entry["repo"].split("/", 1)
            if len(parts) == 2:
                logger.info("Resolved project '%s' -> repo=%s", linear_project_name, entry["repo"])
                return parts[0], parts[1], entry.get("branch", "main")
    logger.info("No mapping for project '%s', using fallback", linear_project_name)
    return _fallback_repo()


def _fallback_repo() -> tuple[str, str, str]:
    return (
        os.getenv("TARGET_REPO_OWNER", "Aimino-Tech"),
        os.getenv("TARGET_REPO_NAME", "solving_tickets_as_a_service"),
        os.getenv("TARGET_REPO_BRANCH", "main"),
    )

_is_tracked: set[str] = set()


def is_already_tracked(issue_id: str) -> bool:
    return issue_id in _is_tracked


def mark_tracked(issue_id: str) -> None:
    _is_tracked.add(issue_id)


def _is_project_paused(issue: dict[str, Any]) -> bool:
    pm = get_pause_manager()
    team = issue.get("team", {})
    team_key = team.get("key", "") if isinstance(team, dict) else ""
    if team_key and pm.is_paused(team_key.lower()):
        logger.info("Skipping issue %s team %s is paused", issue.get("identifier", ""), team_key)
        return True
    proj = issue.get("project") or {}
    if isinstance(proj, dict):
        slug = proj.get("slug", "")
        if slug and pm.is_paused(slug):
            logger.info("Skipping issue %s project %s is paused", issue.get("identifier", ""), slug)
            return True
    return False


@app.task(bind=True, queue="stas.issues.triage", max_retries=3, default_retry_delay=30)
def poll_active_issues(self: Task) -> dict[str, Any]:
    """
    Poll Linear for active issues and dispatch them through the STAS pipeline.

    Beat schedule: every 2 minutes (configured in celeryconfig.py).

    For each issue found:
    1. Dedup check (Redis lock + in-memory set)
    2. Pause/project check
    3. Classify pipeline from labels
    4. Kick off the full pipeline via PipelineEngine
    """
    logger.info("Polling Linear for active issues")
    states = get_active_states()
    issues = linear.get_issues_by_state(states=states)
    dispatched = 0
    skipped_dedup = 0
    skipped_paused = 0

    for issue in issues:
        issue_id = issue["id"]
        identifier = issue.get("identifier", issue_id)

        # Redis-backed dedup (survives worker restarts)
        dedup = get_dedup_manager()
        if not dedup.acquire(issue_id):
            logger.debug("Skipping issue %s — dedup lock held", identifier)
            skipped_dedup += 1
            continue

        # In-memory tracking (fast path within same poll cycle)
        if is_already_tracked(issue_id):
            skipped_dedup += 1
            continue
        mark_tracked(issue_id)

        if _is_project_paused(issue):
            skipped_paused += 1
            continue

        # Classify pipeline from labels
        raw = issue.get("labels", {})
        if isinstance(raw, dict):
            label_names = [l["name"] for l in raw.get("nodes", []) if isinstance(l, dict)]
        elif isinstance(raw, list):
            label_names = [l["name"] for l in raw if isinstance(l, dict)]
        else:
            label_names = []
        pipeline: PipelineType = classify_pipeline(label_names)

        logger.info(
            "Dispatching issue %s — pipeline=%s title=%s",
            identifier, pipeline, issue["title"],
        )

        # Post "working on it" comment
        try:
            linear.post_comment(issue_id, f"🔄 **STAS**: Starting work — pipeline `{pipeline}`")
        except Exception as exc:
            logger.warning("Failed to post comment to %s: %s", identifier, exc)

        project_name = issue.get("project", {}).get("name") if isinstance(issue.get("project"), dict) else None
        repo_owner, repo_name, repo_branch = _resolve_repo(project_name)
        logger.info("Resolved repo for %s: %s/%s (project=%s)", identifier, repo_owner, repo_name, project_name)

        current_state = issue.get("state", {}).get("name", "Todo")

        ctx = {
            "issue_id": issue_id,
            "issue_identifier": identifier,
            "issue_title": issue["title"],
            "issue_description": issue.get("description", ""),
            "issue_url": issue.get("url", ""),
            "project_name": project_name or "unknown",
            "pipeline": pipeline,
            "current_state": current_state,
            "repo_owner": repo_owner,
            "repo_name": repo_name,
            "repo_branch": repo_branch,
            "source": "linear",
        }

        try:
            from workers.tasks.pipeline_orchestrator import run_full_pipeline
            run_full_pipeline.delay(ctx)
            logger.info(
                "Pipeline dispatched for %s via orchestrator",
                identifier,
            )
            dispatched += 1
        except Exception as exc:
            logger.exception(
                "Failed to dispatch pipeline for %s: %s", identifier, exc,
            )
            dedup.release(issue_id)

    return {
        "dispatched": dispatched,
        "skipped_dedup": skipped_dedup,
        "skipped_paused": skipped_paused,
        "total_found": len(issues),
    }


@app.task(bind=True, queue="stas.agents.dispatch")
def triage(self: Task, issue_id: str, identifier: str, pipeline: str, title: str) -> dict[str, Any]:
    """Simple triage that posts a comment and passes through."""
    try:
        linear.post_comment(issue_id, f"🔄 **STAS**: Working on it — pipeline `{pipeline}`")
    except Exception as exc:
        logger.warning("Failed to post comment: %s", exc)
    return {
        "issue_id": issue_id,
        "identifier": identifier,
        "pipeline": pipeline,
        "status": "triage_complete",
    }


@app.task(bind=True, queue="stas.agents.notifications")
def notify_progress(
    self: Task,
    issue_id: str,
    stage: str,
    message: str,
) -> dict[str, Any]:
    """Post a progress update comment to the Linear issue."""
    try:
        linear.post_comment(issue_id, f"**STAS**: {message}")
    except Exception as exc:
        logger.warning("Failed to post notification: %s", exc)
    return {"issue_id": issue_id, "stage": stage, "sent": True}


@app.task(bind=True, queue="stas.agents.self_audit")
def transition_state(self: Task, issue_id: str, current_state: str) -> dict[str, Any]:
    """Transition the Linear issue to the next state per the state machine."""
    from workers.tracker.state_machine import resolve_state as next_state

    target = next_state(current_state)
    if target:
        try:
            linear.transition_issue(issue_id, target)
            logger.info("Transitioned %s from %s to %s", issue_id, current_state, target)
            return {"issue_id": issue_id, "from": current_state, "to": target}
        except Exception as exc:
            logger.error("Failed to transition %s: %s", issue_id, exc)
            return {"issue_id": issue_id, "from": current_state, "to": None, "error": str(exc)}
    return {"issue_id": issue_id, "from": current_state, "to": None}
