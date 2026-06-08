import pytest
from engagement_loop import (
    OrchestratorEngine, PhaseResult, run_scan_cycle,
    run_daily_report, run_weekly_digest, run_followup_check,
    PHASES,
)
from orchestrator_state import get_repository
from backoff import BackoffTracker


def test_phases_defined():
    assert PHASES == ["POLL", "ANALYZE", "DECIDE", "ENGAGE_LOG"]


def test_phase_result_to_dict():
    r = PhaseResult("TEST", True, {"key": "val"}, None)
    d = r.to_dict()
    assert d["phase"] == "TEST"
    assert d["success"] is True
    assert d["data"] == {"key": "val"}
    assert d["error"] is None


def test_phase_result_error():
    r = PhaseResult("TEST", False, None, "something broke")
    d = r.to_dict()
    assert d["success"] is False
    assert d["error"] == "something broke"


def test_orchestrator_engine_init():
    engine = OrchestratorEngine()
    assert engine.dry_run is False
    assert engine.orch is not None
    assert engine.backoff is not None


def test_engine_dry_run_cycle():
    engine = OrchestratorEngine()
    result = engine.run_cycle(dry_run=True)
    assert "cycle_time_seconds" in result
    assert "phases" in result
    assert len(result["phases"]) >= 4


def test_engine_dry_run_flag():
    engine = OrchestratorEngine()
    assert engine.dry_run is False
    engine.run_cycle(dry_run=True)
    assert engine.dry_run is True


def test_decide_auto_approve_high_relevance():
    engine = OrchestratorEngine()
    analyzed = [{
        "id": "1", "relevance": 90, "sentiment": "positive",
        "opportunity": 85, "urgency": "immediate",
    }]
    decisions = engine.decide(analyzed)
    assert len(decisions) == 1
    assert decisions[0]["action"] == "auto_approve"


def test_decide_skip_low_relevance():
    engine = OrchestratorEngine()
    analyzed = [{
        "id": "2", "relevance": 20, "sentiment": "neutral",
        "opportunity": 10, "urgency": "batch",
    }]
    decisions = engine.decide(analyzed)
    assert len(decisions) == 0


def test_decide_skip_negative_sentiment():
    engine = OrchestratorEngine()
    analyzed = [{
        "id": "3", "relevance": 70, "sentiment": "negative",
        "opportunity": 50, "urgency": "today",
    }]
    decisions = engine.decide(analyzed)
    assert len(decisions) == 0


def test_decide_human_review_medium_relevance():
    engine = OrchestratorEngine()
    analyzed = [{
        "id": "4", "relevance": 50, "sentiment": "neutral",
        "opportunity": 45, "urgency": "batch",
    }]
    decisions = engine.decide(analyzed)
    assert len(decisions) == 1
    assert decisions[0]["action"] == "human_review"


def test_decide_multiple_items():
    engine = OrchestratorEngine()
    analyzed = [
        {"id": "1", "relevance": 90, "sentiment": "positive", "opportunity": 85, "urgency": "immediate"},
        {"id": "2", "relevance": 20, "sentiment": "neutral", "opportunity": 10, "urgency": "batch"},
        {"id": "3", "relevance": 50, "sentiment": "neutral", "opportunity": 45, "urgency": "batch"},
    ]
    decisions = engine.decide(analyzed)
    actions = [d["action"] for d in decisions]
    assert "auto_approve" in actions
    assert "human_review" in actions
    assert "skip" not in actions


def test_decide_with_auto_approve_setting(monkeypatch):
    monkeypatch.setattr("engagement_loop.settings.auto_approve", True)
    engine = OrchestratorEngine()
    analyzed = [{
        "id": "5", "relevance": 65, "sentiment": "positive",
        "opportunity": 60, "urgency": "today",
    }]
    decisions = engine.decide(analyzed)
    assert len(decisions) == 1
    assert decisions[0]["action"] == "auto_approve"


def test_poll_indian_engagement_empty():
    engine = OrchestratorEngine()
    results = engine._poll_indian_engagement()
    assert results == []


def test_run_daily_report():
    result = run_daily_report()
    assert result["type"] == "daily_report"
    assert "summary" in result


def test_run_followup_check():
    result = run_followup_check()
    assert result["type"] == "followup_check"
    assert "pending_count" in result
    assert "pending" in result


def test_run_weekly_digest_no_api_key(monkeypatch):
    monkeypatch.setattr("generate_reply.settings.opencode_api_key", "")
    digest = run_weekly_digest()
    assert digest is not None
    assert len(digest) > 0


def test_engine_log_results():
    engine = OrchestratorEngine()
    results = [PhaseResult("TEST", True, {"count": 1})]
    engine.log_results(results)
    state = engine.orch.get_state("last_loop_result")
    assert state is not None
    assert "phases" in state
    assert state["phases"][0]["phase"] == "TEST"
