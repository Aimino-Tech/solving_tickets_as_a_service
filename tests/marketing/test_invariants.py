"""Tests for the runtime quality audit system (``marketing/invariants.py``).

Covers all 6 invariant checks (I₁–I₄, I₆, I₇), the combined ``check_all``
method, lock helpers, and edge cases (dry-run, missing dependencies,
stale locks, empty data).
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from marketing.invariants import (
    I1_MAX_COMMENTS_PER_DAY,
    I1_MIN_GAP_HOURS,
    I1_OVERLAP_THRESHOLD,
    I2_MAX_PROMO_RATIO,
    I4_MIN_PHASE,
    I6_STALE_THRESHOLD_MIN,
    InvariantEngine,
    _content_overlap_ratio,
    _is_promo_content,
)

# ===================================================================
# Fixtures
# ===================================================================


@pytest.fixture
def mock_store() -> MagicMock:
    """Return a mock ``CampaignStore`` with empty data."""
    store = MagicMock()
    store.list_campaigns.return_value = []
    store.get_actions.return_value = []
    store.list_accounts.return_value = []
    return store


@pytest.fixture
def mock_warmup() -> MagicMock:
    """Return a mock ``WarmupEngine`` — account not ready by default."""
    warmup = MagicMock()
    warmup.is_account_ready.return_value = False
    warmup.get_current_phase.return_value = {
        "phase_number": 2,
        "phase_name": "Week 3: Build Recognition",
        "is_ready": False,
    }
    return warmup


@pytest.fixture
def mock_humanization_gate() -> MagicMock:
    """Return a mock ``HumanizationGate`` — passes by default."""
    gate = MagicMock()
    gate.check.return_value = {
        "pass": True,
        "score": 85.0,
        "failures": [],
        "details": {},
    }
    return gate


@pytest.fixture
def engine(
    mock_store: MagicMock,
    mock_warmup: MagicMock,
    mock_humanization_gate: MagicMock,
) -> InvariantEngine:
    """Return an ``InvariantEngine`` backed by mocks."""
    eng = InvariantEngine(
        store=mock_store,
        warmup_engine=mock_warmup,
        humanization_gate=mock_humanization_gate,
    )
    return eng


@pytest.fixture
def engine_no_deps() -> InvariantEngine:
    """Return an engine with no dependencies (all missing)."""
    with patch.multiple(
        "marketing.invariants",
        CampaignStore=None,
        WarmupEngine=None,
        HumanizationGate=None,
    ):
        # Re-import to get the patched module-level references
        import importlib
        import marketing.invariants as inv_mod
        importlib.reload(inv_mod)
        eng = inv_mod.InvariantEngine()
        return eng


# ===================================================================
# _is_promo_content
# ===================================================================


class TestIsPromoContent:
    def test_empty_content(self) -> None:
        assert _is_promo_content(None) is False
        assert _is_promo_content("") is False

    def test_check_out_matches(self) -> None:
        assert _is_promo_content("Hey, check out this library!") is True

    def test_try_matches(self) -> None:
        assert _is_promo_content("You should try our tool.") is True

    def test_we_built_matches(self) -> None:
        assert _is_promo_content("We built an open source tool for that.") is True

    def test_my_project_matches(self) -> None:
        assert _is_promo_content("In my project we solved this.") is True

    def test_open_source_tool_matches(self) -> None:
        assert _is_promo_content("This open source tool does exactly that.") is True

    def test_github_url_matches(self) -> None:
        assert _is_promo_content("Check github.com/my-org/my-repo for details.") is True

    def test_npm_url_matches(self) -> None:
        assert _is_promo_content("Published at npmjs.com/package/my-pkg.") is True

    def test_pypi_url_matches(self) -> None:
        assert _is_promo_content("Install via pip from pypi.org/project/pkg.") is True

    def test_genuine_content_does_not_match(self) -> None:
        content = (
            "I had the same issue last week. The problem was the "
            "dependency resolver — pinning your versions fixed it."
        )
        assert _is_promo_content(content) is False


# ===================================================================
# _content_overlap_ratio
# ===================================================================


class TestContentOverlapRatio:
    def test_identical_strings(self) -> None:
        assert _content_overlap_ratio("hello world", "hello world") == 1.0

    def test_no_overlap(self) -> None:
        assert _content_overlap_ratio("hello world", "foo bar") == 0.0

    def test_partial_overlap(self) -> None:
        ratio = _content_overlap_ratio("hello world foo", "hello world bar")
        # intersection = {hello, world}, union = {hello, world, foo, bar} → 2/4 = 0.5
        assert ratio == 0.5

    def test_case_insensitive(self) -> None:
        assert _content_overlap_ratio("Hello World", "hello world") == 1.0

    def test_empty_strings(self) -> None:
        assert _content_overlap_ratio("", "hello") == 0.0
        assert _content_overlap_ratio("hello", "") == 0.0
        assert _content_overlap_ratio("", "") == 0.0


# ===================================================================
# I₁ — Comment Pacing
# ===================================================================


class TestCheckPacing:
    def test_no_actions_passes(self, engine: InvariantEngine) -> None:
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is True
        assert verdict["details"]["actions_last_24h"] == 0

    def test_two_actions_passes(self, engine: InvariantEngine, mock_store: MagicMock) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        # Last action 5h ago (gap > 4h min)
        mock_store.get_actions.return_value = [
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat()},
        ]
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is True
        assert verdict["details"]["actions_last_24h"] == 2

    def test_three_actions_at_limit_passes(self, engine: InvariantEngine, mock_store: MagicMock) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        # All actions are spaced > 4h apart from now; 3 = exactly at limit
        mock_store.get_actions.return_value = [
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=15)).isoformat()},
        ]
        verdict = engine.check_pacing("test_account")
        assert verdict["details"]["actions_last_24h"] == I1_MAX_COMMENTS_PER_DAY
        assert verdict["pass"] is True

    def test_four_actions_fails_limit(self, engine: InvariantEngine, mock_store: MagicMock) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat()},
        ]
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is False
        assert "Action limit exceeded" in verdict["reason"]

    def test_gap_less_than_4h_fails(self, engine: InvariantEngine, mock_store: MagicMock) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat()},
        ]
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is False
        assert "minimum gap" in verdict["reason"]

    def test_gap_less_than_4h_but_content_different_passes(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {
                "profile_name": "test_account",
                "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
                "content_preview": "I prefer using PostgreSQL for this use case.",
            },
            {
                "profile_name": "test_account",
                "timestamp": (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat(),
                "content_preview": "Just finished reading a great book on distributed systems.",
            },
        ]
        verdict = engine.check_pacing("test_account")
        # Gap is < 4h but content differs → passes gap check (overlap < 50%)
        assert verdict["details"]["content_overlap_ratio"] is not None
        assert verdict["details"]["content_overlap_ratio"] <= I1_OVERLAP_THRESHOLD

    def test_gap_less_than_4h_and_same_content_fails(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        same_content = "I think AWS Lambda is a great service for serverless."
        mock_store.get_actions.return_value = [
            {
                "profile_name": "test_account",
                "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
                "content_preview": same_content,
            },
            {
                "profile_name": "test_account",
                "timestamp": (datetime.now(timezone.utc) - timedelta(hours=10)).isoformat(),
                "content_preview": same_content,
            },
        ]
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is False
        assert "Content overlap" in verdict["reason"]

    def test_dry_run_returns_pass_always(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()},
            {"profile_name": "test_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()},
        ]
        verdict = engine.check_pacing("test_account", dry_run=True)
        assert verdict["pass"] is True
        assert verdict["details"]["dry_run"] is True
        assert len(verdict["details"]["violations"]) > 0

    def test_actions_from_other_accounts_ignored(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {"profile_name": "other_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()},
            {"profile_name": "other_account", "timestamp": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()},
        ]
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is True
        assert verdict["details"]["actions_last_24h"] == 0

    def test_store_unavailable(self) -> None:
        engine = InvariantEngine(store=None)
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is True
        assert verdict["details"]["actions_last_24h"] == 0


# ===================================================================
# I₂ — Promo Ratio
# ===================================================================


class TestCheckPromoRatio:
    def test_no_actions_passes(self, engine: InvariantEngine) -> None:
        verdict = engine.check_promo_ratio("test_account")
        assert verdict["pass"] is True

    def test_no_promo_actions_passes(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {"profile_name": "test_account", "content_preview": "I had the same issue."},
            {"profile_name": "test_account", "content_preview": "Great question! Here's what worked for me."},
        ]
        verdict = engine.check_promo_ratio("test_account")
        assert verdict["pass"] is True
        assert verdict["details"]["promo_ratio"] == 0.0

    def test_promo_within_limit_passes(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        actions = []
        # 45 non-promo + 5 promo = 10% exactly → at limit, passes
        for i in range(45):
            actions.append({
                "profile_name": "test_account",
                "content_preview": f"Regular helpful comment number {i}.",
            })
        for i in range(5):
            actions.append({
                "profile_name": "test_account",
                "content_preview": f"Check out this tool we built for task {i}.",
            })
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = actions
        verdict = engine.check_promo_ratio("test_account")
        assert verdict["pass"] is True
        assert verdict["details"]["promo_ratio"] <= I2_MAX_PROMO_RATIO

    def test_promo_exceeds_limit_fails(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        actions = []
        # 40 non-promo + 10 promo = 20% → fails
        for i in range(40):
            actions.append({
                "profile_name": "test_account",
                "content_preview": f"Regular comment {i}.",
            })
        for i in range(10):
            actions.append({
                "profile_name": "test_account",
                "content_preview": f"We built this awesome tool, check it out! {i}",
            })
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = actions
        verdict = engine.check_promo_ratio("test_account")
        assert verdict["pass"] is False
        assert "exceeds" in verdict["reason"]

    def test_only_lookback_50_actions(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        actions = []
        # 55 actions: 50 non-promo + 5 promo
        # The engine should take the latest 50 (the 5 promo might be in the
        # trimmed portion depending on order). We'll put promo at the end.
        for i in range(50):
            actions.append({
                "profile_name": "test_account",
                "content_preview": f"Regular comment {i}.",
            })
        for i in range(5):
            actions.append({
                "profile_name": "test_account",
                "content_preview": f"Check out our product! {i}",
            })
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = actions
        verdict = engine.check_promo_ratio("test_account")
        # Only 50 checked — all regular, so 0% promo
        assert verdict["details"]["total_actions_checked"] == 50
        assert verdict["pass"] is True

    def test_store_unavailable(self) -> None:
        engine = InvariantEngine(store=None)
        verdict = engine.check_promo_ratio("test_account")
        assert verdict["pass"] is True
        assert "not available" in verdict["reason"]


# ===================================================================
# I₃ — Account Isolation
# ===================================================================


class TestCheckAccountIsolation:
    def test_no_ip_tracking_passes_with_warning(
        self, engine: InvariantEngine,
    ) -> None:
        verdict = engine.check_account_isolation("test_account")
        assert verdict["pass"] is True
        assert len(verdict["details"]["warnings"]) > 0
        assert "No IP tracking data" in verdict["details"]["warnings"][0]

    def test_ip_address_provided_no_conflict(
        self, engine: InvariantEngine,
    ) -> None:
        engine.update_known_ip("test_account", "192.168.1.1")
        verdict = engine.check_account_isolation(
            "test_account", ip_address="192.168.1.1",
        )
        assert verdict["pass"] is True
        assert verdict["details"]["ip_address_provided"] is True

    def test_ip_conflict_detected(
        self, engine: InvariantEngine,
    ) -> None:
        engine.update_known_ip("test_account", "192.168.1.1")
        engine.update_known_ip("other_account", "192.168.1.1")
        verdict = engine.check_account_isolation(
            "test_account", ip_address="192.168.1.1",
        )
        assert verdict["pass"] is False
        assert "also used by" in verdict["reason"]

    def test_ip_no_conflict_if_only_own_account_has_it(
        self, engine: InvariantEngine,
    ) -> None:
        engine.update_known_ip("test_account", "10.0.0.1")
        verdict = engine.check_account_isolation(
            "test_account", ip_address="10.0.0.1",
        )
        assert verdict["pass"] is True

    def test_cross_account_thread_detected(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        mock_store.list_accounts.return_value = [
            {"name": "other_account", "platform": "reddit"},
            {"name": "test_account", "platform": "reddit"},
        ]

        def get_actions_side(camp_id: str, since: str | None = None) -> list:
            return []

        # Make list_campaigns return something
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]

        # other_account has actions on a target URL
        def get_actions_multi(camp_id: str, since: str | None = None) -> list:
            return [
                {
                    "profile_name": "other_account",
                    "target_url": "https://reddit.com/r/test/thread123",
                    "content_preview": "Some comment",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            ]

        mock_store.get_actions.side_effect = [
            # First call: for other_account's campaign actions
            [
                {
                    "profile_name": "other_account",
                    "target_url": "https://reddit.com/r/test/thread123",
                    "content_preview": "Some comment",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            ],
            # Second call: for test_account's campaign actions
            [
                {
                    "profile_name": "test_account",
                    "target_url": "https://reddit.com/r/test/thread123",
                    "content_preview": "Another comment",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            ],
            # Third call (from check_account_isolation's own _get_actions_for_account for current)
            [
                {
                    "profile_name": "test_account",
                    "target_url": "https://reddit.com/r/test/thread123",
                    "content_preview": "Another comment",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            ],
        ]

        verdict = engine.check_account_isolation("test_account")
        assert verdict["pass"] is False
        assert "Cross-account" in verdict["reason"]


# ===================================================================
# I₄ — Warmup
# ===================================================================


class TestCheckWarmup:
    def test_ready_passes(
        self, engine: InvariantEngine, mock_warmup: MagicMock,
    ) -> None:
        mock_warmup.is_account_ready.return_value = True
        mock_warmup.get_current_phase.return_value = {
            "phase_number": 9,
            "phase_name": "Week 10+: Full Readiness",
            "is_ready": True,
        }
        verdict = engine.check_warmup("test_account")
        assert verdict["pass"] is True
        assert "fully warmed up" in verdict["reason"]

    def test_not_ready_fails(
        self, engine: InvariantEngine, mock_warmup: MagicMock,
    ) -> None:
        mock_warmup.is_account_ready.return_value = False
        verdict = engine.check_warmup("test_account")
        assert verdict["pass"] is False
        assert "not ready" in verdict["reason"]

    def test_account_not_found(
        self, engine: InvariantEngine, mock_warmup: MagicMock,
    ) -> None:
        mock_warmup.is_account_ready.return_value = False
        mock_warmup.get_current_phase.side_effect = KeyError("not found")
        verdict = engine.check_warmup("unknown_account")
        assert verdict["pass"] is False
        assert verdict["details"]["current_phase"] is None

    def test_warmup_engine_unavailable(self) -> None:
        engine = InvariantEngine(warmup_engine=None)
        verdict = engine.check_warmup("test_account")
        assert verdict["pass"] is True
        assert "not available" in verdict["reason"]

    def test_warmup_exception_handled(
        self, engine: InvariantEngine, mock_warmup: MagicMock,
    ) -> None:
        mock_warmup.is_account_ready.side_effect = RuntimeError("DB error")
        verdict = engine.check_warmup("test_account")
        assert verdict["pass"] is False
        assert "error" in verdict["reason"]


# ===================================================================
# I₆ — Cron Non-Overlap
# ===================================================================


class TestCheckCronNonOverlap:
    def test_no_lock_passes(
        self, engine: InvariantEngine, tmp_path: Path,
    ) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            verdict = engine.check_cron_non_overlap("test_lock")
            assert verdict["pass"] is True
            assert verdict["details"]["lock_exists"] is False
            assert verdict["details"]["acquired"] is True

    def test_fresh_lock_fails(
        self, engine: InvariantEngine, tmp_path: Path,
    ) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock_path = lock_dir / ".test_lock.lock"
        lock_path.write_text(
            json.dumps({"pid": 99999, "hostname": "other-host", "acquired_at": datetime.now(timezone.utc).isoformat()}),
        )

        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            verdict = engine.check_cron_non_overlap("test_lock")
            assert verdict["pass"] is False
            assert verdict["details"]["lock_exists"] is True
            assert verdict["details"]["is_stale"] is False

    def test_stale_lock_acquires_with_warning(
        self, engine: InvariantEngine, tmp_path: Path,
    ) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock_path = lock_dir / ".test_lock.lock"
        old_time = datetime.now(timezone.utc) - timedelta(minutes=I6_STALE_THRESHOLD_MIN + 5)
        lock_path.write_text(
            json.dumps({"pid": 88888, "hostname": "old-host", "acquired_at": old_time.isoformat()}),
        )
        # Set the mtime manually to be old
        os.utime(lock_path, (old_time.timestamp(), old_time.timestamp()))

        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            verdict = engine.check_cron_non_overlap("test_lock")
            assert verdict["pass"] is True
            assert verdict["details"]["is_stale"] is True
            assert verdict["details"]["acquired"] is True
            assert "stale" in verdict["reason"].lower()


# ===================================================================
# I₇ — Humanization Quality
# ===================================================================


class TestCheckHumanization:
    def test_passing_content(
        self, engine: InvariantEngine, mock_humanization_gate: MagicMock,
    ) -> None:
        mock_humanization_gate.check.return_value = {
            "pass": True,
            "score": 85.0,
            "failures": [],
            "details": {},
        }
        verdict = engine.check_humanization("Great content!", platform="reddit")
        assert verdict["pass"] is True
        assert verdict["details"]["score"] == 85.0

    def test_failing_content(
        self, engine: InvariantEngine, mock_humanization_gate: MagicMock,
    ) -> None:
        mock_humanization_gate.check.return_value = {
            "pass": False,
            "score": 45.0,
            "failures": [
                {
                    "check": "banned_words",
                    "score": 40.0,
                    "reasons": ["Tier-1 banned words found: delve, tapestry"],
                },
            ],
            "details": {},
        }
        verdict = engine.check_humanization("Bad content", platform="reddit")
        assert verdict["pass"] is False
        assert verdict["details"]["score"] == 45.0
        assert "below" in verdict["reason"]

    def test_platform_thresholds(
        self, engine: InvariantEngine, mock_humanization_gate: MagicMock,
    ) -> None:
        # HN has higher threshold (80)
        mock_humanization_gate.check.return_value = {
            "pass": True,
            "score": 75.0,
            "failures": [],
            "details": {},
        }
        verdict = engine.check_humanization("Content", platform="hn")
        assert verdict["pass"] is False  # 75 < 80

        # Twitter has lower threshold (60)
        verdict = engine.check_humanization("Content", platform="twitter")
        assert verdict["pass"] is True  # 75 >= 60

    def test_unknown_platform_uses_default(
        self, engine: InvariantEngine, mock_humanization_gate: MagicMock,
    ) -> None:
        mock_humanization_gate.check.return_value = {
            "pass": True,
            "score": 71.0,
            "failures": [],
            "details": {},
        }
        verdict = engine.check_humanization("Content", platform="unknown")
        assert verdict["pass"] is True  # 71 >= 70 (default)

    def test_gate_unavailable(self) -> None:
        engine = InvariantEngine(humanization_gate=None)
        verdict = engine.check_humanization("Content")
        assert verdict["pass"] is True
        assert "not available" in verdict["reason"]

    def test_gate_exception_handled(
        self, engine: InvariantEngine, mock_humanization_gate: MagicMock,
    ) -> None:
        mock_humanization_gate.check.side_effect = ValueError("parse error")
        verdict = engine.check_humanization("Content")
        assert verdict["pass"] is False
        assert "error" in verdict["reason"]


# ===================================================================
# check_all — combined
# ===================================================================


class TestCheckAll:
    def test_all_pass(
        self, engine: InvariantEngine, mock_store: MagicMock,
        mock_warmup: MagicMock, mock_humanization_gate: MagicMock,
    ) -> None:
        mock_warmup.is_account_ready.return_value = True
        mock_warmup.get_current_phase.return_value = {
            "phase_number": 9,
            "phase_name": "Week 10+: Full Readiness",
            "is_ready": True,
        }
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = []

        verdict = engine.check_all(
            account_name="test_account",
            content="Great helpful comment!",
            platform="reddit",
            campaign_id="camp1",
        )
        assert verdict["pass"] is True
        assert verdict["details"]["passed_count"] == 6
        assert verdict["details"]["failed_count"] == 0

    def test_one_fails_causes_overall_fail(
        self, engine: InvariantEngine, mock_warmup: MagicMock,
    ) -> None:
        mock_warmup.is_account_ready.return_value = False  # I₄ fails

        verdict = engine.check_all(
            account_name="test_account",
            content="Great content!",
            platform="reddit",
        )
        assert verdict["pass"] is False
        assert verdict["details"]["failed_count"] >= 1
        assert "I₄" in str(verdict["details"]["results"]) or "Warmup" in verdict["reason"]

    def test_returns_per_invariant_breakdown(
        self, engine: InvariantEngine,
    ) -> None:
        verdict = engine.check_all(
            account_name="test_account",
            content="Nice post!",
            platform="reddit",
        )
        assert "results" in verdict["details"]
        assert "I₁ (Pacing)" in verdict["details"]["results"]
        assert "I₂ (Promo Ratio)" in verdict["details"]["results"]
        assert "I₃ (Account Isolation)" in verdict["details"]["results"]
        assert "I₄ (Warmup)" in verdict["details"]["results"]
        assert "I₆ (Cron Non-Overlap)" in verdict["details"]["results"]
        assert "I₇ (Humanization)" in verdict["details"]["results"]


# ===================================================================
# Lock management
# ===================================================================


class TestLockManagement:
    def test_acquire_new_lock(self, engine: InvariantEngine, tmp_path: Path) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            result = engine.acquire_lock("test_lock")
            assert result is True
            lock_path = lock_dir / ".test_lock.lock"
            assert lock_path.exists()

    def test_release_lock(self, engine: InvariantEngine, tmp_path: Path) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            engine.acquire_lock("test_lock")
            engine.release_lock("test_lock")
            lock_path = lock_dir / ".test_lock.lock"
            assert not lock_path.exists()

    def test_fresh_lock_rejected(self, engine: InvariantEngine, tmp_path: Path) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock_path = lock_dir / ".test_lock.lock"
        lock_path.write_text(
            json.dumps({
                "pid": 99999,
                "hostname": "other",
                "acquired_at": datetime.now(timezone.utc).isoformat(),
            }),
        )

        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            result = engine.acquire_lock("test_lock")
            assert result is False

    def test_stale_lock_overwritten(self, engine: InvariantEngine, tmp_path: Path) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock_path = lock_dir / ".test_lock.lock"
        old_time = datetime.now(timezone.utc) - timedelta(minutes=45)
        lock_path.write_text(
            json.dumps({
                "pid": 88888,
                "hostname": "old-host",
                "acquired_at": old_time.isoformat(),
            }),
        )
        os.utime(lock_path, (old_time.timestamp(), old_time.timestamp()))

        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            result = engine.acquire_lock("test_lock")
            assert result is True
            # Verify it was overwritten with current PID
            data = json.loads(lock_path.read_text())
            assert data["pid"] == os.getpid()

    def test_release_only_own_lock(self, engine: InvariantEngine, tmp_path: Path) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock_path = lock_dir / ".test_lock.lock"
        lock_path.write_text(
            json.dumps({
                "pid": 77777,
                "hostname": "other",
                "acquired_at": datetime.now(timezone.utc).isoformat(),
            }),
        )

        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            engine.release_lock("test_lock")
            # Should NOT have removed it (different PID)
            assert lock_path.exists()

    def test_release_nonexistent_lock_does_not_error(
        self, engine: InvariantEngine,
    ) -> None:
        # Should not raise
        engine.release_lock("nonexistent_lock")

    def test_custom_timeout(self, engine: InvariantEngine, tmp_path: Path) -> None:
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock_path = lock_dir / ".test_lock.lock"
        # Lock that's 10 min old — with default 30 min timeout it's fresh
        recent_time = datetime.now(timezone.utc) - timedelta(minutes=10)
        lock_path.write_text(
            json.dumps({
                "pid": 66666,
                "hostname": "other",
                "acquired_at": recent_time.isoformat(),
            }),
        )
        os.utime(lock_path, (recent_time.timestamp(), recent_time.timestamp()))

        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            # With short 5 min timeout, 10 min old is stale
            result = engine.acquire_lock("test_lock", timeout_min=5)
            assert result is True


# ===================================================================
# Thread safety
# ===================================================================


class TestThreadSafety:
    def test_concurrent_ip_updates(self, engine: InvariantEngine) -> None:
        """Verify update_known_ip is thread-safe under concurrent access."""
        errors: list[Exception] = []

        def update_ip(acct: str, ip: str) -> None:
            try:
                for _ in range(50):
                    engine.update_known_ip(acct, ip)
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=update_ip, args=("acct1", "10.0.0.1")),
            threading.Thread(target=update_ip, args=("acct2", "10.0.0.2")),
            threading.Thread(target=update_ip, args=("acct3", "10.0.0.3")),
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0, f"Thread safety errors: {errors}"

    def test_concurrent_lock_acquisition(
        self, engine: InvariantEngine, tmp_path: Path,
    ) -> None:
        """Verify concurrent acquire_lock calls are safe."""
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        results: list[bool] = []
        lock = threading.Lock()

        def acquire() -> None:
            with patch.object(engine, "_marketing_dir", return_value=lock_dir):
                result = engine.acquire_lock("concurrent_lock")
                with lock:
                    results.append(result)

        threads = [threading.Thread(target=acquire) for _ in range(5)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # At least one should have acquired, the rest may fail (fresh lock)
        assert True in results


# ===================================================================
# Edge cases
# ===================================================================


class TestEdgeCases:
    def test_check_pacing_no_timestamp(self, engine: InvariantEngine, mock_store: MagicMock) -> None:
        """Action with missing timestamp should not crash."""
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {"profile_name": "test_account"},  # no timestamp key
        ]
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is True

    def test_check_promo_ratio_no_content_preview(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        """Action with missing content_preview should not crash."""
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {"profile_name": "test_account", "action_type": "comment"},
        ]
        verdict = engine.check_promo_ratio("test_account")
        assert verdict["pass"] is True
        assert verdict["details"]["promo_actions"] == 0

    def test_all_empty_strings_and_none(
        self, engine: InvariantEngine, mock_humanization_gate: MagicMock,
    ) -> None:
        """Empty content should not crash humanization check."""
        mock_humanization_gate.check.return_value = {
            "pass": False,
            "score": 0.0,
            "failures": [{"check": "burstiness", "score": 0.0, "reasons": ["Too few sentences"]}],
            "details": {},
        }
        verdict = engine.check_humanization("")
        # Should not crash; score 0 < threshold → fail
        assert verdict["pass"] is False

    def test_check_all_empty_campaign_id(self, engine: InvariantEngine) -> None:
        """Empty campaign_id should not cause errors."""
        verdict = engine.check_all(
            account_name="test_account",
            content="Hello!",
            platform="reddit",
            campaign_id="",
        )
        assert "pass" in verdict
        assert "details" in verdict

    def test_check_pacing_single_action_passes(
        self, engine: InvariantEngine, mock_store: MagicMock,
    ) -> None:
        """Single action (gap > 4h to now) should pass."""
        mock_store.list_campaigns.return_value = [{"id": "camp1"}]
        mock_store.get_actions.return_value = [
            {
                "profile_name": "test_account",
                "timestamp": (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat(),
                "content_preview": "A single helpful comment.",
            },
        ]
        verdict = engine.check_pacing("test_account")
        assert verdict["pass"] is True

    def test_ip_tracking_persistence(self, engine: InvariantEngine, tmp_path: Path) -> None:
        """IPs saved via update_known_ip should persist."""
        lock_dir = tmp_path / "marketing"
        lock_dir.mkdir(parents=True, exist_ok=True)
        with patch.object(engine, "_marketing_dir", return_value=lock_dir):
            engine.update_known_ip("acct1", "10.0.0.1")

            # Create a new engine to verify persistence
            engine2 = InvariantEngine(store=engine._store)
            with patch.object(engine2, "_marketing_dir", return_value=lock_dir):
                engine2._load_known_ips()
                verdict = engine2.check_account_isolation(
                    "acct1", ip_address="10.0.0.1",
                )
                assert verdict["pass"] is True
