"""
Argumentation graph with DF-QuAD strength computation.
"""
from __future__ import annotations

from typing import Optional

from guardrail.epistemic.types import Claim, Constraint, Violation

_STOP_WORDS = {"the", "a", "an", "is", "are", "was", "were", "be", "been",
               "being", "have", "has", "had", "do", "does", "did", "will",
               "would", "could", "should", "may", "might", "shall", "can",
               "to", "of", "in", "for", "on", "with", "at", "by", "from",
               "as", "into", "through", "during", "before", "after", "above",
               "below", "between", "out", "off", "over", "under", "again",
               "further", "then", "once", "here", "there", "when", "where",
               "why", "how", "all", "each", "every", "both", "few", "more",
               "most", "other", "some", "such", "no", "nor", "not", "only",
               "own", "same", "so", "than", "too", "very", "just", "because",
               "and", "but", "or", "if", "while", "that", "this", "these",
               "those", "it", "its", "not"}


def evaluate_constraint(claim: Claim, constraint: Constraint) -> Optional[Violation]:
    constraint_lower = constraint.statement.lower()
    claim_lower = claim.text.lower()

    if constraint_lower in claim_lower:
        return None

    constraint_keywords = {w for w in constraint_lower.split() if w not in _STOP_WORDS and len(w) > 2}
    claim_keywords = {w for w in claim_lower.split() if w not in _STOP_WORDS and len(w) > 2}

    meaningful_overlap = constraint_keywords & claim_keywords

    if not meaningful_overlap:
        return None

    for kw in meaningful_overlap:
        if kw in constraint_lower and kw in claim_lower:
            if constraint_lower not in claim_lower:
                negation = False
                if kw in claim_lower:
                    idx = claim_lower.index(kw)
                    before = claim_lower[max(0, idx - 20):idx]
                    if any(neg in before for neg in ("not ", "n't ", "no ", "never ", "without ")):
                        negation = True
                if negation:
                    return None
                return Violation(
                    constraint_id=constraint.id,
                    claim=claim,
                    strength=0.6,
                    severity=constraint.severity,
                    explanation=(
                        f"Claim may contradict '{constraint.id}': "
                        f"'{constraint.statement}'"
                    ),
                )

    return None


def compute_dfquad_strength(
    claim: Claim,
    constraint: Constraint,
    violations: list[Violation],
) -> float:
    base = 1.0
    supported_strength = 0.0
    attacked_strength = 0.0

    for other_id in constraint.supported_by:
        for v in violations:
            if v.constraint_id == other_id:
                supported_strength = max(supported_strength, v.strength)

    for other_id in constraint.attacked_by:
        for v in violations:
            if v.constraint_id == other_id:
                attacked_strength = max(attacked_strength, v.strength)

    if supported_strength > 0:
        base = base + (1 - base) * supported_strength
    if attacked_strength > 0:
        base = base * (1 - attacked_strength)

    return max(0.0, min(1.0, base))
