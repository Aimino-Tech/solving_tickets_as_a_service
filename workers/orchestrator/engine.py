"""
PipelineEngine --- Redis-backed state tracking for Celery canvas pipelines.
"""
import json, logging, os, time, uuid
from typing import Any, Optional
from celery import chain, chord
from celery.result import AsyncResult
from workers.orchestrator.concurrency import AgentConcurrencyLimiter
from workers.orchestrator.pipelines import get_pipeline, get_stage_task

logger = logging.getLogger(__name__)

_REDIS_CLIENT: Optional[Any] = None
MAX_REWORK_ATTEMPTS = int(os.getenv("PIPELINE_MAX_REWORK_ATTEMPTS", "3"))

def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None: return _REDIS_CLIENT
    try:
        import redis as _rm
        url = os.getenv("REDIS_URL", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))
        _REDIS_CLIENT = _rm.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("PipelineEngine Redis unavailable --- %s", exc)
        _REDIS_CLIENT = None; return None

def _pipeline_id_key(issue_id: str) -> str: return f"pipeline:{issue_id}:id"
def _pipeline_state_key(pipeline_id: str) -> str: return f"pipeline:{pipeline_id}:state"
def _pipeline_events_key(pipeline_id: str) -> str: return f"pipeline:{pipeline_id}:events"


class PipelineEngine:
    def __init__(self) -> None:
        self.concurrency = AgentConcurrencyLimiter()
        self._max_rework = MAX_REWORK_ATTEMPTS

    def start_pipeline(self, issue_id: str, pipeline_name: str, ctx: dict[str, Any] | None = None) -> str:
        pipeline_id = str(uuid.uuid4())
        ctx = dict(ctx or {})
        ctx.setdefault("pipeline_id", pipeline_id)
        ctx.setdefault("issue_id", issue_id)
        logger.info("Starting pipeline pipeline_id=%s issue=%s name=%s", pipeline_id, issue_id, pipeline_name)

        if not self.concurrency.acquire(issue_id):
            logger.warning("Concurrency limit reached for %s -- pipeline queued", issue_id)
            self._persist_state(pipeline_id, {"pipeline_id": pipeline_id, "pipeline_name": pipeline_name, "issue_id": issue_id, "status": "queued", "current_stage": "awaiting_slot", "progress": 0.0, "attempt": 0, "created_at": time.time(), "updated_at": time.time()})
            self._map_issue_to_pipeline(issue_id, pipeline_id)
            return pipeline_id

        try:
            builder = get_pipeline(pipeline_name)
            issue_data = ctx.get("issue_data", {})
            canvas = builder(issue_data, ctx)
            workspace_result = self._create_workspace_for_issue(issue_id, ctx)
            ctx["workspace_path"] = workspace_result.get("workspace_path", "")

            self._persist_state(pipeline_id, {"pipeline_id": pipeline_id, "pipeline_name": pipeline_name, "issue_id": issue_id, "status": "running", "current_stage": "starting", "progress": 0.0, "attempt": 1, "created_at": time.time(), "updated_at": time.time()})
            self._map_issue_to_pipeline(issue_id, pipeline_id)
            self._emit_event(pipeline_id, "pipeline.started", {"pipeline_name": pipeline_name})

            async_result = canvas.delay()
            self._update_state(pipeline_id, async_result_id=async_result.id)
            logger.info("Pipeline dispatched pipeline_id=%s async_result=%s", pipeline_id, async_result.id)
        except Exception:
            logger.exception("Pipeline start failed for issue %s", issue_id)
            self._update_state(pipeline_id, status="failed", error="Pipeline start failed")
            raise
        finally:
            self.concurrency.release(issue_id)
        return pipeline_id

    def cancel_pipeline(self, issue_id: str) -> bool:
        pipeline_id = self._resolve_pipeline_id(issue_id)
        if not pipeline_id: return False
        client = _get_redis()
        if client:
            raw = client.get(_pipeline_state_key(pipeline_id))
            if raw:
                try:
                    s = json.loads(raw)
                    if s.get("async_result_id"):
                        from celery import current_app as _app
                        _app.control.revoke(s["async_result_id"], terminate=True)
                except Exception as exc:
                    logger.warning("Failed to revoke pipeline %s: %s", pipeline_id, exc)
            self._update_state(pipeline_id, status="cancelled", current_stage="cancelled")
        self.concurrency.release(issue_id)
        return True

    def get_status(self, issue_id: str) -> dict[str, Any]:
        client = _get_redis()
        if not client: return {"issue_id": issue_id, "status": "unknown"}
        pid = self._resolve_pipeline_id(issue_id)
        if not pid: return {"issue_id": issue_id, "status": "not_found", "current_stage": "", "progress": 0.0, "attempt": 0}
        raw = client.get(_pipeline_state_key(pid))
        if not raw: return {"issue_id": issue_id, "pipeline_id": pid, "status": "unknown", "note": "State key not found"}
        try:
            s: dict = json.loads(raw)
            s.setdefault("issue_id", issue_id); return s
        except json.JSONDecodeError:
            return {"issue_id": issue_id, "pipeline_id": pid, "status": "error", "error": "Corrupt pipeline state"}

    def get_events(self, issue_id: str, limit: int = 20) -> list[dict[str, Any]]:
        client = _get_redis()
        if not client: return []
        pid = self._resolve_pipeline_id(issue_id)
        if not pid: return []
        try:
            events: list[dict] = []
            for r in client.lrange(_pipeline_events_key(pid), 0, limit - 1) or []:
                try: events.append(json.loads(r))
                except json.JSONDecodeError: continue
            return events
        except Exception: return []

    def should_rework(self, step_result: dict[str, Any]) -> bool:
        if step_result.get("status") in ("failed", "error"): return True
        if step_result.get("passed") is False: return True
        if step_result.get("decision") == "rework": return True
        if step_result.get("failures"): return True
        return False

    def rework_pipeline(self, issue_id: str, pipeline_name: str, ctx: dict[str, Any], feedback: dict[str, Any]) -> Optional[str]:
        pipeline_id = self._resolve_pipeline_id(issue_id)
        if not pipeline_id: return None
        attempt = self._increment_rework_count(pipeline_id)
        if attempt > self._max_rework:
            self._update_state(pipeline_id, status="failed", error=f"Rework limit exceeded ({self._max_rework} attempts)", rework_attempts=attempt)
            return None
        rctx = dict(ctx)
        rctx["_rework_attempt"] = attempt; rctx["_rework_feedback"] = feedback; rctx["_is_rework"] = True
        rctx["agent_feedback"] = feedback.get("failures", [])
        self._update_state(pipeline_id, status="running", current_stage=f"rework_attempt_{attempt}", attempt=attempt)
        try:
            builder = get_pipeline(pipeline_name)
            canvas = builder(ctx.get("issue_data", {}), rctx)
            async_result = canvas.delay()
            self._update_state(pipeline_id, async_result_id=async_result.id)
            return pipeline_id
        except Exception as exc:
            self._update_state(pipeline_id, status="failed", error=str(exc))
            return None

    def _persist_state(self, pid: str, state: dict) -> None:
        c = _get_redis()
        if c:
            try: c.set(_pipeline_state_key(pid), json.dumps(state))
            except Exception as e: logger.warning("Failed to persist state for %s: %s", pid, e)

    def _update_state(self, pid: str, **updates: Any) -> None:
        c = _get_redis()
        if not c: return
        try:
            r = c.get(_pipeline_state_key(pid))
            if r:
                s = json.loads(r); s.update(updates); s["updated_at"] = time.time()
                c.set(_pipeline_state_key(pid), json.dumps(s))
        except Exception as e: logger.warning("Failed to update state for %s: %s", pid, e)

    def _map_issue_to_pipeline(self, issue_id: str, pid: str) -> None:
        c = _get_redis()
        if c:
            try: c.set(_pipeline_id_key(issue_id), pid)
            except Exception as e: logger.warning("Failed to map issue %s -> %s: %s", issue_id, pid, e)

    def _resolve_pipeline_id(self, issue_id: str) -> Optional[str]:
        c = _get_redis()
        if not c: return None
        try: return c.get(_pipeline_id_key(issue_id))
        except Exception: return None

    def _emit_event(self, pid: str, event: str, data: dict) -> None:
        c = _get_redis()
        if not c: return
        try:
            p = json.dumps({"event": event, "timestamp": time.time(), **data})
            k = _pipeline_events_key(pid)
            c.lpush(k, p); c.ltrim(k, 0, 99); c.expire(k, 86400)
        except Exception: pass

    def _increment_rework_count(self, pid: str) -> int:
        c = _get_redis()
        if not c: return 1
        try:
            cnt = c.incr(f"pipeline:{pid}:rework_count"); c.expire(f"pipeline:{pid}:rework_count", 86400); return cnt
        except Exception: return 1

    @staticmethod
    def _create_workspace_for_issue(issue_id: str, ctx: dict[str, Any]) -> dict[str, str]:
        from workers.orchestrator.workspace import create_workspace as _cw
        try:
            return _cw.run(issue_id=issue_id, issue_identifier=ctx.get("issue_identifier", ctx.get("identifier", issue_id)), repo_url=ctx.get("repo_url", ""))
        except Exception as exc:
            logger.warning("Workspace creation failed (non-fatal): %s", exc)
            return {"workspace_path": "", "branch": ""}

_engine: Optional[PipelineEngine] = None
def get_engine() -> PipelineEngine:
    global _engine
    if _engine is None: _engine = PipelineEngine()
    return _engine
