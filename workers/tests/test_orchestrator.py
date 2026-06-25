import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from workers.orchestrator.pipelines import PIPELINES, get_pipeline, get_task_name
from workers.orchestrator.concurrency import AgentConcurrencyLimiter


class TestPipelines:
    def test_get_pipeline_exists(self):
        pipeline = get_pipeline("stas:fix")
        assert pipeline is not None
        assert "stages" in pipeline
        assert pipeline["label"] == "stas:fix"

    def test_get_pipeline_not_found(self):
        assert get_pipeline("nonexistent") is None

    def test_get_task_name_exists(self):
        assert get_task_name("quality_analyze") == "workers.quality.analyzer.quality_analyze"

    def test_get_task_name_not_found(self):
        assert get_task_name("nonexistent") is None

    def test_all_pipelines_have_valid_stages(self):
        for name, cfg in PIPELINES.items():
            for stage in cfg["stages"]:
                assert get_task_name(stage) is not None, f"Pipeline {name}: unknown stage {stage}"

    def test_pipeline_max_attempts_positive(self):
        for name, cfg in PIPELINES.items():
            assert cfg["max_attempts"] >= 1, f"Pipeline {name}: max_attempts must be >= 1"

    def test_pipeline_concurrency_limit_positive(self):
        for name, cfg in PIPELINES.items():
            assert cfg["concurrency_limit"] >= 1, f"Pipeline {name}: concurrency_limit must be >= 1"


class TestConcurrencyLimiter:
    def test_acquire_release(self):
        mock_redis = MagicMock()
        mock_redis.pipeline.return_value = mock_redis
        mock_redis.incr.return_value = 1
        mock_redis.execute.return_value = (1, True)

        limiter = AgentConcurrencyLimiter(redis_client=mock_redis, max_concurrent=3)
        assert limiter.acquire("test-issue") is True

    def test_acquire_rejected_when_at_capacity(self):
        mock_redis = MagicMock()
        mock_redis.pipeline.return_value = mock_redis
        mock_redis.incr.return_value = 5
        mock_redis.execute.return_value = (5, True)

        limiter = AgentConcurrencyLimiter(redis_client=mock_redis, max_concurrent=3)
        assert limiter.acquire("test-issue") is False
        mock_redis.decr.assert_called_once_with("agents:running")

    def test_running_count(self):
        mock_redis = MagicMock()
        mock_redis.get.return_value = "3"

        limiter = AgentConcurrencyLimiter(redis_client=mock_redis)
        assert limiter.running_count() == 3

    def test_running_count_none(self):
        mock_redis = MagicMock()
        mock_redis.get.return_value = None

        limiter = AgentConcurrencyLimiter(redis_client=mock_redis)
        assert limiter.running_count() == 0
