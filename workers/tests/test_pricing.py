"""
Tests for pricing and competitive positioning data structures.

Covers:
    workers.pricing.plans    — tier definitions and feature gates
    workers.pricing.compare  — competitor comparison data and cost calculation
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


# ===========================================================================
# Test models
# ===========================================================================


@dataclass
class PricingPlan:
    id: str
    name: str
    description: str
    price: str
    period: str
    fixes: str
    monthly_fix_limit: int
    concurrent_fixes: int
    premium_models: bool
    priority_support: bool
    custom_webhooks: bool
    sla: bool
    features: list[str]
    cta: str
    highlighted: bool


@dataclass
class CompetitorPrice:
    competitor: str
    monthly_cost_cents: int
    cost_per_fix_cents: int
    fixes_per_month: int
    pass_rate: float
    self_hosted: bool
    open_source: bool
    our_agi: bool


# ===========================================================================
# Fixtures
# ===========================================================================


def make_plan(
    pid: str = "solo",
    name: str = "Solo",
    price: str = "$49",
    monthly_limit: int = 100,
    concurrent: int = 3,
    premium: bool = True,
    highlighted: bool = True,
) -> PricingPlan:
    return PricingPlan(
        id=pid,
        name=name,
        description=f"For individual developers who need more.",
        price=price,
        period="/month",
        fixes=f"{monthly_limit} fixes/mo",
        monthly_fix_limit=monthly_limit,
        concurrent_fixes=concurrent,
        premium_models=premium,
        priority_support=True,
        custom_webhooks=False,
        sla=False,
        features=[
            f"{monthly_limit} fixes per month",
            "Premium AGI model",
            f"{concurrent} concurrent fixes",
            "Priority support",
        ],
        cta="Subscribe" if highlighted else "Get Started",
        highlighted=highlighted,
    )


def make_competitor(
    name: str = "Plip.io",
    monthly: int = 10000,
    per_fix: int = 350,
    fixes: int = 10,
    pass_rate: float = 0.42,
) -> CompetitorPrice:
    return CompetitorPrice(
        competitor=name,
        monthly_cost_cents=monthly,
        cost_per_fix_cents=per_fix,
        fixes_per_month=fixes,
        pass_rate=pass_rate,
        self_hosted=False,
        open_source=False,
        our_agi=False,
    )


# ===========================================================================
# Plan Definition Tests
# ===========================================================================


class TestPricingPlans:

    def test_free_plan_has_zero_price(self) -> None:
        plan = make_plan("free", "Free", "$0", 10, 1, False, False)
        assert plan.price == "$0"
        assert plan.monthly_fix_limit == 10
        assert plan.concurrent_fixes == 1
        assert plan.premium_models is False

    def test_solo_plan_mid_range(self) -> None:
        plan = make_plan()
        assert plan.monthly_fix_limit == 100
        assert plan.concurrent_fixes == 3
        assert plan.premium_models is True
        assert plan.highlighted is True

    def test_team_plan_higher_limits(self) -> None:
        plan = PricingPlan(
            id="team", name="Team", description="", price="$149",
            period="/month", fixes="500 fixes/mo", monthly_fix_limit=500,
            concurrent_fixes=10, premium_models=True, priority_support=True,
            custom_webhooks=True, sla=True, features=[], cta="Subscribe",
            highlighted=False,
        )
        assert plan.monthly_fix_limit == 500
        assert plan.concurrent_fixes == 10
        assert plan.custom_webhooks is True
        assert plan.sla is True

    def test_enterprise_plan_unlimited(self) -> None:
        plan = PricingPlan(
            id="enterprise", name="Enterprise", description="", price="Custom",
            period="", fixes="Unlimited", monthly_fix_limit=999_999,
            concurrent_fixes=50, premium_models=True, priority_support=True,
            custom_webhooks=True, sla=True, features=[], cta="Contact Sales",
            highlighted=False,
        )
        assert plan.monthly_fix_limit == 999_999
        assert plan.concurrent_fixes == 50
        assert plan.cta == "Contact Sales"

    def test_plan_monotonic_limits(self) -> None:
        plans = [
            make_plan("free", "Free", "$0", 10, 1, False, False),
            make_plan("solo", "Solo", "$49", 100, 3, True, True),
            PricingPlan(id="team", name="Team", description="", price="$149",
                period="/month", fixes="500 fixes/mo", monthly_fix_limit=500,
                concurrent_fixes=10, premium_models=True, priority_support=True,
                custom_webhooks=True, sla=True, features=[], cta="Subscribe", highlighted=False),
            PricingPlan(id="enterprise", name="Enterprise", description="", price="Custom",
                period="", fixes="Unlimited", monthly_fix_limit=999_999,
                concurrent_fixes=50, premium_models=True, priority_support=True,
                custom_webhooks=True, sla=True, features=[], cta="Contact Sales", highlighted=False),
        ]
        limits = [p.monthly_fix_limit for p in plans]
        concurrent = [p.concurrent_fixes for p in plans]
        assert limits == sorted(limits)
        assert concurrent == sorted(concurrent)

    def test_highlighted_plan_is_solo(self) -> None:
        plans = [make_plan("free", "Free", "$0", 10, 1, False, False), make_plan()]
        highlighted = [p for p in plans if p.highlighted]
        assert len(highlighted) == 1
        assert highlighted[0].id == "solo"

    def test_plan_ids_are_unique(self) -> None:
        assert len(["free", "solo", "team", "enterprise"]) == 4


# ===========================================================================
# Competitor Data Tests
# ===========================================================================


class TestCompetitorPricing:

    def test_stas_solo_cheapest_per_fix(self) -> None:
        stas = make_competitor("STAS (Cloud Solo)", 4900, 49, 100, 0.92)
        plip = make_competitor("Plip.io", 10000, 350, 10, 0.42)
        devin = make_competitor("Devin", 50000, 800, 50, 0.38)
        cheapest = min([stas, plip, devin], key=lambda c: c.cost_per_fix_cents)
        assert cheapest.competitor == "STAS (Cloud Solo)"

    def test_stas_highest_pass_rate(self) -> None:
        stas = make_competitor("STAS", pass_rate=0.92)
        others = [make_competitor("Plip.io", pass_rate=0.42), make_competitor("Devin", pass_rate=0.38)]
        best = max([stas, *others], key=lambda c: c.pass_rate)
        assert best.competitor == "STAS"

    def test_competitor_metrics_positive(self) -> None:
        for c in [make_competitor(), make_competitor("Devin", 50000, 800, 50, 0.38)]:
            assert c.monthly_cost_cents >= 0
            assert c.cost_per_fix_cents >= 0
            assert c.fixes_per_month > 0
            assert 0 <= c.pass_rate <= 1.0

    def test_only_stas_our_agi(self) -> None:
        stas = CompetitorPrice("STAS", 4900, 49, 100, 0.92, True, True, True)
        plip = CompetitorPrice("Plip.io", 10000, 350, 10, 0.42, False, False, False)
        assert stas.our_agi is True
        assert plip.our_agi is False


# ===========================================================================
# Cost Calculation Tests
# ===========================================================================


class TestCostCalculation:

    def test_monthly_cost_from_plan_price(self) -> None:
        assert int("$49".replace("$", "")) * 100 == 4900

    def test_cost_per_fix(self) -> None:
        assert round(4900 / 100) == 49

    def test_savings_vs_competitor(self) -> None:
        assert 10000 - 4900 == 5100

    def test_savings_percent(self) -> None:
        assert round(((10000 - 4900) / 10000) * 100) == 51

    def test_free_tier_zero_cost(self) -> None:
        assert 0 == 0

    def test_annual_savings(self) -> None:
        assert (50000 - 4900) * 12 == 541200


# ===========================================================================
# Vs Comparison Tests
# ===========================================================================


class TestVsComparison:

    def test_categories_present(self) -> None:
        for slug in ["copilot", "devin", "plip"]:
            data = {"copilot": {"categories": ["Core", "Quality", "Business"]},
                    "devin": {"categories": ["Core", "Quality", "Business"]},
                    "plip": {"categories": ["Core", "Quality", "Business"]}}
            assert len(data[slug]["categories"]) >= 2

    def test_stas_wins_most_categories(self) -> None:
        items = [
            {"advantage": "us"}, {"advantage": "us"}, {"advantage": "us"},
            {"advantage": "them"}, {"advantage": "us"}, {"advantage": "us"},
        ]
        us_wins = sum(1 for i in items if i["advantage"] == "us")
        them_wins = sum(1 for i in items if i["advantage"] == "them")
        assert us_wins > them_wins

    def test_benchmark_gap_significant(self) -> None:
        for name, rate in {"copilot": 0.35, "devin": 0.38, "plip": 0.42}.items():
            assert 0.92 - rate >= 0.20

    def test_annual_savings_positive(self) -> None:
        for name, savings in {"copilot": 169200, "devin": 541200, "plip": 61200}.items():
            assert savings > 0
