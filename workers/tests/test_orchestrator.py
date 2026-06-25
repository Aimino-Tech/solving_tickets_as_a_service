'"Comprehensive tests for pipeline orchestration."""

import json
import time
from unittest.mock import MagicMock, patch

import pytest

from workers.orchestrator.concurrency import AgentConcurrencyLimiter
from workers.orchestrator.engine import PipelineEngine, _pipeline_id_key, _pipeline_state_key
from workers.orchestrator.pipelines import PIPELINES, build_fix_pipeline, build_feature_pipeline, build_research_pipeline
from workers.orchestrator.rework import extract_feedback, rework_loop, should_rework
from workers.orchestrator.workspace import create_workspace, cleanup_workspace


# =========================================================================
# Pipeline Definitions
# =========================================================================


class TestPipelineDefinitions:
    """PIPELINES registry returns correct builder functions."""

    def test_pipelines_registry_keys(self):
        assert "stas:fix" in PIPELINES
        assert "stas:feature" in PIPELINES
        assert "stas:research" in PIPELINES

    def test_pipelines_builders_are_callable(self):
        for name, builder in PIPELINES.items():
            assert callable(builder), f"{name} builder is not callable"

    def test_build_fix_pipeline_returns_chain(self):
        from celery import chain

        issue_data = {"issue_id": "42", "title": "Test bug"}
        ctx = {
            "repo_url": "https://github.com/test/repo.git",
            "issue_identifier": "gh-42",
            "repo_owner": "test",
            "repo_name": "repo",
            "installation_id": 123,
            "test_command": "pytest",
            "correlation_id": "corr-1",
        }
        pipeline = build_fix_pipeline(issue_data, ctx)
        assert isinstance(pipeline, chain)
        assert len(pipeline.tasks) > 0

    def test_build_feature_pipeline_returns_chain(self):
        from celery import chain

        issue_data = {"issue_id": "43", "title": "New feature"}
        ctx = {
            "repo_url": "https://github.com/test/repo.git",
            "issue_identifier": "gh-43",
            "repo_owner": "test",
            "repo_name": "repo",
            "installation_id": 123,
        }
        pipeline = build_feature_pipeline(issue_data, ctx)
        assert isinstance(pipeline, chain)
        assert len(pipeline.tasks) > 0

    def test_build_research_pipeline_returns_chain(self):
        from celery import chain

        issue_data = {"issue_id": "44", "title": "Research topic"}
        ctx = {
            "repo_url": "https://github.com/test/repo.git",
            "issue_identifier": "gh-44",
        }
        pipeline = build_research_pipeline(issue_data, ctx)
        assert isinstance(pipeline, chain)
        assert len(pipeline.tasks) > 0


# =========================================================================
# PipelineEngine
# =========================================================================


class TestPipelineEngine:
    """PipelineEngine start/cancel/get_status logic."""

    @patch("workers.orchestrator.engine.PIPELINES", {"stas:fix": lambda i, c: MagicMock(tasks=[MagicMock()])})
    def test_start_pipeline_unknown_pipeline(self):
        engine = PipelineEngine()
        with pytest.raises(ValueError, match="Unknown pipeline"):
            engine.start_pipeline("issue-1", "stas:unknown", {})

    @patch("workers.orchestrator.engine.PIPELINES", {"stas:fix": lambda i, c: MagicMock(tasks=[MagicMock()])})
    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.engine._tracked_chain")
    def test_start_pipeline_success(self, mock_tracked_chain, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client
        mock_chain = MagicMock()
        mock_chain.tasks = [MagicMock()]
        mock_tracked_chain.return_value = mock_chain

        mock_async = MagicMock()
        mock_async.id = "async-1"
        mock_chain.delay.return_value = mock_async

        engine = PipelineEngine()
        pipeline_id = engine.start_pipeline(
            "issue-1",
            "stas:fix",
            {"repo_url": "https://github.com/test/repo.git", "issue_identifier": "gh-1"},
        )
        assert pipeline_id is not None
        assert isinstance(pipeline_id, str)
        # State should have been persisted
        assert mock_client.set.called

    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.engine.PIPELINES", {"stas:fix": MagicMock()})
    def test_start_pipeline_dispatch_failure(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client
        builder = MagicMock()
        builder.side_effect = lambda i, c: MagicMock()
        with patch("workers.orchestrator.engine.PIPELINES", {"stas:fix": builder}):
            from celery import chain as real_chain
            with patch("workers.orchestrator.engine.chain") as mock_chain_cls:
                mock_chain = MagicMock()
                mock_chain.delay.side_effect = RuntimeError("Dispatch failed")
                mock_chain_cls.return_value = mock_chain
                engine = PipelineEngine()
                with pytest.raises(RuntimeError, match="Dispatch failed"):
                    engine.start_pipeline("issue-1", "stas:fix", {"repo_url": "https://example.com/repo.git", "issue_identifier": "gh-1"})

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


# =========================================================================
# Workspace Lifecycle
# =========================================================================


class TestWorkspace:
    """create_workspace and cleanup_workspace tasks."""

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
        result = cleanup_workspace.run("/tmp/stas-workspaces/ws-42")
        assert result["status"] == "cleaned"
        assert result["workspace_path"] == "/tmp/stas-workspaces/ws-42"
        mock_rmtree.assert_called_once_with("/tmp/stas-workspaces/ws-42", ignore_errors=False)

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
        from workers.orchestrator.concurrency import get_limiter

        l1 = get_limiter()
        l2 = get_limiter()
        assert l1 is l2


# =========================================================================
# Rework Loop
# =========================================================================


class TestRework:
    """rework_loop, should_rework, extract_feedback."""

    def test_should_rework_passed_false(self):
        assert should_rework({"passed": False, "output": "tests failed"}) is True

    def test_should_rework_passed_true(self):
        assert should_rework({"passed": True}) is False

    def test_should_rework_status_failed(self):
        assert should_rework({"status": "failed", "error": "something broke"}) is True

    def test_should_rework_decision_rework(self):
        assert should_rework({"decision": "rework", "failures": ["test failure"]}) is True

    def test_should_rework_failures_list(self):
        assert should_rework({"failures": ["lint error"]}) is True

    def test_should_rework_ok(self):
        assert should_rework({"status": "completed", "passed": True}) is False

    def test_extract_feedback_with_failures(self):
        step_result = {
            "failures": ["Test suite failed", "Lint error"],
            "passed": False,
            "output": "FAILED test_login",
        }
        feedback = extract_feedback("verification", step_result)
        assert "Test suite failed" in feedback["failures"]
        assert "Lint error" in feedback["failures"]
        assert feedback["step_name"] == "verification"
        assert feedback["verification_output"] == "FAILED test_login"

    def test_extract_feedback_with_error(self):
        step_result = {"error": "Connection refused", "status": "failed"}
        feedback = extract_feedback("sandbox", step_result)
        assert "Connection refused" in feedback["failures"]

    def test_extract_feedback_unknown(self):
        step_result = {"status": "unknown"}
        feedback = extract_feedback("mystery_step", step_result)
        assert any("unknown reason" in f for f in feedback["failures"])

    @patch("workers.orchestrator.rework.dispatch_opencode")
    @patch("workers.orchestrator.rework._get_redis")
    def test_rework_loop_first_attempt(self, mock_get_redis, mock_dispatch):
        mock_client = MagicMock()
        mock_client.get.return_value = None  # no prior rework count
        mock_get_redis.return_value = mock_client

        mock_dispatch.run.return_value = {"status": "completed"}

        result = rework_loop.run(
            pipeline_id="pid-1",
            issue_id="issue-42",
            ctx={"repo_url": "https://github.com/test/repo.git", "triage_result": {}},
            feedback={"failures": ["verification failed"]},
        )
        assert result["_rework_attempt"] == 1
        assert result["_is_rework"] is True
        assert result["status"] == "completed"

    @patch("workers.orchestrator.rework._get_redis")
    def test_rework_loop_exhausted(self, mock_get_redis):
        from workers.orchestrator.rework import MAX_REWORK_ATTEMPTS

        mock_client = MagicMock()
        # Simulate already at max attempts
        mock_client.get.return_value = str(MAX_REWORK_ATTEMPTS)
        mock_get_redis.return_value = mock_client

        result = rework_loop.run(
            pipeline_id="pid-1",
            issue_id="issue-42",
            ctx={},
            feedback={"failures": ["still failing"]},
        )
        assert result["status"] == "failed"
        assert "exceeded max rework attempts" in result.get("error", "").lower() or \
               "exceeded" in result.get("error", "").lower()

    def test_should_rework_edge_cases(self):
        # Empty dict
        assert should_rework({}) is False
        # None values
        assert should_rework({"passed": None}) is False
        # Missing keys
        assert should_rework({"status": "completed"}) is False


# =========================================================================
# Integration-style tests
# =========================================================================


class TestEngineRedisInteractions:
    """Test Redis key conventions and JSON serialization."""

    def test_pipeline_id_key_format(self):
        assert _pipeline_id_key("issue-42") == "pipeline:issue-42:id"

    def test_pipeline_state_key_format(self):
        assert _pipeline_state_key("pid-1") == "pipeline:pid-1:state"

    @patch("workers.orchestrator.engine._get_redis")
    def test_pipeline_state_round_trip(self, mock_get_redis):
        import json

        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client

        state = {
            "status": "running",
            "progress": 0.5,
            "current_stage": "testing",
            "attempt": 2,
        }
        serialized = json.dumps(state)
        mock_client.get.return_value = serialized

        engine = PipelineEngine()
        status = engine.get_status("issue-42")
        assert status["status"] == "running"
        assert status["progress"] == 0.5

    @patch("workers.orchestrator.engine._get_redis")
    def test_pipeline_cancel(self, mock_get_redis):
        mock_client = MagicMock()
        pipeline_id = "pid-cancel-test"
        mock_client.get.side_effect = lambda key: {
            _pipeline_id_key("issue-99"): pipeline_id,
            _pipeline_state_key(pipeline_id): json.dumps({
                "status": "running",
                "async_result_id": "async-abc",
            }),
        }.get(key)
        mock_get_redis.return_value = mock_client

        engine = PipelineEngine()
        with patch("workers.orchestrator.engine.default_app") as mock_app:
            engine.cancel_pipeline("issue-99")
            assert mock_app.control.revoke.called


class TestReworkLoopEdgeCases:
    """Edge cases for the rework loop."""

    @patch("workers.orchestrator.rework.dispatch_opencode")
    @patch("workers.orchestrator.rework._get_redis")
    def test_rework_loop_accumulates_failures(self, mock_get_redis, mock_dispatch):
        mock_client = MagicMock()
        mock_client.get.return_value = None
        mock_get_redis.return_value = mock_client

        mock_dispatch.run.return_value = {"status": "completed"}

        ctx = {
            "repo_url": "https://github.com/test/repo.git",
            "_accumulated_failures": ["prior failure"],
        }
        feedback = {"failures": ["new failure"]}

        result = rework_loop.run(
            pipeline_id="pid-1",
            issue_id="issue-42",
            ctx=ctx,
            feedback=feedback,
        )
        assert result["_rework_attempt"] == 1
        assert result["_is_rework"] is True

    @patch("workers.orchestrator.rework._get_redis")
    def test_rework_loop_redis_failure_does_not_block(self, mock_get_redis):
        mock_get_redis.return_value = None  # Redis unavailable

        with patch("workers.orchestrator.rework.dispatch_opencode") as mock_dispatch:
            mock_dispatch.run.return_value = {"status": "completed"}
            result = rework_loop.run(
                pipeline_id="pid-1",
                issue_id="issue-42",
                ctx={},
                feedback={"failures": ["test failure"]},
            )
            assert result["status"] == "completed"
