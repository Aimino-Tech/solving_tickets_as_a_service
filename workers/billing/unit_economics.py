"""
Unit economics — fix negative margin on paying tiers (AIM-2083).

Provides cost models, cost caps, tier rebalancing and pricing recommendations
to ensure every paying tier is profitable.

-- Problem ---------------------------------------------------------------------
  Solo:  $350 cost for $49  revenue  (-$301/mo, margin -614%)
  Team:  $1,750 cost for $149 revenue  (-$1,601/mo, margin -1074%)

-- Solution --------------------------------------------------------------------
  1. Cost model — track actual LLM cost per fix per model so we can bill accurately.
  2. Cost caps — limit max tokens per fix and route simple fixes to cheaper models.
  3. Tier rebalancing — adjust included fixes or pricing so every tier is profitable
     at the average per-fix cost.

-- Target margins --------------------------------------------------------------
  Solo:   target 70%+ gross margin
  Team:   target 75%+ gross margin
  Enterprise: target 80%+ gross margin (custom pricing)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from typing import Any

logger = logging.getLogger(__name__)

MODEL_COST_TABLE: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.015, 0.06),
    "claude-3-haiku": (0.025, 0.125),
    "gemini-2.0-flash": (0.01, 0.04),
    "gpt-4o": (0.25, 1.0),
    "claude-3.5-sonnet": (0.3, 1.5),
    "claude-sonnet-4-20250514": (1.0, 5.0),
    "deepseek-v4-flash": (0.05, 0.2),
    "gpt-5.2-codex": (1.5, 6.0),
    "gpt-5.5-deepswe": (2.0, 8.0),
    "claude-opus-4-20250514": (1.5, 7.5),
    "claude-opus-4.5": (3.0, 15.0),
    "syntaro-agi": (0.5, 2.0),
}


@dataclass
class ModelCost:
    """Cost to run one model query (input + output)."""

    model_name: str
    input_tokens: int = 0
    output_tokens: int = 0
    input_cost_cents: float = 0.0
    output_cost_cents: float = 0.0
    total_cost_cents: float = 0.0

    @classmethod
    def compute(cls, model_name: str, input_tokens: int, output_tokens: int) -> ModelCost:
        rates = MODEL_COST_TABLE.get(model_name)
        if rates is None:
            logger.warning("Unknown model %r — assuming $0 cost", model_name)
            return cls(model_name=model_name, input_tokens=input_tokens, output_tokens=output_tokens)

        input_rate, output_rate = rates
        input_cost = (input_tokens / 1000) * input_rate
        output_cost = (output_tokens / 1000) * output_rate
        total = input_cost + output_cost

        return cls(
            model_name=model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            input_cost_cents=round(input_cost, 4),
            output_cost_cents=round(output_cost, 4),
            total_cost_cents=round(total, 4),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class FixCostRecord:
    """Complete cost breakdown for a single fix run."""

    fix_id: str
    tenant_id: str
    tier: str
    model_name: str
    model_cost_cents: float = 0.0
    sandbox_cost_cents: int = 0
    overhead_cents: int = 0
    total_cost_cents: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    complexity: str = "unknown"
    duration_seconds: int = 0

    def compute_margin(self, monthly_revenue_cents: int, fixes_per_month: int) -> float:
        if fixes_per_month <= 0:
            return 0.0
        revenue_per_fix = monthly_revenue_cents / fixes_per_month
        if revenue_per_fix <= 0:
            return -100.0
        margin = (revenue_per_fix - self.total_cost_cents) / revenue_per_fix * 100.0
        return round(margin, 2)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


TIER_COST_CAP_CENTS: dict[str, float] = {
    "free": 50.0,
    "solo": 350.0,
    "team": 500.0,
    "enterprise": 2000.0,
}

TIER_MAX_OUTPUT_TOKENS: dict[str, int] = {
    "free": 4_000,
    "solo": 8_000,
    "team": 16_000,
    "enterprise": 32_000,
}

TIER_MAX_INPUT_TOKENS: dict[str, int] = {
    "free": 16_000,
    "solo": 32_000,
    "team": 64_000,
    "enterprise": 128_000,
}

TIER_MODEL_ROUTING: dict[tuple[str, str], str] = {
    ("free", "simple"): "gpt-4o-mini",
    ("free", "medium"): "gpt-4o-mini",
    ("free", "complex"): "gpt-4o",
    ("solo", "simple"): "gpt-4o-mini",
    ("solo", "medium"): "deepseek-v4-flash",
    ("solo", "complex"): "gpt-4o",
    ("team", "simple"): "deepseek-v4-flash",
    ("team", "medium"): "claude-3.5-sonnet",
    ("team", "complex"): "claude-opus-4-20250514",
    ("enterprise", "simple"): "gpt-4o",
    ("enterprise", "medium"): "claude-sonnet-4-20250514",
    ("enterprise", "complex"): "claude-opus-4-20250514",
}


def get_cost_cap_cents(tier: str) -> float:
    return TIER_COST_CAP_CENTS.get(tier, TIER_COST_CAP_CENTS["free"])


def get_max_output_tokens(tier: str) -> int:
    return TIER_MAX_OUTPUT_TOKENS.get(tier, TIER_MAX_OUTPUT_TOKENS["free"])


def get_max_input_tokens(tier: str) -> int:
    return TIER_MAX_INPUT_TOKENS.get(tier, TIER_MAX_INPUT_TOKENS["free"])


def select_model_for_fix(tier: str, complexity: str) -> str:
    model = TIER_MODEL_ROUTING.get((tier, complexity))
    if model:
        return model
    for key, mdl in TIER_MODEL_ROUTING.items():
        if key[0] == tier:
            return mdl
    return "deepseek-v4-flash"


def is_within_cost_cap(tier: str, estimated_cost_cents: float) -> bool:
    cap = get_cost_cap_cents(tier)
    return estimated_cost_cents <= cap


@dataclass
class TierEconomics:
    tier_name: str
    monthly_price_cents: int
    fixes_included: int
    avg_cost_per_fix_cents: float
    monthly_cost_cents: float = 0.0
    monthly_revenue_cents: int = 0
    gross_margin_pct: float = 0.0
    is_profitable: bool = False

    def __post_init__(self) -> None:
        if self.fixes_included > 0:
            self.monthly_cost_cents = round(self.avg_cost_per_fix_cents * self.fixes_included, 2)
        else:
            self.monthly_cost_cents = 0.0
        self.monthly_revenue_cents = self.monthly_price_cents
        revenue = float(self.monthly_revenue_cents)
        if revenue > 0:
            self.gross_margin_pct = round(
                (revenue - self.monthly_cost_cents) / revenue * 100.0, 2
            )
        else:
            self.gross_margin_pct = -100.0
        self.is_profitable = self.gross_margin_pct >= 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


DEFAULT_AVG_COST_PER_FIX_CENTS: dict[str, float] = {
    "gpt-4o-mini": 5.0,
    "deepseek-v4-flash": 15.0,
    "gpt-4o": 50.0,
    "claude-3.5-sonnet": 60.0,
    "claude-sonnet-4-20250514": 200.0,
    "gpt-5.2-codex": 530.0,
    "gpt-5.5-deepswe": 580.0,
    "claude-opus-4-20250514": 264.0,
    "claude-opus-4.5": 264.0,
    "syntaro-agi": 350.0,
}

REBALANCED_TIERS_FIXES: dict[str, dict[str, Any]] = {
    "free": {
        "fixes_per_month": 10,
        "monthly_price_cents": 0,
        "target_avg_cost_per_fix_cents": 5.0,
        "description": "Free tier — 10 fixes/mo, cheapest model only",
    },
    "solo": {
        "fixes_per_month": 50,
        "monthly_price_cents": 4900,
        "target_avg_cost_per_fix_cents": 68.6,
        "description": "Solo — 50 fixes/mo at $49/mo",
    },
    "team": {
        "fixes_per_month": 200,
        "monthly_price_cents": 14900,
        "target_avg_cost_per_fix_cents": 52.15,
        "description": "Team — 200 fixes/mo at $149/mo",
    },
    "enterprise": {
        "fixes_per_month": -1,
        "monthly_price_cents": None,
        "target_avg_cost_per_fix_cents": 100.0,
        "description": "Enterprise — custom pricing, unlimited fixes",
    },
}

REBALANCED_TIERS_PRICING: dict[str, dict[str, Any]] = {
    "free": {
        "fixes_per_month": 10,
        "monthly_price_cents": 0,
        "description": "Free tier — 10 fixes/mo",
    },
    "solo": {
        "fixes_per_month": 50,
        "monthly_price_cents": 9900,
        "description": "Solo — 50 fixes/mo at $99/mo (was $49/mo)",
    },
    "team": {
        "fixes_per_month": 200,
        "monthly_price_cents": 29900,
        "description": "Team — 200 fixes/mo at $299/mo (was $149/mo)",
    },
    "enterprise": {
        "fixes_per_month": -1,
        "monthly_price_cents": None,
        "description": "Enterprise — custom pricing",
    },
}


def analyze_tier_economics(tier: str, avg_cost_per_fix_cents: float | None = None) -> TierEconomics:
    cfg = REBALANCED_TIERS_FIXES.get(tier, REBALANCED_TIERS_FIXES["free"])
    price_cents = cfg["monthly_price_cents"] or 0
    fixes = cfg["fixes_per_month"]
    if fixes < 0:
        fixes = 0
    avg_cost = avg_cost_per_fix_cents or DEFAULT_AVG_COST_PER_FIX_CENTS.get("syntaro-agi", 350.0)

    return TierEconomics(
        tier_name=tier,
        monthly_price_cents=price_cents,
        fixes_included=fixes,
        avg_cost_per_fix_cents=avg_cost,
    )


def analyze_all_tiers(avg_cost_per_fix_cents: float | None = None) -> dict[str, TierEconomics]:
    return {
        tier: analyze_tier_economics(tier, avg_cost_per_fix_cents)
        for tier in REBALANCED_TIERS_FIXES
    }


def recommend_pricing(target_margin_pct: float = 70.0) -> dict[str, dict[str, Any]]:
    recommendations: dict[str, dict[str, Any]] = {}

    for tier, cfg in REBALANCED_TIERS_FIXES.items():
        fixes = cfg["fixes_per_month"]
        if fixes < 0:
            recommendations[tier] = {
                "tier": tier,
                "recommended_price_cents": None,
                "fixes_per_month": -1,
                "note": "Custom pricing — contact sales",
            }
            continue

        cost_per_fix = DEFAULT_AVG_COST_PER_FIX_CENTS.get("syntaro-agi", 350.0)
        margin_multiplier = 100.0 / (100.0 - target_margin_pct)
        min_revenue_per_fix = round(cost_per_fix * margin_multiplier, 2)
        min_monthly_price = round(min_revenue_per_fix * fixes)
        min_monthly_dollars = min_monthly_price / 100.0

        current_price = cfg["monthly_price_cents"]
        if current_price and current_price > 0:
            current_margin = 100.0 - (cost_per_fix * fixes / current_price * 100.0)
        else:
            current_margin = 0.0

        recommendations[tier] = {
            "tier": tier,
            "current_price_cents": current_price,
            "current_price_dollars": round((current_price or 0) / 100.0, 2),
            "recommended_price_cents": min_monthly_price,
            "recommended_price_dollars": round(min_monthly_dollars, 2),
            "fixes_per_month": fixes,
            "avg_cost_per_fix_cents": cost_per_fix,
            "avg_cost_per_fix_dollars": round(cost_per_fix / 100.0, 4),
            "target_margin_pct": target_margin_pct,
            "current_margin_pct": round(current_margin, 2) if current_price else 0.0,
            "min_revenue_per_fix_cents": min_revenue_per_fix,
            "note": (
                f"Need ${min_monthly_dollars:.0f}/mo for {target_margin_pct:.0f}% margin "
                f"at {fixes} fixes/mo (${cost_per_fix/100:.4f}/fix avg)"
            ),
        }

    return recommendations


def simulate_tier_changes(avg_cost_per_fix_cents: float = 350.0) -> dict[str, Any]:
    current_tiers: dict[str, dict[str, Any]] = {
        "solo": {"fixes": 50, "price_cents": 4900},
        "team": {"fixes": -1, "price_cents": 14900},
    }

    option_a = REBALANCED_TIERS_FIXES
    option_b = REBALANCED_TIERS_PRICING

    results: dict[str, Any] = {
        "avg_cost_per_fix_cents": avg_cost_per_fix_cents,
        "avg_cost_per_fix_dollars": round(avg_cost_per_fix_cents / 100.0, 4),
        "current": {},
        "option_a_fixes_rebalanced": {},
        "option_b_pricing_rebalanced": {},
    }

    for tier in ("solo", "team"):
        cur = current_tiers[tier]
        cur_fixes = cur["fixes"]
        if cur_fixes < 0:
            cur_fixes = 500
            cur_cost = avg_cost_per_fix_cents * cur_fixes
        else:
            cur_cost = avg_cost_per_fix_cents * cur_fixes
        cur_rev = cur["price_cents"]
        cur_margin = round((cur_rev - cur_cost) / cur_rev * 100.0, 2) if cur_rev > 0 else -100.0
        results["current"][tier] = {
            "fixes_per_month": cur["fixes"],
            "price_cents": cur["price_cents"],
            "monthly_cost_cents": round(cur_cost, 2),
            "monthly_revenue_cents": cur_rev,
            "gross_margin_pct": cur_margin,
            "is_profitable": cur_margin >= 0,
        }

        a = option_a[tier]
        a_fixes = a["fixes_per_month"]
        if a_fixes < 0:
            a_fixes = 500
        a_cost = avg_cost_per_fix_cents * a_fixes
        a_rev = a["monthly_price_cents"] or 0
        a_margin = round((a_rev - a_cost) / a_rev * 100.0, 2) if a_rev > 0 else -100.0
        results["option_a_fixes_rebalanced"][tier] = {
            "fixes_per_month": a["fixes_per_month"],
            "price_cents": a["monthly_price_cents"],
            "monthly_cost_cents": round(a_cost, 2),
            "monthly_revenue_cents": a_rev,
            "gross_margin_pct": a_margin,
            "is_profitable": a_margin >= 0,
        }

        b = option_b[tier]
        b_fixes = b["fixes_per_month"]
        if b_fixes < 0:
            b_fixes = 500
        b_cost = avg_cost_per_fix_cents * b_fixes
        b_rev = b["monthly_price_cents"] or 0
        b_margin = round((b_rev - b_cost) / b_rev * 100.0, 2) if b_rev > 0 else -100.0
        results["option_b_pricing_rebalanced"][tier] = {
            "fixes_per_month": b["fixes_per_month"],
            "price_cents": b["monthly_price_cents"],
            "monthly_cost_cents": round(b_cost, 2),
            "monthly_revenue_cents": b_rev,
            "gross_margin_pct": b_margin,
            "is_profitable": b_margin >= 0,
        }

    return results
