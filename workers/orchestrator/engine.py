import os
import uuid
import logging
from typing import Any

from celery import chain

from workers.orchestrator.pipelines import get_pipeline, get_stage_task
from workers.orchestrator.workspace import create_workspace
from workers.orchestrator.concurrency import AgentConcurrencyLimiter

logger = logging.getLogger(__name__)


class PipelineEngine:
    def __init__(self) -> None:
        self.concurrency = AgentConcurrencyLimiter()

    def start_pipeline(
        self,
        issue_id: str,
        pipeline_name: str,
        ctx: dict[str, Any] | None = None,
    ) -> str:
        pipeline_id = str(uuid.uuid4())
        stages = get_pipeline(pipeline_name)
        ctx = ctx or {}
        ctx["pipeline_id"] = pipeline_id
        ctx["issue_id"] = issue_id

        logger.info(
            "Starting pipeline %s for issue %s — stages=%s",
            pipeline_id, issue_id, stages,
        )

        if not self.concurrency.acquire(issue_id):
            logger.warning("Concurrency limit reached for %s, queuing", issue_id)
            from workers.tasks.linear_poll import poll_active_issues
            poll_active_issues.apply_async(countdown=30)
            return pipeline_id

        workspace = create_workspace(issue_id, ctx.get("identifier", issue_id), "")
        ctx["workspace_path"] = workspace.get("workspace_path", "")

        logger.info("Pipeline %s started for issue %s", pipeline_id, issue_id)
        return pipeline_id

    def cancel_pipeline(self, issue_id: str) -> None:
        from workers.celery_app import app
        i = app.control.inspect()
        active = i.active() or {}
        for worker, tasks in active.items():
            for task in tasks:
                if task.get("kwargs", {}).get("issue_id") == issue_id:
                    app.control.revoke(task["id"], terminate=True)
        self.concurrency.release(issue_id)
        logger.info("Cancelled pipeline for issue %s", issue_id)

    def get_status(self, issue_id: str) -> dict[str, Any]:
        return {
            "issue_id": issue_id,
            "status": "running",
        }


_pipeline_engine: PipelineEngine | None = None


def get_engine() -> PipelineEngine:
    global _pipeline_engine
    if _pipeline_engine is None:
        _pipeline_engine = PipelineEngine()
    return _pipeline_engine
