"""
PipelineEngine --- Redis-backed state tracking for Celery canvas pipelines.

Usage::

    engine = get_engine()
    pipeline_id = engine.start_pipeline("issue-42", "syntaro:fix", ctx)
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
from workers.orchestrator.pipelines import (
    get_pipeline,
    get_stage_task,
    build_canvas,
)
from workers.orchestrator.tenant_limiter import (
    get_tenant_concurrency_limiter,
    get_tenant_token_bucket,
)
from workers.billing.tenant_isolation import get_tenant_manager
from workers.billing.cost_analyzer import (
    analyze_complexity,
    recommend_model,
)
from workers.billing.unit_economics import (
    get_cost_cap_cents,
    get_max_input_tokens,
    get_max_output_tokens,
    is_within_cost_cap,
)
from workers.plan import save_plan, read_plan

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Redis helpers
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None

MAX_REWORK_ATTEMPTS = int(os.getenv("PIPELINE_MAX_REWORK_ATTEMPTS", "3"))


def _get_redis() -> Optional[Any]:
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
    return f"pipeline:{issue_id}:id"


def _pipeline_state_key(pipeline_id: str) -> str:
    return f"pipeline:{pipeline_id}:state"


def _pipeline_events_key(pipeline_id: str) -> str:
    return f"pipeline:{pipeline_id}:events"


# ---------------------------------------------------------------------------
# PipelineEngine
# ---------------------------------------------------------------------------


class PipelineEngine:
    """Manage pipeline lifecycle: start, cancel, status, rework.

    State is persisted in Redis so it survives worker restarts and is
    accessible from the status API.

    Multi-tenant (AIM-2017):
        When ``ctx`` contains ``tenant_id``, the engine applies per-tenant
        concurrency limits and propagates tenant context to all pipeline steps.
    """

    def __init__(self) -> None:
        self.concurrency = AgentConcurrencyLimiter()
        self._tenant_concurrency = get_tenant_concurrency_limiter()
        self._tenant_bucket = get_tenant_token_bucket()
        self._tenant_manager = get_tenant_manager()
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
        pipeline_id = str(uuid.uuid4())
        ctx = dict(ctx or {})
        ctx.setdefault("pipeline_id", pipeline_id)
        ctx.setdefault("issue_id", issue_id)

        tenant_id = ctx.get("tenant_id")
        tenant_tier = ctx.get("tenant_tier")

        # ── Model selection and cost budget (AIM-2083) ─────────────────────
        self._inject_cost_aware_config(ctx, issue_id)

        logger.info(
            "Starting pipeline pipeline_id=%s issue=%s name=%s tenant=%s",
            pipeline_id,
            issue_id,
            pipeline_name,
            tenant_id or "(none)",
        )

        if tenant_id:
            if not self._tenant_concurrency.acquire(tenant_id, issue_id, tier=tenant_tier):
                logger.warning(
                    "Tenant concurrency limit reached for %s tenant=%s -- pipeline queued",
                    issue_id,
                    tenant_id,
                )
                self._persist_state(
                    pipeline_id,
                    {
                        "pipeline_id": pipeline_id,
                        "pipeline_name": pipeline_name,
                        "issue_id": issue_id,
                        "tenant_id": tenant_id,
                        "tenant_tier": tenant_tier or "free",
                        "status": "queued",
                        "current_stage": "awaiting_tenant_slot",
                        "progress": 0.0,
                        "attempt": 0,
                        "created_at": time.time(),
                        "updated_at": time.time(),
                    },
                )
                self._map_issue_to_pipeline(issue_id, pipeline_id)
                return pipeline_id

            if not self._tenant_bucket.consume(tenant_id, tokens=1, tier=tenant_tier):
                logger.warning(
                    "Tenant rate limited for %s tenant=%s -- pipeline queued",
                    issue_id,
                    tenant_id,
                )
                self._tenant_concurrency.release(tenant_id, issue_id)
                self._persist_state(
                    pipeline_id,
                    {
                        "pipeline_id": pipeline_id,
                        "pipeline_name": pipeline_name,
                        "issue_id": issue_id,
                        "tenant_id": tenant_id,
                        "tenant_tier": tenant_tier or "free",
                        "status": "queued",
                        "current_stage": "rate_limited",
                        "progress": 0.0,
                        "attempt": 0,
                        "created_at": time.time(),
                        "updated_at": time.time(),
                    },
                )
                self._map_issue_to_pipeline(issue_id, pipeline_id)
                return pipeline_id

        if not self.concurrency.acquire(issue_id):
            logger.warning(
                "Concurrency limit reached for %s -- pipeline queued",
                issue_id,
            )
            if tenant_id:
                self._tenant_concurrency.release(tenant_id, issue_id)
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
            pipeline_cfg = get_pipeline(pipeline_name)
            if pipeline_cfg is None:
                raise ValueError(f"Unknown pipeline: {pipeline_name}")

            # ── Load externally edited plan.md if it exists ────────────
            existing_workspace = ctx.get("workspace_path", "")
            if existing_workspace:
                plan_steps = read_plan(existing_workspace)
                if plan_steps:
                    ctx["plan_steps"] = plan_steps
                    logger.info(
                        "Loaded %d steps from plan.md for issue=%s",
                        len(plan_steps),
                        issue_id,
                    )

            canvas = build_canvas(pipeline_cfg, ctx)

            if tenant_id:
                issue_key = ctx.get("issue_identifier", issue_id)
                workspace_path = self._tenant_manager.workspace_root(tenant_id, issue_key)
                ctx["workspace_path"] = workspace_path
            else:
                workspace_result = self._create_workspace_for_issue(issue_id, ctx)
                ctx["workspace_path"] = workspace_result.get("workspace_path", "")

            # ── Persist pipeline steps as editable plan.md ────────────
            pipeline_steps = pipeline_cfg.get("steps", [])
            plan_step_dicts = [
                {"task": _step_label(s), "done": False}
                for s in pipeline_steps
            ]
            try:
                save_plan(issue_id, plan_step_dicts, ctx)
            except OSError:
                logger.warning(
                    "Failed to save plan.md for issue=%s workspace=%s",
                    issue_id,
                    ctx.get("workspace_path", "(unknown)"),
                )

            state = {
                "pipeline_id": pipeline_id,
                "pipeline_name": pipeline_name,
                "issue_id": issue_id,
                "status": "running",
                "current_stage": "starting",
                "progress": 0.0,
                "attempt": 1,
                "created_at": time.time(),
                "updated_at": time.time(),
                "selected_model": ctx.get("selected_model", "unknown"),
                "fix_complexity": ctx.get("fix_complexity", "unknown"),
                "cost_budget_cents": ctx.get("cost_budget_cents", 0),
                "estimated_cost_cents": ctx.get("estimated_cost_cents", 0),
                "within_cost_budget": ctx.get("within_cost_budget", True),
            }
            if tenant_id:
                state["tenant_id"] = tenant_id
                state["tenant_tier"] = tenant_tier or "free"
            self._persist_state(pipeline_id, state)
            self._map_issue_to_pipeline(issue_id, pipeline_id)
            self._emit_event(pipeline_id, "pipeline.started", {
                "pipeline_name": pipeline_name,
                "tenant_id": tenant_id,
            })

            async_result = canvas.delay()
            self._update_state(pipeline_id, async_result_id=async_result.id)

            logger.info(
                "Pipeline dispatched pipeline_id=%s async_result=%s tenant=%s",
                pipeline_id,
                async_result.id,
                tenant_id or "(none)",
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
            if tenant_id:
                self._tenant_concurrency.release(tenant_id, issue_id)

        return pipeline_id

    # ------------------------------------------------------------------
    # Cancel
    # ------------------------------------------------------------------

    def cancel_pipeline(self, issue_id: str) -> bool:
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

        try:
            pipeline_cfg = get_pipeline(pipeline_name)
            if pipeline_cfg is None:
                raise ValueError(f"Unknown pipeline: {pipeline_name}")
            canvas = build_canvas(pipeline_cfg, rework_ctx)
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
        client = _get_redis()
        if not client:
            return
        try:
            client.set(_pipeline_state_key(pipeline_id), json.dumps(state))
        except Exception as exc:
            logger.warning("Failed to persist state for %s: %s", pipeline_id, exc)

    def _update_state(self, pipeline_id: str, **updates: Any) -> None:
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
        client = _get_redis()
        if not client:
            return None
        try:
            return client.get(_pipeline_id_key(issue_id))
        except Exception:
            return None

    def _emit_event(self, pipeline_id: str, event: str, data: dict[str, Any]) -> None:
        client = _get_redis()
        if not client:
            return
        try:
            payload = json.dumps({"event": event, "timestamp": time.time(), **data})
            key = _pipeline_events_key(pipeline_id)
            client.lpush(key, payload)
            client.ltrim(key, 0, 99)
            client.expire(key, 86400)
        except Exception as exc:
            logger.debug("Failed to emit event %s: %s", event, exc)

    def _increment_rework_count(self, pipeline_id: str) -> int:
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

    # ------------------------------------------------------------------
    # Cost-aware model routing (AIM-2083)
    # ------------------------------------------------------------------

    def _inject_cost_aware_config(self, ctx: dict[str, Any], issue_id: str) -> None:
        """Select model and set cost budget based on tier and fix complexity."""
        tenant_tier = ctx.get("tenant_tier", "free")
        issue_data = ctx.get("issue_data", {})
        triage_result = ctx.get("triage_result", {})

        # Analyse complexity
        complexity = analyze_complexity(
            issue_title=issue_data.get("title", ""),
            issue_body=issue_data.get("body", ""),
            file_count=ctx.get("estimated_file_count", 0),
            estimated_lines=ctx.get("estimated_lines", 0),
            triage_category=triage_result.get("category", "unknown"),
            triage_scope=triage_result.get("scope", "small"),
        )

        complexity_label = complexity.complexity

        # Select model
        recommendation = recommend_model(
            tier=tenant_tier,
            complexity=complexity_label,
            estimated_input_tokens=get_max_input_tokens(tenant_tier),
            estimated_output_tokens=get_max_output_tokens(tenant_tier),
        )

        model_name = recommendation.model_name
        cost_cap = get_cost_cap_cents(tenant_tier)
        within_budget = is_within_cost_cap(tenant_tier, recommendation.estimated_cost_cents)

        ctx["selected_model"] = model_name
        ctx["cost_budget_cents"] = cost_cap
        ctx["fix_complexity"] = complexity_label
        ctx["complexity_score"] = complexity.score
        ctx["within_cost_budget"] = within_budget
        ctx["estimated_cost_cents"] = recommendation.estimated_cost_cents
        ctx["model_recommendation"] = recommendation.to_dict()

        if not within_budget:
            logger.warning(
                "Fix cost exceeds cap for issue=%s tier=%s est_cost=%.2f cap=%.2f",
                issue_id,
                tenant_tier,
                recommendation.estimated_cost_cents,
                cost_cap,
            )

        logger.info(
            "Cost-aware routing issue=%s tier=%s complexity=%s model=%s est_cost=%.4f",
            issue_id,
            tenant_tier,
            complexity_label,
            model_name,
            recommendation.estimated_cost_cents,
        )

    @staticmethod
    def _create_workspace_for_issue(
        issue_id: str,
        ctx: dict[str, Any],
    ) -> dict[str, str]:
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
# Helpers
# ---------------------------------------------------------------------------


def _step_label(step_cfg: dict[str, Any]) -> str:
    """Derive a human-readable label from a pipeline step config."""
    label = step_cfg.get("label", "")
    if label:
        return label
    task = step_cfg.get("task", "unknown")
    return task.rsplit(".", 1)[-1].replace("_", " ").title()


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_engine: Optional[PipelineEngine] = None


def get_engine() -> PipelineEngine:
    global _engine
    if _engine is None:
        _engine = PipelineEngine()
    return _engine
