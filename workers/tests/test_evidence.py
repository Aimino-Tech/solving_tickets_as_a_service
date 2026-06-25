"""Tests for the workflow evidence receipts module."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest

from workers.audit.evidence import (
    TRANSITION_TYPES,
    EvidenceReceipt,
    EvidenceStore,
    capture_receipt,
    get_receipts,
    verify_receipt_chain,
)
from workers.audit.evidence_export import (
    export_evidence_json,
    export_evidence_ndjson,
    export_single_receipt,
    export_evidence_json_to_file,
    export_evidence_ndjson_to_file,
)
from workers.audit.evidence_middleware import (
    _get_agent_state,
    _extract_workflow_id,
    _extract_issue_id,
    _extract_tenant,
)


@pytest.fixture
def store() -> EvidenceStore:
    return EvidenceStore()


@pytest.fixture
def populated_store(store: EvidenceStore) -> EvidenceStore:
    capture_receipt("wf-001", "pipeline.start", "starting", tenant_id="tenant_1", issue_id="iss-1", store=store)
    capture_receipt("wf-001", "task.start", "triage", previous_state="starting", tenant_id="tenant_1", issue_id="iss-1", store=store)
    capture_receipt("wf-001", "task.success", "triage", previous_state="triage", tenant_id="tenant_1", issue_id="iss-1", store=store)
    return store


class TestEvidenceReceipt:
    def test_default_receipt_id_is_hex(self):
        r = EvidenceReceipt(workflow_id="w1", transition="pipeline.start", agent_state="starting")
        assert len(r.receipt_id) == 32
        int(r.receipt_id, 16)

    def test_default_timestamp_is_utc(self):
        r = EvidenceReceipt(workflow_id="w1", transition="pipeline.start", agent_state="starting")
        assert r.timestamp.tzinfo is not None

    def test_compute_hash_deterministic(self):
        r = EvidenceReceipt(workflow_id="w1", transition="pipeline.start", agent_state="starting", tenant_id="t1", payload={"key": "value"})
        r.receipt_hash = r.compute_hash()
        assert r.compute_hash() == r.compute_hash()
        assert len(r.compute_hash()) == 64

    def test_verify_passes_with_correct_hash(self):
        r = EvidenceReceipt(workflow_id="w1", transition="pipeline.start", agent_state="starting")
        r.receipt_hash = r.compute_hash()
        assert r.verify() is True

    def test_verify_fails_with_tampered_hash(self):
        r = EvidenceReceipt(workflow_id="w1", transition="pipeline.start", agent_state="starting")
        r.receipt_hash = "f" * 64
        assert r.verify() is False

    def test_different_workflow_ids_produce_different_hashes(self):
        r1 = EvidenceReceipt(workflow_id="w1", transition="pipeline.start", agent_state="starting")
        r2 = EvidenceReceipt(workflow_id="w2", transition="pipeline.start", agent_state="starting")
        r1.receipt_hash = r1.compute_hash()
        r2.receipt_hash = r2.compute_hash()
        assert r1.receipt_hash != r2.receipt_hash


class TestCaptureReceipt:
    def test_genesis_receipt_has_empty_prev_hash(self, store):
        r = capture_receipt("wf-001", "pipeline.start", "starting", tenant_id="t1", store=store)
        assert r.prev_receipt_hash == ""
        assert len(r.receipt_hash) == 64

    def test_second_receipt_links_to_first(self, store):
        first = capture_receipt("wf-001", "pipeline.start", "starting", store=store)
        second = capture_receipt("wf-001", "task.start", "triage", store=store)
        assert second.prev_receipt_hash == first.receipt_hash

    def test_different_workflows_have_independent_chains(self, store):
        a1 = capture_receipt("wf-a", "pipeline.start", "starting", store=store)
        b1 = capture_receipt("wf-b", "pipeline.start", "starting", store=store)
        assert a1.prev_receipt_hash == ""
        assert b1.prev_receipt_hash == ""

    def test_append_is_insert_only(self, store):
        capture_receipt("wf-001", "pipeline.start", "starting", store=store)
        assert store.count("wf-001") == 1

    def test_receipt_hash_is_valid_sha256(self, store):
        r = capture_receipt("wf-001", "pipeline.start", "starting", store=store)
        assert len(r.receipt_hash) == 64
        int(r.receipt_hash, 16)

    def test_invalid_transition_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown transition"):
            capture_receipt("wf-001", "not.a.transition", "starting")

    def test_all_valid_transitions_succeed(self, store):
        for transition in sorted(TRANSITION_TYPES):
            r = capture_receipt(f"wf-{transition}", transition, f"state_{transition}", store=store)
            assert r.transition == transition
            assert r.verify()

    def test_tenant_issue_task_ids_are_stored(self, store):
        r = capture_receipt("wf-001", "task.start", "triage", tenant_id="acme", issue_id="gh-42", task_id="celery-task-1", payload={"detail": "test"}, store=store)
        assert r.tenant_id == "acme"
        assert r.issue_id == "gh-42"
        assert r.task_id == "celery-task-1"
        assert r.payload == {"detail": "test"}


class TestEvidenceStore:
    def test_get_receipts_returns_newest_first(self, populated_store):
        receipts = populated_store.get_receipts(workflow_id="wf-001")
        assert len(receipts) == 3
        times = [r.timestamp for r in receipts]
        assert times == sorted(times, reverse=True)

    def test_get_receipts_empty_workflow(self, store):
        assert store.get_receipts(workflow_id="nonexistent") == []

    def test_get_receipts_limit(self, populated_store):
        assert len(populated_store.get_receipts(workflow_id="wf-001", limit=1)) == 1

    def test_get_receipts_after_id_pagination(self, populated_store):
        receipts = populated_store.get_receipts(workflow_id="wf-001")
        first_id = receipts[-1].receipt_id
        after = populated_store.get_receipts(workflow_id="wf-001", after_id=first_id)
        assert len(after) == 2

    def test_get_by_transition(self, store):
        capture_receipt("wf-1", "pipeline.start", "starting", store=store)
        capture_receipt("wf-2", "pipeline.start", "starting", store=store)
        capture_receipt("wf-1", "task.success", "triage", store=store)
        assert len(store.get_by_transition("pipeline.start")) == 2
        assert len(store.get_by_transition("task.success")) == 1

    def test_get_since(self, store):
        capture_receipt("wf-1", "pipeline.start", "starting", store=store)
        capture_receipt("wf-1", "task.start", "triage", store=store)
        before = datetime(2020, 1, 1, tzinfo=timezone.utc)
        assert len(store.get_since(before)) == 2

    def test_count(self, store):
        assert store.count() == 0
        capture_receipt("wf-1", "pipeline.start", "starting", store=store)
        assert store.count() == 1
        assert store.count("wf-1") == 1
        assert store.count("wf-2") == 0

    def test_clear(self, store):
        capture_receipt("wf-1", "pipeline.start", "starting", store=store)
        capture_receipt("wf-1", "task.start", "triage", store=store)
        assert store.count() == 2
        store.clear()
        assert store.count() == 0

    def test_tenant_filtered_queries(self, store):
        capture_receipt("wf-1", "pipeline.start", "starting", tenant_id="t1", store=store)
        capture_receipt("wf-2", "pipeline.start", "starting", tenant_id="t2", store=store)
        assert len(store.get_receipts(tenant_id="t1")) == 1
        assert len(store.get_receipts(tenant_id="t2")) == 1


class TestVerifyReceiptChain:
    def test_intact_chain(self, populated_store):
        assert verify_receipt_chain("wf-001", store=populated_store) is True

    def test_empty_workflow(self, store):
        assert verify_receipt_chain("ghost", store=store) is True

    def test_tampered_receipt_hash(self, store):
        capture_receipt("wf-1", "pipeline.start", "starting", store=store)
        capture_receipt("wf-1", "task.success", "triage", store=store)
        receipts = store.get_receipts(workflow_id="wf-1")
        receipts[-1].receipt_hash = "f" * 64
        assert verify_receipt_chain("wf-1", store=store) is False

    def test_broken_chain_link(self, store):
        capture_receipt("wf-1", "pipeline.start", "starting", store=store)
        capture_receipt("wf-1", "task.success", "triage", store=store)
        receipts = store.get_receipts(workflow_id="wf-1")
        receipts[0].prev_receipt_hash = "f" * 64
        assert verify_receipt_chain("wf-1", store=store) is False

    def test_multi_workflow_chains_independent(self, store):
        capture_receipt("wf-a", "pipeline.start", "starting", store=store)
        capture_receipt("wf-a", "task.success", "triage", store=store)
        capture_receipt("wf-b", "pipeline.start", "starting", store=store)
        assert verify_receipt_chain("wf-a", store=store) is True
        assert verify_receipt_chain("wf-b", store=store) is True


class TestExportJSON:
    def test_export_single_receipt(self, populated_store):
        r = populated_store.get_receipts(workflow_id="wf-001")[0]
        output = export_single_receipt(r)
        parsed = json.loads(output)
        assert parsed["workflow_id"] == "wf-001"
        assert "receipt_hash" in parsed
        assert "receipt_id" in parsed

    def test_export_single_receipt_without_hash(self, populated_store):
        r = populated_store.get_receipts(workflow_id="wf-001")[0]
        parsed = json.loads(export_single_receipt(r, include_hash=False))
        assert "receipt_hash" not in parsed

    def test_export_json_array(self, populated_store):
        receipts = populated_store.get_receipts(workflow_id="wf-001")
        parsed = json.loads(export_evidence_json(receipts))
        assert isinstance(parsed, list)
        assert len(parsed) == 3

    def test_export_json_empty(self):
        assert json.loads(export_evidence_json([])) == []

    def test_export_json_pretty(self, populated_store):
        receipts = populated_store.get_receipts(workflow_id="wf-001")
        assert len(export_evidence_json(receipts, pretty=True)) >= len(export_evidence_json(receipts, pretty=False))

    def test_export_json_to_file(self, populated_store, tmp_path):
        receipts = populated_store.get_receipts(workflow_id="wf-001")
        path = str(tmp_path / "evidence.json")
        assert export_evidence_json_to_file(receipts, path) == 3
        with open(path) as f:
            assert len(json.load(f)) == 3


class TestExportNDJSON:
    def test_export_ndjson(self, populated_store):
        output = export_evidence_ndjson(populated_store.get_receipts(workflow_id="wf-001"))
        lines = output.strip().split("\n")
        assert len(lines) == 3
        for line in lines:
            obj = json.loads(line)
            assert "receipt_id" in obj
            assert "receipt_hash" in obj
            assert "workflow_id" in obj

    def test_export_ndjson_empty(self):
        assert export_evidence_ndjson([]) == ""

    def test_export_ndjson_to_file(self, populated_store, tmp_path):
        receipts = populated_store.get_receipts(workflow_id="wf-001")
        path = str(tmp_path / "evidence.ndjson")
        assert export_evidence_ndjson_to_file(receipts, path) == 3
        with open(path) as f:
            assert len(f.read().strip().split("\n")) == 3


class TestMiddlewareHelpers:
    def test_get_agent_state_known_task(self):
        assert _get_agent_state("workers.tasks.triage.run_triage") == "triage"
        assert _get_agent_state("workers.tasks.agent.dispatch_agent") == "agent_dispatch"
        assert _get_agent_state("workers.tasks.sandbox.run_sandbox") == "sandbox"

    def test_get_agent_state_unknown_task_falls_back(self):
        assert _get_agent_state("workers.tasks.custom.my_task") == "my_task"
        assert _get_agent_state("some.module.func") == "func"

    def test_extract_workflow_id_from_kwargs(self):
        assert _extract_workflow_id((), {"workflow_id": "wf-1"}) == "wf-1"
        assert _extract_workflow_id((), {"pipeline_id": "pl-1"}) == "pl-1"

    def test_extract_workflow_id_from_nested_context(self):
        assert _extract_workflow_id((), {"pipeline_context": {"workflow_id": "wf-nested"}}) == "wf-nested"

    def test_extract_workflow_id_returns_none_when_missing(self):
        assert _extract_workflow_id((), {}) is None

    def test_extract_issue_id_from_kwargs(self):
        assert _extract_issue_id((), {"issue_id": "gh-42"}) == "gh-42"

    def test_extract_issue_id_from_nested_context(self):
        assert _extract_issue_id((), {"pipeline_context": {"issue_id": "gh-nested"}}) == "gh-nested"

    def test_extract_issue_id_from_dict_arg(self):
        assert _extract_issue_id(({"issue_id": "gh-arg"},), {}) == "gh-arg"

    def test_extract_issue_id_returns_none_when_missing(self):
        assert _extract_issue_id((), {}) is None

    def test_extract_tenant_from_kwargs(self):
        assert _extract_tenant((), {"tenant_id": "acme"}) == "acme"

    def test_extract_tenant_from_nested_context(self):
        assert _extract_tenant((), {"pipeline_context": {"tenant_id": "acme-nested"}}) == "acme-nested"

    def test_extract_tenant_fallback_default(self):
        assert _extract_tenant((), {}) == "stas-default"

    def test_extract_tenant_from_first_arg(self):
        assert _extract_tenant(("my-tenant-id", 42), {}) == "my-tenant-id"


class TestIntegration:
    def test_full_pipeline_receipt_chain(self, store):
        wf_id = "pipeline-int-1"
        r1 = capture_receipt(wf_id, "pipeline.start", "starting", tenant_id="acme", issue_id="gh-1", store=store)
        r2 = capture_receipt(wf_id, "task.start", "triage", previous_state="starting", tenant_id="acme", issue_id="gh-1", store=store)
        r3 = capture_receipt(wf_id, "task.success", "triage", previous_state="triage", tenant_id="acme", issue_id="gh-1", store=store)
        r4 = capture_receipt(wf_id, "agent.stage_completed", "fixing", previous_state="triage", tenant_id="acme", issue_id="gh-1", store=store)
        r5 = capture_receipt(wf_id, "pipeline.complete", "completed", previous_state="fixing", tenant_id="acme", issue_id="gh-1", payload={"result": "success"}, store=store)

        assert verify_receipt_chain(wf_id, store=store) is True
        assert store.count(wf_id) == 5
        assert r1.prev_receipt_hash == ""
        assert r2.prev_receipt_hash == r1.receipt_hash
        assert r3.prev_receipt_hash == r2.receipt_hash
        assert r4.prev_receipt_hash == r3.receipt_hash
        assert r5.prev_receipt_hash == r4.receipt_hash
        for r in (r1, r2, r3, r4, r5):
            assert r.verify()

        receipts = get_receipts(workflow_id=wf_id, store=store)
        assert len(receipts) == 5
        parsed = json.loads(export_evidence_json(receipts))
        assert len(parsed) == 5

        ndjson_output = export_evidence_ndjson(receipts)
        assert len(ndjson_output.strip().split("\n")) == 5
        for line in ndjson_output.strip().split("\n"):
            obj = json.loads(line)
            original = next(r for r in (r1, r2, r3, r4, r5) if r.receipt_id == obj["receipt_id"])
            assert obj["receipt_hash"] == original.receipt_hash

    def test_tampering_detected_after_export(self, store):
        capture_receipt("tamper-test", "pipeline.start", "starting", store=store)
        capture_receipt("tamper-test", "task.success", "triage", store=store)
        assert verify_receipt_chain("tamper-test", store=store) is True
        store.get_receipts(workflow_id="tamper-test")[-1].payload = {"tampered": True}
        assert verify_receipt_chain("tamper-test", store=store) is False

    def test_multi_tenant_isolation(self, store):
        for i in range(3):
            capture_receipt(f"wf-t{i}", "pipeline.start", "starting", tenant_id=f"tenant_{i}", store=store)
            capture_receipt(f"wf-t{i}", "task.success", "triage", tenant_id=f"tenant_{i}", store=store)
        for i in range(3):
            assert verify_receipt_chain(f"wf-t{i}", store=store) is True
            assert store.count(f"wf-t{i}") == 2
        assert store.count() == 6

    def test_all_transition_types_exportable(self, store):
        for i, transition in enumerate(sorted(TRANSITION_TYPES)):
            capture_receipt(f"wf-all-{i}", transition, f"state_{transition}", store=store)
        all_receipts = []
        for i in range(len(TRANSITION_TYPES)):
            all_receipts.extend(get_receipts(workflow_id=f"wf-all-{i}", store=store))
        assert len(all_receipts) == len(TRANSITION_TYPES)
        parsed = json.loads(export_evidence_json(all_receipts))
        assert len(parsed) == len(TRANSITION_TYPES)
        ndjson_out = export_evidence_ndjson(all_receipts)
        lines = ndjson_out.strip().split("\n")
        assert len(lines) == len(TRANSITION_TYPES)
        for line in lines:
            h = json.loads(line)["receipt_hash"]
            assert len(h) == 64
            int(h, 16)
