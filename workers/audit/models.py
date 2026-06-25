"""Audit event models for the SHA-256 chained compliance trail."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class AuditEvent(BaseModel):
    """A single event in the append-only SHA-256 chained audit log.

    Each event carries the hash of the previous event in the chain,
    forming an immutable integrity-protected trail.
    """

    id: str = Field(
        default_factory=lambda: uuid.uuid4().hex,
        description="Unique event identifier (hex UUID4)",
    )
    tenant_id: str = Field(
        ..., description="Tenant or organisation scope for the event"
    )
    event_type: str = Field(
        ..., description="Categorical event type (e.g. pipeline.start, task.failure)"
    )
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary structured payload attached to the event",
    )
    payload_hash: str = Field(
        ..., description="SHA-256 hex digest of the canonical JSON payload"
    )
    prev_hash: str = Field(
        default="",
        description=(
            "SHA-256 hex digest of the previous event in the chain. "
            "Empty string for the genesis event."
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp of event creation",
    )

    def chain_hash(self) -> str:
        """Compute the SHA-256 hash of this event for the next link.

        The hash input is ``prev_hash || payload_hash`` concatenated
        as raw hex strings — the same format used by ``append_event``
        to compute the link.
        """
        import hashlib

        raw = (self.prev_hash + self.payload_hash).encode("ascii")
        return hashlib.sha256(raw).hexdigest()

    def model_dump_canonical(self) -> str:
        """Return a deterministic JSON representation for hashing.

        Uses ``serialise_as_json=False`` and sorted keys so the same
        logical event always produces the same hash.
        """
        return self.model_dump_json(
            exclude={"id", "created_at"},
            by_alias=True,
            indent=None,
            separators=(",", ":"),
        )


class PolicyVerdict(BaseModel):
    """Result of evaluating a single policy rule against an audit event."""

    rule_name: str = Field(..., description="Name of the evaluated rule")
    passed: bool = Field(..., description="Whether the event satisfied the rule")
    reason: str = Field(default="", description="Human-readable explanation")
    severity: str = Field(
        default="info",
        description="Severity level: critical, warning, info",
    )


class ComplianceScore(BaseModel):
    """Aggregate compliance score computed over a set of audit events."""

    score: float = Field(..., ge=0.0, le=1.0, description="Overall compliance 0–1")
    total_events: int = Field(..., ge=0, description="Number of events evaluated")
    passed_events: int = Field(..., ge=0, description="Events that passed all policies")
    failed_events: int = Field(..., ge=0, description="Events that violated at least one policy")
    weight_breakdown: dict[str, float] = Field(
        default_factory=dict,
        description="Per-category weighted contributions",
    )


class DriftReport(BaseModel):
    """Report detailing drift between two compliance snapshots."""

    previous_score: float = Field(..., ge=0.0, le=1.0)
    current_score: float = Field(..., ge=0.0, le=1.0)
    score_change: float = Field(..., description="Absolute change (current - previous)")
    fail_rate_previous: float = Field(..., ge=0.0, le=1.0)
    fail_rate_current: float = Field(..., ge=0.0, le=1.0)
    anomaly_detected: bool = Field(
        default=False,
        description="Whether anomalous drift was flagged",
    )
    anomaly_reason: str = Field(default="", description="Explanation if anomalous")
