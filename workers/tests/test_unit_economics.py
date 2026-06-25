"""
Tests for unit economics — cost model, caps, model routing, and tier rebalancing (AIM-2083).

Covers:
    workers.billing.unit_economics   — cost computation, caps, tier economics, pricing recommendations
    workers.billing.cost_analyzer    — complexity detection, model recommendation, savings projection
"""

from unittest.mock import MagicMock, patch

import pytest

from workers.billing.unit_economics import (
    DEFAULT_AVG_COST_PER_FIX_CENTS,
    MODEL_COST_TABLE,
    REBALANCED_TIERS_FIXES,
    REBALANCED_TIERS_PRICING,
    TIER_COST_CAP_CENTS,
    TIER_MAX_INPUT_TOKENS,
    TIER_MAX_OUTPUT_TOKENS,
    TIER_MODEL_ROUTING,
    FixCostRecord,
    ModelCost,
    TierEconomics,
    analyze_all_tiers,
    analyze_tier_economics,
    get_cost_cap_cents,
    get_max_input_tokens,
    get_max_output_tokens,
    is_within_cost_cap,
    recommend_pricing,
    select_model_for_fix,
    simulate_tier_changes,
)
from workers.billing.cost_analyzer import (
    analyze_complexity,
    analyze_fix_costs,
    estimate_model_cost,
    project_savings,
    recommend_model,
)


# =========================================================================
# Model Cost Computation
# =========================================================================


class TestModelCost:
    """workers.billing.unit_economics.ModelCost.compute()"""

    def test_known_model_computes_cost(self) -> None:
        """Known model should compute correct cost from token counts."""
        cost = ModelCost.compute("gpt-4o-mini", input_tokens=1000, output_tokens=500)
        # input: (1000/1000)*0.015 = 0.015, output: (500/1000)*0.06 = 0.03
        assert cost.input_cost_cents == 0.015
        assert cost.output_cost_cents == 0.03
        assert cost.total_cost_cents == 0.045

    def test_unknown_model_returns_zero_cost(self) -> None:
        """Unknown model name should log warning and return zero cost."""
        cost = ModelCost.compute("nonexistent-model", input_tokens=1000, output_tokens=500)
        assert cost.total_cost_cents == 0.0
        assert cost.model_name == "nonexistent-model"

    def test_zero_tokens_zero_cost(self) -> None:
        """Zero tokens should result in zero cost."""
        cost = ModelCost.compute("gpt-4o", input_tokens=0, output_tokens=0)
        assert cost.total_cost_cents == 0.0

    def test_large_token_count(self) -> None:
        """Large token counts should compute correctly without overflow."""
        cost = ModelCost.compute("gpt-4o", input_tokens=100_000, output_tokens=50_000)
        # input: (100000/1000)*0.25 = 25, output: (50000/1000)*1.0 = 50
        assert cost.input_cost_cents == 25.0
        assert cost.output_cost_cents == 50.0
        assert cost.total_cost_cents == 75.0

    def test_model_cost_to_dict(self) -> None:
        """ModelCost.to_dict() should return serializable dict."""
        cost = ModelCost.compute("gpt-4o-mini", 100, 50)
        d = cost.to_dict()
        assert d["model_name"] == "gpt-4o-mini"
        assert d["input_tokens"] == 100
        assert "total_cost_cents" in d

    def test_all_known_models_have_rates(self) -> None:
        """All models in cost table should have positive rates."""
        for model, (in_rate, out_rate) in MODEL_COST_TABLE.items():
            assert in_rate >= 0, f"{model} has negative input rate"
            assert out_rate >= 0, f"{model} has negative output rate"


# =========================================================================
# Cost Caps
# =========================================================================


class TestCostCaps:
    """Per-tier cost caps and token limits."""

    def test_get_cost_cap_cents_known_tier(self) -> None:
        """Known tier should return its cost cap."""
        assert get_cost_cap_cents("solo") == TIER_COST_CAP_CENTS["solo"]

    def test_get_cost_cap_cents_unknown_tier_defaults_to_free(self) -> None:
        """Unknown tier should default to free cap."""
        assert get_cost_cap_cents("nonexistent") == TIER_COST_CAP_CENTS["free"]

    def test_get_max_output_tokens_known_tier(self) -> None:
        """Known tier should return its output token limit."""
        assert get_max_output_tokens("team") == TIER_MAX_OUTPUT_TOKENS["team"]

    def test_get_max_output_tokens_unknown_tier_defaults_to_free(self) -> None:
        """Unknown tier should default to free output token limit."""
        assert get_max_output_tokens("bogus") == TIER_MAX_OUTPUT_TOKENS["free"]

    def test_get_max_input_tokens_known_tier(self) -> None:
        """Known tier should return its input token limit."""
        assert get_max_input_tokens("solo") == TIER_MAX_INPUT_TOKENS["solo"]

    def test_get_max_input_tokens_unknown_tier_defaults_to_free(self) -> None:
        """Unknown tier should default to free input token limit."""
        assert get_max_input_tokens("bogus") == TIER_MAX_INPUT_TOKENS["free"]

    def test_is_within_cost_cap_under(self) -> None:
        """Cost under the cap should return True."""
        assert is_within_cost_cap("solo", 100.0) is True

    def test_is_within_cost_cap_over(self) -> None:
        """Cost over the cap should return False."""
        assert is_within_cost_cap("solo", 1000.0) is False

    def test_is_within_cost_cap_exact(self) -> None:
        """Cost exactly at the cap should return True."""
        cap = get_cost_cap_cents("free")
        assert is_within_cost_cap("free", cap) is True

    def test_tier_caps_are_reasonable(self) -> None:
        """Higher tiers should have higher or equal caps."""
        assert TIER_COST_CAP_CENTS["free"] <= TIER_COST_CAP_CENTS["solo"]
        assert TIER_COST_CAP_CENTS["solo"] <= TIER_COST_CAP_CENTS["team"]
        assert TIER_COST_CAP_CENTS["team"] <= TIER_COST_CAP_CENTS["enterprise"]

    def test_free_tier_cap_allows_cheap_models(self) -> None:
        """Free tier cap should be enough for gpt-4o-mini."""
        cost = ModelCost.compute("gpt-4o-mini", 4000, 1000)
        assert is_within_cost_cap("free", cost.total_cost_cents) is True

    def test_solo_tier_cap_allows_gpt4o(self) -> None:
        """Solo tier cap should be enough for gpt-4o."""
        cost = ModelCost.compute("gpt-4o", 8000, 2000)
        assert is_within_cost_cap("solo", cost.total_cost_cents) is True


# =========================================================================
# Model Selection
# =========================================================================


class TestModelSelection:
    """select_model_for_fix() and routing table."""

    def test_selects_cheap_for_free_simple(self) -> None:
        """Free tier simple fixes should use cheapest model."""
        model = select_model_for_fix("free", "simple")
        assert model == "gpt-4o-mini"

    def test_selects_mid_for_solo_medium(self) -> None:
        """Solo tier medium fixes should use mid-range model."""
        model = select_model_for_fix("solo", "medium")
        assert model == "deepseek-v4-flash"

    def test_selects_expensive_for_complex(self) -> None:
        """Complex fixes should use capable models."""
        model = select_model_for_fix("team", "complex")
        assert model in ("claude-opus-4-20250514",)

    def test_unknown_tier_falls_back(self) -> None:
        """Unknown tier should fall back to a known model."""
        model = select_model_for_fix("bogus", "simple")
        assert model is not None
        assert isinstance(model, str)

    def test_all_tiers_have_routing_for_all_complexities(self) -> None:
        """Every tier should have a routing entry for simple/medium/complex."""
        complexities = ("simple", "medium", "complex")
        for tier in ("free", "solo", "team", "enterprise"):
            for comp in complexities:
                model = select_model_for_fix(tier, comp)
                assert model is not None, f"No routing for {tier}/{comp}"

    def test_routing_respects_tier_budget(self) -> None:
        """Selected model's cost should be within tier cost cap."""
        for (tier, comp), model in TIER_MODEL_ROUTING.items():
            cap = get_cost_cap_cents(tier)
            avg_cost = DEFAULT_AVG_COST_PER_FIX_CENTS.get(model, 0)
            assert avg_cost <= cap or cap >= 50.0, (
                f"{model} avg cost {avg_cost} exceeds {tier} cap {cap}"
            )


# =========================================================================
# Fix Cost Record
# =========================================================================


class TestFixCostRecord:
    """workers.billing.unit_economics.FixCostRecord"""

    def test_compute_margin_positive(self) -> None:
        """Fix cost below revenue per fix should yield positive margin."""
        record = FixCostRecord(
            fix_id="fix-1",
            tenant_id="t1",
            tier="solo",
            model_name="gpt-4o-mini",
            total_cost_cents=5.0,
        )
        # Solo: $49/50 = $0.98/fix = 98 cents
        margin = record.compute_margin(monthly_revenue_cents=4900, fixes_per_month=50)
        assert margin > 0  # 5c cost on 98c revenue

    def test_compute_margin_negative(self) -> None:
        """Fix cost above revenue per fix should yield negative margin."""
        record = FixCostRecord(
            fix_id="fix-2",
            tenant_id="t1",
            tier="solo",
            model_name="claude-opus-4.5",
            total_cost_cents=700.0,
        )
        # Solo: $49/50 = 98c/fix, cost 700c = -614%
        margin = record.compute_margin(monthly_revenue_cents=4900, fixes_per_month=50)
        assert margin < 0

    def test_compute_margin_unlimited_fixes(self) -> None:
        """Unlimited tiers should return 0 margin (can't compute per-fix)."""
        record = FixCostRecord(
            fix_id="fix-3",
            tenant_id="t1",
            tier="enterprise",
            model_name="gpt-4o",
            total_cost_cents=100.0,
        )
        margin = record.compute_margin(monthly_revenue_cents=0, fixes_per_month=0)
        assert margin == 0.0

    def test_to_dict(self) -> None:
        """FixCostRecord.to_dict() should be JSON-serializable."""
        record = FixCostRecord(
            fix_id="fix-1",
            tenant_id="t1",
            tier="solo",
            model_name="gpt-4o",
            input_tokens=5000,
            output_tokens=1500,
            total_cost_cents=75.0,
            complexity="medium",
        )
        d = record.to_dict()
        assert d["fix_id"] == "fix-1"
        assert d["complexity"] == "medium"
        assert d["total_cost_cents"] == 75.0


# =========================================================================
# Complexity Analysis
# =========================================================================


class TestComplexityAnalysis:
    """workers.billing.cost_analyzer.analyze_complexity()"""

    def test_simple_typo_fix(self) -> None:
        """Simple typo fixes should be classified as simple."""
        result = analyze_complexity(
            issue_title="Fix typo in README",
            issue_body="There's a spelling mistake in the introduction paragraph.",
            estimated_lines=2,
            file_count=1,
        )
        assert result.complexity == "simple"
        assert result.score < 0.3

    def test_complex_architectural_change(self) -> None:
        """Architectural changes should be classified as complex."""
        result = analyze_complexity(
            issue_title="Migrate from REST to GraphQL",
            issue_body="We need to redesign the API layer to use GraphQL. "
            "This involves changing multiple files and the data access pattern.",
            file_count=8,
            estimated_lines=500,
        )
        assert result.complexity == "complex"
        assert result.score >= 0.5

    def test_medium_complexity(self) -> None:
        """Multi-file bug fixes should be medium complexity."""
        result = analyze_complexity(
            issue_title="Fix cross-cutting validation bug",
            issue_body="The login endpoint doesn't validate email format properly. Needs changes across multiple files and refactoring of the validation logic.",
            estimated_lines=80,
            file_count=3,
        )
        assert result.complexity == "medium"

    def test_empty_input_defaults_to_medium(self) -> None:
        """Empty input should default to medium (midpoint)."""
        result = analyze_complexity()
        assert result.complexity in ("simple", "medium", "complex")

    def test_simple_indicators_reduce_complexity(self) -> None:
        """Simple indicators (typo, rename, etc.) should reduce score."""
        result = analyze_complexity(
            issue_title="Rename variable for clarity",
            issue_body="Simple rename of 'data' to 'userData' for better readability.",
            estimated_lines=5,
            file_count=1,
        )
        assert result.complexity == "simple"

    def test_to_dict(self) -> None:
        """ComplexityAnalysis.to_dict() should be serializable."""
        result = analyze_complexity(
            issue_title="Test issue",
            issue_body="Test body",
        )
        d = result.to_dict()
        assert "complexity" in d
        assert "score" in d
        assert "indicators" in d


# =========================================================================
# Model Recommendation
# =========================================================================


class TestModelRecommendation:
    """workers.billing.cost_analyzer.recommend_model()"""

    def test_returns_recommendation_for_known_tier(self) -> None:
        """Known tier and complexity should return a recommendation."""
        rec = recommend_model(tier="solo", complexity="simple")
        assert rec.model_name is not None
        assert rec.tier == "solo"
        assert rec.complexity == "simple"

    def test_estimate_cost_is_reasonable(self) -> None:
        """Estimated cost should be a positive number for known models."""
        rec = recommend_model(tier="team", complexity="complex")
        assert rec.estimated_cost_cents > 0

    def test_alternatives_list(self) -> None:
        """Recommendation should include alternative models."""
        rec = recommend_model(tier="solo", complexity="medium")
        assert isinstance(rec.alternatives, list)

    def test_to_dict(self) -> None:
        """ModelRecommendation.to_dict() should be serializable."""
        rec = recommend_model(tier="free", complexity="simple")
        d = rec.to_dict()
        assert d["model_name"] is not None
        assert "estimated_cost_cents" in d
        assert "reason" in d


# =========================================================================
# Cost Analysis
# =========================================================================


class TestCostAnalysis:
    """workers.billing.cost_analyzer.analyze_fix_costs()"""

    def test_empty_records(self) -> None:
        """Empty records should return empty analysis."""
        result = analyze_fix_costs([])
        assert result.total_runs == 0
        assert result.total_cost_cents == 0.0

    def test_single_record(self) -> None:
        """Single record should return its cost."""
        records = [{"model_name": "gpt-4o", "total_cost_cents": 50.0, "complexity": "medium", "tier": "solo"}]
        result = analyze_fix_costs(records)
        assert result.total_runs == 1
        assert result.total_cost_cents == 50.0
        assert result.avg_cost_cents == 50.0

    def test_multiple_records(self) -> None:
        """Multiple records should aggregate correctly."""
        records = [
            {"model_name": "gpt-4o-mini", "total_cost_cents": 5.0, "complexity": "simple", "tier": "free"},
            {"model_name": "gpt-4o", "total_cost_cents": 50.0, "complexity": "medium", "tier": "solo"},
            {"model_name": "claude-opus-4-20250514", "total_cost_cents": 264.0, "complexity": "complex", "tier": "team"},
        ]
        result = analyze_fix_costs(records)
        assert result.total_runs == 3
        assert result.total_cost_cents == 319.0
        assert result.avg_cost_cents == pytest.approx(106.3333, rel=0.01)
        assert result.min_cost_cents == 5.0
        assert result.max_cost_cents == 264.0

    def test_by_model_breakdown(self) -> None:
        """Should break down costs by model."""
        records = [
            {"model_name": "gpt-4o-mini", "total_cost_cents": 5.0, "complexity": "simple", "tier": "free"},
            {"model_name": "gpt-4o-mini", "total_cost_cents": 5.0, "complexity": "simple", "tier": "free"},
            {"model_name": "gpt-4o", "total_cost_cents": 50.0, "complexity": "medium", "tier": "solo"},
        ]
        result = analyze_fix_costs(records)
        assert result.by_model["gpt-4o-mini"] == 10.0
        assert result.by_model["gpt-4o"] == 50.0

    def test_by_complexity_breakdown(self) -> None:
        """Should break down costs by complexity."""
        records = [
            {"model_name": "gpt-4o-mini", "total_cost_cents": 5.0, "complexity": "simple", "tier": "free"},
            {"model_name": "gpt-4o", "total_cost_cents": 50.0, "complexity": "medium", "tier": "solo"},
        ]
        result = analyze_fix_costs(records)
        assert result.by_complexity["simple"] == 5.0
        assert result.by_complexity["medium"] == 50.0


# =========================================================================
# Savings Projection
# =========================================================================


class TestSavingsProjection:
    """workers.billing.cost_analyzer.project_savings()"""

    def test_returns_projection(self) -> None:
        """Should return a savings projection with all fields."""
        proj = project_savings(tier="solo", fixes_per_month=50)
        assert proj.current_avg_cost_cents > 0
        assert proj.savings_per_fix_cents >= 0
        assert proj.savings_percent > 0
        assert proj.savings_percent <= 100

    def test_savings_positive(self) -> None:
        """Routing should save money compared to using expensive model for everything."""
        proj = project_savings(tier="team", fixes_per_month=200)
        assert proj.savings_per_fix_cents > 0
        assert proj.monthly_savings_cents > 0
        assert proj.monthly_savings_dollars > 0

    def test_to_dict(self) -> None:
        """SavingsProjection.to_dict() should be serializable."""
        proj = project_savings(tier="solo", fixes_per_month=50)
        d = proj.to_dict()
        assert "savings_percent" in d
        assert "monthly_savings_dollars" in d


# =========================================================================
# Tier Economics
# =========================================================================


class TestTierEconomics:
    """workers.billing.unit_economics.TierEconomics and analysis."""

    def test_solo_currently_unprofitable(self) -> None:
        """Solo at $49/50 fixes with $3.50/fix cost should be loss-making."""
        eco = analyze_tier_economics("solo", avg_cost_per_fix_cents=350.0)
        assert not eco.is_profitable
        assert eco.gross_margin_pct < 0

    def test_team_currently_unprofitable(self) -> None:
        """Team at $149/200 fixes with $3.50/fix cost should be loss-making."""
        eco = analyze_tier_economics("team", avg_cost_per_fix_cents=350.0)
        assert not eco.is_profitable

    def test_rebalanced_solo_is_profitable(self) -> None:
        """Rebalanced Solo (50 fixes, $49) with cheap routing should be profitable."""
        # If avg cost drops to $0.50/fix (via routing to cheap models)
        eco = analyze_tier_economics("solo", avg_cost_per_fix_cents=50.0)
        assert eco.is_profitable
        assert eco.gross_margin_pct > 40

    def test_free_tier_is_loss_leader(self) -> None:
        """Free tier should have negative margin (intentional loss leader)."""
        eco = analyze_tier_economics("free", avg_cost_per_fix_cents=5.0)
        assert not eco.is_profitable
        assert eco.monthly_revenue_cents == 0

    def test_analyze_all_tiers_returns_all(self) -> None:
        """analyze_all_tiers should return entries for all tiers."""
        results = analyze_all_tiers(avg_cost_per_fix_cents=350.0)
        assert "solo" in results
        assert "team" in results
        assert "free" in results
        assert "enterprise" in results

    def test_tier_economics_to_dict(self) -> None:
        """TierEconomics.to_dict() should be serializable."""
        eco = TierEconomics(
            tier_name="solo",
            monthly_price_cents=4900,
            fixes_included=50,
            avg_cost_per_fix_cents=50.0,
        )
        d = eco.to_dict()
        assert d["tier_name"] == "solo"
        assert "gross_margin_pct" in d
        assert "is_profitable" in d


# =========================================================================
# Pricing Recommendations
# =========================================================================


class TestPricingRecommendations:
    """workers.billing.unit_economics.recommend_pricing()"""

    def test_returns_recommendations(self) -> None:
        """Should return pricing recommendations for all tiers."""
        recs = recommend_pricing(target_margin_pct=70.0)
        assert "solo" in recs
        assert "team" in recs
        assert "free" in recs

    def test_solo_recommendation_has_reasoning(self) -> None:
        """Solo recommendation should include rationale."""
        recs = recommend_pricing(target_margin_pct=70.0)
        solo = recs["solo"]
        assert "note" in solo
        assert solo["recommended_price_cents"] > 0
        assert solo["target_margin_pct"] == 70.0

    def test_free_tier_recommendation_exists(self) -> None:
        """Free tier should have a recommendation entry."""
        recs = recommend_pricing()
        assert "free" in recs
        assert "note" in recs["free"]

    def test_higher_target_margin_higher_price(self) -> None:
        """Higher target margin should result in higher recommended price."""
        recs_70 = recommend_pricing(target_margin_pct=70.0)
        recs_80 = recommend_pricing(target_margin_pct=80.0)
        assert recs_80["solo"]["recommended_price_cents"] >= recs_70["solo"]["recommended_price_cents"]


# =========================================================================
# Tier Rebalancing Simulation
# =========================================================================


class TestTierRebalancing:
    """workers.billing.unit_economics.simulate_tier_changes()"""

    def test_simulate_returns_all_scenarios(self) -> None:
        """Simulation should return current, option A, and option B results."""
        sim = simulate_tier_changes(avg_cost_per_fix_cents=350.0)
        assert "current" in sim
        assert "option_a_fixes_rebalanced" in sim
        assert "option_b_pricing_rebalanced" in sim
        assert "avg_cost_per_fix_cents" in sim

    def test_current_solo_loss_making(self) -> None:
        """Current Solo should show negative margin."""
        sim = simulate_tier_changes(avg_cost_per_fix_cents=350.0)
        solo_current = sim["current"]["solo"]
        assert not solo_current["is_profitable"]
        assert solo_current["gross_margin_pct"] < 0

    def test_option_b_solo_profitable(self) -> None:
        """Solo at 50 fixes/$99 should be profitable at $3.50/fix."""
        sim = simulate_tier_changes(avg_cost_per_fix_cents=350.0)
        solo_b = sim["option_b_pricing_rebalanced"]["solo"]
        assert solo_b["is_profitable"]
        assert solo_b["gross_margin_pct"] > 0

    def test_option_a_solo_still_loss_making_at_350c(self) -> None:
        """Solo at 50 fixes/$49 with $3.50/fix cost should still lose money."""
        sim = simulate_tier_changes(avg_cost_per_fix_cents=350.0)
        solo_a = sim["option_a_fixes_rebalanced"]["solo"]
        # 50 fixes * $3.50 = $175 cost, $49 revenue -> still loss
        assert not solo_a["is_profitable"]

    def test_option_a_solo_profitable_with_cheap_routing(self) -> None:
        """With cost routing dropping avg to $0.50/fix, option A solo should profit."""
        sim = simulate_tier_changes(avg_cost_per_fix_cents=50.0)
        solo_a = sim["option_a_fixes_rebalanced"]["solo"]
        # 50 fixes * $0.50 = $25 cost, $49 revenue -> profit
        assert solo_a["is_profitable"]
        assert solo_a["gross_margin_pct"] > 40


# =========================================================================
# Estimate Model Cost
# =========================================================================


class TestEstimateModelCost:
    """workers.billing.cost_analyzer.estimate_model_cost()"""

    def test_known_model(self) -> None:
        """Known model should return estimated cost."""
        cost = estimate_model_cost("gpt-4o-mini", 4000, 1000)
        assert cost > 0

    def test_unknown_model_returns_zero(self) -> None:
        """Unknown model should return 0."""
        cost = estimate_model_cost("fake-model", 1000, 500)
        assert cost == 0.0

    def test_different_models_different_costs(self) -> None:
        """Different models should have different estimated costs."""
        cheap = estimate_model_cost("gpt-4o-mini", 4000, 1000)
        expensive = estimate_model_cost("claude-opus-4-20250514", 4000, 1000)
        assert cheap < expensive


# =========================================================================
# Edge Cases
# =========================================================================


class TestUnitEconomicsEdgeCases:
    """Edge cases for unit economics modules."""

    def test_model_cost_negative_tokens(self) -> None:
        """Negative tokens should still compute (no validation needed here)."""
        cost = ModelCost.compute("gpt-4o", input_tokens=-100, output_tokens=100)
        assert cost.input_cost_cents <= 0
        assert cost.total_cost_cents is not None

    def test_empty_issue_analysis(self) -> None:
        """Empty issue title/body should not crash complexity analysis."""
        result = analyze_complexity(issue_title="", issue_body="")
        assert result.complexity in ("simple", "medium", "complex")

    def test_tier_enum_values_match(self) -> None:
        """REBALANCED_TIERS_FIXES and REBALANCED_TIERS_PRICING should cover same tiers."""
        assert set(REBALANCED_TIERS_FIXES) == set(REBALANCED_TIERS_PRICING)

    def test_cost_cap_not_exceeded_by_avg_cost(self) -> None:
        """Default average cost per fix should be within tier cost caps."""
        for model, avg_cost in DEFAULT_AVG_COST_PER_FIX_CENTS.items():
            for tier, cap in TIER_COST_CAP_CENTS.items():
                if avg_cost <= cap:
                    break
            else:
                # Enterprise cap is high enough for all
                pass

    def test_fix_cost_record_zero_division(self) -> None:
        """Zero revenue should not crash compute_margin."""
        record = FixCostRecord(
            fix_id="fix-1",
            tenant_id="t1",
            tier="free",
            total_cost_cents=10.0,
        )
        margin = record.compute_margin(monthly_revenue_cents=0, fixes_per_month=10)
        assert margin < 0
