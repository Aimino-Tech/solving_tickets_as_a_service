import pytest
from unittest.mock import MagicMock, patch

from workers.review.review_agent import build_adversarial_prompt, parse_review_output, ADVERSARIAL_SYSTEM_PROMPT
from workers.review.models import ReviewVerdict, Severity, FindingCategory, Finding, ReviewResult


class TestReviewAgent:
    def test_build_adversarial_prompt_includes_diff(self):
        prompt = build_adversarial_prompt("test diff", ["AC-1: do thing"], {"passed": True})
        assert "test diff" in prompt
        assert "AC-1: do thing" in prompt
        assert ADVERSARIAL_SYSTEM_PROMPT[:20] in prompt

    def test_build_adversarial_prompt_no_verification(self):
        prompt = build_adversarial_prompt("diff", ["AC1"])
        assert "Verification Results" not in prompt

    def test_parse_review_output_valid_json(self):
        output = '{"verdict": "approve", "severity": "low", "findings": [], "score": 1.0}'
        result = parse_review_output(output)
        assert result["verdict"] == "approve"
        assert result["score"] == 1.0

    def test_parse_review_output_embedded_json(self):
        output = "Here's my review:\n\n{\"verdict\": \"changes_requested\", \"severity\": \"high\", \"findings\": [{\"category\": \"bug\", \"severity\": \"high\", \"file\": \"src/main.py\", \"line\": 42, \"description\": \"Missing null check\"}], \"score\": 0.3}"
        result = parse_review_output(output)
        assert result["verdict"] == "changes_requested"
        assert len(result["findings"]) == 1

    def test_parse_review_output_invalid(self):
        result = parse_review_output("Not json at all")
        assert result["verdict"] == "changes_requested"
        assert result["severity"] == "high"

    def test_review_result_model(self):
        finding = Finding(category=FindingCategory.security, severity=Severity.critical, file="auth.py", line=10, description="SQL injection")
        result = ReviewResult(verdict=ReviewVerdict.changes_requested, severity=Severity.critical, findings=[finding], score=0.1)
        assert result.verdict == ReviewVerdict.changes_requested
        assert len(result.findings) == 1
        assert result.findings[0].category == FindingCategory.security


class TestReviewOrchestrator:
    def test_make_decision_critical(self):
        from workers.tasks.review_orchestrator import _make_decision
        decision = _make_decision({"verdict": "changes_requested", "severity": "critical"}, {"passed": True})
        assert decision["next_action"] == "human_review"

    def test_make_decision_approve(self):
        from workers.tasks.review_orchestrator import _make_decision
        decision = _make_decision({"verdict": "approve", "severity": "low"}, {"passed": True})
        assert decision["next_action"] == "merge_queue"

    def test_make_decision_high_severity(self):
        from workers.tasks.review_orchestrator import _make_decision
        decision = _make_decision({"verdict": "changes_requested", "severity": "high"}, {"passed": True})
        assert decision["next_action"] == "rework"

    def test_make_decision_verification_failed(self):
        from workers.tasks.review_orchestrator import _make_decision
        decision = _make_decision({"verdict": "approve", "severity": "low"}, {"passed": False})
        assert decision["next_action"] == "rework"
