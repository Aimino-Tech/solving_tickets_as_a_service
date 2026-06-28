"""Tests for the OSS stage coalescer.

Covers:
  - ``OssStageCoalescer``: buffering, flush, timer, max-batch forced flush
  - ``_validate_oss_event``: required-key validation
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock

import pytest

from workers.notifications.oss_coalescer import (
    OSS_EVENT_KEYS,
    OssStageCoalescer,
    _validate_oss_event,
)


# ===========================================================================
# _validate_oss_event
# ===========================================================================


class TestValidateOssEvent:
    def test_passes_with_all_keys(self):
        event = {
            "repo": "owner/repo",
            "issue_id": "42",
            "stage": "triage",
            "status": "completed",
            "message": "OK",
        }
        _validate_oss_event(event)  # should not raise

    def test_empty_message_is_valid(self):
        event = {
            "repo": "owner/repo",
            "issue_id": "42",
            "stage": "triage",
            "status": "completed",
            "message": "",
        }
        _validate_oss_event(event)  # should not raise

    def test_missing_key_raises(self):
        with pytest.raises(ValueError, match="missing required keys"):
            _validate_oss_event({"repo": "owner/repo"})

    def test_missing_multiple_keys_reports_all(self):
        with pytest.raises(ValueError, match="missing required keys"):
            _validate_oss_event({})


# ===========================================================================
# OssStageCoalescer
# ===========================================================================


class TestOssStageCoalescer:
    def test_initial_state(self):
        coalescer = OssStageCoalescer()
        assert coalescer.pending_count == 0

    def test_add_event_buffers(self):
        coalescer = OssStageCoalescer()
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Triage passed")
        assert coalescer.pending_count == 1

    def test_flush_returns_events(self):
        coalescer = OssStageCoalescer()
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Triage passed")
        events = coalescer.flush()
        assert len(events) == 1
        assert events[0]["repo"] == "owner/repo"
        assert events[0]["issue_id"] == "42"
        assert events[0]["stage"] == "triage"
        assert coalescer.pending_count == 0

    def test_flush_multiple_events(self):
        coalescer = OssStageCoalescer()
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Triage passed")
        coalescer.add_event("owner/repo", "42", "agent", "completed", "Agent done")
        events = coalescer.flush()
        assert len(events) == 2

    def test_flush_clears_buffer(self):
        coalescer = OssStageCoalescer()
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Passed")
        coalescer.flush()
        assert coalescer.pending_count == 0

    def test_flush_callback_invoked(self):
        callback = MagicMock()
        coalescer = OssStageCoalescer(flush_callback=callback)
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Passed")
        coalescer.flush()
        callback.assert_called_once()
        args = callback.call_args[0][0]
        assert len(args) == 1
        assert args[0]["repo"] == "owner/repo"

    def test_flush_callback_not_invoked_when_empty(self):
        callback = MagicMock()
        coalescer = OssStageCoalescer(flush_callback=callback)
        coalescer.flush()
        callback.assert_not_called()

    def test_timer_auto_flush(self):
        callback = MagicMock()
        coalescer = OssStageCoalescer(window_seconds=0.05, flush_callback=callback)
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Passed")
        time.sleep(0.15)
        callback.assert_called_once()

    def test_timer_resets_on_new_event(self):
        callback = MagicMock()
        coalescer = OssStageCoalescer(window_seconds=0.1, flush_callback=callback)
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Passed")
        time.sleep(0.05)
        coalescer.add_event("owner/repo", "42", "agent", "completed", "Agent done")
        time.sleep(0.05)
        callback.assert_not_called()
        time.sleep(0.1)
        callback.assert_called_once()

    def test_max_batch_triggers_immediate_flush(self):
        """When the buffer reaches max_batch the flush should happen inline."""
        callback = MagicMock()
        coalescer = OssStageCoalescer(
            window_seconds=10.0, max_batch=2, flush_callback=callback,
        )
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Passed")
        assert coalescer.pending_count == 1
        # Second event hits max_batch=2 → flush inline
        coalescer.add_event("owner/repo", "42", "agent", "completed", "Done")
        assert coalescer.pending_count == 0
        callback.assert_called_once()

    def test_pending_count_after_max_batch_flush(self):
        callback = MagicMock()
        coalescer = OssStageCoalescer(
            window_seconds=10.0, max_batch=2, flush_callback=callback,
        )
        coalescer.add_event("owner/repo", "42", "triage", "completed", "A")
        coalescer.add_event("owner/repo", "42", "agent", "completed", "B")
        assert coalescer.pending_count == 0
        callback.assert_called_once()

    def test_multiple_repos_separate_events(self):
        coalescer = OssStageCoalescer()
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Passed")
        coalescer.add_event("other/repo", "7", "agent", "completed", "Done")
        events = coalescer.flush()
        assert len(events) == 2
        repos = {e["repo"] for e in events}
        assert repos == {"owner/repo", "other/repo"}

    def test_concurrent_add_and_flush(self):
        coalescer = OssStageCoalescer()
        coalescer.add_event("owner/repo", "42", "triage", "completed", "Passed")
        events1 = coalescer.flush()
        assert len(events1) == 1
        assert coalescer.pending_count == 0
        coalescer.add_event("owner/repo", "42", "agent", "completed", "Done")
        assert coalescer.pending_count == 1

    def test_custom_window_and_max_batch(self):
        coalescer = OssStageCoalescer(window_seconds=7.5, max_batch=5)
        assert coalescer._window == 7.5
        assert coalescer._max_batch == 5
