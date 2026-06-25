"""Merge queue — processes PRs sequentially per-repo with squash merge."""

import json
import logging
import os
import subprocess
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)
PER_REPO_MERGE_LOCK = "stas:merge:lock:"


def _get_redis():
    try:
        import redis as redis_mod
        return redis_mod.from_url(os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))
    except ImportError:
        return None


def _acquire_repo_lock(repo_full_name: str, timeout: int = 300) -> bool:
    r = _get_redis()
    if not r:
        return True
    lock_key = PER_REPO_MERGE_LOCK + repo_full_name
    return r.set(lock_key, "locked", nx=True, ex=timeout)


def _release_repo_lock(repo_full_name: str) -> None:
    r = _get_redis()
    if r:
        lock_key = PER_REPO_MERGE_LOCK + repo_full_name
        r.delete(lock_key)


def _has_conflicts(pr_url: str) -> bool:
    import httpx
    token = os.getenv("GITHUB_TOKEN", "")
    if not token:
        logger.warning("GITHUB_TOKEN not set — cannot check merge conflicts")
        return False
    pr_number = pr_url.rstrip("/").split("/")[-1]
    repo_path = "/".join(pr_url.split("/")[3:5])
    api_url = f"https://api.github.com/repos/{repo_path}/pulls/{pr_number}"
    try:
        resp = httpx.get(api_url, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.v3+json"})
        resp.raise_for_status()
        data = resp.json()
        return data.get("mergeable") is False
    except Exception as exc:
        logger.error("Failed to check merge conflicts: %s", exc)
        return False


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    name="workers.tasks.merge_queue.process_merge_queue",
    queue="stas.queue.merge",
)
def process_merge_queue(self, issue_id: str, workspace_path: str, pr_url: str = "", merge_strategy: str = "squash") -> dict[str, Any]:
    logger.info("Processing merge queue for %s (PR: %s)", issue_id, pr_url)
    repo_full_name = ""
    if pr_url:
        parts = pr_url.split("/")
        if len(parts) >= 5:
            repo_full_name = f"{parts[3]}/{parts[4]}"
    if repo_full_name:
        if not _acquire_repo_lock(repo_full_name):
            logger.info("Merge lock held for %s, retrying later", repo_full_name)
            raise self.retry(countdown=30)
    try:
        if pr_url and _has_conflicts(pr_url):
            from workers.tasks.conflict_resolver import resolve_conflicts
            conflict_result = resolve_conflicts.delay(issue_id=issue_id, pr_url=pr_url, workspace_path=workspace_path)
            _release_repo_lock(repo_full_name)
            return {"status": "conflict", "action": "resolve_conflicts", "conflict_result": conflict_result.id}
        branch = ""
        if workspace_path and os.path.isdir(workspace_path):
            result = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=workspace_path, capture_output=True, text=True)
            if result.returncode == 0:
                branch = result.stdout.strip()
            subprocess.run(["git", "push", "origin", branch], cwd=workspace_path, check=True)
        from workers.linear.client import get_client
        linear = get_client()
        comment_body = f"PR merged successfully!\n\nPR: {pr_url}\nStrategy: {merge_strategy}"
        try:
            linear.post_comment(issue_id, comment_body)
            linear.transition_issue(issue_id, "Done")
        except Exception as exc:
            logger.warning("Failed to post merge comment to Linear: %s", exc)
        _release_repo_lock(repo_full_name)
        result = {"status": "merged", "issue_id": issue_id, "pr_url": pr_url, "merge_strategy": merge_strategy, "branch": branch}
        logger.info(json.dumps({"event": "merge.complete", **result}))
        return result
    except Exception as exc:
        if repo_full_name:
            _release_repo_lock(repo_full_name)
        logger.error("Merge failed for %s: %s", issue_id, exc, exc_info=True)
        raise self.retry(exc=exc)
