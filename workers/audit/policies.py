from __future__ import annotations

import json
import logging
from typing import Any

from workers.audit.models import PolicyEvaluation
from workers.audit.trail import AuditTrail

logger = logging.getLogger(__name__)

DEFAULT_POLICIES: list[dict[str, Any]] = [
    {
        "id": "retry_limit",
        "name": "Retry Limit Policy",
        "description": "No task should exceed max retries",
        "event_type": "task_dispatched",
        "condition": lambda p: p.get("retry_count", 0) <= 5,
        "severity": "error",
    },
    {
        "id": "verification_gate",
        "name": "Verification Gate Policy",
        "description": "Every fix must pass verification",
        "event_type": "verification_fail",
        "condition": lambda p: False,
        "severity": "critical",
    },
    {
        "id": "budget_compliance",
        "name": "Budget Compliance Policy",
        "description": "Budget should not be exceeded",
        "event_type": "budget_exceeded",
        "condition": lambda p: False,
        "severity": "critical",
    },
    {
        "id": "score_minimum",
        "name": "Minimum Quality Score",
        "description": "Quality score should stay above threshold",
        "event_type": "quality_score_change",
        "condition": lambda p: p.get("new_score", 1.0) >= 0.5,
        "severity": "warning",
    },
]


class PolicyEngine:
    def __init__(self, policies: list[dict[str, Any]] | None = None) -> None:
        self._policies = policies or DEFAULT_POLICIES
        self._trail = AuditTrail()

    def evaluate(self, event_type: str, payload: dict[str, Any], scope: str = "") -> list[PolicyEvaluation]:
        results: list[PolicyEvaluation] = []
        for policy in self._policies:
            if policy["event_type"] != event_type:
                continue
            try:
                passed = policy["condition"](payload)
            except Exception:
                passed = False

            evaluation = PolicyEvaluation(
                policy_id=policy["id"],
                policy_name=policy["name"],
                passed=passed,
                scope=scope,
                event_type=event_type,
                details=f"Policy {'passed' if passed else 'failed'}: {policy['description']}",
            )
            results.append(evaluation)

            if not passed:
                logger.warning(
                    "Policy violation: %s (scope=%s, type=%s)",
                    policy["name"],
                    scope,
                    event_type,
                )

                from workers.audit.models import EventSeverity, EventType
                self._trail.append_event(
                    EventType.POLICY_EVALUATION,
                    EventSeverity(policy.get("severity", "warning")),
                    {
                        "policy_id": policy["id"],
                        "policy_name": policy["name"],
                        "passed": False,
                        "event_type": event_type,
                        "payload_summary": json.dumps(payload)[:200],
                    },
                    scope,
                )

        return results
