"""
Tests for unit economics - cost model, caps, model routing, and tier rebalancing (AIM-2083).
"""

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


class TestModelCost:
    def test_known_model_computes_cost(self):
        cost = ModelCost.compute("gpt-4o-mini", input_tokens=1000, output_tokens=500)
        assert cost.input_cost_cents == 0.015
        assert cost.output_cost_cents == 0.03
        assert cost.total_cost_cents == 0.045

    def test_unknown_model_returns_zero_cost(self):
        cost = ModelCost.compute("nonexistent-model", input_tokens=1000, output_tokens=500)
        assert cost.total_cost_cents == 0.0

    def test_zero_tokens_zero_cost(self):
        cost = ModelCost.compute("gpt-4o", input_tokens=0, output_tokens=0)
        assert cost.total_cost_cents == 0.0

    def test_large_token_count(self):
        cost = ModelCost.compute("gpt-4o", input_tokens=100_000, output_tokens=50_000)
        assert cost.input_cost_cents == 25.0
        assert cost.output_cost_cents == 50.0
        assert cost.total_cost_cents == 75.0

    def test_model_cost_to_dict(self):
        cost = ModelCost.compute("gpt-4o-mini", 100, 50)
        d = cost.to_dict()
        assert d["model_name"] == "gpt-4o-mini"

    def test_all_known_models_have_rates(self):
        for model, (in_rate, out_rate) in MODEL_COST_TABLE.items():
            assert in_rate >= 0
            assert out_rate >= 0


class TestCostCaps:
    def test_get_cost_cap_cents_known_tier(self):
        assert get_cost_cap_cents("solo") == TIER_COST_CAP_CENTS["solo"]

    def test_get_cost_cap_cents_unknown_tier_defaults_to_free(self):
        assert get_cost_cap_cents("nonexistent") == TIER_COST_CAP_CENTS["free"]

    def test_get_max_output_tokens_known_tier(self):
        assert get_max_output_tokens("team") == TIER_MAX_OUTPUT_TOKENS["team"]

    def test_get_max_output_tokens_unknown_tier(self):
        assert get_max_output_tokens("bogus") == TIER_MAX_OUTPUT_TOKENS["free"]

    def test_is_within_cost_cap_under(self):
        assert is_within_cost_cap("solo", 100.0) is True

    def test_is_within_cost_cap_over(self):
        assert is_within_cost_cap("solo", 1000.0) is False

    def test_tier_caps_are_reasonable(self):
        assert TIER_COST_CAP_CENTS["free"] <= TIER_COST_CAP_CENTS["solo"]
        assert TIER_COST_CAP_CENTS["solo"] <= TIER_COST_CAP_CENTS["team"]


class TestModelSelection:
    def test_selects_cheap_for_free_simple(self):
        assert select_model_for_fix("free", "simple") == "gpt-4o-mini"

    def test_selects_mid_for_solo_medium(self):
        assert select_model_for_fix("solo", "medium") == "deepseek-v4-flash"

    def test_selects_expensive_for_complex(self):
        assert select_model_for_fix("team", "complex") in ("claude-opus-4-20250514",)

    def test_unknown_tier_falls_back(self):
        model = select_model_for_fix("bogus", "simple")
        assert isinstance(model, str)

    def test_all_tiers_have_routing(self):
        for tier in ("free", "solo", "team", "enterprise"):
            for comp in ("simple", "medium", "complex"):
                assert select_model_for_fix(tier, comp) is not None


class TestFixCostRecord:
    def test_compute_margin_positive(self):
        record = FixCostRecord("fix-1", "t1", "solo", "gpt-4o-mini", total_cost_cents=5.0)
        margin = record.compute_margin(monthly_revenue_cents=4900, fixes_per_month=50)
        assert margin > 0

    def test_compute_margin_negative(self):
        record = FixCostRecord("fix-2", "t1", "solo", "claude-opus-4.5", total_cost_cents=700.0)
        margin = record.compute_margin(monthly_revenue_cents=4900, fixes_per_month=50)
        assert margin < 0

    def test_compute_margin_enterprise(self):
        record = FixCostRecord("fix-3", "t1", "enterprise", "gpt-4o", total_cost_cents=100.0)
        margin = record.compute_margin(monthly_revenue_cents=0, fixes_per_month=0)
        assert margin == 0.0

    def test_to_dict(self):
        record = FixCostRecord("fix-1", "t1", "solo", "gpt-4o", total_cost_cents=75.0, complexity="medium")
        d = record.to_dict()
        assert d["fix_id"] == "fix-1"


class TestComplexityAnalysis:
    def test_simple_typo_fix(self):
        result = analyze_complexity(issue_title="Fix typo in README", issue_body="Spelling mistake.", estimated_lines=2, file_count=1)
        assert result.complexity == "simple"

    def test_complex_architectural_change(self):
        result = analyze_complexity(issue_title="Migrate from REST to GraphQL", issue_body="Redesign the API layer.", file_count=8, estimated_lines=500)
        assert result.complexity == "complex"

    def test_medium_complexity(self):
        result = analyze_complexity(issue_title="Fix validation logic in multiple endpoints", issue_body="The validation logic needs to be updated across several endpoints. This involves changing the middleware and controller files.", estimated_lines=80, file_count=3, triage_scope="medium")
        assert result.complexity == "medium"

    def test_empty_input_defaults(self):
        result = analyze_complexity()
        assert result.complexity in ("simple", "medium", "complex")

    def test_to_dict(self):
        result = analyze_complexity(issue_title="Test", issue_body="Body")
        d = result.to_dict()
        assert "complexity" in d


class TestModelRecommendation:
    def test_returns_recommendation(self):
        rec = recommend_model(tier="solo", complexity="simple")
        assert rec.model_name is not None

    def test_estimate_cost_is_positive(self):
        rec = recommend_model(tier="team", complexity="complex")
        assert rec.estimated_cost_cents > 0

    def test_alternatives_list(self):
        rec = recommend_model(tier="solo", complexity="medium")
        assert isinstance(rec.alternatives, list)

    def test_to_dict(self):
        rec = recommend_model(tier="free", complexity="simple")
        d = rec.to_dict()
        assert "model_name" in d


class TestCostAnalysis:
    def test_empty_records(self):
        result = analyze_fix_costs([])
        assert result.total_runs == 0

    def test_single_record(self):
        records = [{"model_name": "gpt-4o", "total_cost_cents": 50.0, "complexity": "medium", "tier": "solo"}]
        result = analyze_fix_costs(records)
        assert result.total_runs == 1
        assert result.total_cost_cents == 50.0

    def test_multiple_records(self):
        records = [
            {"model_name": "gpt-4o-mini", "total_cost_cents": 5.0, "complexity": "simple", "tier": "free"},
            {"model_name": "gpt-4o", "total_cost_cents": 50.0, "complexity": "medium", "tier": "solo"},
        ]
        result = analyze_fix_costs(records)
        assert result.total_runs == 2
        assert result.by_model["gpt-4o-mini"] == 5.0
        assert result.by_model["gpt-4o"] == 50.0

    def test_by_complexity_breakdown(self):
        records = [
            {"model_name": "a", "total_cost_cents": 5.0, "complexity": "simple", "tier": "free"},
            {"model_name": "b", "total_cost_cents": 50.0, "complexity": "medium", "tier": "solo"},
        ]
        result = analyze_fix_costs(records)
        assert result.by_complexity["simple"] == 5.0
        assert result.by_complexity["medium"] == 50.0

    def test_min_max_cost(self):
        records = [
            {"model_name": "a", "total_cost_cents": 5.0, "complexity": "simple", "tier": "free"},
            {"model_name": "b", "total_cost_cents": 264.0, "complexity": "complex", "tier": "team"},
        ]
        result = analyze_fix_costs(records)
        assert result.min_cost_cents == 5.0
        assert result.max_cost_cents == 264.0


class TestSavingsProjection:
    def test_returns_projection(self):
        proj = project_savings(tier="solo", fixes_per_month=50)
        assert proj.current_avg_cost_cents > 0
        assert proj.savings_percent > 0

    def test_savings_positive(self):
        proj = project_savings(tier="team", fixes_per_month=200)
        assert proj.savings_per_fix_cents > 0


class TestTierEconomics:
    def test_solo_currently_unprofitable(self):
        eco = analyze_tier_economics("solo", avg_cost_per_fix_cents=350.0)
        assert not eco.is_profitable

    def test_team_currently_unprofitable(self):
        eco = analyze_tier_economics("team", avg_cost_per_fix_cents=350.0)
        assert not eco.is_profitable

    def test_rebalanced_solo_is_profitable(self):
        eco = analyze_tier_economics("solo", avg_cost_per_fix_cents=50.0)
        assert eco.is_profitable
        assert eco.gross_margin_pct > 40

    def test_free_tier_is_loss_leader(self):
        eco = analyze_tier_economics("free", avg_cost_per_fix_cents=5.0)
        assert not eco.is_profitable

    def test_analyze_all_tiers_returns_all(self):
        results = analyze_all_tiers(avg_cost_per_fix_cents=350.0)
        assert "solo" in results
        assert "team" in results


class TestPricingRecommendations:
    def test_returns_recommendations(self):
        recs = recommend_pricing(target_margin_pct=70.0)
        assert "solo" in recs
        assert "team" in recs

    def test_free_tier_has_entry(self):
        recs = recommend_pricing()
        assert "free" in recs

    def test_higher_margin_higher_price(self):
        recs_70 = recommend_pricing(target_margin_pct=70.0)
        recs_80 = recommend_pricing(target_margin_pct=80.0)
        assert recs_80["solo"]["recommended_price_cents"] >= recs_70["solo"]["recommended_price_cents"]


class TestTierRebalancing:
    def test_simulate_returns_all_scenarios(self):
        sim = simulate_tier_changes(avg_cost_per_fix_cents=350.0)
        assert "current" in sim
        assert "option_a_fixes_rebalanced" in sim
        assert "option_b_pricing_rebalanced" in sim

    def test_current_solo_loss_making(self):
        sim = simulate_tier_changes(avg_cost_per_fix_cents=350.0)
        assert not sim["current"]["solo"]["is_profitable"]

    def test_option_b_solo_profitable_with_routing(self):
        sim = simulate_tier_changes(avg_cost_per_fix_cents=50.0)
        assert sim["option_b_pricing_rebalanced"]["solo"]["is_profitable"]

    def test_option_a_loss_making_at_350c(self):
        sim = simulate_tier_changes(avg_cost_per_fix_cents=350.0)
        assert not sim["option_a_fixes_rebalanced"]["solo"]["is_profitable"]

    def test_cheap_routing_makes_option_a_profitable(self):
        sim = simulate_tier_changes(avg_cost_per_fix_cents=50.0)
        assert sim["option_a_fixes_rebalanced"]["solo"]["is_profitable"]


class TestEstimateModelCost:
    def test_known_model(self):
        assert estimate_model_cost("gpt-4o-mini", 4000, 1000) > 0

    def test_unknown_model_returns_zero(self):
        assert estimate_model_cost("fake-model", 1000, 500) == 0.0

    def test_different_models_different_costs(self):
        cheap = estimate_model_cost("gpt-4o-mini", 4000, 1000)
        expensive = estimate_model_cost("claude-opus-4-20250514", 4000, 1000)
        assert cheap < expensive


class TestUnitEconomicsEdgeCases:
    def test_empty_issue_analysis(self):
        result = analyze_complexity(issue_title="", issue_body="")
        assert result.complexity in ("simple", "medium", "complex")

    def test_tier_enum_values_match(self):
        assert set(REBALANCED_TIERS_FIXES) == set(REBALANCED_TIERS_PRICING)

    def test_zero_revenue_margin(self):
        record = FixCostRecord("fix-1", "t1", "free", "gpt-4o-mini", total_cost_cents=10.0)
        margin = record.compute_margin(monthly_revenue_cents=0, fixes_per_month=10)
        assert margin < 0
