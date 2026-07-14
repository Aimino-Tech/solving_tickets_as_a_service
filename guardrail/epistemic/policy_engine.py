"""
Policy engine: evaluates claims against epistemic constraints.
"""
from __future__ import annotations

from guardrail.epistemic.types import (
    Claim,
    Constraint,
    Decision,
    EpistemicResult,
    Severity,
    Violation,
)
from guardrail.epistemic.argumentation import evaluate_constraint, compute_dfquad_strength


_DECISION_THRESHOLD_WARN = 0.5
_DECISION_THRESHOLD_BLOCK = 0.8


def evaluate_claims(
    claims: list[Claim],
    constraints: list[Constraint],
) -> EpistemicResult:
    violations: list[Violation] = []
    for claim in claims:
        for constraint in constraints:
            violation = evaluate_constraint(claim, constraint)
            if violation is not None:
                strength = compute_dfquad_strength(claim, constraint, violations)
                violation.strength = strength
                violations.append(violation)

    max_strength = max((v.strength for v in violations), default=0.0)

    if max_strength >= _DECISION_THRESHOLD_BLOCK:
        decision = Decision.BLOCK
    elif max_strength >= _DECISION_THRESHOLD_WARN:
        decision = Decision.WARN
    else:
        decision = Decision.ALLOW

    return EpistemicResult(
        claims=claims,
        violations=violations,
        decision=decision,
        confidence=1.0 - max_strength,
    )
