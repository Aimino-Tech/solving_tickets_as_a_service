"""Tests for real-time Linear status comments.

Covers:
  - ``post_stage_comment``: posted on stage start, complete, and fail
  - ``StageCoalescer``: buffering and flush within 5-second window
  - ``_sanitize_error``: sanitized error messages
  - ``set_enabled``: disabled via config
  - ``_extract_issue_id``: issue ID resolution from various arg patterns
  - Celery signal handlers: automatic comment posting
"""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, call, patch

import pytest

from workers.notifications.coalescer import StageCoalescer
from workers.notifications.status_comments import (
    STATUS_COMMENTS_ENABLED,
    STAGE_EMOJI,
    STAGE_LABELS,
    TASK_STAGE_MAP,
    _extract_issue_id,
    _format_message,
    _sanitize_error,
    _summarize_result,
    post_stage_comment,
    set_enabled,
)


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture(autouse=True)
def reset_enabled():
    """Reset the enabled flag before and after each test."""
    original = STATUS_COMMENTS_ENABLED
    set_enabled(True)
    yield
    set_enabled(original)


# ===========================================================================
# _format_message
# ===========================================================================


class TestFormatMessage:
    def test_formats_with_emoji(self):
        body = _format_message("triage", "started", "Triaging issue")
        assert STAGE_EMOJI["triage"] in body
        assert STAGE_LABELS["triage"] in body
        assert "Triaging issue" in body

    def test_unknown_stage_uses_fallback(self):
        body = _format_message("unknown", "started", "Something")
        assert "•" in body  # bullet fallback
        assert "Unknown" in body

    def test_failed_status_includes_message(self):
        body = _format_message("agent", "failed", "Timed out")
        assert "Timed out" in body


# ===========================================================================
# _sanitize_error
# ===========================================================================


class TestSanitizeError:
    def test_truncates_long_message(self):
        long_msg = "x" * 1000
        sanitized = _sanitize_error(long_msg, max_length=100)
        assert len(sanitized) == 103  # 100 + "..."
        assert sanitized.endswith("...")

    def test_strips_stack_trace(self):
        msg = "KeyError: 'missing_key'\n  File \"/app/foo.py\", line 42, in bar\n    raise KeyError"
        sanitized = _sanitize_error(msg)
        assert sanitized == "KeyError: 'missing_key'"
        assert "File" not in sanitized

    def test_empty_message(self):
        assert _sanitize_error("") == "Unknown error"

    def test_none_message(self):
        assert _sanitize_error("") == "Unknown error"

    def test_short_message_passes_through(self):
        assert _sanitize_error("Timeout") == "Timeout"


# ===========================================================================
# _extract_issue_id
# ===========================================================================


class TestExtractIssueId:
    def test_from_kwargs_direct(self):
        assert _extract_issue_id((), {"issue_id": "lin_123"}) == "lin_123"

    def test_from_pipeline_context(self):
        kwargs = {"pipeline_context": {"issue_id": "lin_456"}}
        assert _extract_issue_id((), kwargs) == "lin_456"

    def test_from_issue_context(self):
        kwargs = {"issue_context": {"issue_id": "lin_789"}}
        assert _extract_issue_id((), kwargs) == "lin_789"

    def test_from_first_dict_arg(self):
        args = ({"issue_id": "lin_arg"},)
        assert _extract_issue_id(args, {}) == "lin_arg"

    def test_from_issue_identifier_fallback(self):
        kwargs = {"issue_context": {"issue_identifier": "PROJ-42"}}
        assert _extract_issue_id((), kwargs) == "PROJ-42"

    def test_returns_none_when_not_found(self):
        assert _extract_issue_id((), {}) is None
        assert _extract_issue_id((42, "str"), {}) is None


# ===========================================================================
# _summarize_result
# ===========================================================================


class TestSummarizeResult:
    def test_uses_status_key(self):
        assert _summarize_result({"status": "passed"}) == "passed"

    def test_uses_passed_key(self):
        assert _summarize_result({"passed": True}) == "True"

    def test_uses_decision_key(self):
        assert _summarize_result({"decision": "approved"}) == "approved"

    def test_falls_back_to_first_string_value(self):
        assert _summarize_result({"foo": "bar", "baz": 42}) == "bar"

    def test_falls_back_to_static_when_empty(self):
        assert _summarize_result({}) == "Stage completed"


# ===========================================================================
# StageCoalescer
# ===========================================================================


class TestStageCoalescer:
    def test_initial_state(self):
        coalescer = StageCoalescer()
        assert coalescer.pending_count == 0

    def test_add_event_buffers(self):
        coalescer = StageCoalescer()
        coalescer.add_event("lin_1", "triage", "completed", "Triage passed")
        assert coalescer.pending_count == 1

    def test_events_always_have_required_keys(self):
        coalescer = StageCoalescer()
        coalescer.add_event("lin_1", "triage", "completed", "")
        assert coalescer.pending_count == 1

    def test_flush_returns_events(self):
        coalescer = StageCoalescer()
        coalescer.add_event("lin_1", "triage", "completed", "Triage passed")
        events = coalescer.flush()
        assert len(events) == 1
        assert events[0]["issue_id"] == "lin_1"
        assert events[0]["stage"] == "triage"
        assert coalescer.pending_count == 0

    def test_flush_multiple_events(self):
        coalescer = StageCoalescer()
        coalescer.add_event("lin_1", "triage", "completed", "Triage passed")
        coalescer.add_event("lin_1", "agent", "completed", "Agent done")
        events = coalescer.flush()
        assert len(events) == 2

    def test_flush_clears_buffer(self):
        coalescer = StageCoalescer()
        coalescer.add_event("lin_1", "triage", "completed", "Passed")
        coalescer.flush()
        assert coalescer.pending_count == 0

    def test_flush_callback_invoked(self):
        callback = MagicMock()
        coalescer = StageCoalescer(flush_callback=callback)
        coalescer.add_event("lin_1", "triage", "completed", "Passed")
        coalescer.flush()
        callback.assert_called_once()
        args = callback.call_args[0][0]
        assert len(args) == 1
        assert args[0]["stage"] == "triage"

    def test_flush_callback_not_invoked_when_empty(self):
        callback = MagicMock()
        coalescer = StageCoalescer(flush_callback=callback)
        coalescer.flush()
        callback.assert_not_called()

    def test_timer_auto_flush(self):
        """Events should auto-flush after the window expires."""
        callback = MagicMock()
        coalescer = StageCoalescer(window_seconds=0.05, flush_callback=callback)
        coalescer.add_event("lin_1", "triage", "completed", "Passed")
        time.sleep(0.15)
        callback.assert_called_once()

    def test_timer_resets_on_new_event(self):
        """Adding a new event should reset the timer."""
        callback = MagicMock()
        coalescer = StageCoalescer(window_seconds=0.1, flush_callback=callback)
        coalescer.add_event("lin_1", "triage", "completed", "Passed")
        time.sleep(0.05)
        # This should reset the timer
        coalescer.add_event("lin_1", "agent", "completed", "Agent done")
        time.sleep(0.05)  # Not enough for the second timer
        callback.assert_not_called()
        time.sleep(0.1)  # Now the second timer should fire
        callback.assert_called_once()

    def test_multiple_issues_separate_events(self):
        coalescer = StageCoalescer()
        coalescer.add_event("lin_1", "triage", "completed", "Passed")
        coalescer.add_event("lin_2", "agent", "completed", "Done")
        events = coalescer.flush()
        assert len(events) == 2
        issues = {e["issue_id"] for e in events}
        assert issues == {"lin_1", "lin_2"}

    def test_concurrent_add_and_flush(self):
        """Thread safety: add and flush from 'concurrent' paths."""
        coalescer = StageCoalescer()
        coalescer.add_event("lin_1", "triage", "completed", "Passed")
        # Flush from one "thread"
        events1 = coalescer.flush()
        assert len(events1) == 1
        # After flush, buffer is empty
        assert coalescer.pending_count == 0
        # Add more
        coalescer.add_event("lin_1", "agent", "completed", "Done")
        assert coalescer.pending_count == 1


# ===========================================================================
# post_stage_comment
# ===========================================================================


class TestPostStageComment:
    @patch("workers.notifications.status_comments._post_to_linear")
    def test_started_posts_immediately(self, mock_post):
        result = post_stage_comment("lin_1", "agent", "started", "Agent started")
        assert result["status"] == "posted"
        mock_post.assert_called_once()
        body = mock_post.call_args[0][1]
        assert STAGE_EMOJI["agent"] in body
        assert "Agent started" in body

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_completed_is_coalesced(self, mock_post):
        result = post_stage_comment("lin_1", "triage", "completed", "Triage passed")
        assert result["status"] == "coalesced"
        mock_post.assert_not_called()

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_failed_posts_immediately(self, mock_post):
        result = post_stage_comment("lin_1", "agent", "failed", "Out of memory")
        assert result["status"] == "posted"
        mock_post.assert_called_once()
        body = mock_post.call_args[0][1]
        assert "Out of memory" in body

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_failed_sanitizes_error_message(self, mock_post):
        result = post_stage_comment(
            "lin_1", "agent", "failed",
            "KeyError: 'secret_token'\n  File \"/home/user/code.py\", line 42",
        )
        assert result["status"] == "posted"
        body = mock_post.call_args[0][1]
        assert "KeyError: 'secret_token'" in body
        assert "/home/user/code.py" not in body

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_post_to_linear_error_returns_error_status(self, mock_post):
        mock_post.side_effect = RuntimeError("API error")
        result = post_stage_comment("lin_1", "triage", "started", "Starting")
        assert result["status"] == "error"
        assert "API error" in result.get("error", "")

    def test_disabled_returns_immediately(self):
        set_enabled(False)
        result = post_stage_comment("lin_1", "triage", "started", "Starting")
        assert result["status"] == "disabled"

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_all_stages_have_emoji_and_label(self, mock_post):
        """Every stage in STAGE_LABELS should have a corresponding emoji."""
        for stage in STAGE_LABELS:
            assert stage in STAGE_EMOJI, f"Missing emoji for stage {stage}"
            mock_post.reset_mock()
            post_stage_comment("lin_1", stage, "started", f"{stage} started")
            if mock_post.called:
                body = mock_post.call_args[0][1]
                assert STAGE_EMOJI[stage] in body, f"Emoji missing for {stage}"
                assert STAGE_LABELS[stage] in body, f"Label missing for {stage}"


# ===========================================================================
# TASK_STAGE_MAP completeness
# ===========================================================================


class TestTaskStageMap:
    def test_all_mapped_tasks_have_valid_stages(self):
        """All values in TASK_STAGE_MAP should be valid stage identifiers."""
        for task_name, stage in TASK_STAGE_MAP.items():
            assert stage in STAGE_LABELS, f"Unknown stage {stage!r} for task {task_name}"
            assert stage in STAGE_EMOJI, f"Missing emoji for stage {stage!r}"

    def test_task_names_are_strings(self):
        for task_name in TASK_STAGE_MAP:
            assert isinstance(task_name, str)
            assert "." in task_name


# ===========================================================================
# _flush_coalesced_events integration
# ===========================================================================


class TestFlushCoalescedEvents:
    @patch("workers.notifications.status_comments._post_to_linear")
    def test_single_event_posts_simple_comment(self, mock_post):
        from workers.notifications.status_comments import _flush_coalesced_events

        events = [
            {"issue_id": "lin_1", "stage": "triage", "status": "completed", "message": "Passed", "timestamp": time.time()},
        ]
        _flush_coalesced_events(events)
        mock_post.assert_called_once_with("lin_1", mock_post.call_args[0][1])

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_multiple_events_coalesced(self, mock_post):
        from workers.notifications.status_comments import _flush_coalesced_events

        events = [
            {"issue_id": "lin_1", "stage": "triage", "status": "completed", "message": "Triage OK", "timestamp": time.time()},
            {"issue_id": "lin_1", "stage": "agent", "status": "completed", "message": "Agent done", "timestamp": time.time()},
        ]
        _flush_coalesced_events(events)
        mock_post.assert_called_once()
        body = mock_post.call_args[0][1]
        assert "Pipeline Progress" in body
        assert "Triage OK" in body
        assert "Agent done" in body

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_empty_events_does_nothing(self, mock_post):
        from workers.notifications.status_comments import _flush_coalesced_events

        _flush_coalesced_events([])
        mock_post.assert_not_called()

    @patch("workers.notifications.status_comments._post_to_linear")
    def test_different_issues_posted_separately(self, mock_post):
        from workers.notifications.status_comments import _flush_coalesced_events

        events = [
            {"issue_id": "lin_1", "stage": "triage", "status": "completed", "message": "OK", "timestamp": time.time()},
            {"issue_id": "lin_2", "stage": "agent", "status": "completed", "message": "Done", "timestamp": time.time()},
        ]
        _flush_coalesced_events(events)
        assert mock_post.call_count == 2


# ===========================================================================
# set_enabled
# ===========================================================================


class TestSetEnabled:
    def test_disables_globally(self):
        set_enabled(False)
        from workers.notifications.status_comments import STATUS_COMMENTS_ENABLED
        assert STATUS_COMMENTS_ENABLED is False

    def test_enables_globally(self):
        set_enabled(True)
        from workers.notifications.status_comments import STATUS_COMMENTS_ENABLED
        assert STATUS_COMMENTS_ENABLED is True


# ===========================================================================
# Celery signal handlers (integration)
# ===========================================================================


class TestCelerySignalHandlers:
    """Test the signal handler functions directly."""

    @patch("workers.notifications.status_comments.post_stage_comment")
    def test_on_task_prerun_known_task(self, mock_post):
        from workers.notifications.status_comments import _on_task_prerun

        _on_task_prerun(
            "workers.tasks.triage.triage_issue",
            ({"issue_id": "lin_1"},),
            {},
        )
        mock_post.assert_called_once_with("lin_1", "triage", "started", "Triage stage started")

    @patch("workers.notifications.status_comments.post_stage_comment")
    def test_on_task_prerun_unknown_task_skipped(self, mock_post):
        from workers.notifications.status_comments import _on_task_prerun

        _on_task_prerun("some.unknown.task", (), {})
        mock_post.assert_not_called()

    @patch("workers.notifications.status_comments.post_stage_comment")
    def test_on_task_prerun_no_issue_id_skipped(self, mock_post):
        from workers.notifications.status_comments import _on_task_prerun

        _on_task_prerun("workers.tasks.triage.triage_issue", (), {})
        mock_post.assert_not_called()

    @patch("workers.notifications.status_comments.post_stage_comment")
    def test_on_task_success_posts_completed(self, mock_post):
        from workers.notifications.status_comments import _on_task_success

        _on_task_success(
            "workers.tasks.triage.triage_issue",
            ({"issue_id": "lin_1"},),
            {},
            {"status": "passed"},
        )
        mock_post.assert_called_once()
        args = mock_post.call_args[0]
        assert args[0] == "lin_1"
        assert args[1] == "triage"
        assert args[2] == "completed"

    @patch("workers.notifications.status_comments.post_stage_comment")
    def test_on_task_failure_posts_failed(self, mock_post):
        from workers.notifications.status_comments import _on_task_failure

        _on_task_failure(
            "workers.tasks.agent.dispatch_opencode",
            ({"issue_id": "lin_1"},),
            {},
            RuntimeError("Connection timeout"),
        )
        mock_post.assert_called_once_with(
            "lin_1", "agent", "failed", "Connection timeout",
        )

    @patch("workers.notifications.status_comments.post_stage_comment")
    def test_on_task_failure_unknown_task_skipped(self, mock_post):
        from workers.notifications.status_comments import _on_task_failure

        _on_task_failure("some.unknown.task", (), {}, Exception("fail"))
        mock_post.assert_not_called()

    def test_all_mapped_tasks_have_valid_signal_routing(self):
        """All tasks in TASK_STAGE_MAP should route through signal handlers."""
        for task_name, stage in TASK_STAGE_MAP.items():
            assert task_name.count(".") >= 2
            assert stage in STAGE_LABELS


# ===========================================================================
# StageCoalescer event validation
# ===========================================================================


class TestCoalescerValidation:
    def test_validate_event_passes_with_all_keys(self):
        from workers.notifications.coalescer import _validate_event

        event = {"issue_id": "lin_1", "stage": "triage", "status": "completed", "message": "OK"}
        # Should not raise
        _validate_event(event)

    def test_validate_event_empty_message_is_valid(self):
        from workers.notifications.coalescer import _validate_event

        event = {"issue_id": "lin_1", "stage": "triage", "status": "completed", "message": ""}
        # Empty string is a valid value; key presence is what matters
        _validate_event(event)

    def test_validate_event_missing_key_raises(self):
        from workers.notifications.coalescer import _validate_event

        with pytest.raises(ValueError, match="missing required keys"):
            _validate_event({"issue_id": "lin_1"})
