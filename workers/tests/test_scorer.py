"""Tests for the real-time quality scorer (workers/quality/scorer.py)."""

from __future__ import annotations

from workers.quality.scorer import (
    ScorerConfig,
    ScorerResult,
    _count_files_changed,
    _get_added_lines,
    _score_diff_quality,
    _score_hallucination_risk,
    _score_regression_safety,
    _score_test_integrity,
    score_fix,
)
from workers.quality.scorer_config import get_config


# ── Fixtures: sample diffs ─────────────────────────────────────────────────


def _clean_fix_diff() -> str:
    return (
        "--- a/src/auth/login.py\n"
        "+++ b/src/auth/login.py\n"
        "@@ -10,7 +10,9 @@ def login(email, password):\n"
        "     if not email:\n"
        "         raise ValueError(\"Email required\")\n"
        "-    user = db.query(User).filter_by(email=email).first()\n"
        "+    # Sanitize email before query\n"
        "+    sanitized = email.strip().lower()\n"
        "+    user = db.query(User).filter_by(email=sanitized).first()\n"
        "     if not user:\n"
        "         return None\n"
        "--- a/tests/test_login.py\n"
        "+++ b/tests/test_login.py\n"
        "@@ -1,0 +2,12 @@\n"
        "+def test_login_sanitizes_email():\n"
        "+    result = login(\"  Test@Example.COM  \")\n"
        "+    assert result is not None\n"
        "+    assert result.email == \"test@example.com\"\n"
        "+\n"
        "+def test_login_rejects_empty_email():\n"
        "+    with pytest.raises(ValueError):\n"
        "+        login(\"\", \"password\")\n"
        "+\n"
        "+def test_login_returns_none_for_unknown():\n"
        "+    result = login(\"unknown@test.com\", \"pass\")\n"
        "+    assert result is None\n"
    )


def _stubby_fix_diff() -> str:
    return (
        "--- a/src/handler.py\n"
        "+++ b/src/handler.py\n"
        "@@ -5,7 +5,9 @@\n"
        " def process_request(data):\n"
        "-    # TODO: implement this\n"
        "+    # FIXME: need to actually process\n"
        "     pass\n"
        "--- a/tests/test_handler.py\n"
        "+++ b/tests/test_handler.py\n"
        "@@ -1,0 +2,5 @@\n"
        "+def test_process_request():\n"
        "+    # TODO: add real assertions later\n"
        "+    result = process_request({})\n"
        "+    assert result is not None  # placeholder\n"
    )


def _empty_diff() -> str:
    return ""


def _massive_diff() -> str:
    lines = ["--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,500 @@\n"]
    for i in range(500):
        lines.append(f"+line_{i} = {i}\n")
    return "".join(lines)


def _multi_file_diff() -> str:
    return (
        "--- a/src/a.py\n+++ b/src/a.py\n@@ -1 +1,2 @@\n+new_a\n"
        "--- a/src/b.py\n+++ b/src/b.py\n@@ -1 +1,2 @@\n+new_b\n"
        "--- a/src/c.py\n+++ b/src/c.py\n@@ -1 +1,2 @@\n+new_c\n"
        "--- a/src/d.py\n+++ b/src/d.py\n@@ -1 +1,2 @@\n+new_d\n"
    )


# ── Test: score_fix end-to-end ─────────────────────────────────────────────


def test_score_fix_clean_fix_scores_high():
    """A clean fix with tests and assertions should score >= 70."""
    result = score_fix(
        _clean_fix_diff(),
        test_results={"passed": True, "total": 10},
    )
    assert isinstance(result, ScorerResult)
    assert result.score >= 70, f"Expected >= 70, got {result.score}"
    assert result.passed is True
    assert "test_integrity" in result.breakdown
    assert result.breakdown["test_integrity"]["score"] > 0.5


def test_score_fix_stubby_fix_scores_low():
    """A fix with TODOs and stubs should score below a clean fix."""
    clean_result = score_fix(
        _clean_fix_diff(),
        test_results={"passed": True, "total": 10},
    )
    stubby_result = score_fix(
        _stubby_fix_diff(),
        test_results={"passed": True, "total": 3},
    )
    assert isinstance(stubby_result, ScorerResult)
    assert stubby_result.score < clean_result.score - 10, (
        f"Stubby {stubby_result.score} not < Clean {clean_result.score} - 10"
    )
    assert stubby_result.breakdown["hallucination_risk"]["score"] < 0.6


def test_score_fix_empty_diff_scores_low():
    """An empty diff should score low (no changes = no fix value)."""
    result = score_fix("")
    assert isinstance(result, ScorerResult)
    assert result.score < 40, f"Expected < 40, got {result.score}"
    assert result.passed is False


def test_score_fix_with_failing_tests():
    """A fix whose tests fail should suffer in regression safety."""
    result = score_fix(
        _clean_fix_diff(),
        test_results={"passed": False, "total": 5, "previous_passed": True},
    )
    assert result.breakdown["regression_safety"]["score"] < 0.5
    # The fix might still pass other dimensions
    assert isinstance(result.score, int) and 0 <= result.score <= 100
    assert result.passed is False  # failing tests are a red flag


def test_score_fix_no_test_results_is_lenient():
    """Without test results, the scorer should be neutral on that dimension."""
    result = score_fix(_clean_fix_diff())
    assert 0 <= result.score <= 100
    # Test integrity should not penalise for lack of test results
    assert result.breakdown["test_integrity"]["details"]["test_results_passed"] is None


def test_score_fix_returns_int():
    """score_fix must always return a 0-100 integer."""
    result = score_fix("@@ -1 +1,2 @@\n+new_line\n")
    assert isinstance(result.score, int)
    assert 0 <= result.score <= 100


def test_score_fix_accepts_custom_config():
    """A custom config should be honoured."""
    cfg = ScorerConfig(pass_threshold=10.0)
    result = score_fix(
        _clean_fix_diff(),
        test_results={"passed": True, "total": 10},
        config=cfg,
    )
    # With low threshold, even mediocre diffs pass
    assert isinstance(result, ScorerResult)
    # Config snapshot should be in result
    assert result.config_used["thresholds"]["pass"] == 10.0


# ── Test: dimension scorers ────────────────────────────────────────────────


def test_score_test_integrity_with_tests_and_assertions():
    score, details = _score_test_integrity(
        _clean_fix_diff(),
        {"passed": True, "total": 10},
    )
    assert score > 0.5
    assert details["test_files_changed"] >= 1
    assert details["assertion_count"] >= 3


def test_score_test_integrity_without_tests():
    score, details = _score_test_integrity(
        "--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,2 @@\n+new_line\n",
        None,
    )
    assert score < 0.5  # no tests = low score
    assert details["test_files_changed"] == 0
    assert details["assertion_count"] == 0


def test_score_test_integrity_with_vacuous_tests():
    """Tests with no assertions should score lower than tests with assertions."""
    diff = (
        "--- a/tests/test_foo.py\n+++ b/tests/test_foo.py\n"
        "@@ -0,0 +1,3 @@\n+def test_foo():\n+    pass\n"
    )
    score_no_assert, details = _score_test_integrity(diff, {"passed": True, "total": 1})
    score_with_assert, _ = _score_test_integrity(
        _clean_fix_diff(), {"passed": True, "total": 10},
    )
    assert score_no_assert < score_with_assert, "Vacuous tests should score lower"
    assert details["assertion_count"] == 0


def test_score_hallucination_risk_clean():
    """Clean code should score 1.0 on hallucination risk."""
    score, details = _score_hallucination_risk(
        "--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,2 @@\n+valid_code\n",
        ["TODO", "FIXME"],
    )
    assert score == 1.0
    assert details["stub_count"] == 0


def test_score_hallucination_risk_with_todos():
    """Code with TODOs should be penalised."""
    score, details = _score_hallucination_risk(
        "--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,3 @@\n+    # TODO: implement\n+    pass\n",
        ["TODO", "FIXME"],
    )
    assert score < 0.6
    assert details["stub_count"] > 0


def test_score_hallucination_risk_no_added_lines():
    """No added lines = no hallucination risk."""
    score, details = _score_hallucination_risk("", ["TODO"])
    assert score == 1.0
    assert details["total_added_lines"] == 0


def test_score_diff_quality_concise():
    """A concise diff should score well."""
    score, details = _score_diff_quality(
        "--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,2 @@\n+new_line\n",
        ["print("],
    )
    assert score > 0.3
    assert details["added_lines"] == 1


def test_score_diff_quality_with_debug():
    """Debug print statements should be penalised."""
    diff = (
        "--- a/src/main.py\n+++ b/src/main.py\n@@ -5,7 +5,9 @@\n"
        " def compute():\n"
        "+    print(\"debug: computing...\")\n"
        "     result = do_stuff()\n"
    )
    score, details = _score_diff_quality(diff, ["print("])
    assert score < 0.5  # penalised
    assert details["debug_count"] > 0


def test_score_diff_quality_too_large():
    """Massive diffs should be penalised."""
    score, details = _score_diff_quality(_massive_diff(), ["print("])
    assert score < 0.3
    assert details["added_lines"] >= 500


def test_score_diff_quality_empty():
    """Empty diff = no changes = bad quality."""
    score, details = _score_diff_quality("", ["print("])
    assert score == 0.0
    assert details["added_lines"] == 0


def test_score_regression_safety_tests_pass():
    score, details = _score_regression_safety(
        _clean_fix_diff(),
        {"passed": True, "total": 10, "previous_passed": True},
    )
    assert score > 0.5
    assert details["tests_passed"] is True


def test_score_regression_safety_tests_fail():
    score, details = _score_regression_safety(
        _clean_fix_diff(),
        {"passed": False, "total": 5, "previous_passed": True},
    )
    assert score < 0.4
    assert details["tests_passed"] is False


def test_score_regression_safety_no_results():
    score, details = _score_regression_safety(_clean_fix_diff(), None)
    assert score > 0  # neutral
    assert details["tests_passed"] is None


def test_score_regression_safety_many_files():
    """Touching too many files is penalised."""
    score, details = _score_regression_safety(_multi_file_diff(), None)
    assert score < 0.5
    assert details["files_changed"] >= 4


# ── Test: ScorerConfig ────────────────────────────────────────────────────


def test_scorer_config_defaults():
    cfg = ScorerConfig()
    assert cfg.weight_test_integrity == 25.0
    assert cfg.weight_hallucination_risk == 25.0
    assert cfg.weight_diff_quality == 25.0
    assert cfg.weight_regression_safety == 25.0
    assert cfg.pass_threshold == 70.0
    assert cfg.warn_threshold == 50.0
    assert cfg.fail_threshold == 30.0
    assert len(cfg.stub_patterns) > 0
    assert len(cfg.debug_patterns) > 0


def test_scorer_config_to_dict():
    cfg = ScorerConfig()
    d = cfg.to_dict()
    assert "weights" in d
    assert "thresholds" in d
    assert "patterns" in d
    assert d["thresholds"]["pass"] == 70.0


def test_get_config():
    cfg = get_config()
    assert isinstance(cfg, dict)
    assert "weights" in cfg
    assert "thresholds" in cfg


# ── Test: helpers ──────────────────────────────────────────────────────────


def test_get_added_lines():
    diff = (
        "--- a/src/main.py\n"
        "+++ b/src/main.py\n"
        "@@ -1 +1,3 @@\n"
        " unchanged\n"
        "+added1\n"
        "+added2\n"
    )
    lines = _get_added_lines(diff)
    assert lines == ["added1", "added2"]


def test_get_added_lines_skips_header():
    diff = "+++ b/src/main.py\n+real_added\n"
    lines = _get_added_lines(diff)
    assert lines == ["real_added"]


def test_get_added_lines_empty():
    assert _get_added_lines("") == []


def test_count_files_changed():
    assert _count_files_changed(_multi_file_diff()) == 4


def test_count_files_changed_empty():
    assert _count_files_changed("") == 0


def test_scorer_result_to_dict():
    result = ScorerResult(
        score=85,
        breakdown={"test": {"score": 0.9}},
        passed=True,
        config_used={"thresholds": {}},
    )
    d = result.to_dict()
    assert d["score"] == 85
    assert d["passed"] is True
    assert d["breakdown"]["test"]["score"] == 0.9


# ── Test: edge cases ───────────────────────────────────────────────────────


def test_score_fix_malformed_diff():
    """Malformed or random strings should not crash."""
    result = score_fix("not a diff at all, just random text\n")
    assert isinstance(result, ScorerResult)
    assert 0 <= result.score <= 100


def test_score_fix_with_test_results_none():
    result = score_fix(_clean_fix_diff(), test_results=None)
    assert isinstance(result, ScorerResult)
    assert 0 <= result.score <= 100


def test_score_fix_no_tests_in_diff():
    """A fix diff that doesn't touch test files."""
    diff = "--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,2 @@\n+new_code\n"
    result = score_fix(diff, test_results={"passed": True, "total": 0})
    assert result.breakdown["test_integrity"]["details"]["test_files_changed"] == 0


def test_hallucination_multiple_stubs():
    """Multiple stubs should drive score to near zero."""
    diff_lines = ["--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,10 @@\n"]
    for i in range(5):
        diff_lines.append(f"+    # TODO: implement part {i}\n")
        diff_lines.append(f"+    pass\n")
    diff = "".join(diff_lines)
    score, details = _score_hallucination_risk(diff, ["TODO", "FIXME"])
    assert details["stub_count"] >= 5
    assert score < 0.3  # multiple stubs = very bad
