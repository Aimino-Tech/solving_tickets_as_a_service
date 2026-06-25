"""Tests for Review & Merge Queue Pipeline."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ── Adversarial Review Agent ───────────────────────────────────────────────


class TestReviewAgent:
    def test_run_adversarial_review_approve(self):
        from workers.review.review_agent import run_adversarial_review

        result = run_adversarial_review(
            issue_id="issue-1",
            workspace_path="/tmp/ws",
            self_audit_result={"verdict": "pass"},
            verification_result={"passed": True, "score": 1.0},
            diff="",
        )
        assert result["verdict"] == "approve"
        assert result["severity"] == "low"
        assert result["score"] == 1.0
        assert len(result["findings"]) == 0

    def test_run_adversarial_review_self_audit_fail(self):
        from workers.review.review_agent import run_adversarial_review

        result = run_adversarial_review(
            issue_id="issue-2",
            workspace_path="/tmp/ws",
            self_audit_result={"verdict": "fail", "reason": "Mock data detected"},
            verification_result={"passed": True},
        )
        assert result["verdict"] == "changes_requested"
        assert len(result["findings"]) > 0
        assert any(f["category"] == "self_audit" for f in result["findings"])

    def test_run_adversarial_review_verification_fail(self):
        from workers.review.review_agent import run_adversarial_review

        result = run_adversarial_review(
            issue_id="issue-3",
            workspace_path="/tmp/ws",
            verification_result={"passed": False, "score": 0.0, "output": "Tests crashed"},
        )
        assert result["verdict"] == "changes_requested"
        assert result["severity"] == "critical"
        assert any(f["category"] == "verification" for f in result["findings"])

    def test_run_adversarial_review_mockup_findings(self):
        from workers.review.review_agent import run_adversarial_review

        result = run_adversarial_review(
            issue_id="issue-4",
            workspace_path="/tmp/ws",
            self_audit_result={
                "verdict": "fail",
                "anti_mockup_findings": [
                    {"file": "src/api.py", "line": 42, "description": "Stub detected"},
                ],
            },
        )
        assert any(f["category"] == "mockup" for f in result["findings"])

    def test_security_patterns_detected(self):
        from workers.review.review_agent import run_adversarial_review

        diff = """
        def process(data):
            result = eval(data)
            return result
        """
        result = run_adversarial_review(
            issue_id="issue-5",
            workspace_path="/tmp/ws",
            diff=diff,
        )
        assert any(f["category"] == "code_injection" for f in result["findings"])
        assert result["severity"] == "critical"

    def test_performance_patterns_detected(self):
        from workers.review.review_agent import run_adversarial_review

        diff = """
        for item in items:
            items.append(item)
        """
        result = run_adversarial_review(
            issue_id="issue-6",
            workspace_path="/tmp/ws",
            diff=diff,
        )
        perf_findings = [f for f in result["findings"] if f["category"] == "performance"]
        assert len(perf_findings) > 0

    def test_no_findings_empty_diff(self):
        from workers.review.review_agent import run_adversarial_review

        result = run_adversarial_review(
            issue_id="issue-7",
            workspace_path="/tmp/ws",
            diff="",
        )
        assert result["verdict"] == "approve"

    @patch("workers.review.review_agent._get_llm_client")
    def test_run_llm_review_fallback(self, mock_get_client):
        from workers.review.review_agent import run_llm_review

        mock_get_client.return_value = None
        result = run_llm_review(diff="some code")
        assert "verdict" in result


# ── Review Orchestrator ────────────────────────────────────────────────────


class TestReviewOrchestrator:
    @patch("workers.tasks.review_orchestrator._get_redis")
    def test_already_processed(self, mock_get_redis):
        from workers.tasks.review_orchestrator import run_review_pipeline

        mock_client = MagicMock()
        mock_client.sismember.return_value = True
        mock_get_redis.return_value = mock_client

        result = run_review_pipeline.run(
            issue_id="processed-issue",
            workspace_path="/tmp/ws",
        )
        assert result["status"] == "skipped"

    @patch("workers.tasks.review_orchestrator._get_redis")
    @patch("workers.tasks.review_orchestrator.run_adversarial_review")
    @patch("workers.tasks.review_orchestrator.process_merge_queue")
    def test_approve_routes_to_merge(self, mock_merge, mock_review, mock_redis):
        from workers.tasks.review_orchestrator import run_review_pipeline

        mock_redis.return_value = MagicMock()
        mock_redis.return_value.sismember.return_value = False
        mock_review.return_value = {"verdict": "approve", "severity": "low", "findings": [], "score": 1.0}

        result = run_review_pipeline.run(
            issue_id="issue-approve",
            workspace_path="/tmp/ws",
            verification_result={"passed": True},
        )
        assert result["status"] == "approved"
        assert result["action"] == "merge_queue"

    @patch("workers.tasks.review_orchestrator._get_redis")
    @patch("workers.tasks.review_orchestrator.run_adversarial_review")
    def test_critical_escalates(self, mock_review, mock_redis):
        from workers.tasks.review_orchestrator import run_review_pipeline

        mock_redis.return_value = MagicMock()
        mock_redis.return_value.sismember.return_value = False
        mock_review.return_value = {"verdict": "changes_requested", "severity": "critical", "findings": [], "score": 0.0}

        with patch("workers.tasks.review_orchestrator.escalate_to_human") as mock_escalate:
            result = run_review_pipeline.run(
                issue_id="issue-critical",
                workspace_path="/tmp/ws",
            )
            assert result["status"] == "escalated"
            mock_escalate.delay.assert_called_once()


# ── Merge Queue ────────────────────────────────────────────────────────────


class TestMergeQueue:
    @patch("workers.tasks.merge_queue._get_redis")
    @patch("workers.tasks.merge_queue.subprocess.run")
    def test_process_merge_no_pr(self, mock_run, mock_redis):
        from workers.tasks.merge_queue import process_merge_queue

        mock_redis.return_value = None
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "feature-branch"

        with patch("workers.tasks.merge_queue.get_client") as mock_linear:
            mock_linear.return_value = MagicMock()
            result = process_merge_queue.run(
                issue_id="issue-merge",
                workspace_path="/tmp/ws",
            )
            assert result["status"] == "merged"

    @patch("workers.tasks.merge_queue._get_redis")
    def test_acquire_repo_lock(self, mock_redis):
        from workers.tasks.merge_queue import _acquire_repo_lock

        mock_client = MagicMock()
        mock_client.set.return_value = True
        mock_redis.return_value = mock_client

        assert _acquire_repo_lock("owner/repo") is True

    @patch("workers.tasks.merge_queue._get_redis")
    def test_release_repo_lock(self, mock_redis):
        from workers.tasks.merge_queue import _release_repo_lock

        mock_client = MagicMock()
        mock_redis.return_value = mock_client

        _release_repo_lock("owner/repo")
        mock_client.delete.assert_called_once()


# ── Conflict Resolver ──────────────────────────────────────────────────────


class TestConflictResolver:
    def test_detect_conflicts_none(self):
        from workers.tasks.conflict_resolver import ConflictResolver

        resolver = ConflictResolver()
        with patch.object(resolver, "detect_conflicts", return_value=[]):
            assert resolver.detect_conflicts("/tmp/ws") == []

    def test_detect_conflicts_found(self):
        from workers.tasks.conflict_resolver import ConflictResolver

        resolver = ConflictResolver()
        with patch.object(resolver, "detect_conflicts", return_value=["src/api.ts"]):
            files = resolver.detect_conflicts("/tmp/ws")
            assert "src/api.ts" in files

    @patch("workers.tasks.conflict_resolver.subprocess.run")
    def test_auto_resolve(self, mock_run):
        from workers.tasks.conflict_resolver import ConflictResolver

        mock_run.return_value.returncode = 0
        resolver = ConflictResolver()
        result = resolver.auto_resolve("/tmp/ws", ["src/api.ts"])
        assert "src/api.ts" in result["resolved"]
        assert len(result["unresolved"]) == 0

    @patch("workers.tasks.conflict_resolver.subprocess.run")
    def test_auto_resolve_failure(self, mock_run):
        from workers.tasks.conflict_resolver import ConflictResolver
        import subprocess

        mock_run.side_effect = subprocess.CalledProcessError(1, "git checkout")
        resolver = ConflictResolver()
        result = resolver.auto_resolve("/tmp/ws", ["src/api.ts"])
        assert "src/api.ts" in result["unresolved"]

    @patch("workers.tasks.conflict_resolver.ConflictResolver.detect_conflicts")
    @patch("workers.tasks.conflict_resolver.ConflictResolver.auto_resolve")
    def test_resolve_conflicts_no_conflicts(self, mock_auto, mock_detect):
        from workers.tasks.conflict_resolver import resolve_conflicts

        mock_detect.return_value = []
        result = resolve_conflicts.run(
            issue_id="issue-1",
            pr_url="https://github.com/owner/repo/pull/1",
            workspace_path="/tmp/ws",
        )
        assert result["status"] == "no_conflicts"

    @patch("workers.tasks.conflict_resolver.ConflictResolver.detect_conflicts")
    @patch("workers.tasks.conflict_resolver.ConflictResolver.auto_resolve")
    @patch("workers.tasks.conflict_resolver.escalate_to_human")
    def test_resolve_conflicts_unresolved_escalates(self, mock_escalate, mock_auto, mock_detect):
        from workers.tasks.conflict_resolver import resolve_conflicts

        mock_detect.return_value = ["src/api.ts"]
        mock_auto.return_value = {
            "resolved": [],
            "unresolved": ["src/api.ts"],
        }
        result = resolve_conflicts.run(
            issue_id="issue-2",
            pr_url="https://github.com/owner/repo/pull/2",
            workspace_path="/tmp/ws",
        )
        assert result["status"] == "partial"


# ── Human Escalation ───────────────────────────────────────────────────────


class TestHumanEscalation:
    @patch("workers.tasks.human_escalation.get_client")
    def test_escalate_to_human(self, mock_get_client):
        from workers.tasks.human_escalation import escalate_to_human

        mock_linear = MagicMock()
        mock_get_client.return_value = mock_linear

        result = escalate_to_human.run(
            issue_id="issue-esc",
            review_result={
                "verdict": "changes_requested",
                "severity": "critical",
                "findings": [{"category": "bug", "severity": "high", "file": "src/x.ts", "line": 10, "description": "Security flaw"}],
                "score": 0.0,
            },
        )
        assert result["status"] == "escalated"
        assert result["findings_count"] == 1
        mock_linear.post_comment.assert_called_once()
        mock_linear.transition_issue.assert_called_once()

    @patch("workers.tasks.human_escalation.get_client")
    def test_escalate_no_findings(self, mock_get_client):
        from workers.tasks.human_escalation import escalate_to_human

        mock_linear = MagicMock()
        mock_get_client.return_value = mock_linear

        result = escalate_to_human.run(
            issue_id="issue-empty",
            review_result={"verdict": "changes_requested", "severity": "medium", "findings": [], "score": 0.5},
        )
        assert result["status"] == "escalated"
        assert result["findings_count"] == 0
