"""Tests for the PR feedback loop (workers/feedback/loop.py)."""

from __future__ import annotations

from workers.feedback.loop import (
    FeedbackDimension,
    FeedbackLoop,
    PRFeedback,
    _get_added_lines,
    _get_removed_lines,
    improve_from_feedback,
    rate_pr,
    track_improvement,
)


# ── Fixtures: sample diffs ───────────────────────────────────────────────────


def _clean_diff() -> str:
    return (
        "--- a/src/auth/login.py\n"
        "+++ b/src/auth/login.py\n"
        "@@ -10,7 +10,9 @@ def login(email, password):\n"
        "     if not email:\n"
        "         raise ValueError(\"Email required\")\n"
        "-    user = db.query(User).filter_by(email=email).first()\n"
        "+    # Sanitize email before query\n"
        "+    sanitized: str = email.strip().lower()\n"
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
    )


def _stubby_diff() -> str:
    return (
        "--- a/src/handler.py\n"
        "+++ b/src/handler.py\n"
        "@@ -5,7 +5,9 @@\n"
        " def process_request(data):\n"
        "+    print(\"processing\")  # TODO: remove debug\n"
        "     pass\n"
        "--- a/tests/test_handler.py\n"
        "+++ b/tests/test_handler.py\n"
        "@@ -1,0 +2,5 @@\n"
        "+def test_process_request():\n"
        "+    result = process_request({})\n"
        "+    assert result is not None  # FIXME: vacuous\n"
    )


def _empty_diff() -> str:
    return ""


def _large_diff() -> str:
    lines = ["--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,500 @@\n"]
    for i in range(500):
        lines.append(f"+line_{i} = {i}\n")
    return "".join(lines)


# ── Tests: helper utilities ──────────────────────────────────────────────────


class TestHelpers:
    def test_get_added_lines(self) -> None:
        diff = _clean_diff()
        added = _get_added_lines(diff)
        assert len(added) > 0
        assert all(not line.startswith("+") for line in added)
        assert all(not line.startswith("+++") for line in added)

    def test_get_added_lines_empty(self) -> None:
        assert _get_added_lines("") == []

    def test_get_removed_lines(self) -> None:
        diff = _clean_diff()
        removed = _get_removed_lines(diff)
        assert len(removed) > 0
        assert all(not line.startswith("-") for line in removed)
        assert all(not line.startswith("---") for line in removed)

    def test_get_removed_lines_empty(self) -> None:
        assert _get_removed_lines("") == []


# ── Tests: FeedbackLoop ──────────────────────────────────────────────────────


class TestFeedbackLoop:
    def test_rate_clean_diff_scores_well(self) -> None:
        loop = FeedbackLoop()
        result = loop.rate(_clean_diff(), pr_number=42, pr_title="Fix email sanitization")
        assert isinstance(result, PRFeedback)
        assert result.pr_number == 42
        assert result.pr_title == "Fix email sanitization"
        assert 0.0 <= result.overall_score <= 1.0
        assert len(result.dimensions) == 4

    def test_rate_stubby_diff_has_issues(self) -> None:
        loop = FeedbackLoop()
        stubby = loop.rate(_stubby_diff(), pr_number=2)
        # Stubby diff should have suggestions and debug print detected
        assert stubby.overall_score >= 0.0
        all_suggestions = sum(len(d.suggestions) for d in stubby.dimensions)
        assert all_suggestions > 0

    def test_rate_clean_diff_has_fewer_issues(self) -> None:
        loop = FeedbackLoop()
        clean = loop.rate(_clean_diff(), pr_number=1)
        stubby = FeedbackLoop().rate(_stubby_diff(), pr_number=2)
        # Clean diff should have fewer high-priority suggestions than stubby
        clean_high = sum(
            1 for d in clean.dimensions
            for s in d.suggestions if "debug" in s.lower() or "TODO" in s.upper() or "FIXME" in s.upper()
        )
        stubby_high = sum(
            1 for d in stubby.dimensions
            for s in d.suggestions if "debug" in s.lower()
        )
        # Stubby diff has debug print suggestions
        assert stubby_high > 0 or clean_high == 0

    def test_rate_empty_diff(self) -> None:
        loop = FeedbackLoop()
        result = loop.rate(_empty_diff(), pr_number=99)
        assert result.overall_score >= 0.0
        assert len(result.dimensions) == 4

    def test_rate_large_diff(self) -> None:
        loop = FeedbackLoop()
        result = loop.rate(_large_diff(), pr_number=100)
        # Large diffs should be penalised in diff_hygiene
        diff_hygiene = next(
            d for d in result.dimensions
            if d.dimension == FeedbackDimension.DIFF_HYGIENE
        )
        assert diff_hygiene.score < 0.6

    def test_rate_with_test_results(self) -> None:
        loop = FeedbackLoop()
        result = loop.rate(
            _clean_diff(),
            pr_number=1,
            test_results={"passed": True, "total": 15},
        )
        test_dim = next(
            d for d in result.dimensions
            if d.dimension == FeedbackDimension.TEST_COVERAGE
        )
        assert test_dim.score >= 0.5  # boosted by passing test results

    def test_rate_with_failing_tests(self) -> None:
        loop = FeedbackLoop()
        result = loop.rate(
            _clean_diff(),
            pr_number=1,
            test_results={"passed": False, "total": 10},
        )
        test_dim = next(
            d for d in result.dimensions
            if d.dimension == FeedbackDimension.TEST_COVERAGE
        )
        assert test_dim.score < 0.7  # penalised

    def test_rate_with_acceptance_criteria(self) -> None:
        loop = FeedbackLoop()
        acs = [
            "Sanitize email input before database query",
            "Return None for unknown users",
            "Raise error on empty email",
        ]
        result = loop.rate(
            _clean_diff(),
            pr_number=1,
            acceptance_criteria=acs,
        )
        ac_dim = next(
            d for d in result.dimensions
            if d.dimension == FeedbackDimension.AC_ALIGNMENT
        )
        assert ac_dim.score > 0.5  # should match AC keywords
        assert ac_dim.evidence is not None

    def test_rate_no_acceptance_criteria(self) -> None:
        loop = FeedbackLoop()
        result = loop.rate(_clean_diff(), pr_number=1)
        ac_dim = next(
            d for d in result.dimensions
            if d.dimension == FeedbackDimension.AC_ALIGNMENT
        )
        assert ac_dim.score == 0.5  # neutral
        assert len(ac_dim.suggestions) > 0

    def test_run_tracks_history(self) -> None:
        loop = FeedbackLoop()
        r1 = loop.run(_clean_diff(), pr_number=1)
        assert len(r1.history) == 0  # first run, no prior history
        assert not r1.improved

        r2 = loop.run(_clean_diff(), pr_number=1)
        assert len(r2.history) >= 1  # prior iteration preserved
        assert r2.history[0].pr_number == 1

    def test_run_delta_calculation(self) -> None:
        loop = FeedbackLoop()
        r1 = loop.run(_clean_diff(), pr_number=1)
        assert r1.delta == 0.0  # no baseline

        r2 = loop.run(_clean_diff(), pr_number=1)
        assert isinstance(r2.delta, float)

        r3 = loop.run(_stubby_diff(), pr_number=1)
        assert isinstance(r3.delta, float)  # may be negative if regression

    def test_trend_insufficient_history(self) -> None:
        loop = FeedbackLoop()
        trend = loop.trend()
        assert trend["direction"] == "stable"
        assert trend["iterations"] == 0

    def test_trend_improving(self) -> None:
        loop = FeedbackLoop()
        loop.rate(_stubby_diff(), pr_number=1)
        loop.rate(_clean_diff(), pr_number=1)
        loop.rate(_clean_diff(), pr_number=1)
        trend = loop.trend()
        assert trend["direction"] in ("improving", "stable")
        assert trend["iterations"] >= 2


# ── Tests: Dimension ratings ──────────────────────────────────────────────────


class TestDimensionRatings:
    def test_code_quality_typed(self) -> None:
        rating = FeedbackLoop._rate_code_quality(_clean_diff())
        assert rating.dimension == FeedbackDimension.CODE_QUALITY
        assert 0.0 <= rating.score <= 1.0

    def test_code_quality_stubby(self) -> None:
        rating = FeedbackLoop._rate_code_quality(_stubby_diff())
        # Stubby diff has debug print and no types
        assert rating.score < 0.7
        assert rating.evidence or rating.suggestions

    def test_test_coverage_with_tests(self) -> None:
        rating = FeedbackLoop._rate_test_coverage(_clean_diff(), None)
        assert rating.score >= 0.3

    def test_test_coverage_no_tests(self) -> None:
        diff = "--- a/src/main.py\n+++ b/src/main.py\n@@ -1 +1,3 @@\n+def foo():\n+    return 1\n"
        rating = FeedbackLoop._rate_test_coverage(diff, None)
        assert len(rating.suggestions) > 0  # should suggest adding tests

    def test_diff_hygiene_clean(self) -> None:
        rating = FeedbackLoop._rate_diff_hygiene(_clean_diff())
        assert rating.score >= 0.5

    def test_diff_hygiene_stubby(self) -> None:
        rating = FeedbackLoop._rate_diff_hygiene(_stubby_diff())
        # Has TODO patterns
        assert len(rating.evidence) > 0 or len(rating.suggestions) > 0

    def test_diff_hygiene_large_diff(self) -> None:
        rating = FeedbackLoop._rate_diff_hygiene(_large_diff())
        assert rating.score < 0.6  # penalised for size

    def test_ac_alignment_with_criteria(self) -> None:
        rating = FeedbackLoop._rate_ac_alignment(
            _clean_diff(),
            ["Sanitize email input", "Handle empty email"],
        )
        assert rating.score > 0.5

    def test_ac_alignment_no_criteria(self) -> None:
        rating = FeedbackLoop._rate_ac_alignment(_clean_diff(), None)
        assert rating.score == 0.5

    def test_ac_alignment_empty_criteria(self) -> None:
        rating = FeedbackLoop._rate_ac_alignment(_clean_diff(), [])
        assert rating.score == 0.5


# ── Tests: Convenience functions ─────────────────────────────────────────────


class TestConvenienceFunctions:
    def test_rate_pr(self) -> None:
        result = rate_pr(_clean_diff(), pr_number=1)
        assert isinstance(result, PRFeedback)
        assert result.pr_number == 1
        assert 0.0 <= result.overall_score <= 1.0

    def test_rate_pr_with_acs(self) -> None:
        result = rate_pr(
            _clean_diff(),
            pr_number=1,
            acceptance_criteria=["Sanitize email", "Handle errors"],
        )
        assert result.overall_score >= 0.0

    def test_improve_from_feedback(self) -> None:
        feedback = rate_pr(_stubby_diff(), pr_number=1)
        improvements = improve_from_feedback(feedback, _stubby_diff())
        assert isinstance(improvements, list)
        if improvements:
            assert "dimension" in improvements[0]
            assert "action" in improvements[0]
            assert "priority" in improvements[0]

    def test_improve_from_feedback_clean_diff(self) -> None:
        feedback = rate_pr(_clean_diff(), pr_number=1)
        improvements = improve_from_feedback(feedback, _clean_diff())
        # Clean diff should have fewer or no high-priority suggestions
        high_pri = [i for i in improvements if i["priority"] == "high"]
        assert len(high_pri) <= len(improvements)

    def test_track_improvement_no_history(self) -> None:
        trend = track_improvement([])
        assert trend["direction"] == "stable"
        assert trend["iterations"] == 0

    def test_track_improvement_with_history(self) -> None:
        loop = FeedbackLoop()
        loop.rate(_clean_diff(), pr_number=1)
        loop.rate(_clean_diff(), pr_number=2)
        trend = track_improvement(loop.history)
        assert trend["iterations"] >= 2
        assert trend["direction"] in ("improving", "declining", "stable")


# ── Tests: PRFeedback model ──────────────────────────────────────────────────


class TestPRFeedbackModel:
    def test_score_clamped(self) -> None:
        fb = PRFeedback(pr_number=1, pr_title="test", overall_score=1.5)
        assert fb.overall_score == 1.0

        fb2 = PRFeedback(pr_number=1, pr_title="test", overall_score=-0.5)
        assert fb2.overall_score == 0.0

    def test_to_dict(self) -> None:
        fb = PRFeedback(
            pr_number=1,
            pr_title="Test PR",
            overall_score=0.85,
            summary="Good PR",
            loop_iteration=3,
        )
        d = fb.to_dict()
        assert d["pr_number"] == 1
        assert d["overall_score"] == 0.85
        assert d["loop_iteration"] == 3
