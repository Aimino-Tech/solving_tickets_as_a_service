"""Tests for OSS status comments (GitHub-issue-centric pipeline progress).

Covers:
  - ``post_oss_comment``: posted on stage start, complete, and fail
  - ``_format_oss_message``: formatting with emoji
  - ``_sanitize_oss_error``: sanitized error messages
  - ``set_oss_enabled``: disabled via config
  - ``_build_progressive_body``: progressive comment structure
  - ``OSS_STAGE_EMOJI`` / ``OSS_STAGE_LABELS`` completeness
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from workers.notifications.oss_status import (
    OSS_STAGE_EMOJI,
    OSS_STAGE_LABELS,
    _build_progressive_body,
    _format_oss_message,
    _sanitize_oss_error,
    post_oss_comment,
    set_oss_enabled,
)
from workers.notifications.status_comments import STAGE_ORDER


# ===========================================================================
# Fixtures
# ===========================================================================


def _reset_enabled():
    """Reset globals before and after tests (handled manually per test)."""
    # We use set_oss_enabled(True) in setUp-style and restore after
    pass


# ===========================================================================
# _format_oss_message
# ===========================================================================


class TestFormatOssMessage:
    def test_formats_with_emoji(self):
        body = _format_oss_message("triage", "started", "Triaging issue")
        assert OSS_STAGE_EMOJI["triage"] in body
        assert OSS_STAGE_LABELS["triage"] in body
        assert "Triaging issue" in body

    def test_unknown_stage_uses_fallback(self):
        body = _format_oss_message("unknown", "started", "Something")
        assert "\u2022" in body  # bullet fallback
        assert "Unknown" in body

    def test_failed_status_includes_message(self):
        body = _format_oss_message("agent", "failed", "Timed out")
        assert "Timed out" in body


# ===========================================================================
# _sanitize_oss_error
# ===========================================================================


class TestSanitizeOssError:
    def test_truncates_long_message(self):
        long_msg = "x" * 1000
        sanitized = _sanitize_oss_error(long_msg, max_length=100)
        assert len(sanitized) == 103  # 100 + "..."
        assert sanitized.endswith("...")

    def test_strips_stack_trace(self):
        msg = "KeyError: 'missing_key'\n  File \"/app/foo.py\", line 42, in bar\n    raise KeyError"
        sanitized = _sanitize_oss_error(msg)
        assert sanitized == "KeyError: 'missing_key'"
        assert "File" not in sanitized

    def test_empty_message(self):
        assert _sanitize_oss_error("") == "Unknown error"

    def test_short_message_passes_through(self):
        assert _sanitize_oss_error("Timeout") == "Timeout"


# ===========================================================================
# _build_progressive_body
# ===========================================================================


class TestBuildProgressiveBody:
    def test_all_stages_pending(self):
        body = _build_progressive_body("42", {})
        assert "Pipeline Progress" in body
        assert "#42" in body or "# 42" in body or "#42" in body or "42" in body
        for stage in STAGE_ORDER:
            assert OSS_STAGE_EMOJI.get(stage, "\u2022") in body or stage in body

    def test_completed_stage_shows_checkmark(self):
        stages = {
            "triage": {"stage": "triage", "status": "completed", "message": "Passed"},
        }
        body = _build_progressive_body("42", stages)
        assert "✅" in body
        assert "Passed" in body

    def test_started_stage_shows_hourglass(self):
        stages = {
            "agent": {"stage": "agent", "status": "started", "message": "Running"},
        }
        body = _build_progressive_body("42", stages)
        assert "⏳" in body
        assert "Running" in body

    def test_failed_stage_shows_x(self):
        stages = {
            "verify": {"stage": "verify", "status": "failed", "message": "Tests failed"},
        }
        body = _build_progressive_body("42", stages)
        assert "❌" in body
        assert "Tests failed" in body

    def test_pending_stage_uses_strikethrough(self):
        body = _build_progressive_body("42", {})
        lines = body.split("\n")
        pending_lines = [
            l for l in lines if "pending" in l.lower() or "~~" in l
        ]
        # Without stages everything should be pending
        assert len(pending_lines) >= len(STAGE_ORDER)


# ===========================================================================
# post_oss_comment
# ===========================================================================


class TestPostOssComment:
    @patch("workers.notifications.oss_status._post_to_github_issue")
    def test_started_posts_immediately(self, mock_post):
        result = post_oss_comment("owner/repo", "42", "agent", "started", "Agent started")
        assert result["status"] == "posted"
        mock_post.assert_called_once()
        body = mock_post.call_args[0][2]
        assert OSS_STAGE_EMOJI["agent"] in body
        assert "Agent started" in body

    @patch("workers.notifications.oss_status._post_to_github_issue")
    def test_completed_is_coalesced(self, mock_post):
        result = post_oss_comment("owner/repo", "42", "triage", "completed", "Triage passed")
        assert result["status"] == "coalesced"
        mock_post.assert_not_called()

    @patch("workers.notifications.oss_status._post_to_github_issue")
    def test_failed_posts_immediately(self, mock_post):
        result = post_oss_comment("owner/repo", "42", "agent", "failed", "Out of memory")
        assert result["status"] == "posted"
        mock_post.assert_called_once()
        body = mock_post.call_args[0][2]
        assert "Out of memory" in body

    @patch("workers.notifications.oss_status._post_to_github_issue")
    def test_failed_sanitizes_error_message(self, mock_post):
        result = post_oss_comment(
            "owner/repo", "42", "agent", "failed",
            "KeyError: 'secret_token'\n  File \"/home/user/code.py\", line 42",
        )
        assert result["status"] == "posted"
        body = mock_post.call_args[0][2]
        assert "KeyError: 'secret_token'" in body
        assert "/home/user/code.py" not in body

    @patch("workers.notifications.oss_status._post_to_github_issue")
    def test_post_error_returns_error_status(self, mock_post):
        mock_post.side_effect = RuntimeError("GitHub API error")
        result = post_oss_comment("owner/repo", "42", "triage", "started", "Starting")
        assert result["status"] == "error"
        assert "GitHub API error" in result.get("error", "")

    def test_disabled_returns_immediately(self):
        set_oss_enabled(False)
        result = post_oss_comment("owner/repo", "42", "triage", "started", "Starting")
        assert result["status"] == "disabled"
        set_oss_enabled(True)

    @patch("workers.notifications.oss_status._post_to_github_issue")
    def test_all_stages_have_emoji_and_label(self, mock_post):
        """Every stage in OSS_STAGE_LABELS should have a corresponding emoji."""
        for stage in OSS_STAGE_LABELS:
            assert stage in OSS_STAGE_EMOJI, f"Missing emoji for stage {stage}"
            mock_post.reset_mock()
            post_oss_comment("owner/repo", "42", stage, "started", f"{stage} started")
            if mock_post.called:
                body = mock_post.call_args[0][2]
                assert OSS_STAGE_EMOJI[stage] in body, f"Emoji missing for {stage}"
                assert OSS_STAGE_LABELS[stage] in body, f"Label missing for {stage}"


# ===========================================================================
# set_oss_enabled
# ===========================================================================


class TestSetOssEnabled:
    def test_disables_globally(self):
        set_oss_enabled(False)
        from workers.notifications.oss_status import OSS_STATUS_ENABLED
        assert OSS_STATUS_ENABLED is False

    def test_enables_globally(self):
        set_oss_enabled(True)
        from workers.notifications.oss_status import OSS_STATUS_ENABLED
        assert OSS_STATUS_ENABLED is True

    def test_reset_to_default(self):
        set_oss_enabled(True)
        set_oss_enabled(False)
        from workers.notifications.oss_status import OSS_STATUS_ENABLED
        assert OSS_STATUS_ENABLED is False
        set_oss_enabled(True)


# ===========================================================================
# OSS_STAGE_LABELS / OSS_STAGE_EMOJI completeness
# ===========================================================================


class TestOssStageConfig:
    def test_all_labels_have_emoji(self):
        for stage in OSS_STAGE_LABELS:
            assert stage in OSS_STAGE_EMOJI, f"Stage {stage!r} has a label but no emoji"

    def test_emoji_count_matches_labels(self):
        # failed has an emoji but no label (intentionally — it is a status, not a stage)
        emoji_stages = set(OSS_STAGE_EMOJI.keys())
        label_stages = set(OSS_STAGE_LABELS.keys())
        # Only "failed" should differ
        diff = emoji_stages - label_stages
        assert diff == {"failed"}, f"Unexpected extra emoji stages: {diff}"

    def test_stage_order_consistency(self):
        """All labels should appear in STAGE_ORDER from status_comments."""
        for stage in OSS_STAGE_LABELS:
            assert stage in STAGE_ORDER, f"Stage {stage!r} not in STAGE_ORDER"
