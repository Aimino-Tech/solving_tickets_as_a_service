from __future__ import annotations

import os
import tempfile

from workers.audit import AuditTrail, PolicyEngine, ComplianceScorer, DriftDetector, AuditExporter
from workers.audit.models import EventSeverity, EventType, AuditEvent


class TestAuditTrail:
    def setup_method(self) -> None:
        self.db = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.db_path = self.db.name
        self.db.close()
        os.environ["STAS_AUDIT_DB_PATH"] = self.db_path

    def teardown_method(self) -> None:
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def test_append_event(self) -> None:
        trail = AuditTrail()
        event = trail.append_event(
            EventType.TASK_DISPATCHED,
            EventSeverity.INFO,
            {"task_id": "t1", "task_name": "test"},
        )
        assert event.event_id
        assert event.sha256_hash
        assert event.prev_hash == "0" * 64

    def test_chain_integrity(self) -> None:
        trail = AuditTrail()
        e1 = trail.append_event(EventType.TASK_DISPATCHED, EventSeverity.INFO, {"seq": 1})
        e2 = trail.append_event(EventType.AGENT_STARTED, EventSeverity.INFO, {"seq": 2})
        e3 = trail.append_event(EventType.AGENT_COMPLETED, EventSeverity.INFO, {"seq": 3})

        assert e2.prev_hash == e1.sha256_hash
        assert e3.prev_hash == e2.sha256_hash

    def test_verify_chain_no_violations(self) -> None:
        trail = AuditTrail()
        trail.append_event(EventType.TASK_DISPATCHED, EventSeverity.INFO, {"seq": 1})
        trail.append_event(EventType.AGENT_STARTED, EventSeverity.INFO, {"seq": 2})
        violations = trail.verify_chain(limit=10)
        assert len(violations) == 0

    def test_get_events_filter(self) -> None:
        trail = AuditTrail()
        trail.append_event(EventType.TASK_DISPATCHED, EventSeverity.INFO, {"seq": 1}, scope="test")
        events = trail.get_events(scope="test")
        assert len(events) == 1

    def test_prune(self) -> None:
        trail = AuditTrail()
        trail.append_event(EventType.TASK_DISPATCHED, EventSeverity.INFO, {"seq": 1})
        deleted = trail.prune(retention_days=0)
        assert isinstance(deleted, int)


class TestPolicyEngine:
    def test_evaluate_retry_limit_policy(self) -> None:
        engine = PolicyEngine()
        results = engine.evaluate("task_dispatched", {"retry_count": 3})
        passed = [r for r in results if r.policy_id == "retry_limit"]
        assert all(r.passed for r in passed)

    def test_evaluate_retry_limit_exceeded(self) -> None:
        engine = PolicyEngine()
        results = engine.evaluate("task_dispatched", {"retry_count": 10})
        failed = [r for r in results if r.policy_id == "retry_limit"]
        assert any(not r.passed for r in failed)

    def test_evaluate_verification_fail(self) -> None:
        engine = PolicyEngine()
        results = engine.evaluate("verification_fail", {})
        failed = [r for r in results if r.policy_id == "verification_gate"]
        assert any(not r.passed for r in failed)


class TestComplianceScorer:
    def test_compute_score_no_events(self) -> None:
        scorer = ComplianceScorer()
        score = scorer.compute_score()
        assert score.score == 1.0
        assert score.total_count == 0


class TestDriftDetector:
    def test_no_drift_with_no_events(self) -> None:
        detector = DriftDetector()
        result = detector.check_drift()
        assert len(result["drifts"]) == 0


class TestAuditExporter:
    def test_export_ndjson(self) -> None:
        exporter = AuditExporter()
        output = exporter.export_ndjson()
        assert isinstance(output, str)

    def test_export_csv(self) -> None:
        exporter = AuditExporter()
        output = exporter.export_csv()
        assert "event_id" in output
