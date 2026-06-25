import json
import logging
import os
import uuid

import redis.asyncio as redis
from celery.result import AsyncResult

from workers.orchestrator.pipelines import PIPELINES, get_pipeline

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("CELERY_BROKER_URL", os.getenv("REDIS_URL", "redis://localhost:6379/0"))


class PipelineEngine:
    def __init__(self, redis_client: redis.Redis | None = None):
        self.redis = redis_client or redis.from_url(REDIS_URL, decode_responses=True)

    async def start_pipeline(
        self,
        issue_id: str,
        pipeline_name: str,
        ctx: dict | None = None,
    ) -> str:
        pipeline_id = str(uuid.uuid4())
        pipeline_cfg = get_pipeline(pipeline_name)
        if not pipeline_cfg:
            raise ValueError(f"Unknown pipeline: {pipeline_name}")

        pipeline_key = f"pipeline:{pipeline_id}"
        await self.redis.hset(pipeline_key, mapping={
            "issue_id": issue_id,
            "pipeline_name": pipeline_name,
            "pipeline_id": pipeline_id,
            "status": "running",
            "current_stage": pipeline_cfg["stages"][0] if pipeline_cfg["stages"] else "",
            "attempt": "0",
            "created_at": str(uuid.uuid4()),
        })
        await self.redis.expire(pipeline_key, 86400)

        await self.redis.set(f"pipeline:issue:{issue_id}", pipeline_id, ex=86400)

        return pipeline_id

    async def cancel_pipeline(self, issue_id: str) -> bool:
        pipeline_id = await self.redis.get(f"pipeline:issue:{issue_id}")
        if not pipeline_id:
            return False

        pipeline_key = f"pipeline:{pipeline_id}"
        await self.redis.hset(pipeline_key, "status", "cancelled")

        async_result_id = await self.redis.hget(pipeline_key, "async_result_id")
        if async_result_id:
            AsyncResult(async_result_id).revoke(terminate=True)

        return True

    async def get_status(self, issue_id: str) -> dict | None:
        pipeline_id = await self.redis.get(f"pipeline:issue:{issue_id}")
        if not pipeline_id:
            return None

        pipeline_key = f"pipeline:{pipeline_id}"
        data = await self.redis.hgetall(pipeline_key)
        if not data:
            return None

        return {
            "pipeline_id": data.get("pipeline_id"),
            "issue_id": data.get("issue_id"),
            "status": data.get("status", "unknown"),
            "current_stage": data.get("current_stage", ""),
            "attempt": int(data.get("attempt", 0)),
            "pipeline_name": data.get("pipeline_name"),
            "progress": await self._get_progress(pipeline_id),
        }

    async def update_stage(self, pipeline_id: str, stage: str, status: str):
        pipeline_key = f"pipeline:{pipeline_id}"
        await self.redis.hset(pipeline_key, "current_stage", stage)
        await self.redis.hset(f"pipeline:{pipeline_id}:stage:{stage}", "status", status)

    async def _get_progress(self, pipeline_id: str) -> dict:
        pipeline_cfg = get_pipeline("stas:fix")
        if not pipeline_cfg:
            return {}
        progress = {}
        for stage in pipeline_cfg["stages"]:
            stage_data = await self.redis.hgetall(f"pipeline:{pipeline_id}:stage:{stage}")
            progress[stage] = stage_data.get("status", "pending")
        return progress

    async def record_async_result(self, pipeline_id: str, async_result_id: str):
        pipeline_key = f"pipeline:{pipeline_id}"
        await self.redis.hset(pipeline_key, "async_result_id", async_result_id)
