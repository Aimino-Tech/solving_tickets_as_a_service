from __future__ import annotations

import logging
from typing import Any

from workers.audit.models import PolicyEvaluation, ScopeScore
from workers.audit.policies import PolicyEngine
from workers.audit.trail import AuditTrail

logger = logging.getLogger(__name__)


class ComplianceScorer:
    def __init__(self) -> None:
        self._trail = AuditTrail()
        self._policies = PolicyEngine()

    def compute_score(self, scope: str = "", window_hours: int = 24) -> ScopeScore:
        from datetime import datetime, timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).isoformat()

        evaluations = self._trail.get_events(
            event_type="policy_evaluation",
            scope=scope,
            limit=5000,
        )

        passed_count = 0
        total_count = 0

        for event in evaluations:
            if event.timestamp < cutoff:
                continue
            total_count += 1
            payload = event.payload
            if payload.get("passed", False):
                passed_count += 1

        score = passed_count / total_count if total_count > 0 else 1.0

        return ScopeScore(
            scope=scope or "global",
            score=round(score, 4),
            passed_count=passed_count,
            total_count=total_count,
        )
