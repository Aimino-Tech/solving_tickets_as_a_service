"""Tests for the compliance audit trail module."""

from __future__ import annotations

import hashlib
import io
import json
from datetime import datetime, timedelta, timezone

import pytest

from workers.audit.models import AuditEvent
from workers.audit.trail import (
    AuditStore,
    append_event,
    compute_chain_hash,
    compute_payload_hash,
    get_chain,
    verify_chain_integrity,
)
from workers.audit.policies import (
    EventTypeAllowlistRule,
    HashIntegrityRule,
    MaxPayloadSizeRule,
    PayloadPresenceRule,
    PolicyEngine,
    PrevHashChainRule,
)
from workers.audit.scoring import compute_score
from workers.audit.drift_detection import DriftDetector
from workers.audit.export import export_csv, export_ndjson


@pytest.fixture
def store() -> AuditStore:
    return AuditStore()


@pytest.fixture
def populated_store(store: AuditStore) -> AuditStore:
    append_event("tenant_1", "pipeline.start", {"pipeline": "fix-bug"}, store=store)
    append_event("tenant_1", "task.success", {"task": "triage"}, store=store)
    append_event("tenant_1", "pipeline.complete", {"status": "ok"}, store=store)
    return store


class TestAuditEvent:
    def test_default_id_is_hex(self):
        event = AuditEvent(tenant_id="t1", event_type="test", payload_hash="a" * 64)
        assert len(event.id) == 32
        int(event.id, 16)

    def test_default_created_at_is_utc(self):
        event = AuditEvent(tenant_id="t1", event_type="test", payload_hash="a" * 64)
        assert event.created_at.tzinfo is not None

    def test_chain_hash_deterministic(self):
        event = AuditEvent(
            tenant_id="t1",
            event_type="test",
            payload={"key": "value"},
            payload_hash=compute_payload_hash({"key": "value"}),
            prev_hash="",
        )
        h1 = event.chain_hash()
        h2 = event.chain_hash()
        assert h1 == h2
        assert len(h1) == 64

    def test_chain_hash_different_for_different_prev(self):
        event1 = AuditEvent(
            tenant_id="t1", event_type="test", payload={"a": 1},
            payload_hash=compute_payload_hash({"a": 1}),
            prev_hash="",
        )
        event2 = AuditEvent(
            tenant_id="t1", event_type="test", payload={"a": 1},
            payload_hash=compute_payload_hash({"a": 1}),
            prev_hash="different",
        )
        assert event1.chain_hash() != event2.chain_hash()


class TestComputePayloadHash:
    def test_deterministic(self):
        p1 = compute_payload_hash({"a": 1, "b": 2})
        p2 = compute_payload_hash({"b": 2, "a": 1})
        assert p1 == p2

    def test_different_payload_different_hash(self):
        h1 = compute_payload_hash({"a": 1})
        h2 = compute_payload_hash({"a": 2})
        assert h1 != h2

    def test_empty_payload(self):
        h = compute_payload_hash({})
        assert len(h) == 64
        assert h == hashlib.sha256(b"{}").hexdigest()


class TestComputeChainHash:
    def test_genesis(self):
        h = compute_chain_hash("", compute_payload_hash({"a": 1}))
        assert len(h) == 64

    def test_deterministic(self):
        ph = compute_payload_hash({"x": 1})
        assert compute_chain_hash("abc", ph) == compute_chain_hash("abc", ph)

    def test_links_differ(self):
        ph = compute_payload_hash({"x": 1})
        assert compute_chain_hash("a", ph) != compute_chain_hash("b", ph)


class TestAppendEvent:
    def test_genesis_event_has_empty_prev_hash(self, store: AuditStore):
        event = append_event("tenant_x", "audit.genesis", {"msg": "first"}, store=store)
        assert event.prev_hash == ""
        assert len(event.payload_hash) == 64

    def test_second_event_links_to_first(self, store: AuditStore):
        first = append_event("tenant_x", "pipeline.start", store=store)
        second = append_event("tenant_x", "task.success", store=store)
        assert second.prev_hash == first.chain_hash()

    def test_different_tenants_have_independent_chains(self, store: AuditStore):
        a1 = append_event("t_a", "pipeline.start", store=store)
        b1 = append_event("t_b", "pipeline.start", store=store)
        assert a1.prev_hash == ""
        assert b1.prev_hash == ""

    def test_append_is_insert_only(self, store: AuditStore):
        event = append_event("t", "test", store=store)
        assert store.count("t") == 1

    def test_event_has_chain_hash(self, store: AuditStore):
        event = append_event("t", "test", {"n": 42}, store=store)
        ch = event.chain_hash()
        assert len(ch) == 64
        raw = (event.prev_hash + event.payload_hash).encode("ascii")
        expected = hashlib.sha256(raw).hexdigest()
        assert ch == expected

    def test_payload_hash_matches_canonical(self, store: AuditStore):
        payload = {"z": 1, "a": 2}
        event = append_event("t", "test", payload, store=store)
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        expected = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        assert event.payload_hash == expected


class TestGetChain:
    def test_returns_newest_first(self, populated_store: AuditStore):
        chain = get_chain("tenant_1", store=populated_store)
        assert len(chain) == 3
        times = [e.created_at for e in chain]
        assert times == sorted(times, reverse=True)

    def test_empty_tenant(self, store: AuditStore):
        assert get_chain("nonexistent", store=store) == []

    def test_limit(self, populated_store: AuditStore):
        chain = get_chain("tenant_1", limit=1, store=populated_store)
        assert len(chain) == 1

    def test_after_id_pagination(self, populated_store: AuditStore):
        chain = get_chain("tenant_1", store=populated_store)
        assert len(chain) == 3
        first_id = chain[-1].id
        after = get_chain("tenant_1", after_id=first_id, store=populated_store)
        assert len(after) == 2


class TestVerifyChainIntegrity:
    def test_intact_chain(self, populated_store: AuditStore):
        assert verify_chain_integrity("tenant_1", store=populated_store) is True

    def test_empty_tenant(self, store: AuditStore):
        assert verify_chain_integrity("ghost", store=store) is True

    def test_tampered_chain(self, store: AuditStore):
        append_event("t", "audit.genesis", {"step": 1}, store=store)
        append_event("t", "pipeline.start", {"step": 2}, store=store)
        events = store.get_chain("t")
        oldest = events[-1]
        oldest.payload_hash = "f" * 64
        assert verify_chain_integrity("t", store=store) is False


class TestPolicyEngine:
    def test_all_default_rules_pass_valid_event(self):
        engine = PolicyEngine.with_defaults()
        event = AuditEvent(
            tenant_id="t",
            event_type="audit.genesis",
            payload={"pipeline": "fix"},
            payload_hash=compute_payload_hash({"pipeline": "fix"}),
            prev_hash="",
        )
        verdicts = engine.evaluate(event)
        assert all(v.passed for v in verdicts)
        assert len(verdicts) == 5

    def test_hash_integrity_rule_fails_on_mismatch(self):
        engine = PolicyEngine([HashIntegrityRule()])
        event = AuditEvent(
            tenant_id="t",
            event_type="pipeline.start",
            payload={"pipeline": "fix"},
            payload_hash="f" * 64,
            prev_hash="",
        )
        verdicts = engine.evaluate(event)
        assert not verdicts[0].passed
        assert "mismatch" in verdicts[0].reason.lower()

    def test_payload_presence_rule_fails_on_empty(self):
        rule = PayloadPresenceRule(
            require_for_types=frozenset({"pipeline.start"}),
        )
        engine = PolicyEngine([rule])
        event = AuditEvent(
            tenant_id="t",
            event_type="pipeline.start",
            payload={},
            payload_hash=compute_payload_hash({}),
            prev_hash="",
        )
        verdicts = engine.evaluate(event)
        assert not verdicts[0].passed
        assert "empty" in verdicts[0].reason.lower()

    def test_event_type_allowlist_rejects_unknown(self):
        engine = PolicyEngine([EventTypeAllowlistRule()])
        event = AuditEvent(
            tenant_id="t",
            event_type="unknown.type",
            payload={},
            payload_hash=compute_payload_hash({}),
            prev_hash="",
        )
        verdicts = engine.evaluate(event)
        assert not verdicts[0].passed
        assert "unknown" in verdicts[0].reason.lower()

    def test_max_payload_size_rule(self):
        engine = PolicyEngine([MaxPayloadSizeRule(max_bytes=10)])
        event = AuditEvent(
            tenant_id="t",
            event_type="pipeline.start",
            payload={"this_payload_is_way_too_long": "yep"},
            payload_hash=compute_payload_hash({"this_payload_is_way_too_long": "yep"}),
            prev_hash="",
        )
        verdicts = engine.evaluate(event)
        assert not verdicts[0].passed
        assert "exceeds" in verdicts[0].reason.lower()

    def test_prev_hash_chain_rule_rejects_empty_on_non_genesis(self):
        engine = PolicyEngine([PrevHashChainRule()])
        event = AuditEvent(
            tenant_id="t",
            event_type="task.success",
            payload={},
            payload_hash=compute_payload_hash({}),
            prev_hash="",
        )
        verdicts = engine.evaluate(event)
        assert not verdicts[0].passed

    def test_custom_rule(self):
        engine = PolicyEngine()
        engine.add_custom_rule(
            "always_fail",
            lambda e: type("V", (), {"passed": False, "reason": "nope", "severity": "info"})(),
            severity="info",
        )
        event = AuditEvent(
            tenant_id="t", event_type="test", payload={},
            payload_hash=compute_payload_hash({}), prev_hash="",
        )
        verdicts = engine.evaluate(event)
        assert not verdicts[0].passed

    def test_rule_exception_is_caught(self):
        def _broken(_event):
            raise ValueError("boom")

        engine = PolicyEngine()
        engine.add_custom_rule("broken", _broken, severity="critical")
        event = AuditEvent(
            tenant_id="t", event_type="test", payload={},
            payload_hash=compute_payload_hash({}), prev_hash="",
        )
        verdicts = engine.evaluate(event)
        assert not verdicts[0].passed
        assert "boom" in verdicts[0].reason


class TestComputeScore:
    def test_empty_events_returns_perfect(self):
        score = compute_score([])
        assert score.score == 1.0
        assert score.total_events == 0

    def test_no_verdicts_returns_perfect(self):
        events = [
            AuditEvent(tenant_id="t", event_type="pipeline.start", payload={},
                       payload_hash=compute_payload_hash({}), prev_hash=""),
        ]
        score = compute_score(events)
        assert score.score == 1.0
        assert score.total_events == 1

    def test_all_pass(self):
        events = [
            AuditEvent(tenant_id="t", event_type="pipeline.start", payload={"a": 1},
                       payload_hash=compute_payload_hash({"a": 1}), prev_hash=""),
            AuditEvent(tenant_id="t", event_type="task.success", payload={"b": 2},
                       payload_hash=compute_payload_hash({"b": 2}), prev_hash="x" * 64),
        ]
        verdicts = [[type("V", (), {"passed": True})()] for _ in events]
        score = compute_score(events, verdicts)
        assert score.score == 1.0
        assert score.passed_events == 2
        assert score.failed_events == 0

    def test_all_fail(self):
        events = [
            AuditEvent(tenant_id="t", event_type="pipeline.start", payload={},
                       payload_hash=compute_payload_hash({}), prev_hash=""),
        ]
        verdicts = [[type("V", (), {"passed": False})()]]
        score = compute_score(events, verdicts)
        assert score.score == 0.0
        assert score.passed_events == 0
        assert score.failed_events == 1

    def test_weighted_score(self):
        events = [
            AuditEvent(tenant_id="t", event_type="pipeline.start", payload={},
                       payload_hash=compute_payload_hash({}), prev_hash=""),
            AuditEvent(tenant_id="t", event_type="verification.pass", payload={},
                       payload_hash=compute_payload_hash({}), prev_hash="x" * 64),
        ]
        verdicts = [
            [type("V", (), {"passed": True})()],
            [type("V", (), {"passed": False})()],
        ]
        score = compute_score(events, verdicts)
        assert score.score == pytest.approx(0.333333, rel=1e-5)

    def test_score_rounds_to_6_decimals(self):
        events = [
            AuditEvent(tenant_id="t", event_type="pipeline.start", payload={},
                       payload_hash=compute_payload_hash({}), prev_hash=""),
        ]
        verdicts = [[type("V", (), {"passed": False})()]]
        score = compute_score(events, verdicts)
        assert score.score == 0.0


class TestDriftDetector:
    def test_no_drift_when_identical(self):
        detector = DriftDetector()
        events = [
            AuditEvent(tenant_id="t", event_type="pipeline.start", payload={},
                       payload_hash=compute_payload_hash({}), prev_hash=""),
        ]
        report = detector.compare(events, events)
        assert report.score_change == 0.0
        assert report.fail_rate_current == report.fail_rate_previous

    def test_drift_detected_on_score_drop(self):
        detector = DriftDetector(score_change_threshold=0.05)
        prev = [
            AuditEvent(tenant_id="t", event_type="pipeline.start", payload={},
                       payload_hash=compute_payload_hash({}), prev_hash=""),
        ]
        curr = [
            AuditEvent(tenant_id="t", event_type="verification.fail", payload={},
                       payload_hash=compute_payload_hash({}), prev_hash="x" * 64),
        ]
        from workers.audit.models import PolicyVerdict
        from workers.audit.scoring import compute_score

        prev_score = compute_score(prev, [[PolicyVerdict(rule_name="r", passed=True, severity="info")]])
        curr_score = compute_score(curr, [[PolicyVerdict(rule_name="r", passed=False, reason="fail", severity="info")]])
        report = detector.compare(prev, curr, prev_score, curr_score)
        assert report.anomaly_detected
        assert "decrease" in report.anomaly_reason.lower()

    def test_insufficient_events_skips(self):
        detector = DriftDetector(min_event_count=10)
        report = detector.compare_time_windows(
            [AuditEvent(tenant_id="t", event_type="test", payload={},
                        payload_hash=compute_payload_hash({}), prev_hash="",
                        created_at=datetime.now(timezone.utc) - timedelta(hours=2))],
            window_minutes=60,
        )
        assert not report.anomaly_detected


class TestExportNDJSON:
    def test_writes_ndjson(self, populated_store: AuditStore):
        buf = io.StringIO()
        events = get_chain("tenant_1", store=populated_store)
        count = export_ndjson(events, buf)
        assert count == 3
        lines = buf.getvalue().strip().split("\n")
        assert len(lines) == 3
        for line in lines:
            obj = json.loads(line)
            assert "id" in obj
            assert "tenant_id" in obj
            assert "chain_hash" in obj

    def test_empty_events(self):
        buf = io.StringIO()
        count = export_ndjson([], buf)
        assert count == 0
        assert buf.getvalue() == ""

    def test_pretty_format(self, populated_store: AuditStore):
        buf = io.StringIO()
        events = get_chain("tenant_1", store=populated_store)
        export_ndjson(events, buf, pretty=True)
        assert '"id":' in buf.getvalue()


class TestExportCSV:
    def test_writes_csv_with_header(self, populated_store: AuditStore):
        buf = io.StringIO()
        events = get_chain("tenant_1", store=populated_store)
        count = export_csv(events, buf)
        assert count == 3
        output = buf.getvalue()
        assert "id,tenant_id,event_type" in output
        lines = output.strip().split("\n")
        assert len(lines) == 4

    def test_empty_events(self):
        buf = io.StringIO()
        count = export_csv([], buf)
        assert count == 0
        assert "id" in buf.getvalue()

    def test_delimiter_option(self, populated_store: AuditStore):
        buf = io.StringIO()
        events = get_chain("tenant_1", store=populated_store)
        export_csv(events, buf, delimiter=";")
        assert "id;tenant_id;event_type" in buf.getvalue()


class TestIntegration:
    def test_full_pipeline(self, store: AuditStore):
        e1 = append_event("acme", "audit.genesis", {"branch": "main"}, store=store)
        e2 = append_event("acme", "task.success", {"task": "build"}, store=store)
        e3 = append_event("acme", "verification.pass", {"tests": 42}, store=store)

        assert verify_chain_integrity("acme", store=store)

        engine = PolicyEngine.with_defaults()
        chain = get_chain("acme", store=store)
        chain_rev = list(reversed(chain))
        all_verdicts = engine.evaluate_all(chain_rev)
        assert len(all_verdicts) == 3
        assert all(all(v.passed for v in ev) for ev in all_verdicts)

        score = compute_score(chain_rev, all_verdicts)
        assert score.score == 1.0
        assert score.total_events == 3

        buf = io.StringIO()
        export_ndjson(chain, buf)
        lines = buf.getvalue().strip().split("\n")
        assert len(lines) == 3

        buf2 = io.StringIO()
        export_csv(chain, buf2)
        assert "acme" in buf2.getvalue()

    def test_chain_tampering_detected(self, store: AuditStore):
        append_event("t", "pipeline.start", {"i": 1}, store=store)
        append_event("t", "task.success", {"i": 2}, store=store)

        events = store.get_chain("t")
        tampered = events[-1]
        tampered.payload_hash = compute_payload_hash({"i": 999})

        assert verify_chain_integrity("t", store=store) is False

        engine = PolicyEngine([HashIntegrityRule()])
        chain_rev = list(reversed(store.get_chain("t")))
        verdicts = engine.evaluate_all(chain_rev)
        assert any(not v.passed for ev_v in verdicts for v in ev_v)

    def test_anomaly_detection_flow(self, store: AuditStore):
        from workers.audit.models import PolicyVerdict
        from workers.audit.scoring import compute_score

        good_events: list[AuditEvent] = []
        for i in range(10):
            ev = append_event("t", "pipeline.start", {"i": i}, store=store)
            good_events.append(ev)

        bad_events: list[AuditEvent] = []
        for i in range(5):
            ev = append_event("t", "pipeline.fail", {"i": i}, store=store)
            bad_events.append(ev)

        good_verdicts = [[PolicyVerdict(rule_name="r", passed=True, severity="info")]] * 10
        bad_verdicts = [[PolicyVerdict(rule_name="r", passed=False, reason="fail", severity="info")]] * 5

        good_score = compute_score(good_events, good_verdicts)
        bad_score = compute_score(bad_events, bad_verdicts)

        detector = DriftDetector(fail_rate_threshold=0.05, score_change_threshold=0.05)
        report = detector.compare(good_events, bad_events, good_score, bad_score)
        assert report.anomaly_detected
        assert report.fail_rate_current > 0
        assert report.current_score < report.previous_score
