from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class EventSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class EventType(str, Enum):
    TASK_DISPATCHED = "task_dispatched"
    AGENT_STARTED = "agent_started"
    AGENT_COMPLETED = "agent_completed"
    VERIFICATION_PASS = "verification_pass"
    VERIFICATION_FAIL = "verification_fail"
    SELF_AUDIT_COMPLETED = "self_audit_completed"
    REVIEW_VERDICT = "review_verdict"
    PR_MERGED = "pr_merged"
    QUALITY_SCORE_CHANGE = "quality_score_change"
    PIPELINE_STAGE = "pipeline_stage"
    BUDGET_EXCEEDED = "budget_exceeded"
    ESCALATION_TRIGGERED = "escalation_triggered"
    POLICY_EVALUATION = "policy_evaluation"


@dataclass
class AuditEvent:
    event_id: str
    prev_hash: str
    sha256_hash: str
    timestamp: str
    severity: EventSeverity
    event_type: EventType | str
    payload: dict[str, Any]
    scope: str = ""

    def verify_chain(self, prev_event: AuditEvent | None) -> bool:
        if prev_event is None:
            return self.prev_hash == "0" * 64
        expected_hash = _compute_hash(prev_event)
        return self.prev_hash == expected_hash

    def compute_hash(self) -> str:
        return _compute_hash(self)


def _compute_hash(event: AuditEvent) -> str:
    canonical = json.dumps({
        "event_id": event.event_id,
        "prev_hash": event.prev_hash,
        "timestamp": event.timestamp,
        "severity": event.severity.value if isinstance(event.severity, EventSeverity) else event.severity,
        "event_type": event.event_type.value if isinstance(event.event_type, EventType) else event.event_type,
        "payload": event.payload,
        "scope": event.scope,
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class PolicyEvaluation:
    policy_id: str
    policy_name: str
    passed: bool
    scope: str
    event_type: str
    details: str = ""
    evaluated_at: str = ""


@dataclass
class ScopeScore:
    scope: str
    score: float
    passed_count: int
    total_count: int
    score_trend: str = "stable"
