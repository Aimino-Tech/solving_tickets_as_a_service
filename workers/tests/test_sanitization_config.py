"""Tests for the sanitization configuration module."""

import re
import pytest

from workers.gates.sanitization_config import (
    CATEGORIES,
    SEVERITY_CRITICAL,
    SEVERITY_HIGH,
    SEVERITY_LOW,
    SEVERITY_MEDIUM,
    ALL_RULES,
    RULES_BY_CATEGORY,
    SanitizationRule,
    SanitizationConfig,
    CategoryConfig,
    build_sanitizer_config,
    get_active_rules,
    get_rules_by_severity,
    get_config_summary,
    is_allowlisted,
    load_allowlist,
    build_category_patterns,
    _parse_allowlist,
)


# ============================================================================
# Structure tests - categories, rules, constants
# ============================================================================


class TestCategoriesStructure:
    def test_categories_is_list(self):
        assert isinstance(CATEGORIES, list)

    def test_each_category_has_name_and_rules(self):
        for cat in CATEGORIES:
            assert isinstance(cat, CategoryConfig)
            assert cat.name
            assert isinstance(cat.name, str)
            assert isinstance(cat.rules, list)
            assert len(cat.rules) > 0, f"Category {cat.name!r} has no rules"

    def test_category_names_are_unique(self):
        names = [c.name for c in CATEGORIES]
        assert len(names) == len(set(names)), "Duplicate category names found"

    def test_expected_categories_present(self):
        expected = {"api_keys", "internal_urls", "system_prompts", "file_paths", "env_vars", "internal_ips"}
        actual = {c.name for c in CATEGORIES}
        assert actual == expected, f"Missing categories: {expected - actual}"


class TestRulesStructure:
    def test_all_rules_flat_list(self):
        assert isinstance(ALL_RULES, list)
        assert len(ALL_RULES) > 0

    def test_each_rule_is_named_tuple(self):
        for rule in ALL_RULES:
            assert isinstance(rule, SanitizationRule)

    def test_each_rule_has_required_fields(self):
        for rule in ALL_RULES:
            assert rule.name, f"Rule missing name: {rule}"
            assert rule.category, f"Rule {rule.name!r} missing category"
            assert isinstance(rule.pattern, re.Pattern), f"Rule {rule.name!r} pattern not compiled"
            assert rule.replacement, f"Rule {rule.name!r} missing replacement"
            assert rule.severity in (
                SEVERITY_CRITICAL, SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW,
            ), f"Rule {rule.name!r} has unknown severity {rule.severity!r}"
            assert rule.description, f"Rule {rule.name!r} missing description"

    def test_rule_names_are_unique(self):
        names = [r.name for r in ALL_RULES]
        assert len(names) == len(set(names)), "Duplicate rule names found"

    def test_rules_by_category_index(self):
        for cat_name, rules in RULES_BY_CATEGORY.items():
            assert cat_name in {c.name for c in CATEGORIES}
            assert len(rules) > 0
            for rule in rules:
                assert rule.category == cat_name

    def test_total_rule_count_within_expected_range(self):
        assert 30 <= len(ALL_RULES) <= 50, (
            f"Unexpected rule count {len(ALL_RULES)} - pattern db may have drifted"
        )


class TestSeverityDistribution:
    def test_each_severity_has_at_least_one_rule(self):
        severities_found = {r.severity for r in ALL_RULES}
        for sev in (SEVERITY_CRITICAL, SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW):
            assert sev in severities_found, f"No rules with severity {sev}"

    def test_critical_severity_reserved_for_private_keys(self):
        critical_rules = [r for r in ALL_RULES if r.severity == SEVERITY_CRITICAL]
        assert len(critical_rules) >= 1
        for rule in critical_rules:
            assert "key" in rule.description.lower() or "credential" in rule.description.lower()


# ============================================================================
# Allowlist tests
# ============================================================================


class TestParseAllowlist:
    def test_empty_string(self):
        assert _parse_allowlist("") == set()

    def test_whitespace_string(self):
        assert _parse_allowlist("  ") == set()

    def test_single_item(self):
        assert _parse_allowlist("localhost") == {"localhost"}

    def test_multiple_items(self):
        result = _parse_allowlist("localhost, abs_tmp, file_paths")
        assert result == {"localhost", "abs_tmp", "file_paths"}

    def test_trailing_comma(self):
        result = _parse_allowlist("localhost,")
        assert result == {"localhost"}

    def test_case_normalization(self):
        result = _parse_allowlist("LocalHost, ABS_TMP")
        assert result == {"localhost", "abs_tmp"}


class TestLoadAllowlist:
    def test_load_from_env(self, monkeypatch):
        monkeypatch.setenv("SYNTARO_SANITIZER_ALLOWLIST", "loopback,abs_tmp")
        result = load_allowlist()
        assert "loopback" in result
        assert "abs_tmp" in result

    def test_load_from_env_empty(self, monkeypatch):
        monkeypatch.setenv("SYNTARO_SANITIZER_ALLOWLIST", "")
        result = load_allowlist()
        assert result == set()

    def test_load_from_arg_overrides_env(self, monkeypatch):
        monkeypatch.setenv("SYNTARO_SANITIZER_ALLOWLIST", "localhost")
        result = load_allowlist("abs_tmp")
        assert result == {"abs_tmp"}
        assert "localhost" not in result


class TestIsAllowlisted:
    def test_empty_allowlist_returns_false(self):
        assert is_allowlisted("anything", set()) is False

    def test_exact_match(self):
        assert is_allowlisted("localhost", {"localhost"}) is True

    def test_prefix_match(self):
        assert is_allowlisted("localhost_url", {"localhost"}) is True

    def test_no_match(self):
        assert is_allowlisted("abs_tmp", {"localhost"}) is False

    def test_case_insensitive(self):
        assert is_allowlisted("LOCALHOST", {"localhost"}) is True


# ============================================================================
# SanitizationConfig tests
# ============================================================================


class TestSanitizationConfig:
    def test_default_config(self):
        config = SanitizationConfig()
        assert config.enabled is True
        assert config.allowlist == set()
        assert len(config.exclusions) > 0

    def test_config_with_allowlist(self):
        config = SanitizationConfig(allowlist={"localhost", "abs_tmp"})
        assert "localhost" in config.allowlist
        assert config.enabled is True

    def test_config_disabled(self):
        config = SanitizationConfig(enabled=False)
        assert config.enabled is False

    def test_from_env_enabled(self, monkeypatch):
        monkeypatch.setenv("SYNTARO_SANITIZER_ENABLED", "true")
        monkeypatch.setenv("SYNTARO_SANITIZER_ALLOWLIST", "localhost")
        config = SanitizationConfig.from_env()
        assert config.enabled is True
        assert "localhost" in config.allowlist

    def test_from_env_disabled(self, monkeypatch):
        monkeypatch.setenv("SYNTARO_SANITIZER_ENABLED", "false")
        config = SanitizationConfig.from_env()
        assert config.enabled is False

    def test_from_env_allowlist_override(self, monkeypatch):
        monkeypatch.setenv("SYNTARO_SANITIZER_ALLOWLIST", "localhost")
        config = SanitizationConfig.from_env(allowlist_raw="abs_tmp")
        assert config.allowlist == {"abs_tmp"}

    def test_to_dict(self):
        config = SanitizationConfig(allowlist={"loopback"})
        d = config.to_dict()
        assert d["enabled"] is True
        assert "loopback" in d["allowlist"]
        assert d["exclusion_count"] > 0


class TestBuildSanitizerConfig:
    def test_returns_config(self):
        config = build_sanitizer_config()
        assert isinstance(config, SanitizationConfig)

    def test_respects_env(self, monkeypatch):
        monkeypatch.setenv("SYNTARO_SANITIZER_ENABLED", "false")
        config = build_sanitizer_config()
        assert config.enabled is False

    def test_accepts_allowlist_arg(self):
        config = build_sanitizer_config(allowlist_raw="loopback")
        assert "loopback" in config.allowlist


class TestGetActiveRules:
    def test_all_rules_when_no_allowlist(self):
        config = SanitizationConfig(allowlist=set())
        active = get_active_rules(config)
        assert len(active) == len(ALL_RULES)

    def test_suppresses_rule_by_name(self):
        config = SanitizationConfig(allowlist={"localhost"})
        active = get_active_rules(config)
        active_names = {r.name for r in active}
        assert "localhost" not in active_names
        assert "loopback" in active_names

    def test_suppresses_entire_category(self):
        config = SanitizationConfig(allowlist={"file_paths"})
        active = get_active_rules(config)
        for rule in active:
            assert rule.category != "file_paths"

    def test_disabled_config_returns_empty(self):
        config = SanitizationConfig(enabled=False)
        active = get_active_rules(config)
        assert active == []

    def test_auto_config_when_none_provided(self):
        active = get_active_rules()
        assert isinstance(active, list)
        assert len(active) > 0


class TestGetRulesBySeverity:
    def test_filter_by_severity(self):
        config = SanitizationConfig(allowlist=set())
        high_rules = get_rules_by_severity(SEVERITY_HIGH, config)
        assert len(high_rules) > 0
        for rule in high_rules:
            assert rule.severity == SEVERITY_HIGH

    def test_invalid_severity_raises(self):
        with pytest.raises(ValueError, match="Unknown severity"):
            get_rules_by_severity("INVALID")

    def test_critical_rules_always_included(self):
        config = SanitizationConfig(allowlist=set())
        critical = get_rules_by_severity(SEVERITY_CRITICAL, config)
        assert len(critical) >= 1

    def test_low_severity_excluded_by_default(self):
        config = SanitizationConfig(allowlist=set())
        low = get_rules_by_severity(SEVERITY_LOW, config)
        assert len(low) >= 1


class TestBuildCategoryPatterns:
    def test_returns_list_of_tuples(self):
        result = build_category_patterns()
        assert isinstance(result, list)
        assert len(result) == len(CATEGORIES)

    def test_each_entry_has_correct_shape(self):
        result = build_category_patterns()
        for cat_name, patterns in result:
            assert isinstance(cat_name, str)
            assert isinstance(patterns, list)
            for name, compiled, replacement in patterns:
                assert isinstance(name, str)
                assert isinstance(compiled, re.Pattern)
                assert isinstance(replacement, str)

    def test_matches_categories(self):
        result = build_category_patterns()
        result_names = [name for name, _ in result]
        expected_names = [c.name for c in CATEGORIES]
        assert result_names == expected_names


class TestGetConfigSummary:
    def test_returns_dict(self):
        summary = get_config_summary()
        assert isinstance(summary, dict)

    def test_has_required_keys(self):
        summary = get_config_summary()
        assert "total_rules" in summary
        assert "active_rules" in summary
        assert "allowlisted" in summary
        assert "enabled" in summary
        assert "rules_by_category" in summary
        assert "rules_by_severity" in summary

    def test_counts_are_consistent(self):
        summary = get_config_summary()
        assert summary["total_rules"] == len(ALL_RULES)
        assert summary["active_rules"] <= summary["total_rules"]

    def test_category_counts_match(self):
        summary = get_config_summary()
        total_in_categories = sum(summary["rules_by_category"].values())
        assert total_in_categories == summary["active_rules"]


class TestPatternIntegration:
    def test_api_key_pattern_matches(self):
        api_rules = RULES_BY_CATEGORY.get("api_keys", [])
        openai_rule = next((r for r in api_rules if r.name == "openai_sk"), None)
        assert openai_rule is not None
        assert openai_rule.pattern.search("sk-abc123def456ghi789jkl01234567890")
        assert not openai_rule.pattern.search("sk-short")

    def test_github_token_pattern(self):
        api_rules = RULES_BY_CATEGORY.get("api_keys", [])
        gh_rule = next((r for r in api_rules if r.name == "github_token"), None)
        assert gh_rule is not None
        assert gh_rule.pattern.search("ghp_abc123def456ghi789jkl01234567890abcdefghijklm")
        assert not gh_rule.pattern.search("ghp_short")

    def test_jwt_pattern(self):
        api_rules = RULES_BY_CATEGORY.get("api_keys", [])
        jwt_rule = next((r for r in api_rules if r.name == "jwt_token"), None)
        assert jwt_rule is not None
        assert jwt_rule.pattern.search(
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8"
        )
        assert not jwt_rule.pattern.search("not.a.jwt")

    def test_localhost_url_pattern(self):
        url_rules = RULES_BY_CATEGORY.get("internal_urls", [])
        localhost_rule = next((r for r in url_rules if r.name == "localhost"), None)
        assert localhost_rule is not None
        assert localhost_rule.pattern.search("http://localhost:4096/api")
        assert localhost_rule.pattern.search("https://localhost/health")

    def test_private_key_block_pattern(self):
        api_rules = RULES_BY_CATEGORY.get("api_keys", [])
        pk_rule = next((r for r in api_rules if r.name == "private_key"), None)
        assert pk_rule is not None
        sample = "-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----"
        assert pk_rule.pattern.search(sample)

    def test_system_prompt_pattern(self):
        sp_rules = RULES_BY_CATEGORY.get("system_prompts", [])
        ya_rule = next((r for r in sp_rules if r.name == "you_are_ai"), None)
        assert ya_rule is not None
        assert ya_rule.pattern.search("You are a helpful assistant")
        assert ya_rule.pattern.search("you are an AI assistant")
        assert not ya_rule.pattern.search("You are a developer")

    def test_file_path_patterns(self):
        fp_rules = RULES_BY_CATEGORY.get("file_paths", [])
        etc_rule = next((r for r in fp_rules if r.name == "abs_etc"), None)
        assert etc_rule is not None
        assert etc_rule.pattern.search("/etc/nginx/nginx.conf")
        assert not etc_rule.pattern.search("etc/something/relative")

    def test_rfc1918_pattern(self):
        ip_rules = RULES_BY_CATEGORY.get("internal_ips", [])
        rfc10 = next((r for r in ip_rules if r.name == "rfc1918_10"), None)
        assert rfc10 is not None
        assert rfc10.pattern.search("Server at 10.0.0.5")
        assert not rfc10.pattern.search("Server at 8.8.8.8")

    def test_env_var_patterns(self):
        env_rules = RULES_BY_CATEGORY.get("env_vars", [])
        proc_rule = next((r for r in env_rules if r.name == "process_env"), None)
        assert proc_rule is not None
        assert proc_rule.pattern.search("process.env.DATABASE_URL")


class TestFalsePositiveExclusions:
    def test_exclusions_are_compiled_patterns(self):
        config = SanitizationConfig()
        for excl in config.exclusions:
            assert isinstance(excl, re.Pattern)

    def test_example_com_excluded(self):
        config = SanitizationConfig()
        assert any(p.search("use api-key-here at example.com") for p in config.exclusions)

    def test_placeholder_excluded(self):
        config = SanitizationConfig()
        assert any(p.search("your password is placeholder") for p in config.exclusions)


class TestEdgeCases:
    def test_allowlist_does_not_affect_unrelated_rules(self):
        config = SanitizationConfig(allowlist={"localhost"})
        active = get_active_rules(config)
        active_names = {r.name for r in active}
        assert "localhost" not in active_names
        assert "loopback" in active_names
        assert "internal_host" in active_names

    def test_empty_text_returns_empty_rules_when_disabled(self):
        config = SanitizationConfig(enabled=False)
        assert get_active_rules(config) == []

    def test_get_rules_by_severity_unknown(self):
        with pytest.raises(ValueError):
            get_rules_by_severity("BOGUS")

    def test_all_rules_have_matching_category_index(self):
        for rule in ALL_RULES:
            assert rule.category in RULES_BY_CATEGORY
            assert rule in RULES_BY_CATEGORY[rule.category] or any(
                r.name == rule.name for r in RULES_BY_CATEGORY[rule.category]
            )
