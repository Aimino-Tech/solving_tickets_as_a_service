"""
Cost analyzer — per-fix cost analysis and optimal model routing (AIM-2083).

Analyses the cost of each fix run by model, task type, and complexity.
Provides recommendations for optimal model routing: cheap/fast models for
simple fixes, expensive/best models only for complex fixes where they add
meaningful value.

-- Model Routing Strategy ------------------------------------------------------
  Simple fixes (< 100 lines changed, single file, well-understood pattern):
    → gpt-4o-mini ($0.05/fix avg)  — 99% pass rate on simple tasks

  Medium fixes (multi-file, some investigation needed):
    → deepseek-v4-flash ($0.15/fix) or gpt-4o ($0.50/fix)

  Complex fixes (deep reasoning, architecture changes, multiple attempts):
    → claude-sonnet-4 or claude-opus ($2.00-3.00/fix)

  Expected savings: 40-60% reduction in average cost per fix.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field, asdict
from typing import Any

from workers.billing.unit_economics import (
    DEFAULT_AVG_COST_PER_FIX_CENTS,
    MODEL_COST_TABLE,
    ModelCost,
    select_model_for_fix,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Complexity detection
# ---------------------------------------------------------------------------

# Indicators that a fix is complex
_COMPLEX_INDICATORS: list[str] = [
    r"\barchitect", r"\brefactor", r"\bredesign", r"\bmigrate",
    r"\bmulti[-\s]?file", r"\bcross[-\s]?cutting",
    r"\bdependency\s+upgrade", r"\bbreaking\s+change",
    r"\bperformance\s+optimiz", r"\bsecurity\s+fix",
    r"\bapi\s+change", r"\bdatabase\s+change", r"\bschema\s+migration",
]

# Indicators that a fix is simple
_SIMPLE_INDICATORS: list[str] = [
    r"\btypo", r"\bspelling", r"\brename", r"\bnit\b",
    r"\border\s+of\s+operations", r"\bsimple\s+fix",
    r"\bimport\s+(fix|error|issue)", r"\bcrash\s+on\s+null",
    r"\bmissing\s+(import|export|return|await|check)",
    r"\bminor\b", r"\btrivial\b", r"\bcosmetic\b",
    r"\bvalue\s+out\s+of\s+range", r"\bindex\s+error",
]

# Per-model complexity capability (can this model handle this complexity?)
_MODEL_CAPABILITY: dict[str, set[str]] = {
    "gpt-4o-mini": {"simple", "medium"},
    "claude-3-haiku": {"simple", "medium"},
    "gemini-2.0-flash": {"simple", "medium"},
    "deepseek-v4-flash": {"simple", "medium", "complex"},
    "gpt-4o": {"simple", "medium", "complex"},
    "claude-3.5-sonnet": {"simple", "medium", "complex"},
    "claude-sonnet-4-20250514": {"simple", "medium", "complex"},
    "gpt-5.2-codex": {"simple", "medium", "complex"},
    "gpt-5.5-deepswe": {"medium", "complex"},
    "claude-opus-4-20250514": {"complex"},
    "claude-opus-4.5": {"complex"},
    "stas-agi": {"simple", "medium", "complex"},
}


@dataclass
class ComplexityAnalysis:
    """Result of analysing fix complexity."""

    complexity: str  # simple | medium | complex
    score: float  # 0.0 (simple) to 1.0 (complex)
    indicators: list[str] = field(default_factory=list)
    file_count: int = 0
    estimated_changes_lines: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def analyze_complexity(
    issue_title: str = "",
    issue_body: str = "",
    file_count: int = 0,
    estimated_lines: int = 0,
    triage_category: str = "unknown",
    triage_scope: str = "small",
) -> ComplexityAnalysis:
    """Analyse the complexity of a fix from issue context.

    Examines the issue title, body, file count, estimated lines changed,
    and triage results to determine whether this is a simple, medium,
    or complex fix.

    Parameters
    ----------
    issue_title : str
        The issue title.
    issue_body : str
        The issue body / description.
    file_count : int
        Estimated number of files that need changes.
    estimated_lines : int
        Estimated lines of code that need changes.
    triage_category : str
        Category from triage (bug, feature, question).
    triage_scope : str
        Scope from triage (small, medium, large).

    Returns
    -------
    ComplexityAnalysis
        Complexity classification with evidence.
    """
    combined = f"{issue_title} {issue_body}".lower()
    indicators: list[str] = []

    # Check complex indicators
    complex_score = 0
    for pattern in _COMPLEX_INDICATORS:
        if re.search(pattern, combined, re.IGNORECASE):
            complex_score += 1
            indicators.append(f"complex: {pattern.strip('\\b')}")

    # Check simple indicators
    simple_score = 0
    for pattern in _SIMPLE_INDICATORS:
        if re.search(pattern, combined, re.IGNORECASE):
            simple_score += 1
            indicators.append(f"simple: {pattern.strip('\\b')}")

    # Structural signals
    if file_count <= 1:
        simple_score += 1
        indicators.append("simple: single file")
    elif file_count >= 5:
        complex_score += 1
        indicators.append("complex: 5+ files")

    if estimated_lines <= 20:
        simple_score += 1
        indicators.append("simple: ≤20 lines")
    elif estimated_lines >= 200:
        complex_score += 1
        indicators.append("complex: 200+ lines")

    if triage_scope == "small":
        simple_score += 1
    elif triage_scope == "large":
        complex_score += 1

    # Score: normalize to 0-1 where 0=simple, 1=complex
    total = simple_score + complex_score
    if total == 0:
        normalized = 0.5  # unknown mid-point
    else:
        normalized = complex_score / total

    # Classify
    if normalized < 0.3:
        complexity = "simple"
    elif normalized < 0.6:
        complexity = "medium"
    else:
        complexity = "complex"

    return ComplexityAnalysis(
        complexity=complexity,
        score=round(normalized, 2),
        indicators=indicators[:10],
        file_count=file_count,
        estimated_changes_lines=estimated_lines,
    )


# ---------------------------------------------------------------------------
# Model routing
# ---------------------------------------------------------------------------


@dataclass
class ModelRecommendation:
    """Recommended model for a fix with cost estimates."""

    model_name: str
    complexity: str
    tier: str
    estimated_cost_cents: float = 0.0
    estimated_duration_seconds: int = 0
    capable: bool = True
    alternatives: list[str] = field(default_factory=list)
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def estimate_model_cost(
    model_name: str,
    estimated_input_tokens: int = 4_000,
    estimated_output_tokens: int = 1_000,
) -> float:
    """Estimate the cost of running a model for a fix.

    Parameters
    ----------
    model_name : str
        Model name to estimate cost for.
    estimated_input_tokens : int
        Expected input token count.
    estimated_output_tokens : int
        Expected output token count.

    Returns
    -------
    float
        Estimated cost in cents.
    """
    cost = ModelCost.compute(model_name, estimated_input_tokens, estimated_output_tokens)
    return cost.total_cost_cents


def recommend_model(
    tier: str,
    complexity: str,
    estimated_input_tokens: int = 4_000,
    estimated_output_tokens: int = 1_000,
    cost_cap_cents: float | None = None,
) -> ModelRecommendation:
    """Recommend the optimal model for a fix.

    Considers tier, complexity, token budget, and cost cap to recommend
    the best value model.

    Parameters
    ----------
    tier : str
        Tenant's plan tier.
    complexity : str
        Fix complexity (simple | medium | complex).
    estimated_input_tokens : int
        Expected input tokens.
    estimated_output_tokens : int
        Expected output tokens.
    cost_cap_cents : float | None
        Maximum allowed cost in cents. If None, uses tier default.

    Returns
    -------
    ModelRecommendation
        Recommended model with cost estimate.
    """
    from workers.billing.unit_economics import get_cost_cap_cents

    cap = cost_cap_cents if cost_cap_cents is not None else get_cost_cap_cents(tier)

    # Get primary recommendation from routing table
    primary = select_model_for_fix(tier, complexity)

    # Check if primary is capable of this complexity
    capable = complexity in _MODEL_CAPABILITY.get(primary, {"simple", "medium"})

    # Estimate cost
    estimated_cost = estimate_model_cost(primary, estimated_input_tokens, estimated_output_tokens)

    # Find alternatives (models that can handle this complexity for this tier)
    alternatives: list[str] = []
    for model, capabilities in _MODEL_CAPABILITY.items():
        if model != primary and complexity in capabilities:
            alt_cost = estimate_model_cost(model, estimated_input_tokens, estimated_output_tokens)
            if alt_cost <= cap:
                alternatives.append(model)

    # Build reason
    reason_parts: list[str] = []
    if capable:
        reason_parts.append(f"Model can handle {complexity} complexity")
    else:
        reason_parts.append(f"Warning: model may struggle with {complexity} complexity")

    cost_str = f"${estimated_cost / 100:.4f}"
    cap_str = f"${cap / 100:.2f}"
    reason_parts.append(f"Est. cost {cost_str} (cap {cap_str})")
    reason_parts.append(f"Tier: {tier}")

    return ModelRecommendation(
        model_name=primary,
        complexity=complexity,
        tier=tier,
        estimated_cost_cents=round(estimated_cost, 4),
        estimated_duration_seconds=_estimate_duration(complexity),
        capable=capable,
        alternatives=alternatives[:5],
        reason=" — ".join(reason_parts),
    )


def _estimate_duration(complexity: str) -> int:
    """Estimate fix duration in seconds based on complexity."""
    estimates = {
        "simple": 30,
        "medium": 120,
        "complex": 600,
    }
    return estimates.get(complexity, 120)


# ---------------------------------------------------------------------------
# Cost analysis (post-hoc)
# ---------------------------------------------------------------------------


@dataclass
class FixCostAnalysis:
    """Detailed cost analysis for one or more fix runs."""

    total_runs: int = 0
    total_cost_cents: float = 0.0
    avg_cost_cents: float = 0.0
    min_cost_cents: float = 0.0
    max_cost_cents: float = 0.0
    by_model: dict[str, float] = field(default_factory=dict)
    by_complexity: dict[str, float] = field(default_factory=dict)
    by_tier: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def analyze_fix_costs(records: list[dict[str, Any]]) -> FixCostAnalysis:
    """Analyse a batch of fix cost records and produce summary statistics.

    Parameters
    ----------
    records : list[dict]
        List of fix cost records (FixCostRecord.to_dict() format).

    Returns
    -------
    FixCostAnalysis
        Aggregated cost analysis broken down by model, complexity, tier.
    """
    if not records:
        return FixCostAnalysis()

    total = len(records)
    costs = [r.get("total_cost_cents", 0) for r in records]
    total_cost = sum(costs)
    avg_cost = total_cost / total if total > 0 else 0.0
    min_cost = min(costs) if costs else 0.0
    max_cost = max(costs) if costs else 0.0

    by_model: dict[str, float] = {}
    by_complexity: dict[str, float] = {}
    by_tier: dict[str, float] = {}

    for record in records:
        model = record.get("model_name", "unknown")
        by_model[model] = by_model.get(model, 0) + record.get("total_cost_cents", 0)

        comp = record.get("complexity", "unknown")
        by_complexity[comp] = by_complexity.get(comp, 0) + record.get("total_cost_cents", 0)

        tier = record.get("tier", "free")
        by_tier[tier] = by_tier.get(tier, 0) + record.get("total_cost_cents", 0)

    return FixCostAnalysis(
        total_runs=total,
        total_cost_cents=round(total_cost, 2),
        avg_cost_cents=round(avg_cost, 4),
        min_cost_cents=round(min_cost, 4),
        max_cost_cents=round(max_cost, 4),
        by_model=by_model,
        by_complexity=by_complexity,
        by_tier=by_tier,
    )


# ---------------------------------------------------------------------------
# Savings projection
# ---------------------------------------------------------------------------


@dataclass
class SavingsProjection:
    """Projected savings from optimal model routing."""

    current_avg_cost_cents: float
    recommended_avg_cost_cents: float
    savings_per_fix_cents: float
    savings_per_fix_dollars: float
    savings_percent: float
    monthly_savings_cents: float = 0.0
    monthly_savings_dollars: float = 0.0
    fixes_per_month: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def project_savings(
    tier: str,
    fixes_per_month: int,
    current_model: str = "claude-opus-4-20250514",
    estimated_input_tokens: int = 8_000,
    estimated_output_tokens: int = 3_000,
) -> SavingsProjection:
    """Project cost savings from routing to optimal models.

    Compares the cost of using an expensive model for everything vs routing
    based on complexity.

    Parameters
    ----------
    tier : str
        Tenant's plan tier.
    fixes_per_month : int
        Number of fixes per month.
    current_model : str
        The model currently used for all fixes.
    estimated_input_tokens : int
        Average input tokens per fix.
    estimated_output_tokens : int
        Average output tokens per fix.

    Returns
    -------
    SavingsProjection
        Projected savings from optimal routing.
    """
    # Current cost: expensive model for everything
    current_cost = estimate_model_cost(current_model, estimated_input_tokens, estimated_output_tokens)

    # With routing: assume mix of 40% simple, 40% medium, 20% complex
    simple_model = select_model_for_fix(tier, "simple")
    medium_model = select_model_for_fix(tier, "medium")
    complex_model = select_model_for_fix(tier, "complex")

    simple_cost = estimate_model_cost(simple_model, int(estimated_input_tokens * 0.5), int(estimated_output_tokens * 0.3))
    medium_cost = estimate_model_cost(medium_model, estimated_input_tokens, estimated_output_tokens)
    complex_cost = estimate_model_cost(complex_model, int(estimated_input_tokens * 1.5), int(estimated_output_tokens * 1.2))

    blended_cost = simple_cost * 0.4 + medium_cost * 0.4 + complex_cost * 0.2
    savings_per_fix = current_cost - blended_cost
    savings_pct = (savings_per_fix / current_cost * 100.0) if current_cost > 0 else 0.0

    return SavingsProjection(
        current_avg_cost_cents=round(current_cost, 4),
        recommended_avg_cost_cents=round(blended_cost, 4),
        savings_per_fix_cents=round(savings_per_fix, 4),
        savings_per_fix_dollars=round(savings_per_fix / 100.0, 4),
        savings_percent=round(savings_pct, 2),
        monthly_savings_cents=round(savings_per_fix * fixes_per_month, 2),
        monthly_savings_dollars=round(savings_per_fix * fixes_per_month / 100.0, 2),
        fixes_per_month=fixes_per_month,
    )
