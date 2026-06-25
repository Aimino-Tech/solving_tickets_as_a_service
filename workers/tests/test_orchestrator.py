"""Tests for pipeline orchestration - Celery canvas, engine, workspace, concurrency."""
import json, time
from unittest.mock import MagicMock, patch
import pytest
from workers.celery_app import app
from workers.orchestrator.concurrency import AgentConcurrencyLimiter, get_limiter
from workers.orchestrator.engine import MAX_REWORK_ATTEMPTS, PipelineEngine, _pipeline_id_key, _pipeline_state_key, get_engine
from workers.orchestrator.pipelines import PIPELINES, TASK_NAMES, build_feature_pipeline, build_fix_pipeline, build_research_pipeline, get_pipeline, get_stage_task
from workers.orchestrator.workspace import cleanup_workspace, create_workspace

# ===== Pipeline Definitions =====
class TestPipelineDefinitions:
    def test_pipelines_registry_keys(self):
        assert "stas:fix" in PIPELINES and "stas:feature" in PIPELINES and "stas:research" in PIPELINES
    def test_pipelines_builders_are_callable(self):
        for n, b in PIPELINES.items(): assert callable(b), f"{n} builder not callable"
    def test_get_pipeline_unknown(self):
        with pytest.raises(ValueError, match="Unknown pipeline"): get_pipeline("stas:nonexistent")
    def test_get_pipeline_known(self):
        assert callable(get_pipeline("stas:fix"))
    def test_task_names_are_strings(self):
        for s, n in TASK_NAMES.items(): assert isinstance(n, str) and n.count(".") >= 2
    def test_get_stage_task_known(self):
        assert get_stage_task("triage") == "workers.tasks.triage.triage_issue"
    def test_get_stage_task_unknown(self):
        assert get_stage_task("unknown_stage") == "unknown_stage"
    def test_build_fix_pipeline_has_tasks(self):
        issue_data, ctx = {"issue_id": "42"}, {"repo_url": "https://github.com/test/repo.git", "issue_identifier": "gh-42"}
        p = build_fix_pipeline(issue_data, ctx)
        assert hasattr(p, "tasks") and len(p.tasks) == 2
        chord_t = p.tasks[1]
        assert chord_t.__class__.__name__ in ("chord", "_chord")
        cb = chord_t.body
        assert hasattr(cb, "tasks") and len(cb.tasks) == 4
    def test_build_feature_pipeline_has_tasks(self):
        issue_data, ctx = {"issue_id": "43"}, {"repo_url": "https://github.com/test/repo.git"}
        p = build_feature_pipeline(issue_data, ctx)
        assert hasattr(p, "tasks") and len(p.tasks) == 2
    def test_build_research_pipeline_has_tasks(self):
        issue_data, ctx = {"issue_id": "44"}, {"repo_url": "https://github.com/test/repo.git"}
        p = build_research_pipeline(issue_data, ctx)
        assert hasattr(p, "tasks") and len(p.tasks) == 1
    def test_fix_and_feature_are_same(self):
        d, c = {"issue_id": "45"}, {"repo_url": "https://github.com/test/repo.git"}
        assert len(build_fix_pipeline(d, c).tasks) == len(build_feature_pipeline(d, c).tasks)

# ===== Workspace =====
class TestWorkspaceTasks:
    @patch("workers.orchestrator.workspace.subprocess.run")
    @patch("workers.orchestrator.workspace.os.makedirs")
    def test_create_workspace_success(self, mk, run):
        run.return_value.returncode = 0
        r = create_workspace.run(issue_id="42", issue_identifier="gh-42", repo_url="https://github.com/test/repo.git")
        assert r["status"] == "created" and "workspace_path" in r and r["branch"].startswith("stas/bot/") and r["issue_id"] == "42"
    @patch("workers.orchestrator.workspace.subprocess.run")
    @patch("workers.orchestrator.workspace.os.makedirs")
    def test_create_workspace_no_repo_url(self, mk, run):
        with pytest.raises(ValueError, match="No repo_url"): create_workspace.run(issue_id="42", issue_identifier="gh-42", repo_url="")
    @patch("workers.orchestrator.workspace.subprocess.run")
    @patch("workers.orchestrator.workspace.os.makedirs")
    def test_create_workspace_git_failure(self, mk, run):
        import subprocess as _sp
        run.side_effect = _sp.CalledProcessError(128, "git clone")
        with pytest.raises(_sp.CalledProcessError): create_workspace.run(issue_id="42", issue_identifier="gh-42", repo_url="https://github.com/test/repo.git")
    @patch("workers.orchestrator.workspace.shutil.rmtree")
    @patch("workers.orchestrator.workspace.os.path.isdir")
    def test_cleanup_workspace_success(self, isdir, rm):
        isdir.return_value = True
        r = cleanup_workspace.run("/tmp/stas-workspaces/ws-42")
        assert r["status"] == "cleaned" and r["workspace_path"] == "/tmp/stas-workspaces/ws-42"
        rm.assert_called_once_with("/tmp/stas-workspaces/ws-42")
    @patch("workers.orchestrator.workspace.os.path.isdir")
    def test_cleanup_workspace_not_found(self, isdir):
        isdir.return_value = False
        assert cleanup_workspace.run("/tmp/stas-workspaces/ws-42")["status"] == "not_found"
    def test_cleanup_workspace_empty_path(self):
        assert cleanup_workspace.run("")["status"] == "skipped"
    @patch("workers.orchestrator.workspace.shutil.rmtree")
    @patch("workers.orchestrator.workspace.os.path.isdir")
    def test_cleanup_workspace_error_nonfatal(self, isdir, rm):
        isdir.return_value = True; rm.side_effect = PermissionError("Access denied")
        assert cleanup_workspace.run("/tmp/ws-42")["status"] == "error"

# ===== Concurrency =====
class TestAgentConcurrencyLimiter:
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_success(self, g):
        c = MagicMock(); c.scard.return_value = 0; c.sadd.return_value = 1; g.return_value = c
        assert AgentConcurrencyLimiter(max_concurrent=3).acquire("issue-42") is True
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_at_limit(self, g):
        c = MagicMock(); c.scard.return_value = 3; c.sadd.return_value = 0; g.return_value = c
        assert AgentConcurrencyLimiter(max_concurrent=3).acquire("issue-42") is False
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_under_limit(self, g):
        c = MagicMock(); c.scard.return_value = 1; c.sadd.return_value = 1; g.return_value = c
        assert AgentConcurrencyLimiter(max_concurrent=3).acquire("issue-43") is True
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_already_held(self, g):
        c = MagicMock(); c.scard.return_value = 0; c.sadd.return_value = 0; g.return_value = c
        assert AgentConcurrencyLimiter(max_concurrent=3).acquire("issue-42") is True
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_acquire_redis_unavailable(self, g):
        g.return_value = None; assert AgentConcurrencyLimiter(max_concurrent=3).acquire("issue-42") is True
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_release_success(self, g):
        c = MagicMock(); c.srem.return_value = 1; g.return_value = c
        AgentConcurrencyLimiter().release("issue-42"); c.srem.assert_called_once()
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_release_not_held(self, g):
        g.return_value = MagicMock()
        AgentConcurrencyLimiter().release("issue-99")  # should not raise
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_active_count(self, g):
        c = MagicMock(); c.scard.return_value = 2; g.return_value = c
        assert AgentConcurrencyLimiter().active_count() == 2
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_active_count_no_redis(self, g):
        g.return_value = None; assert AgentConcurrencyLimiter().active_count() == 0
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_is_acquired(self, g):
        c = MagicMock(); c.sismember.return_value = 1; g.return_value = c
        assert AgentConcurrencyLimiter().is_acquired("issue-42") is True
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_prune_stale_slots(self, g):
        c = MagicMock(); c.smembers.return_value = {f"stas:agent:slot:stale-issue"}; c.hget.return_value = str(time.time() - 3600); g.return_value = c
        AgentConcurrencyLimiter()._prune_stale_slots(c)
        assert c.srem.called and c.delete.called
    @patch("workers.orchestrator.concurrency._get_redis")
    def test_get_limiter_singleton(self, g):
        l1, l2 = get_limiter(), get_limiter(); assert l1 is l2

# ===== PipelineEngine =====
class TestPipelineEngine:
    def test_start_pipeline_unknown_pipeline(self):
        with pytest.raises(ValueError, match="Unknown pipeline"): PipelineEngine().start_pipeline("issue-1", "stas:unknown", {})
    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.engine.AgentConcurrencyLimiter")
    def test_start_pipeline_concurrency_queued(self, lc, g):
        l = MagicMock(); l.acquire.return_value = False; lc.return_value = l
        c = MagicMock(); g.return_value = c
        pid = PipelineEngine().start_pipeline("issue-1", "stas:fix", {"repo_url": "https://github.com/test/repo.git"})
        assert pid is not None and c.set.called
    @patch("workers.orchestrator.engine._get_redis")
    @patch("workers.orchestrator.engine.AgentConcurrencyLimiter")
    def test_start_pipeline_dispatch_failure(self, lc, g):
        l = MagicMock(); l.acquire.return_value = True; lc.return_value = l
        c = MagicMock(); g.return_value = c
        def broken_builder(d, ctx): raise RuntimeError("Dispatch failed")
        with patch("workers.orchestrator.pipelines.PIPELINES", {"stas:fix": broken_builder}):
            with pytest.raises(RuntimeError, match="Dispatch failed"):
                PipelineEngine().start_pipeline("issue-1", "stas:fix", {"repo_url": "https://example.com/repo.git"})
    @patch("workers.orchestrator.engine._get_redis")
    def test_cancel_pipeline_not_found(self, g):
        c = MagicMock(); c.get.return_value = None; g.return_value = c
        assert PipelineEngine().cancel_pipeline("nonexistent-issue") is False
    @patch("workers.orchestrator.engine._get_redis")
    def test_get_status_no_pipeline(self, g):
        c = MagicMock(); c.get.return_value = None; g.return_value = c
        assert PipelineEngine().get_status("no-such-issue")["status"] == "not_found"
    @patch("workers.orchestrator.engine._get_redis")
    def test_get_status_happy_path(self, g):
        pid = "pipeline-uuid-123"
        state = {"pipeline_id": pid, "pipeline_name": "stas:fix", "status": "running", "current_stage": "step_2", "progress": 0.22, "attempt": 1, "created_at": time.time(), "updated_at": time.time()}
        c = MagicMock(); c.get.side_effect = lambda k: {_pipeline_id_key("issue-42"): pid, _pipeline_state_key(pid): json.dumps(state)}.get(k); g.return_value = c
        s = PipelineEngine().get_status("issue-42")
        assert s["status"] == "running" and s["current_stage"] == "step_2" and s["progress"] == 0.22 and s["attempt"] == 1
    @patch("workers.orchestrator.engine._get_redis")
    def test_get_status_redis_unavailable(self, g):
        g.return_value = None; assert PipelineEngine().get_status("issue-42")["status"] == "unknown"
    @patch("workers.orchestrator.engine._get_redis")
    def test_get_status_corrupt_state(self, g):
        c = MagicMock(); c.get.side_effect = lambda k: {_pipeline_id_key("issue-42"): "pid-1", _pipeline_state_key("pid-1"): "not-json{{{"}.get(k); g.return_value = c
        assert PipelineEngine().get_status("issue-42")["status"] == "error"
    @patch("workers.orchestrator.engine._get_redis")
    def test_emit_event(self, g):
        c = MagicMock(); g.return_value = c
        PipelineEngine()._emit_event("pid-1", "test.event", {"detail": "hello"})
        assert c.lpush.called and c.ltrim.called
    @patch("workers.orchestrator.engine._get_redis")
    def test_get_events(self, g):
        c = MagicMock(); c.get.return_value = "pid-1"; c.lrange.return_value = [json.dumps({"event": "e1", "timestamp": 100}), json.dumps({"event": "e2", "timestamp": 101})]; g.return_value = c
        evts = PipelineEngine().get_events("issue-42")
        assert len(evts) == 2 and evts[0]["event"] == "e1"
    @patch("workers.orchestrator.engine._get_redis")
    def test_get_engine_singleton(self, g):
        assert get_engine() is get_engine()

# ===== Rework =====
class TestRework:
    def setup_method(self): self.e = PipelineEngine()
    def test_should_rework_passed_false(self): assert self.e.should_rework({"passed": False, "output": "failed"}) is True
    def test_should_rework_passed_true(self): assert self.e.should_rework({"passed": True}) is False
    def test_should_rework_status_failed(self): assert self.e.should_rework({"status": "failed", "error": "broke"}) is True
    def test_should_rework_decision_rework(self): assert self.e.should_rework({"decision": "rework", "failures": ["x"]}) is True
    def test_should_rework_failures_list(self): assert self.e.should_rework({"failures": ["lint"]}) is True
    def test_should_rework_ok(self): assert self.e.should_rework({"status": "completed", "passed": True}) is False
    def test_should_rework_edge_cases(self): assert not self.e.should_rework({}) and not self.e.should_rework({"passed": None}) and not self.e.should_rework({"status": "completed"})
    @patch("workers.orchestrator.engine._get_redis")
    def test_rework_exhausted(self, g):
        c = MagicMock(); c.get.side_effect = lambda k: {_pipeline_id_key("issue-42"): "pid-1", _pipeline_state_key("pid-1"): json.dumps({"status": "running"})}.get(k)
        c.incr.return_value = MAX_REWORK_ATTEMPTS + 1; g.return_value = c
        assert self.e.rework_pipeline("issue-42", "stas:fix", {"repo_url": "x"}, {"failures": ["fail"]}) is None
    @patch("workers.orchestrator.engine._get_redis")
    def test_rework_no_pipeline(self, g):
        c = MagicMock()
        c.get.return_value = None  # no pipeline ID mapping
        g.return_value = c
        assert self.e.rework_pipeline("nonexistent", "stas:fix", {}, {"failures": ["x"]}) is None
    @patch("workers.orchestrator.engine._get_redis")
    def test_rework_increment_count(self, g):
        c = MagicMock(); c.get.return_value = json.dumps({"status": "running"}); c.incr.return_value = 1; g.return_value = c
        assert self.e._increment_rework_count("pid-1") == 1

# ===== Redis Keys =====
class TestRedisKeys:
    def test_id_key_format(self): assert _pipeline_id_key("issue-42") == "pipeline:issue-42:id"
    def test_state_key_format(self): assert _pipeline_state_key("pid-1") == "pipeline:pid-1:state"
    @patch("workers.orchestrator.engine._get_redis")
    def test_state_round_trip(self, g):
        c = MagicMock(); c.get.side_effect = lambda k: {_pipeline_id_key("issue-42"): "pid-1", _pipeline_state_key("pid-1"): json.dumps({"status": "running", "progress": 0.5, "current_stage": "testing", "attempt": 2})}.get(k); g.return_value = c
        s = PipelineEngine().get_status("issue-42")
        assert s["status"] == "running" and s["progress"] == 0.5

# ===== Orchestrator Task =====
class TestOrchestratorTask:
    def test_task_registered(self):
        # Ensure the module is imported so @shared_task registers it
        import workers.tasks.pipeline_orchestrator  # noqa: F401
        assert "workers.tasks.pipeline_orchestrator.orchestrate_pipeline" in app.tasks
    @patch("workers.tasks.pipeline_orchestrator.get_engine")
    def test_orchestrate_max_attempts_exceeded(self, ge):
        from workers.tasks.pipeline_orchestrator import orchestrate_pipeline
        r = orchestrate_pipeline.run(issue_id="issue-42", pipeline_name="stas:fix", ctx={}, attempt=3)
        assert r["status"] == "failed" and r["reason"] == "max_attempts_exceeded"
    @patch("workers.tasks.pipeline_orchestrator.get_engine")
    def test_orchestrate_success(self, ge):
        e = MagicMock(); e.start_pipeline.return_value = "pipeline-uuid-abc"; ge.return_value = e
        from workers.tasks.pipeline_orchestrator import orchestrate_pipeline
        r = orchestrate_pipeline.run(issue_id="issue-42", pipeline_name="stas:fix", ctx={"repo_url": "https://github.com/test/repo.git"}, attempt=0)
        assert r["status"] == "started" and r["pipeline_id"] == "pipeline-uuid-abc" and r["attempt"] == 1
    @patch("workers.tasks.pipeline_orchestrator.get_engine")
    def test_orchestrate_with_rework_feedback(self, ge):
        e = MagicMock(); e.start_pipeline.return_value = "pipeline-uuid-def"; ge.return_value = e
        from workers.tasks.pipeline_orchestrator import orchestrate_pipeline
        r = orchestrate_pipeline.run(issue_id="issue-42", pipeline_name="stas:fix", ctx={"repo_url": "https://github.com/test/repo.git", "_rework_feedback": {"failures": ["Verification failed"]}}, attempt=1)
        assert r["status"] == "started" and r["attempt"] == 2
        assert "agent_feedback" in e.start_pipeline.call_args[0][2]
