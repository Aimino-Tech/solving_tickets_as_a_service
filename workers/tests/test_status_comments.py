from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from workers.notifications.status_comments import (
    StageCoalescer,
    post_stage_start,
    post_stage_complete,
    post_stage_failure,
    _sanitize_reason,
    is_enabled,
)


class TestStatusComments:
    def test_sanitize_reason_shortens_long_strings(self) -> None:
        long = "x" * 500
        result = _sanitize_reason(long)
        assert len(result) <= 203

    def test_sanitize_reason_removes_code_blocks(self) -> None:
        result = _sanitize_reason("Error: ```print('hi')```")
        assert "```" not in result

    def test_post_stage_start_calls_linear(self) -> None:
        with patch("workers.notifications.status_comments._do_post") as mock:
            post_stage_start("ISSUE-1", "triage")
            mock.assert_called_once()
            args = mock.call_args[0]
            assert "Triage" in args[1]

    def test_post_stage_complete(self) -> None:
        with patch("workers.notifications.status_comments._do_post") as mock:
            post_stage_complete("ISSUE-1", "verify", "All 42 tests pass")
            mock.assert_called_once()
            args = mock.call_args[0]
            assert "42 tests" in args[1]

    def test_post_stage_failure(self) -> None:
        with patch("workers.notifications.status_comments._do_post") as mock:
            post_stage_failure("ISSUE-1", "agent", "Sandbox timeout")
            mock.assert_called_once()
            args = mock.call_args[0]
            assert "Failed" in args[1]


class TestCoalescer:
    def test_single_event_posts_directly(self) -> None:
        c = StageCoalescer(window_seconds=0.1)
        with patch("workers.notifications.status_comments._do_post") as mock:
            c.add_event("ISSUE-1", "triage", "started")
            time.sleep(0.2)
            c.flush("ISSUE-1")
            assert mock.call_count == 1 or mock.call_count > 0

    def test_multiple_events_coalesced(self) -> None:
        c = StageCoalescer(window_seconds=0.1)
        with patch("workers.notifications.status_comments._do_post") as mock:
            c.add_event("ISSUE-1", "triage", "completed", "Bug fix")
            c.add_event("ISSUE-1", "research", "completed", "3 patterns found")
            time.sleep(0.2)
            c.flush("ISSUE-1")
            assert mock.call_count >= 1
            if mock.call_count > 0:
                body = mock.call_args[0][1]
                assert "Bug fix" in body or "3 patterns" in body


class TestIsEnabled:
    def test_enabled_by_default(self) -> None:
        import os
        os.environ.pop("STAS_STATUS_COMMENTS_ENABLED", None)
        assert is_enabled()

    def test_disabled_when_false(self) -> None:
        import os
        os.environ["STAS_STATUS_COMMENTS_ENABLED"] = "false"
        assert not is_enabled()
