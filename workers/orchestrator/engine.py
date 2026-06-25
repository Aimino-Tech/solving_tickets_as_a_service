"""
PipelineEngine --- Redis-backed state tracking for Celery canvas pipelines.

Usage::

    engine = get_engine()
    pipeline_id = engine.start_pipeline("issue-42", "stas:fix", ctx)
    status = engine.get_status("issue-42")
    engine.cancel_pipeline("issue-42")
"""

import json
import logging
import os
import time
import uuid
from typing import Any, Optional

from celery import chain, chord
from celery.result import AsyncResult

from workers.orchestrator.concurrency import AgentConcurrencyLimiter
from workers.orchestrator.pipelines import get_pipeline, get_stage_task

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None

MAX_REWORK_ATTEMPTS = int(os.getenv("PIPELINE_MAX_REWORK_ATTEMPTS", "3"))


def _get_redis() -> Optional[Any]:
    """Lazy-init Redis client for pipeline state storage."""
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        url = os.getenv(
            "REDIS_URL",
            os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
        )
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("PipelineEngine Redis unavailable --- %s", exc)
        _REDIS_CLIENT = None
        return None


def _pipeline_id_key(issue_id: str) -> str:
    """Redis key mapping *issue_id* to its active pipeline ID."""
    return f"pipeline:{issue_id}:id"


def _pipeline_state_key(pipeline_id: str) -> str:
    """Redis key holding the JSON state blob for *pipeline_id*."""
    return f"pipeline:{pipeline_id}:state"


def _pipeline_events_key(pipeline_id: str) -> str:
    """Redis list key holding recent pipeline events."""
    return f"pipeline:{pipeline_id}:events"


# ---------------------------------------------------------------------------
# PipelineEngine
# ---------------------------------------------------------------------------


class PipelineEngine:
    """Manage pipeline lifecycle: start, cancel, status, rework.

    State is persisted in Redis so it survives worker restarts and is
    accessible from the status API.
    """

    def __init__(self) -> None:
        self.concurrency = AgentConcurrencyLimiter()
        self._max_rework = MAX_REWORK_ATTEMPTS

    # ------------------------------------------------------------------
    # Start
    # ------------------------------------------------------------------

    def start_pipeline(
        self,
        issue_id: str,
        pipeline_name: str,
        ctx: dict[str, Any] | None = None,
    ) -> str:
        """Build and dispatch a pipeline canvas for *issue_id*.

        Args:
            issue_id: Issue identifier (e.g. ``"AIM-42"`` or ``"42"``).
            pipeline_name: One of ``"stas:fix"``, ``"stas:feature"``,
                ``"stas:research"``.
            ctx: Context dict passed to the pipeline builder.  Must contain
                at minimum ``"repo_url"`` and ``"issue_identifier"``.

        Returns:
            The generated ``pipeline_id`` (UUID string).

        Raises:
            ValueError: if *pipeline_name* is not registered.
        """
        pipeline_id = str(uuid.uuid4())
        ctx = dict(ctx or {})
        ctx.setdefault("pipeline_id", pipeline_id)
        ctx.setdefault("issue_id", issue_id)

        logger.info(
            "Starting pipeline pipeline_id=%s issue=%s name=%s",
            pipeline_id,
            issue_id,
            pipeline_name,
        )

        # --- Concurrency check ---
        if not self.concurrency.acquire(issue_id):
            logger.warning(
                "Concurrency limit reached for %s -- pipeline queued",
                issue_id,
            )
            self._persist_state(
                pipeline_id,
                {
                    "pipeline_id": pipeline_id,
                    "pipeline_name": pipeline_name,
                    "issue_id": issue_id,
                    "status": "queued",
                    "current_stage": "awaiting_slot",
                    "progress": 0.0,
                    "attempt": 0,
                    "created_at": time.time(),
                    "updated_at": time.time(),
                },
            )
            self._map_issue_to_pipeline(issue_id, pipeline_id)
            return pipeline_id

        try:
            # --- Build pipeline canvas ---
            builder = get_pipeline(pipeline_name)
            issue_data = ctx.get("issue_data", {})
            canvas = builder(issue_data, ctx)

            # --- Create workspace ---
            workspace_result = self._create_workspace_for_issue(issue_id, ctx)
            ctx["workspace_path"] = workspace_result.get("workspace_path", "")

            # --- Persist initial state ---
            self._persist_state(
                pipeline_id,
                {
                    "pipeline_id": pipeline_id,
                    "pipeline_name": pipeline_name,
                    "issue_id": issue_id,
                    "status": "running",
                    "current_stage": "starting",
                    "progress": 0.0,
                    "attempt": 1,
                    "created_at": time.time(),
                    "updated_at": time.time(),
                },
            )
            self._map_issue_to_pipeline(issue_id, pipeline_id)
            self._emit_event(pipeline_id, "pipeline.started", {"pipeline_name": pipeline_name})

            # --- Dispatch the canvas ---
            async_result = canvas.delay()
            self._update_state(pipeline_id, async_result_id=async_result.id)

            logger.info(
                "Pipeline dispatched pipeline_id=%s async_result=%s",
                pipeline_id,
                async_result.id,
            )

        except Exception:
            logger.exception("Pipeline start failed for issue %s", issue_id)
            self._update_state(
                pipeline_id,
                status="failed",
                error="Pipeline start failed",
            )
            raise
        finally:
            self.concurrency.release(issue_id)

        return pipeline_id

    # ------------------------------------------------------------------
    # Cancel
    # ------------------------------------------------------------------

    def cancel_pipeline(self, issue_id: str) -> bool:
        """Revoke all tasks for *issue_id* and mark the pipeline cancelled.

        Returns:
            True if a pipeline was found and revoked, False otherwise.
        """
        pipeline_id = self._resolve_pipeline_id(issue_id)
        if not pipeline_id:
            logger.warning("No pipeline found for issue %s", issue_id)
            return False

        client = _get_redis()
        if client:
            raw = client.get(_pipeline_state_key(pipeline_id))
            if raw:
                try:
                    state = json.loads(raw)
                    async_result_id = state.get("async_result_id")
                    if async_result_id:
                        from celery import current_app as _app

                        _app.control.revoke(async_result_id, terminate=True)
                        logger.info(
                            "Revoked task %s for pipeline %s",
                            async_result_id,
                            pipeline_id,
                        )
                except Exception as exc:
                    logger.warning("Failed to revoke pipeline %s: %s", pipeline_id, exc)

            self._update_state(pipeline_id, status="cancelled", current_stage="cancelled")

        self.concurrency.release(issue_id)
        self._emit_event(pipeline_id, "pipeline.cancelled", {"issue_id": issue_id})
        logger.info("Cancelled pipeline for issue %s", issue_id)
        return True

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def get_status(self, issue_id: str) -> dict[str, Any]:
        """Return the current pipeline state for *issue_id*.

        Returns a dict with ``status``, ``current_stage``, ``progress``,
        ``attempt``, ``pipeline_name``, and other metadata.  Returns a
        ``not_found`` status when no pipeline exists.
        """
        client = _get_redis()
        if not client:
            return {"issue_id": issue_id, "status": "unknown"}

        pipeline_id = self._resolve_pipeline_id(issue_id)
        if not pipeline_id:
            return {
                "issue_id": issue_id,
                "status": "not_found",
                "current_stage": "",
                "progress": 0.0,
                "attempt": 0,
            }

        raw = client.get(_pipeline_state_key(pipeline_id))
        if not raw:
            return {
                "issue_id": issue_id,
                "pipeline_id": pipeline_id,
                "status": "unknown",
                "note": "State key not found",
            }

        try:
            state: dict[str, Any] = json.loads(raw)
            state.setdefault("issue_id", issue_id)
            return state
        except json.JSONDecodeError:
            return {
                "issue_id": issue_id,
                "pipeline_id": pipeline_id,
                "status": "error",
                "error": "Corrupt pipeline state",
            }

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def get_events(self, issue_id: str, limit: int = 20) -> list[dict[str, Any]]:
        """Return recent pipeline events for *issue_id*."""
        client = _get_redis()
        if not client:
            return []

        pipeline_id = self._resolve_pipeline_id(issue_id)
        if not pipeline_id:
            return []

        try:
            raw_events = client.lrange(_pipeline_events_key(pipeline_id), 0, limit - 1)
            events: list[dict[str, Any]] = []
            for raw in raw_events or []:
                try:
                    events.append(json.loads(raw))
                except json.JSONDecodeError:
                    continue
            return events
        except Exception:
            logger.exception("Failed to read events for pipeline %s", pipeline_id)
            return []

    # ------------------------------------------------------------------
    # Rework
    # ------------------------------------------------------------------

    def should_rework(self, step_result: dict[str, Any]) -> bool:
        """Determine if *step_result* indicates a failure worth reworking."""
        if step_result.get("status") in ("failed", "error"):
            return True
        if step_result.get("passed") is False:
            return True
        if step_result.get("decision") == "rework":
            return True
        if step_result.get("failures"):
            return True
        return False

    def rework_pipeline(
        self,
        issue_id: str,
        pipeline_name: str,
        ctx: dict[str, Any],
        feedback: dict[str, Any],
    ) -> Optional[str]:
        """Re-dispatch the pipeline with accumulated *feedback*.

        Increments the rework counter in Redis.  When ``MAX_REWORK_ATTEMPTS``
        is exceeded the pipeline is marked as ``failed`` and ``None`` is
        returned.
        """
        pipeline_id = self._resolve_pipeline_id(issue_id)
        if not pipeline_id:
            logger.warning("Cannot rework -- no pipeline for issue %s", issue_id)
            return None

        attempt = self._increment_rework_count(pipeline_id)

        if attempt > self._max_rework:
            logger.error(
                "Rework limit exceeded issue=%s pipeline=%s attempt=%d max=%d",
                issue_id,
                pipeline_id,
                attempt,
                self._max_rework,
            )
            self._update_state(
                pipeline_id,
                status="failed",
                error=f"Rework limit exceeded ({self._max_rework} attempts)",
                rework_attempts=attempt,
            )
            self._emit_event(
                pipeline_id,
                "pipeline.rework_exhausted",
                {"attempt": attempt, "max_attempts": self._max_rework},
            )
            return None

        # Build rework context
        rework_ctx = dict(ctx)
        rework_ctx["_rework_attempt"] = attempt
        rework_ctx["_rework_feedback"] = feedback
        rework_ctx["_is_rework"] = True
        rework_ctx["agent_feedback"] = feedback.get("failures", [])

        self._update_state(
            pipeline_id,
            status="running",
            current_stage=f"rework_attempt_{attempt}",
            attempt=attempt,
        )
        self._emit_event(
            pipeline_id,
            "pipeline.rework_started",
            {"attempt": attempt, "failures": feedback.get("failures", [])},
        )

        # Re-dispatch
        try:
            builder = get_pipeline(pipeline_name)
            issue_data = ctx.get("issue_data", {})
            canvas = builder(issue_data, rework_ctx)
            async_result = canvas.delay()
            self._update_state(pipeline_id, async_result_id=async_result.id)
            return pipeline_id
        except Exception as exc:
            logger.exception("Rework dispatch failed for %s", pipeline_id)
            self._update_state(pipeline_id, status="failed", error=str(exc))
            return None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _persist_state(self, pipeline_id: str, state: dict[str, Any]) -> None:
        """Write *state* to Redis."""
        client = _get_redis()
        if not client:
            return
        try:
            client.set(_pipeline_state_key(pipeline_id), json.dumps(state))
        except Exception as exc:
            logger.warning("Failed to persist state for %s: %s", pipeline_id, exc)

    def _update_state(self, pipeline_id: str, **updates: Any) -> None:
        """Merge keyword arguments into the existing Redis state."""
        client = _get_redis()
        if not client:
            return
        try:
            raw = client.get(_pipeline_state_key(pipeline_id))
            if raw:
                state = json.loads(raw)
                state.update(updates)
                state["updated_at"] = time.time()
                client.set(_pipeline_state_key(pipeline_id), json.dumps(state))
        except Exception as exc:
            logger.warning("Failed to update state for %s: %s", pipeline_id, exc)

    def _map_issue_to_pipeline(self, issue_id: str, pipeline_id: str) -> None:
        """Write the issue -> pipeline mapping to Redis."""
        client = _get_redis()
        if not client:
            return
        try:
            client.set(_pipeline_id_key(issue_id), pipeline_id)
        except Exception as exc:
            logger.warning(
                "Failed to map issue %s -> %s: %s",
                issue_id,
                pipeline_id,
                exc,
            )

    def _resolve_pipeline_id(self, issue_id: str) -> Optional[str]:
        """Look up the pipeline ID for *issue_id* from Redis."""
        client = _get_redis()
        if not client:
            return None
        try:
            return client.get(_pipeline_id_key(issue_id))
        except Exception:
            return None

    def _emit_event(self, pipeline_id: str, event: str, data: dict[str, Any]) -> None:
        """Push an event to the pipeline's event list in Redis."""
        client = _get_redis()
        if not client:
            return
        try:
            payload = json.dumps({"event": event, "timestamp": time.time(), **data})
            key = _pipeline_events_key(pipeline_id)
            client.lpush(key, payload)
            client.ltrim(key, 0, 99)  # keep last 100 events
            client.expire(key, 86400)  # 24h TTL
        except Exception as exc:
            logger.debug("Failed to emit event %s: %s", event, exc)

    def _increment_rework_count(self, pipeline_id: str) -> int:
        """Increment and return the rework attempt counter in Redis."""
        client = _get_redis()
        if not client:
            return 1
        try:
            key = f"pipeline:{pipeline_id}:rework_count"
            count = client.incr(key)
            client.expire(key, 86400)
            return count
        except Exception:
            return 1

    @staticmethod
    def _create_workspace_for_issue(
        issue_id: str,
        ctx: dict[str, Any],
    ) -> dict[str, str]:
        """Synchronously create a workspace (or skip if already present)."""
        from workers.orchestrator.workspace import create_workspace as _create_ws

        try:
            result = _create_ws.run(
                issue_id=issue_id,
                issue_identifier=ctx.get(
                    "issue_identifier", ctx.get("identifier", issue_id)
                ),
                repo_url=ctx.get("repo_url", ""),
            )
            return result
        except Exception as exc:
            logger.warning("Workspace creation failed (non-fatal): %s", exc)
            return {"workspace_path": "", "branch": ""}


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_engine: Optional[PipelineEngine] = None


def get_engine() -> PipelineEngine:
    """Return the shared ``PipelineEngine`` singleton."""
    global _engine
    if _engine is None:
        _engine = PipelineEngine()
    return _engine
