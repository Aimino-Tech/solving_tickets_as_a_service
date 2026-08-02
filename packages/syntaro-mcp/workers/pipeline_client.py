"""
PipelineClient — wraps the real PipelineEngine for use by MCP servers.

Provides a clean API for submitting fix requests, checking status,
and managing fix runs. Delegates to PipelineEngine for real
Celery-based dispatch and Redis-backed state tracking.

Usage:

    from workers.pipeline_client import get_client

    client = get_client()
    result = client.submit_fix(owner="my-org", repo="my-repo", issue_number=42)
    status = client.check_status(result["run_id"])
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


class PipelineClient:
    """Client for the real OpenSymphony pipeline.

    In-process mode (default): calls ``PipelineEngine`` directly.
    HTTP mode (``STAS_PIPELINE_API_URL`` env): calls a remote pipeline API.
    """

    def __init__(self) -> None:
        self._engine_ref = None
        self._engine_init = False
        self._api_url = os.getenv("STAS_PIPELINE_API_URL", "")

    def _get_engine(self):
        if not self._engine_init:
            self._engine_init = True
            if not self._api_url:
                try:
                    from workers.orchestrator.engine import get_engine
                    self._engine_ref = get_engine()
                except Exception as exc:
                    logger.warning("PipelineEngine not available: %s", exc)
                    self._engine_ref = None
            else:
                self._engine_ref = None
        return self._engine_ref

    def _http_call(self, method: str, *args, **kwargs) -> dict[str, Any]:
        import httpx
        url = f"{self._api_url.rstrip('/')}/api/pipeline/{method}"
        payload = {"args": args, "kwargs": kwargs}
        resp = httpx.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def submit_fix(
        self,
        owner: str,
        repo: str,
        issue_number: int,
        issue_url: str = "",
        pipeline_name: str = "stas:fix",
    ) -> dict[str, Any]:
        if not issue_url:
            issue_url = f"https://github.com/{owner}/{repo}/issues/{issue_number}"

        issue_id = f"{owner}/{repo}#{issue_number}"
        run_id = f"stas-{uuid.uuid4().hex[:12]}"
        created_at = datetime.now(timezone.utc).isoformat()

        engine = self._get_engine()
        if engine and not self._api_url:
            ctx: dict[str, Any] = {
                "issue_id": issue_id,
                "run_id": run_id,
                "repo_owner": owner,
                "repo_name": repo,
                "repo_full_name": f"{owner}/{repo}",
                "issue_number": issue_number,
                "issue_url": issue_url,
                "pipeline_name": pipeline_name,
                "created_at": created_at,
            }
            try:
                pipeline_id = engine.start_pipeline(issue_id, pipeline_name, ctx)
                logger.info("Pipeline started for %s — pipeline_id=%s", issue_id, pipeline_id)
                return {
                    "success": True,
                    "run_id": run_id,
                    "pipeline_id": pipeline_id,
                    "issue_id": issue_id,
                    "status": "queued",
                    "created_at": created_at,
                }
            except Exception as exc:
                logger.error("Failed to start pipeline for %s: %s", issue_id, exc)
                return {
                    "success": False, "run_id": run_id,
                    "issue_id": issue_id, "status": "failed",
                    "error": str(exc), "created_at": created_at,
                }

        if self._api_url:
            return self._http_call("submit_fix", owner=owner, repo=repo,
                                   issue_number=issue_number, issue_url=issue_url,
                                   pipeline_name=pipeline_name)

        return {
            "success": False, "run_id": run_id,
            "status": "unavailable",
            "error": "No pipeline engine or API URL configured",
        }

    def check_status(self, issue_id_or_run_id: str) -> dict[str, Any]:
        engine = self._get_engine()
        if engine and not self._api_url:
            try:
                state = engine.get_status(issue_id_or_run_id)
                return {
                    "success": True,
                    "issue_id": issue_id_or_run_id,
                    "status": state.get("status", "unknown"),
                    "current_stage": state.get("current_stage", ""),
                    "progress": state.get("progress", 0.0),
                    "pipeline_id": state.get("pipeline_id", ""),
                    "error": state.get("error"),
                }
            except Exception as exc:
                logger.error("Status check failed for %s: %s", issue_id_or_run_id, exc)
                return {"success": False, "error": str(exc)}
        if self._api_url:
            return self._http_call("check_status", issue_id=issue_id_or_run_id)
        return {"success": False, "error": "Pipeline engine unavailable"}

    def get_run_history(self, repo: str = "", limit: int = 20) -> dict[str, Any]:
        """List fix runs, optionally filtered by repo. Returns {"success", "runs", "total"}."""
        engine = self._get_engine()
        if engine and not self._api_url:
            try:
                runs = engine.list_runs(repo=repo, limit=limit)
                return {"success": True, "runs": runs, "total": len(runs)}
            except Exception as exc:
                logger.error("Run history failed for repo=%s: %s", repo, exc)
                return {"success": False, "runs": [], "error": str(exc)}
        if self._api_url:
            return self._http_call("get_run_history", repo=repo, limit=limit)
        return {"success": False, "runs": [], "error": "Pipeline engine unavailable"}

    def get_events(self, issue_id: str, limit: int = 20) -> dict[str, Any]:
        engine = self._get_engine()
        if engine and not self._api_url:
            try:
                events = engine.get_events(issue_id, limit=limit)
                return {"success": True, "events": events, "total": len(events)}
            except Exception as exc:
                return {"success": False, "error": str(exc)}
        if self._api_url:
            return self._http_call("get_events", issue_id=issue_id, limit=limit)
        return {"success": False, "error": "Pipeline engine unavailable"}

    def cancel_fix(self, issue_id: str) -> dict[str, Any]:
        engine = self._get_engine()
        if engine and not self._api_url:
            try:
                cancelled = engine.cancel_pipeline(issue_id)
                return {
                    "success": cancelled,
                    "issue_id": issue_id,
                    "status": "cancelled" if cancelled else "not_found",
                }
            except Exception as exc:
                return {"success": False, "error": str(exc)}
        if self._api_url:
            return self._http_call("cancel_fix", issue_id=issue_id)
        return {"success": False, "error": "Pipeline engine unavailable"}


_client: PipelineClient | None = None


def get_client() -> PipelineClient:
    global _client
    if _client is None:
        _client = PipelineClient()
    return _client
