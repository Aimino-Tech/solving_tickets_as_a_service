"""Comprehensive tests for pipeline orchestration."""

import json
import os
import time
from unittest.mock import MagicMock, patch

import pytest

from workers.celery_app import app
from workers.orchestrator.concurrency import AgentConcurrencyLimiter, get_limiter
from workers.orchestrator.engine import (
    MAX_REWORK_ATTEMPTS,
    PipelineEngine,
    _pipeline_id_key,
    _pipeline_state_key,
    get_engine,
)
from workers.orchestrator.pipelines import (
    PIPELINES,
    TASK_NAMES,
    build_feature_pipeline,
    build_fix_pipeline,
    build_research_pipeline,
    get_pipeline,
    get_stage_task,
)
from workers.orchestrator.workspace import cleanup_workspace, create_workspace


# =========================================================================
# Pipeline Definitions
# =========================================================================


class TestPipelineDefinitions:
    """Pipeline builder functions return correct Celery canvas structures."""

    def test_pipelines_registry_keys(self):
        assert "stas:fix" in PIPELINES
        assert "stas:feature" in PIPELINES
        assert "stas:research" in PIPELINES

    def test_pipelines_builders_are_callable(self):
        for name, builder in PIPELINES.items():
            assert callable(builder), f"{name} builder is not callable"

    def test_get_pipeline_unknown(self):
        with pytest.raises(ValueError, match="Unknown pipeline"):
            get_pipeline("stas:nonexistent")

    def test_get_pipeline_known(self):
        builder = get_pipeline("stas:fix")
        assert callable(builder)

    def test_task_names_are_strings(self):
        for stage, task_name in TASK_NAMES.items():
            assert isinstance(task_name, str)
            assert task_name.count(".") >= 2  # module.task

    def test_get_stage_task_known(self):
        assert get_stage_task("triage") == "workers.tasks.triage.triage_issue"

    def test_get_stage_task_unknown(self):
        assert get_stage_task("unknown_stage") == "unknown_stage"

    def test_build_fix_pipeline_returns_chain(self):
        from celery import chain, chord

        issue_data = {"issue_id": "42", "title": "Test bug"}
        ctx = {
            "repo_url": "https://github.com/test/repo.git",
            "issue_identifier": "gh-42",
        }
        pipeline = build_fix_pipeline(issue_data, ctx)
        assert isinstance(pipeline, chain)
        # chain(triage, chord(...)) => length 2
        assert len(pipeline.tasks) == 2

        # Second task should be a chord
        chord_task = pipeline.tasks[1]
        assert isinstance(chord_task, chord)

        # Chord callback should be a chain of 4 tasks (verify, audit, review, pr)
        callback = chord_task.task
        assert isinstance(callback, chain)
        assert len(callback.tasks) == 4

    def test_build_feature_pipeline_returns_chain(self):
        from celery import chain

        issue_data = {"issue_id": "43", "title": "New feature"}
        ctx = {"repo_url": "https://github.com/test/repo.git"}
        pipeline = build_feature_pipeline(issue_data, ctx)
        assert isinstance(pipeline, chain)
        assert len(pipeline.tasks) == 2

    def test_build_research_pipeline_returns_chain(self):
        from celery import chain

        issue_data = {"issue_id": "44", "title": "Research topic"}
        ctx = {"repo_url": "https://github.com/test/repo.git"}
        pipeline = build_research_pipeline(issue_data, ctx)
        assert isinstance(pipeline, chain)
        # research has only agent_dispatch
        assert len(pipeline.tasks) == 1

    def test_fix_and_feature_are_same(self):
        issue_data = {"issue_id": "45"}
        ctx = {"repo_url": "https://github.com/test/repo.git"}
        fix = build_fix_pipeline(issue_data, ctx)
        feature = build_feature_pipeline(issue_data, ctx)
        # Both should have same structure (2 tasks in chain)
        assert len(fix.tasks) == len(feature.tasks)


# =========================================================================
# Workspace Lifecycle
# =========================================================================


class TestWorkspaceTasks:
    """create_workspace and cleanup_workspace Celery tasks."""

    @patch("workers.orchestrator.workspace.subprocess.run")
    @patch("workers.orchestrator.workspace.os.makedirs")
    def test_create_workspace_success(self, mock_makedirs, mock_run):
        mock_run.return_value.returncode = 0
        result = create_workspace.run(
            issue_id="42",
            issue_identifier="gh-42",
            repo_url="https://github.com/test/repo.git",
        )
        assert result["status"] == "created"
        assert "workspace_path" in result
        assert result["branch"].startswith("stas/bot/")
        assert result["repo_url"] == "https://github.com/test/repo.git"
        assert result["issue_id"] == "42"

    @patch("workers.orchestrator.workspace.subprocess.run")
    @patch("workers.orchestrator.workspace.os.makedirs")
    def test_create_workspace_no_repo_url(self, mock_makedirs, mock_run):
        with pytest.raises(ValueError, match="No repo_url"):
            create_workspace.run(
                issue_id="42",
                issue_identifier="gh-42",
                repo_url="",
            )

    @patch("workers.orchestrator.workspace.subprocess.run")
    @patch("workers.orchestrator.workspace.os.makedirs")
    def test_create_workspace_git_failure(self, mock_makedirs, mock_run):
        import subprocess as _sp

        mock_run.side_effect = _sp.CalledProcessError(128, "git clone")
        with pytest.raises(_sp.CalledProcessError):
            create_workspace.run(
                issue_id="42",
                issue_identifier="gh-42",
                repo_url="https://github.com/test/repo.git",
            )

    @patch("workers.orchestrator.workspace.shutil.rmtree")
    @patch("workers.orchestrator.workspace.os.path.isdir")
    def test_cleanup_workspace_success(self, mock_isdir, mock_rmtree):
        mock_isdir.return_value = True
        result = cleanup_workspace.run(
            "/tmp/stas-workspaces/ws-42"
        )
        assert result["status"] == "cleaned"
        assert result["workspace_path"] == "/tmp/stas-workspaces/ws-42"
        mock_rmtree.assert_called_once_with(
            "/tmp/stas-workspaces/ws-42", ignore_errors=False
        )

    @patch("workers.orchestrator.workspace.os.path.isdir")
    def test_cleanup_workspace_not_found(self, mock_isdir):
        mock_isdir.return_value = False
        result = cleanup_workspace.run("/tmp/stas-workspaces/ws-42")
        assert result["status"] == "not_found"

    def test_cleanup_workspace_empty_path(self):
        result = cleanup_workspace.run("")
        assert result["status"] == "skipped"

    @patch("workers.orchestrator.workspace.shutil.rmtree")
    @patch("workers.orchestrator.workspace.os.path.isdir")
    def test_cleanup_workspace_error_nonfatal(self, mock_isdir, mock_rmtree):
        mock_isdir.return_value = True
        mock_rmtree.side_effect = PermissionError("Access denied")
        result = cleanup_workspace.run("/tmp/ws-42")
        assert result["status"] == "error"
        assert "Access denied" in result.get("error", "")


# =========================================================================
# Concurrency Limiter
# =========================================================================


class TestAgentConcurrencyLimiter:
    """AgentConcurrencyLimiter acquire/release/active_count."""

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_success(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.scard.return_value = 0  # no active slots
        mock_client.sadd.return_value = 1  # successfully added
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter(max_concurrent=3)
        assert limiter.acquire("issue-42") is True

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_at_limit(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.scard.return_value = 3  # at limit
        mock_client.sadd.return_value = 0
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter(max_concurrent=3)
        assert limiter.acquire("issue-42") is False

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_under_limit(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.scard.return_value = 1  # below limit
        mock_client.sadd.return_value = 1
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter(max_concurrent=3)
        assert limiter.acquire("issue-43") is True

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_already_held(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.scard.return_value = 0
        mock_client.sadd.return_value = 0  # already present
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter(max_concurrent=3)
        assert limiter.acquire("issue-42") is True  # graceful

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_redis_unavailable(self, mock_get_redis):
        mock_get_redis.return_value = None
        limiter = AgentConcurrencyLimiter(max_concurrent=3)
        assert limiter.acquire("issue-42") is True  # degrades gracefully

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_release_success(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.srem.return_value = 1
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter()
        limiter.release("issue-42")
        mock_client.srem.assert_called_once()

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_release_not_held(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.srem.return_value = 0  # not in set
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter()
        # Should not raise
        limiter.release("issue-99")

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_active_count(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.scard.return_value = 2
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter()
        assert limiter.active_count() == 2

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_active_count_no_redis(self, mock_get_redis):
        mock_get_redis.return_value = None
        limiter = AgentConcurrencyLimiter()
        assert limiter.active_count() == 0

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_is_acquired(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.sismember.return_value = 1
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter()
        assert limiter.is_acquired("issue-42") is True

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_prune_stale_slots(self, mock_get_redis):
        mock_client = MagicMock()
        old_time = time.time() - 3600  # 1 hour ago
        mock_client.smembers.return_value = {"stas:agent:slot:stale-issue"}
        mock_client.hget.return_value = str(old_time)
        mock_get_redis.return_value = mock_client

        limiter = AgentConcurrencyLimiter()
        limiter._prune_stale_slots(mock_client)
        # Should have removed the stale slot
        assert mock_client.srem.called
        assert mock_client.delete.called

    @patch("workers.orchestrator.concurrency._get_redis")
    def test_get_limiter_singleton(self, mock_get_redis):
        l1 = get_limiter()
        l2 = get_limiter()
        assert l1 is l2


# =========================================================================
# PipelineEngine
# =========================================================================


class TestPipelineEngine:
    """PipelineEngine start/cancel/get_status logic."""

    @patch("workers.orchestrator.engine.PIPELINES", {})
    def test_start_pipeline_unknown_pipeline(self):
        engine = PipelineEngine()
        with pytest.raises(ValueError, match="Unknown pipeline"):
            engine.start_pipeline("issue-1", "stas:unknown", {})

    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.engine.AgentConcurrencyLimiter")
    def test_start_pipeline_concurrency_queued(
        self, mock_limiter_cls, mock_get_redis
    ):
        mock_limiter = MagicMock()
        mock_limiter.acquire.return_value = False  # limit reached
        mock_limiter_cls.return_value = mock_limiter

        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        engine = PipelineEngine()
        pipeline_id = engine.start_pipeline(
            "issue-1",
            "stas:fix",
            {"repo_url": "https://github.com/test/repo.git"},
        )
        assert pipeline_id is not None
        # Should persist queued state
        assert mock_client.set.called
        # Should map issue -> pipeline
        assert mock_client.set.call_count >= 2

    @patch("workers.orchestrator.engine.PIPELINES", {"stas:fix": MagicMock()})
    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.engine.AgentConcurrencyLimiter")
    def test_start_pipeline_dispatch_failure(
        self, mock_limiter_cls, mock_get_redis
    ):
        mock_limiter = MagicMock()
        mock_limiter.acquire.return_value = True
        mock_limiter_cls.return_value = mock_limiter

        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        # Make the pipeline builder raise
        def broken_builder(issue_data, ctx):
            msg = "Dispatch failed"
            raise RuntimeError(msg)

        with patch(
            "workers.orchestrator.engine.PIPELINES",
            {"stas:fix": broken_builder},
        ):
            engine = PipelineEngine()
            with pytest.raises(RuntimeError, match="Dispatch failed"):
                engine.start_pipeline(
                    "issue-1",
                    "stas:fix",
                    {"repo_url": "https://example.com/repo.git"},
                )

    @patch("workers.orchestrator.engine._get_redis")
    def test_cancel_pipeline_not_found(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.return_value = None
        mock_get_redis.return_value = mock_client

        engine = PipelineEngine()
        result = engine.cancel_pipeline("nonexistent-issue")
        assert result is False

    @patch("workers.orchestrator.engine._get_redis")
    def test_get_status_no_pipeline(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.return_value = None
        mock_get_redis.return_value = mock_client

        engine = PipelineEngine()
        status = engine.get_status("no-such-issue")
        assert status["status"] == "not_found"

    @patch("workers.orchestrator.engine._get_redis")
    def test_get_status_happy_path(self, mock_get_redis):
        mock_client = MagicMock()
        pipeline_id = "pipeline-uuid-123"
        state = {
            "pipeline_id": pipeline_id,
            "pipeline_name": "stas:fix",
            "status": "running",
            "current_stage": "step_2_of_9",
            "progress": 0.22,
            "attempt": 1,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        mock_client.get.side_effect = lambda key: {
            _pipeline_id_key("issue-42"): pipeline_id,
            _pipeline_state_key(pipeline_id): json.dumps(state),
        }.get(key)

        mock_get_redis.return_value = mock_client

        engine = PipelineEngine()
        status = engine.get_status("issue-42")
        assert status["status"] == "running"
        assert status["current_stage"] == "step_2_of_9"
        assert status["progress"] == 0.22
        assert status["attempt"] == 1
        assert status["pipeline_name"] == "stas:fix"

    @patch("workers.orchestrator.engine._get_redis")
    def test_get_status_redis_unavailable(self, mock_get_redis):
        mock_get_redis.return_value = None

        engine = PipelineEngine()
        status = engine.get_status("issue-42")
        assert status["status"] == "unknown"

    @patch("workers.orchestrator.engine._get_redis")
    def test_get_status_corrupt_state(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = lambda key: {
            _pipeline_id_key("issue-42"): "pid-1",
            _pipeline_state_key("pid-1"): "not-json{{{",
        }.get(key)
        mock_get_redis.return_value = mock_client

        engine = PipelineEngine()
        status = engine.get_status("issue-42")
        assert status["status"] == "error"

    @patch("workers.orchestrator.engine._get_redis")
    def test_emit_event(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        engine = PipelineEngine()
        engine._emit_event("pid-1", "test.event", {"detail": "hello"})
        assert mock_client.lpush.called
        assert mock_client.ltrim.called

    @patch("workers.orchestrator.engine._get_redis")
    def test_get_events(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.return_value = "pid-1"
        mock_client.lrange.return_value = [
            json.dumps({"event": "e1", "timestamp": 100}),
            json.dumps({"event": "e2", "timestamp": 101}),
        ]
        mock_get_redis.return_value = mock_client

        engine = PipelineEngine()
        events = engine.get_events("issue-42")
        assert len(events) == 2
        assert events[0]["event"] == "e1"
        assert events[1]["event"] == "e2"

    @patch("workers.orchestrator.engine._get_redis")
    def test_get_engine_singleton(self, mock_get_redis):
        e1 = get_engine()
        e2 = get_engine()
        assert e1 is e2


# =========================================================================
# Rework Logic
# =========================================================================


class TestRework:
    """Rework loop support in PipelineEngine."""

    def setup_method(self):
        self.engine = PipelineEngine()

    def test_should_rework_passed_false(self):
        assert self.engine.should_rework({"passed": False, "output": "failed"}) is True

    def test_should_rework_passed_true(self):
        assert self.engine.should_rework({"passed": True}) is False

    def test_should_rework_status_failed(self):
        assert (
            self.engine.should_rework({"status": "failed", "error": "broke"}) is True
        )

    def test_should_rework_decision_rework(self):
        assert (
            self.engine.should_rework(
                {"decision": "rework", "failures": ["test failure"]}
            )
            is True
        )

    def test_should_rework_failures_list(self):
        assert self.engine.should_rework({"failures": ["lint error"]}) is True

    def test_should_rework_ok(self):
        assert self.engine.should_rework({"status": "completed", "passed": True}) is False

    def test_should_rework_edge_cases(self):
        assert self.engine.should_rework({}) is False
        assert self.engine.should_rework({"passed": None}) is False
        assert self.engine.should_rework({"status": "completed"}) is False

    @patch("workers.orchestrator.engine._get_redis")
    def test_rework_pipeline_exhausted(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = lambda key: {
            _pipeline_id_key("issue-42"): "pid-1",
            _pipeline_state_key("pid-1"): json.dumps({"status": "running"}),
        }.get(key)
        mock_client.incr.return_value = MAX_REWORK_ATTEMPTS + 1  # exceeded
        mock_get_redis.return_value = mock_client

        result = self.engine.rework_pipeline(
            "issue-42",
            "stas:fix",
            {"repo_url": "https://github.com/test/repo.git"},
            {"failures": ["still failing"]},
        )
        assert result is None  # no re-dispatch

    @patch("workers.orchestrator.engine._get_redis")
    def test_rework_pipeline_no_pipeline_id(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.return_value = None  # no pipeline mapping
        mock_get_redis.return_value = mock_client

        result = self.engine.rework_pipeline(
            "nonexistent",
            "stas:fix",
            {},
            {"failures": ["failure"]},
        )
        assert result is None

    @patch("workers.orchestrator.engine._get_redis")
    def test_rework_increment_count(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = lambda key: {
            _pipeline_id_key("issue-42"): "pid-1",
            _pipeline_state_key("pid-1"): json.dumps({"status": "running"}),
        }.get(key)
        mock_client.incr.return_value = 1
        mock_get_redis.return_value = mock_client

        count = self.engine._increment_rework_count("pid-1")
        assert count == 1


# =========================================================================
# Redis Key Conventions
# =========================================================================


class TestRedisKeys:
    """Redis key format conventions."""

    def test_pipeline_id_key_format(self):
        assert _pipeline_id_key("issue-42") == "pipeline:issue-42:id"

    def test_pipeline_state_key_format(self):
        assert _pipeline_state_key("pid-1") == "pipeline:pid-1:state"

    @patch("workers.orchestrator.engine._get_redis")
    def test_pipeline_state_round_trip(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        state = {
            "status": "running",
            "progress": 0.5,
            "current_stage": "testing",
            "attempt": 2,
        }
        serialized = json.dumps(state)
        mock_client.get.side_effect = lambda key: {
            _pipeline_id_key("issue-42"): "pid-1",
            _pipeline_state_key("pid-1"): serialized,
        }.get(key)

        engine = PipelineEngine()
        status = engine.get_status("issue-42")
        assert status["status"] == "running"
        assert status["progress"] == 0.5


# =========================================================================
# Pipeline Orchestrator Task
# =========================================================================


class TestOrchestratorTask:
    """workers.tasks.pipeline_orchestrator.orchestrate_pipeline."""

    def test_task_registered(self):
        assert (
            "workers.tasks.pipeline_orchestrator.orchestrate_pipeline"
            in app.tasks
        )

    @patch("workers.tasks.pipeline_orchestrator.get_engine")
    def test_orchestrate_max_attempts_exceeded(self, mock_get_engine):
        from workers.tasks.pipeline_orchestrator import orchestrate_pipeline

        result = orchestrate_pipeline.run(
            issue_id="issue-42",
            pipeline_name="stas:fix",
            ctx={},
            attempt=3,  # max_attempts is 3, so attempt >= 3 means exceeded
        )
        assert result["status"] == "failed"
        assert result["reason"] == "max_attempts_exceeded"

    @patch("workers.tasks.pipeline_orchestrator.get_engine")
    def test_orchestrate_success(self, mock_get_engine):
        mock_engine = MagicMock()
        mock_engine.start_pipeline.return_value = "pipeline-uuid-abc"
        mock_get_engine.return_value = mock_engine

        from workers.tasks.pipeline_orchestrator import orchestrate_pipeline

        result = orchestrate_pipeline.run(
            issue_id="issue-42",
            pipeline_name="stas:fix",
            ctx={"repo_url": "https://github.com/test/repo.git"},
            attempt=0,
        )
        assert result["status"] == "started"
        assert result["pipeline_id"] == "pipeline-uuid-abc"
        assert result["attempt"] == 1
        assert result["pipeline_name"] == "stas:fix"

    @patch("workers.tasks.pipeline_orchestrator.get_engine")
    def test_orchestrate_with_rework_feedback(self, mock_get_engine):
        mock_engine = MagicMock()
        mock_engine.start_pipeline.return_value = "pipeline-uuid-def"
        mock_get_engine.return_value = mock_engine

        from workers.tasks.pipeline_orchestrator import orchestrate_pipeline

        result = orchestrate_pipeline.run(
            issue_id="issue-42",
            pipeline_name="stas:fix",
            ctx={
                "repo_url": "https://github.com/test/repo.git",
                "_rework_feedback": {
                    "failures": ["Verification failed", "Lint error"]
                },
            },
            attempt=1,
        )
        assert result["status"] == "started"
        assert result["attempt"] == 2
        # Should have injected agent_feedback into ctx
        ctx_passed = mock_engine.start_pipeline.call_args[0][2]
        assert "agent_feedback" in ctx_passed
