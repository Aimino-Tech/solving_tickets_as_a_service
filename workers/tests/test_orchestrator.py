import pytest
from workers.orchestrator.concurrency import AgentConcurrencyLimiter
from workers.orchestrator.pipelines import get_pipeline, get_stage_task
from workers.orchestrator.workspace import sanitize


class TestSanitize:
    def test_sanitize_basic(self) -> None:
        assert sanitize("hello-world") == "hello-world"

    def test_sanitize_special_chars(self) -> None:
        result = sanitize("AIM-123!@#test")
        assert "!" not in result
        assert "@" not in result
        assert len(result) <= 64

    def test_sanitize_long(self) -> None:
        long_name = "a" * 100
        assert len(sanitize(long_name)) == 64


class TestPipelines:
    def test_get_pipeline_fix(self) -> None:
        stages = get_pipeline("stas:fix")
        assert "triage" in stages
        assert "agent" in stages
        assert "verify" in stages
        assert "self_audit" in stages
        assert "review" in stages
        assert "pr" in stages

    def test_get_pipeline_research(self) -> None:
        stages = get_pipeline("stas:research")
        assert stages == ["agent"]

    def test_get_pipeline_default(self) -> None:
        stages = get_pipeline("unknown")
        assert stages == get_pipeline("stas:fix")

    def test_get_stage_task(self) -> None:
        assert "triage" in get_stage_task("triage")
        assert "agent" in get_stage_task("agent")

    def test_get_stage_task_unknown(self) -> None:
        assert get_stage_task("custom") == "custom"


class TestConcurrencyLimiter:
    def test_acquire_release(self) -> None:
        limiter = AgentConcurrencyLimiter(max_concurrent=2)
        assert limiter.acquire("issue-1") is True
        assert limiter.acquire("issue-2") is True
        assert limiter.acquire("issue-3") is False
        limiter.release("issue-1")
        assert limiter.acquire("issue-4") is True

    def test_active_count(self) -> None:
        limiter = AgentConcurrencyLimiter(max_concurrent=5)
        assert limiter.active_count() == 0
        limiter.acquire("issue-1")
        assert limiter.active_count() == 1
        limiter.release("issue-1")
        assert limiter.active_count() == 0
