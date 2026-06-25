from __future__ import annotations

import logging

from celery import shared_task

from workers.audit import AuditTrail, PolicyEngine, ComplianceScorer, DriftDetector, AuditExporter
from workers.audit.models import EventSeverity, EventType

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.audit.append_audit_event",
)
def append_audit_event(
    self,
    event_type: str,
    severity: str,
    payload: dict,
    scope: str = "",
) -> dict:
    trail = AuditTrail()
    event = trail.append_event(event_type, EventSeverity(severity), payload, scope)
    return {
        "event_id": event.event_id,
        "sha256_hash": event.sha256_hash,
        "prev_hash": event.prev_hash,
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.audit.verify_chain",
)
def verify_chain(self, limit: int = 100) -> dict:
    trail = AuditTrail()
    violations = trail.verify_chain(limit)
    return {"violations": violations, "violation_count": len(violations)}


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.audit.evaluate_policy",
)
def evaluate_policy(self, event_type: str, payload: dict, scope: str = "") -> dict:
    engine = PolicyEngine()
    results = engine.evaluate(event_type, payload, scope)
    return {
        "evaluations": [
            {
                "policy_id": r.policy_id,
                "passed": r.passed,
                "details": r.details,
            }
            for r in results
        ]
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.audit.compute_compliance_score",
)
def compute_compliance_score(self, scope: str = "", window_hours: int = 24) -> dict:
    scorer = ComplianceScorer()
    score = scorer.compute_score(scope, window_hours)
    return {
        "scope": score.scope,
        "score": score.score,
        "passed_count": score.passed_count,
        "total_count": score.total_count,
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    name="workers.tasks.audit.check_drift",
)
def check_drift(self, scope: str = "") -> dict:
    detector = DriftDetector()
    return detector.check_drift(scope)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.audit.prune_audit_trail",
)
def prune_audit_trail(self, retention_days: int = 90) -> dict:
    trail = AuditTrail()
    deleted = trail.prune(retention_days)
    return {"deleted": deleted, "retention_days": retention_days}
