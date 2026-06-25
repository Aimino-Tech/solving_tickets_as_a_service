"""Tests for workflow receipt generation and chain verification."""

from __future__ import annotations

import hashlib
import json

from workers.audit.receipts import WorkflowReceipt, generate_receipt
from workers.audit.receipt_verifier import verify_chain, verify_receipt


# ---------------------------------------------------------------------------
# WorkflowReceipt model tests
# ---------------------------------------------------------------------------


class TestWorkflowReceipt:
    def test_default_id_is_hex(self) -> None:
        r = generate_receipt("test.event", {"a": 1})
        assert len(r.id) == 32
        int(r.id, 16)

    def test_default_created_at_is_utc(self) -> None:
        r = generate_receipt("test.event", {"a": 1})
        assert r.created_at.tzinfo is not None

    def test_chain_hash_is_64_hex_chars(self) -> None:
        r = generate_receipt("build.started", {"branch": "main"})
        assert len(r.chain_hash) == 64
        int(r.chain_hash, 16)

    def test_payload_hash_is_64_hex_chars(self) -> None:
        r = generate_receipt("build.started", {"branch": "main"})
        assert len(r.payload_hash) == 64
        int(r.payload_hash, 16)

    def test_to_dict_contains_all_keys(self) -> None:
        r = generate_receipt("test.event", {"key": "val"})
        d = r.to_dict()
        assert d["event"] == "test.event"
        assert d["payload"] == {"key": "val"}
        assert "chain_hash" in d
        assert "created_at" in d


# ---------------------------------------------------------------------------
# generate_receipt tests
# ---------------------------------------------------------------------------


class TestGenerateReceipt:
    def test_genesis_receipt_has_empty_prev_hash(self) -> None:
        r = generate_receipt("workflow.start", {"init": True})
        assert r.prev_hash == ""

    def test_genesis_receipt_chain_hash_matches_computation(self) -> None:
        r = generate_receipt("genesis", {"n": 1})
        expected = hashlib.sha256(
            ("" + r.payload_hash).encode("ascii")
        ).hexdigest()
        assert r.chain_hash == expected

    def test_second_receipt_links_to_first(self) -> None:
        r1 = generate_receipt("step.1", {"i": 1})
        r2 = generate_receipt("step.2", {"i": 2}, prev_hash=r1.chain_hash)
        assert r2.prev_hash == r1.chain_hash

    def test_chain_hashes_differ(self) -> None:
        r1 = generate_receipt("step.1", {"i": 1})
        r2 = generate_receipt("step.2", {"i": 2}, prev_hash=r1.chain_hash)
        assert r1.chain_hash != r2.chain_hash
        assert r1.payload_hash != r2.payload_hash

    def test_deterministic_with_same_input(self) -> None:
        r1 = generate_receipt("same", {"x": 42})
        r2 = generate_receipt("same", {"x": 42})
        assert r1.payload_hash == r2.payload_hash
        # prev_hash differs (both genesis, but chain_hash uses
        # prev_hash + payload_hash, and prev_hash is "" for both)
        assert r1.chain_hash == r2.chain_hash

    def test_different_payloads_produce_different_hashes(self) -> None:
        r1 = generate_receipt("event.a", {"x": 1})
        r2 = generate_receipt("event.b", {"x": 2})
        assert r1.chain_hash != r2.chain_hash

    def test_empty_payload(self) -> None:
        r = generate_receipt("empty.payload")
        assert r.payload == {}
        assert len(r.payload_hash) == 64
        expected = hashlib.sha256(b"{}").hexdigest()
        assert r.payload_hash == expected

    def test_payload_canonical_json(self) -> None:
        payload = {"z": 99, "a": 1}
        r = generate_receipt("test", payload)
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        expected = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        assert r.payload_hash == expected

    def test_payload_unchanged_in_receipt(self) -> None:
        payload = {"msg": "hello", "count": 3}
        r = generate_receipt("test", payload)
        assert r.payload == payload


# ---------------------------------------------------------------------------
# verify_receipt tests
# ---------------------------------------------------------------------------


class TestVerifyReceipt:
    def test_genesis_receipt_passes_without_previous(self) -> None:
        r = generate_receipt("genesis", {"ok": True})
        ok, reason = verify_receipt(r, previous_receipt=None)
        assert ok is True
        assert reason == ""

    def test_genesis_receipt_passes_with_previous_none_explicit(self) -> None:
        r = generate_receipt("genesis", {"ok": True})
        ok, reason = verify_receipt(r)
        assert ok is True

    def test_chained_receipt_passes_with_previous(self) -> None:
        r1 = generate_receipt("step.1", {"i": 1})
        r2 = generate_receipt("step.2", {"i": 2}, prev_hash=r1.chain_hash)
        ok, reason = verify_receipt(r2, previous_receipt=r1)
        assert ok is True
        assert reason == ""

    def test_fails_on_tampered_payload_hash(self) -> None:
        r = generate_receipt("test", {"original": "data"})
        r.payload_hash = "f" * 64
        ok, reason = verify_receipt(r)
        assert ok is False
        assert "payload_hash mismatch" in reason

    def test_fails_on_tampered_chain_hash(self) -> None:
        r = generate_receipt("test", {"x": 1})
        r.chain_hash = "e" * 64
        ok, reason = verify_receipt(r)
        assert ok is False
        assert "chain_hash mismatch" in reason

    def test_fails_on_broken_link(self) -> None:
        r1 = generate_receipt("step.1", {"i": 1})
        r2 = generate_receipt("step.2", {"i": 2}, prev_hash=r1.chain_hash)
        # Tamper with the first receipt's chain_hash so the link breaks
        r1.chain_hash = "d" * 64
        ok, reason = verify_receipt(r2, previous_receipt=r1)
        assert ok is False
        assert "prev_hash" in reason

    def test_fails_on_tampered_payload(self) -> None:
        payload = {"amount": 100}
        r = generate_receipt("payment", payload)
        r.payload = {"amount": 999}  # tampered
        ok, reason = verify_receipt(r)
        assert ok is False
        assert "payload_hash mismatch" in reason


# ---------------------------------------------------------------------------
# verify_chain tests
# ---------------------------------------------------------------------------


class TestVerifyChain:
    def test_empty_chain_passes(self) -> None:
        ok, reason = verify_chain([])
        assert ok is True
        assert reason == ""

    def test_single_receipt_chain_passes(self) -> None:
        r = generate_receipt("genesis", {"start": True})
        ok, reason = verify_chain([r])
        assert ok is True

    def test_three_link_chain_passes(self) -> None:
        r1 = generate_receipt("start", {"s": 1})
        r2 = generate_receipt("process", {"s": 2}, prev_hash=r1.chain_hash)
        r3 = generate_receipt("finish", {"s": 3}, prev_hash=r2.chain_hash)
        ok, reason = verify_chain([r1, r2, r3])
        assert ok is True
        assert reason == ""

    def test_fails_on_tampered_middle_receipt(self) -> None:
        r1 = generate_receipt("start", {"s": 1})
        r2 = generate_receipt("process", {"s": 2}, prev_hash=r1.chain_hash)
        r3 = generate_receipt("finish", {"s": 3}, prev_hash=r2.chain_hash)
        # Tamper with the middle receipt
        r2.payload_hash = "f" * 64
        ok, reason = verify_chain([r1, r2, r3])
        assert ok is False

    def test_fails_on_tampered_genesis(self) -> None:
        r1 = generate_receipt("start", {"s": 1})
        r2 = generate_receipt("process", {"s": 2}, prev_hash=r1.chain_hash)
        r1.chain_hash = "b" * 64
        ok, reason = verify_chain([r1, r2])
        assert ok is False
        assert "Genesis" in reason

    def test_different_prev_hash_breaks_chain(self) -> None:
        r1 = generate_receipt("step.1", {"i": 1})
        r2 = generate_receipt("step.2", {"i": 2}, prev_hash="x" * 64)
        ok, reason = verify_chain([r1, r2])
        assert ok is False
        assert "prev_hash" in reason


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------


class TestIntegration:
    def test_generate_and_verify_workflow(self) -> None:
        """End-to-end: generate a chain of receipts and verify it."""
        chain: list[WorkflowReceipt] = []
        prev = ""
        steps = [
            ("workflow.start", {"branch": "main", "commit": "abc123"}),
            ("build.started", {"image": "node:20"}),
            ("build.completed", {"status": "success", "duration_ms": 4500}),
            ("test.run", {"passed": 142, "failed": 0, "skipped": 3}),
            ("deploy.started", {"env": "staging"}),
            ("deploy.completed", {"url": "https://staging.example.com"}),
        ]

        for event, payload in steps:
            r = generate_receipt(event, payload, prev_hash=prev)
            chain.append(r)
            prev = r.chain_hash

        assert len(chain) == 6

        # Verify individual receipts
        ok, reason = verify_receipt(chain[0])
        assert ok, reason
        for i in range(1, len(chain)):
            ok, reason = verify_receipt(chain[i], previous_receipt=chain[i - 1])
            assert ok, reason

        # Verify the full chain
        ok, reason = verify_chain(chain)
        assert ok, reason

        # Tampering with any receipt breaks the chain
        chain[3].payload = {"passed": 0, "failed": 999, "skipped": 0}
        ok, reason = verify_chain(chain)
        assert ok is False
        assert "payload_hash mismatch" in reason

    def test_multi_chain_independence(self) -> None:
        """Two independent chains do not interfere."""
        a1 = generate_receipt("workflow.a", {"id": "a"})
        a2 = generate_receipt("workflow.a.2", {"val": 1}, prev_hash=a1.chain_hash)

        b1 = generate_receipt("workflow.b", {"id": "b"})
        b2 = generate_receipt("workflow.b.2", {"val": 2}, prev_hash=b1.chain_hash)

        assert verify_chain([a1, a2]) == (True, "")
        assert verify_chain([b1, b2]) == (True, "")

        # Mixing chains must fail
        ok, reason = verify_chain([a1, b2])
        assert ok is False

    def test_to_dict_roundtrip(self) -> None:
        """to_dict() produces expected data for external consumers."""
        r = generate_receipt("build.pass", {"tests": 99})
        d = r.to_dict()
        assert d["event"] == "build.pass"
        assert d["payload"] == {"tests": 99}
        assert d["chain_hash"] == r.chain_hash
        assert d["prev_hash"] == ""
        assert d["payload_hash"] == r.payload_hash
        assert "created_at" in d
