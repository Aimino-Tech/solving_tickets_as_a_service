"""Compliance scoring via weighted ratio.

The compliance score is computed as::

    score = sum(w_i * pass_rate_i) / sum(w_i)

where *w_i* is the weight for a policy category and *pass_rate_i* is
the fraction of events in that category that passed all applicable rules.
"""

from __future__ import annotations

from collections import defaultdict

from workers.audit.models import AuditEvent, ComplianceScore, PolicyVerdict

DEFAULT_CATEGORY_WEIGHTS: dict[str, float] = {
    "integrity": 0.35,
    "policy": 0.25,
    "verification": 0.20,
    "lifecycle": 0.10,
    "export": 0.10,
}


def _categorise_event(event: AuditEvent) -> str:
    if event.event_type.startswith("audit."):
        return "integrity"
    if event.event_type.startswith("verification."):
        return "verification"
    if event.event_type.startswith(("pipeline.", "task.")):
        return "lifecycle"
    if event.event_type.startswith("export."):
        return "export"
    return "policy"


def compute_score(
    events: list[AuditEvent],
    verdicts: list[list[PolicyVerdict]] | None = None,
    weights: dict[str, float] | None = None,
) -> ComplianceScore:
    w = weights or DEFAULT_CATEGORY_WEIGHTS
    n = len(events)

    if n == 0:
        return ComplianceScore(
            score=1.0,
            total_events=0,
            passed_events=0,
            failed_events=0,
            weight_breakdown={k: 0.0 for k in w},
        )

    if verdicts is None:
        return ComplianceScore(
            score=1.0,
            total_events=n,
            passed_events=n,
            failed_events=0,
            weight_breakdown={k: w.get(k, 0.0) for k in w},
        )

    category_total: dict[str, int] = defaultdict(int)
    category_pass: dict[str, int] = defaultdict(int)

    for event, ev_verdicts in zip(events, verdicts):
        cat = _categorise_event(event)
        category_total[cat] += 1
        if all(v.passed for v in ev_verdicts):
            category_pass[cat] += 1

    weight_total = 0.0
    weighted_sum = 0.0
    weight_breakdown: dict[str, float] = {}

    for cat, weight in w.items():
        total = category_total.get(cat, 0)
        passed = category_pass.get(cat, 0)
        if total == 0:
            weight_breakdown[cat] = 0.0
            continue
        pass_rate = passed / total
        contribution = weight * pass_rate
        weighted_sum += contribution
        weight_total += weight
        weight_breakdown[cat] = contribution

    score = weighted_sum / weight_total if weight_total > 0 else 1.0

    total_passed = sum(category_pass.values())
    total_failed = n - total_passed

    return ComplianceScore(
        score=round(score, 6),
        total_events=n,
        passed_events=total_passed,
        failed_events=total_failed,
        weight_breakdown=weight_breakdown,
    )
