"""Tests for the quality score calculator (``marketing/quality_score.py``).

Covers the core scoring formula, grade conversion, typo-tolerant status
parsing, and the CampaignStore-backed integration function.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from marketing.quality_score import (
    STATUS_COMPLETED_PATTERNS,
    STATUS_PENDING_PATTERNS,
    compute_quality_score,
    compute_quality_score_from_campaign,
    grade_from_score,
    is_status_completed,
    is_status_pending,
)


# ===================================================================
# Core scoring formula
# ===================================================================


class TestComputeQualityScore:
    """Direct tests for ``compute_quality_score()`` — pure function, no I/O."""

    def test_baseline_only(self) -> None:
        """Zero execution, zero platforms, zero actions → score = 15."""
        score = compute_quality_score(
            execution_rate=0.0,
            platform_coverage=0,
            total_actions=0,
            marketplace_published=False,
        )
        assert score == 15

    def test_maximum(self) -> None:
        """Perfect execution, full coverage, high volume, marketplace → 100."""
        score = compute_quality_score(
            execution_rate=1.0,
            platform_coverage=6,
            total_actions=200,
            marketplace_published=True,
        )
        assert score == 100

    def test_mid_range(self) -> None:
        """0.5 exec, 3 platforms, 50 actions, no marketplace → 52.

        Calculation: (0.5×30) + (3/6×20) + (50/100×25) + 15
                   = 15 + 10 + 12.5 + 15 = 52.5 → round = 52
        """
        score = compute_quality_score(
            execution_rate=0.5,
            platform_coverage=3,
            total_actions=50,
            marketplace_published=False,
        )
        assert score == 52

    def test_ceiling_at_100(self) -> None:
        """Score is capped at 100 even when inputs would exceed it."""
        score = compute_quality_score(
            execution_rate=2.0,  # would give 60 raw
            platform_coverage=99,  # would give 330 raw
            total_actions=9999,
            marketplace_published=True,
        )
        assert score == 100

    def test_partial_platform_coverage(self) -> None:
        """1 platform out of 6 → (1/6)*20 = 3.33... rounded."""
        score = compute_quality_score(
            execution_rate=0.0,
            platform_coverage=1,
            total_actions=0,
            marketplace_published=False,
        )
        # baseline 15 + (1/6)*20 = 15 + 3.33... = 18 (rounded)
        assert score == 18

    def test_marketplace_bonus(self) -> None:
        """Marketplace published adds exactly 10 points."""
        without = compute_quality_score(1.0, 6, 100, marketplace_published=False)
        with_ = compute_quality_score(1.0, 6, 100, marketplace_published=True)
        assert with_ - without == 10

    def test_total_actions_capped_at_100(self) -> None:
        """More than 100 actions contributes max 25 (min(total/100, 1)*25)."""
        score_100 = compute_quality_score(0.0, 0, 100, False)
        score_500 = compute_quality_score(0.0, 0, 500, False)
        assert score_100 == score_500

    def test_execution_rate_scales_linearly(self) -> None:
        """0.5 exec → total 30; 1.0 exec → total 45."""
        score_half = compute_quality_score(0.5, 0, 0, False)
        score_full = compute_quality_score(1.0, 0, 0, False)
        # (0.5×30) + 15 = 15 + 15 = 30
        assert score_half == 30
        # (1.0×30) + 15 = 30 + 15 = 45
        assert score_full == 45

    def test_zero_execution_still_has_baseline(self) -> None:
        """Even with zero everything, baseline 15 is included."""
        score = compute_quality_score(0.0, 0, 0, False)
        assert score == 15


# ===================================================================
# Grade conversion
# ===================================================================


class TestGradeFromScore:
    def test_A_grade(self) -> None:
        assert grade_from_score(100) == "A"
        assert grade_from_score(95) == "A"
        assert grade_from_score(90) == "A"

    def test_B_grade(self) -> None:
        assert grade_from_score(89) == "B"
        assert grade_from_score(85) == "B"
        assert grade_from_score(80) == "B"

    def test_C_grade(self) -> None:
        assert grade_from_score(79) == "C"
        assert grade_from_score(75) == "C"
        assert grade_from_score(70) == "C"

    def test_D_grade(self) -> None:
        assert grade_from_score(69) == "D"
        assert grade_from_score(65) == "D"
        assert grade_from_score(60) == "D"

    def test_F_grade(self) -> None:
        assert grade_from_score(59) == "F"
        assert grade_from_score(30) == "F"
        assert grade_from_score(0) == "F"


# ===================================================================
# Status parsing (typo-tolerant)
# ===================================================================


class TestIsStatusCompleted:
    def test_replied(self) -> None:
        assert is_status_completed("replied") is True

    def test_repled_typo(self) -> None:
        """The known sheet typo ``repled`` must be treated as completed."""
        assert is_status_completed("repled") is True

    def test_posted(self) -> None:
        assert is_status_completed("posted") is True

    def test_completed(self) -> None:
        assert is_status_completed("completed") is True

    def test_done(self) -> None:
        assert is_status_completed("done") is True

    def test_case_insensitive(self) -> None:
        assert is_status_completed("REPLIED") is True
        assert is_status_completed("Repled") is True
        assert is_status_completed("Posted") is True

    def test_substring_match(self) -> None:
        """Any status containing 'replied' anywhere matches."""
        assert is_status_completed("pending -> replied") is True
        assert is_status_completed("not repled yet") is True

    def test_pending_not_completed(self) -> None:
        assert is_status_completed("pending") is False
        assert is_status_completed("planned") is False
        assert is_status_completed("draft") is False

    def test_empty_string(self) -> None:
        assert is_status_completed("") is False

    def test_gibberish(self) -> None:
        assert is_status_completed("xyzzy") is False

    def test_status_with_prefix_suffix(self) -> None:
        """Prefixes/suffixes like 'pending (replied)' should still match."""
        assert is_status_completed("pending (replied)") is True
        assert is_status_completed("partial repled") is True
        assert is_status_completed("marked as posted today") is True

    def test_all_completed_patterns_are_recognised(self) -> None:
        """Every pattern in STATUS_COMPLETED_PATTERNS returns True."""
        for pattern in STATUS_COMPLETED_PATTERNS:
            assert is_status_completed(pattern) is True, (
                f"Pattern {pattern!r} should be recognised as completed"
            )


class TestIsStatusPending:
    def test_pending(self) -> None:
        assert is_status_pending("pending") is True

    def test_planned(self) -> None:
        assert is_status_pending("planned") is True

    def test_draft(self) -> None:
        assert is_status_pending("draft") is True

    def test_case_insensitive(self) -> None:
        assert is_status_pending("PENDING") is True
        assert is_status_pending("Planned") is True
        assert is_status_pending("DRAFT") is True

    def test_completed_not_pending(self) -> None:
        assert is_status_pending("completed") is False
        assert is_status_pending("replied") is False
        assert is_status_pending("done") is False

    def test_empty_string(self) -> None:
        assert is_status_pending("") is False

    def test_all_pending_patterns_are_recognised(self) -> None:
        """Every pattern in STATUS_PENDING_PATTERNS returns True."""
        for pattern in STATUS_PENDING_PATTERNS:
            assert is_status_pending(pattern) is True, (
                f"Pattern {pattern!r} should be recognised as pending"
            )


# ===================================================================
# CampaignStore-backed scorer
# ===================================================================


class TestComputeQualityScoreFromCampaign:
    """Integration-style tests with a mocked CampaignStore."""

    @pytest.fixture
    def store(self) -> MagicMock:
        return MagicMock()

    def test_no_campaign_returns_baseline(self, store: MagicMock) -> None:
        store.get_campaign.return_value = None
        score = compute_quality_score_from_campaign(store, "nonexistent")
        assert score == 15

    def test_no_actions_returns_baseline(self, store: MagicMock) -> None:
        store.get_campaign.return_value = {
            "id": "camp1",
            "config_json": "{}",
        }
        store.get_actions.return_value = []
        score = compute_quality_score_from_campaign(store, "camp1")
        assert score == 15

    def test_all_completed_full_coverage_marketplace(self, store: MagicMock) -> None:
        """6 platforms, all completed, marketplace → 76 (actions volume caps score)."""
        store.get_campaign.return_value = {
            "id": "camp1",
            "config_json": json.dumps({"marketplace_published": True}),
        }
        store.get_actions.return_value = [
            {"platform": "reddit", "status": "replied"},
            {"platform": "twitter", "status": "posted"},
            {"platform": "discord", "status": "completed"},
            {"platform": "telegram", "status": "repled"},
            {"platform": "linkedin", "status": "done"},
            {"platform": "youtube", "status": "replied"},
        ]
        score = compute_quality_score_from_campaign(store, "camp1")
        # (1.0×30) + (6/6×20) + (6/100×25) + 15 + 10 = 30+20+1.5+15+10 = 76.5 → 76
        assert score == 76

    def test_half_execution_partial_coverage(self, store: MagicMock) -> None:
        store.get_campaign.return_value = {
            "id": "camp1",
            "config_json": "{}",
        }
        store.get_actions.return_value = [
            {"platform": "reddit", "status": "replied"},
            {"platform": "reddit", "status": "pending"},
            {"platform": "twitter", "status": "replied"},
            {"platform": "twitter", "status": "pending"},
        ]
        # 2 completed / 4 total = 0.5 exec rate
        # 2 unique platforms
        # 4 total actions
        # no marketplace
        score = compute_quality_score_from_campaign(store, "camp1")
        # (0.5*30) + (2/6*20) + (4/100*25) + 15 + 0
        # = 15 + 6.67... + 1 + 15
        # ≈ 38 (rounded)
        assert score == 38

    def test_config_json_as_dict_already_parsed(self, store: MagicMock) -> None:
        """CampaignStore may return parsed JSON; handle both str and dict."""
        store.get_campaign.return_value = {
            "id": "camp1",
            "config_json": {"marketplace_published": True},
        }
        store.get_actions.return_value = [
            {"platform": "reddit", "status": "replied"},
        ]
        score = compute_quality_score_from_campaign(store, "camp1")
        assert score > 15  # marketplace bonus included

    def test_malformed_config_json(self, store: MagicMock) -> None:
        """Malformed JSON should not crash — treated as empty config."""
        store.get_campaign.return_value = {
            "id": "camp1",
            "config_json": "not valid json{{{",
        }
        store.get_actions.return_value = []
        score = compute_quality_score_from_campaign(store, "camp1")
        assert score == 15

    def test_actions_with_no_platform_ignored_in_coverage(
        self, store: MagicMock,
    ) -> None:
        """Actions without a platform key should not count toward coverage."""
        store.get_campaign.return_value = {
            "id": "camp1",
            "config_json": "{}",
        }
        store.get_actions.return_value = [
            {"status": "replied"},  # no platform key
            {"platform": None, "status": "replied"},  # platform is None
            {"platform": "reddit", "status": "replied"},
        ]
        score = compute_quality_score_from_campaign(store, "camp1")
        # All 3 "replied" → completed → exec_rate = 1.0
        # 1 unique platform (reddit only; "" and None excluded)
        # (1.0×30) + (1/6×20) + (3/100×25) + 15
        # = 30 + 3.33... + 0.75 + 15 ≈ 49 (rounded)
        assert score == 49

    def test_typo_in_action_status(self, store: MagicMock) -> None:
        """Action with 'repled' status is counted as completed."""
        store.get_campaign.return_value = {
            "id": "camp1",
            "config_json": "{}",
        }
        store.get_actions.return_value = [
            {"platform": "reddit", "status": "repled"},
            {"platform": "twitter", "status": "pending"},
        ]
        score = compute_quality_score_from_campaign(store, "camp1")
        # 1 completed / 2 total = 0.5 exec
        # 2 platforms
        # (0.5×30) + (2/6×20) + (2/100×25) + 15
        # = 15 + 6.67 + 0.5 + 15 ≈ 37 (rounded)
        assert score == 37
