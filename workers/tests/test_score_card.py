"""Tests for workers/quality/score_card.py."""

from __future__ import annotations

import pytest

from workers.quality.score_card import (
    DimensionScore,
    QualityScoreCard,
    build_score_card,
    score_ac_coverage,
    score_card_to_dict,
    score_code_style,
    score_test_pass_rate,
)


class TestScoreTestPassRate:
    def test_all_pass(self):
        result = score_test_pass_rate(passed=10, total=10)
        assert result.score == 1.0
        assert result.raw["passed"] == 10
        assert result.raw["total"] == 10
        assert "100.0%" in result.details

    def test_high_rate(self):
        result = score_test_pass_rate(passed=19, total=20)
        assert result.score == 1.0

    def test_moderate_rate(self):
        result = score_test_pass_rate(passed=17, total=20)
        assert 0.5 <= result.score < 1.0

    def test_low_rate(self):
        result = score_test_pass_rate(passed=5, total=20)
        assert result.score == 0.125

    def test_zero_tests(self):
        result = score_test_pass_rate(passed=0, total=0)
        assert result.score == 0.0
        assert "No tests were executed" in result.details

    def test_failed_tests_listed(self):
        result = score_test_pass_rate(passed=8, total=10, failed_tests=["test_a", "test_b"])
        assert result.raw["failed"] == 2
        assert "test_a" in result.details
        assert "test_b" in result.details


class TestScoreACCoverage:
    def test_all_covered(self):
        ac = (
            "- User can log in with email\n"
            "- User sees error on invalid password\n"
            "- Rate limiter blocks after 5 attempts"
        )
        output = (
            "test_auth.py::test_login_with_email PASSED\n"
            "test_auth.py::test_invalid_password PASSED\n"
            "test_auth.py::test_rate_limiter PASSED\n"
        )
        result = score_ac_coverage(acceptance_criteria=ac, test_output=output)
        assert result.score > 0.5
        assert result.raw["ac_count"] == 3

    def test_no_acs(self):
        result = score_ac_coverage(acceptance_criteria="", test_output="")
        assert result.score == 1.0
        assert result.raw["ac_count"] == 0

    def test_with_test_names(self):
        ac = "- Handle edge case for empty input"
        result = score_ac_coverage(
            acceptance_criteria=ac,
            test_output="",
            test_names=["test_empty_input", "test_normal_case"],
        )
        assert result.score > 0
        assert result.raw["covered"] == 1

    def test_no_coverage(self):
        ac = "- Admin dashboard shows user analytics"
        result = score_ac_coverage(
            acceptance_criteria=ac,
            test_output="test_login.py::test_login PASSED",
        )
        assert result.score < 0.5


class TestScoreCodeStyle:
    def test_clean(self):
        result = score_code_style(lint_errors=0, lint_warnings=0, format_issues=0)
        assert result.score == 1.0
        assert "No issues found" in result.details

    def test_some_errors(self):
        result = score_code_style(lint_errors=3, lint_warnings=2, format_issues=1, total_files=5)
        assert 0 < result.score < 1.0

    def test_many_errors(self):
        result = score_code_style(lint_errors=50, lint_warnings=20, format_issues=10, total_files=1)
        assert result.score == 0.0

    def test_zero_files(self):
        result = score_code_style(lint_errors=1, total_files=0)
        assert 0 <= result.score <= 1.0

    def test_details_string(self):
        result = score_code_style(lint_errors=2, lint_warnings=3, format_issues=0, total_files=4)
        assert "2 error(s)" in result.details
        assert "3 warning(s)" in result.details
        assert "4 file(s)" in result.details


class TestBuildScoreCard:
    def test_perfect_scores(self):
        card = build_score_card(
            test_pass_rate=DimensionScore(score=1.0, raw={"passed": 10, "total": 10}),
            ac_coverage=DimensionScore(score=1.0, raw={"ac_count": 3, "covered": 3}),
            code_style=DimensionScore(score=1.0, raw={"lint_errors": 0}),
        )
        assert card.overall == 1.0

    def test_zero_scores(self):
        card = build_score_card(
            test_pass_rate=DimensionScore(score=0.0, raw={"passed": 0, "total": 10}),
            ac_coverage=DimensionScore(score=0.0, raw={"ac_count": 3, "covered": 0}),
            code_style=DimensionScore(score=0.0, raw={"lint_errors": 99}),
        )
        assert card.overall == 0.0

    def test_weighted(self):
        card = build_score_card(
            test_pass_rate=DimensionScore(score=0.8, raw={}),
            ac_coverage=DimensionScore(score=0.6, raw={}),
            code_style=DimensionScore(score=1.0, raw={}),
        )
        expected = 0.8 * 0.4 + 0.6 * 0.35 + 1.0 * 0.25
        assert card.overall == pytest.approx(expected)

    def test_custom_weights(self):
        card = build_score_card(
            test_pass_rate=DimensionScore(score=0.5, raw={}),
            ac_coverage=DimensionScore(score=0.5, raw={}),
            code_style=DimensionScore(score=0.5, raw={}),
            weights={"test_pass_rate": 0.5, "ac_coverage": 0.3, "code_style": 0.2},
        )
        assert card.overall == 0.5

    def test_score_card_to_dict(self):
        card = QualityScoreCard(
            test_pass_rate=DimensionScore(score=0.9, raw={"passed": 9, "total": 10}),
            ac_coverage=DimensionScore(score=0.7, raw={"ac_count": 3, "covered": 2}),
            code_style=DimensionScore(score=1.0, raw={"lint_errors": 0}),
            overall=0.86,
        )
        d = score_card_to_dict(card)
        assert d["overall"] == 0.86
        assert "test_pass_rate" in d["dimensions"]
        assert d["dimensions"]["test_pass_rate"]["score"] == 0.9
        assert d["dimensions"]["test_pass_rate"]["raw"]["passed"] == 9


def test_module_importable():
    import workers.quality.score_card  # noqa: F401

    assert True
