"""Workflow evidence receipts — verifiable evidence trail for agent lifecycle.

Each receipt captures a cryptographic hash-linked snapshot of an agent
lifecycle transition (pipeline state change, task start/success/failure,
or agent state transition).  Receipts form an append-only chain that can
be exported and verified independently of the audit trail.

Receipt chain::

    receipt_hash = SHA-256(canonical_json(prev_receipt_hash || payload))

where ``prev_receipt_hash`` is the ``receipt_hash`` of the previous receipt
in the same workflow scope (``workflow_id``).  The genesis receipt for a
workflow uses ``prev_receipt_hash = ""``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Receipt model
# ---------------------------------------------------------------------------

# Canonical agent lifecycle transition types
TRANSITION_TYPES = frozenset({
    "pipeline.start",
    "pipeline.cancelled",
    "pipeline.complete",
    "pipeline.failed",
    "pipeline.rework_started",
    "pipeline.rework_exhausted",
    "task.start",
    "task.success",
    "task.failure",
    "agent.state_change",
    "agent.stage_started",
    "agent.stage_completed",
    "agent.verification_passed",
    "agent.verification_failed",
    "agent.error",
})


class EvidenceReceipt(BaseModel):
    """A single verifiable evidence receipt for a workflow transition.

    Each receipt is immutable once created.  The ``receipt_hash``
    cryptographically binds it to the previous receipt in the workflow's
    chain, forming an integrity-protected evidence trail.
    """

    receipt_id: str = Field(
        default_factory=lambda: uuid.uuid4().hex,
        description="Unique receipt identifier (hex UUID4)",
    )
    workflow_id: str = Field(
        ..., description="Workflow / pipeline identifier this receipt belongs to",
    )
    transition: str = Field(
        ..., description="Transition type (e.g. pipeline.start, task.success)",
    )
    agent_state: str = Field(
        ..., description="Agent state at this transition (e.g. starting, triage)",
    )
    previous_state: str | None = Field(
        default=None,
        description="Previous agent state before this transition",
    )
    tenant_id: str = Field(
        default="stas-default",
        description="Tenant or organisation scope",
    )
    issue_id: str | None = Field(
        default=None,
        description="Associated issue identifier, if applicable",
    )
    task_id: str | None = Field(
        default=None,
        description="Celery task identifier, if applicable",
    )
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary structured evidence payload",
    )
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp of the transition",
    )
    prev_receipt_hash: str = Field(
        default="",
        description=(
            "SHA-256 hex digest of the previous receipt in this workflow's "
            "chain.  Empty string for the genesis receipt."
        ),
    )
    receipt_hash: str = Field(
        default="",
        description=(
            "SHA-256 hex digest of this receipt's canonical JSON "
            "(excluding receipt_hash itself).  Computed at creation time."
        ),
    )

    def compute_hash(self) -> str:
        """Compute the SHA-256 hash of this receipt's canonical content."""
        canonical = self._canonical_json()
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def _canonical_json(self) -> str:
        raw = self.model_dump(mode="json")
        raw.pop("receipt_hash", None)
        return json.dumps(raw, sort_keys=True, separators=(",", ":"))

    def verify(self) -> bool:
        return self.receipt_hash == self.compute_hash()


# ---------------------------------------------------------------------------
# Receipt store (thread-safe, in-memory)
# ---------------------------------------------------------------------------


class EvidenceStore:
    """Thread-safe in-memory store for evidence receipts."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._receipts: list[EvidenceReceipt] = []
        self._by_workflow: dict[str, list[EvidenceReceipt]] = defaultdict(list)
        self._by_tenant: dict[str, list[EvidenceReceipt]] = defaultdict(list)

    def append(self, receipt: EvidenceReceipt) -> EvidenceReceipt:
        with self._lock:
            self._receipts.append(receipt)
            self._by_workflow[receipt.workflow_id].append(receipt)
            self._by_tenant[receipt.tenant_id].append(receipt)
        return receipt

    def get_receipts(
        self,
        workflow_id: str | None = None,
        tenant_id: str | None = None,
        *,
        after_id: str | None = None,
        limit: int = 100,
    ) -> list[EvidenceReceipt]:
        with self._lock:
            source: list[EvidenceReceipt]
            if workflow_id:
                source = list(self._by_workflow.get(workflow_id, []))
            elif tenant_id:
                source = list(self._by_tenant.get(tenant_id, []))
            else:
                source = list(self._receipts)
            if after_id is not None:
                idx = self._find_index(source, after_id)
                if idx is not None:
                    source = source[idx + 1:]
            return list(reversed(source))[:limit]

    def get_by_transition(self, transition: str) -> list[EvidenceReceipt]:
        with self._lock:
            return [r for r in self._receipts if r.transition == transition]

    def get_since(self, since: datetime, tenant_id: str | None = None) -> list[EvidenceReceipt]:
        with self._lock:
            source = self._by_tenant.get(tenant_id, []) if tenant_id else self._receipts
            return [r for r in source if r.timestamp >= since]

    def count(self, workflow_id: str | None = None) -> int:
        with self._lock:
            if workflow_id:
                return len(self._by_workflow.get(workflow_id, []))
            return len(self._receipts)

    def clear(self) -> None:
        with self._lock:
            self._receipts.clear()
            self._by_workflow.clear()
            self._by_tenant.clear()

    @staticmethod
    def _find_index(receipts: list[EvidenceReceipt], receipt_id: str) -> int | None:
        for i, r in enumerate(receipts):
            if r.receipt_id == receipt_id:
                return i
        return None


_store: EvidenceStore | None = None
_store_lock = threading.Lock()


def _get_store() -> EvidenceStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = EvidenceStore()
    return _store


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def capture_receipt(
    workflow_id: str,
    transition: str,
    agent_state: str,
    *,
    previous_state: str | None = None,
    tenant_id: str = "stas-default",
    issue_id: str | None = None,
    task_id: str | None = None,
    payload: dict[str, Any] | None = None,
    store: EvidenceStore | None = None,
) -> EvidenceReceipt:
    """Capture an evidence receipt for an agent lifecycle transition.

    Parameters
    ----------
    workflow_id:
        Workflow / pipeline identifier.
    transition:
        Transition type (must be in TRANSITION_TYPES).
    agent_state:
        Current agent state at this transition.
    previous_state:
        Previous agent state before this transition.
    tenant_id:
        Tenant scope.
    issue_id:
        Associated issue identifier.
    task_id:
        Celery task identifier.
    payload:
        Arbitrary structured data to attach as evidence.
    store:
        Override the default store (useful for testing).

    Raises
    ------
    ValueError
        If transition is not in TRANSITION_TYPES.
    """
    if transition not in TRANSITION_TYPES:
        raise ValueError(
            f"Unknown transition {transition!r}. "
            f"Valid types: {sorted(TRANSITION_TYPES)}",
        )

    s = store or _get_store()
    payload = payload or {}

    chain = s.get_receipts(workflow_id=workflow_id, limit=1)
    prev_hash = chain[0].receipt_hash if chain else ""

    receipt = EvidenceReceipt(
        workflow_id=workflow_id,
        transition=transition,
        agent_state=agent_state,
        previous_state=previous_state,
        tenant_id=tenant_id,
        issue_id=issue_id,
        task_id=task_id,
        payload=payload,
        prev_receipt_hash=prev_hash,
    )
    receipt.receipt_hash = receipt.compute_hash()

    s.append(receipt)
    logger.debug(
        "Evidence receipt captured — id=%s workflow=%s transition=%s state=%s hash=%s",
        receipt.receipt_id,
        workflow_id,
        transition,
        agent_state,
        receipt.receipt_hash[:16],
    )
    return receipt


def get_receipts(
    workflow_id: str | None = None,
    tenant_id: str | None = None,
    *,
    after_id: str | None = None,
    limit: int = 100,
    store: EvidenceStore | None = None,
) -> list[EvidenceReceipt]:
    return (store or _get_store()).get_receipts(
        workflow_id=workflow_id,
        tenant_id=tenant_id,
        after_id=after_id,
        limit=limit,
    )


def verify_receipt_chain(
    workflow_id: str,
    *,
    store: EvidenceStore | None = None,
) -> bool:
    """Verify the integrity of the entire receipt chain for a workflow.

    Returns True if the chain is intact.
    """
    s = store or _get_store()
    receipts = s.get_receipts(workflow_id=workflow_id, limit=10_000)
    receipts = list(reversed(receipts))

    if not receipts:
        return True

    expected_prev = ""
    for receipt in receipts:
        if not receipt.verify():
            logger.error("Receipt hash mismatch — id=%s workflow=%s", receipt.receipt_id, workflow_id)
            return False
        if receipt.prev_receipt_hash != expected_prev:
            logger.error(
                "Receipt chain break — id=%s expected_prev=%s got=%s",
                receipt.receipt_id,
                expected_prev,
                receipt.prev_receipt_hash,
            )
            return False
        expected_prev = receipt.receipt_hash

    return True
