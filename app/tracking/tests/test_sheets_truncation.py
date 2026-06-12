"""Tests for Google Sheet content truncation logic.

Covers:
- ``_truncate_content`` boundary behaviour
- ``_chunk_large_content`` splitting
- ``_is_retryable_error`` transient error detection
- ``validate_content_length`` field checking
- ``log_content_warning`` logging
- ``safe_append_row`` and ``write_large_content`` via mock gspread worksheet
- ``GoogleSheetsBackend.append_record`` overflow-row creation and content preservation
- Retry logic via ``_append_row_with_retry``
"""

from __future__ import annotations

import json
import logging
import time
from unittest.mock import MagicMock, patch

import pytest

from app.tracking.sheets_backend import (
    MAX_CELL_LENGTH,
    MAX_RETRIES,
    RETRY_BASE_DELAY,
    _chunk_large_content,
    _is_retryable_error,
    _truncate_content,
)
from app.tracking.sheet_content_writer import (
    log_content_warning,
    safe_append_row,
    validate_content_length,
    write_large_content,
)


# ---------------------------------------------------------------------------
# _truncate_content
# ---------------------------------------------------------------------------


class TestTruncateContent:
    """Verify _truncate_content handles boundary conditions correctly."""

    def test_under_limit_unchanged(self):
        short = "short string"
        assert _truncate_content(short, max_len=100) == short

    def test_exactly_at_limit_unchanged(self):
        exact = "a" * MAX_CELL_LENGTH
        result = _truncate_content(exact, max_len=MAX_CELL_LENGTH)
        assert result == exact
        assert len(result) == MAX_CELL_LENGTH

    def test_one_over_limit_truncated(self):
        value = "a" * (MAX_CELL_LENGTH + 1)
        result = _truncate_content(value, max_len=MAX_CELL_LENGTH)
        assert len(result) <= MAX_CELL_LENGTH
        assert "[TRUNCATED:" in result
        assert str(len(value)) in result

    def test_significantly_over_limit_truncated(self):
        value = "x" * (MAX_CELL_LENGTH * 3)
        result = _truncate_content(value, max_len=MAX_CELL_LENGTH)
        assert len(result) <= MAX_CELL_LENGTH
        assert "[TRUNCATED:" in result
        assert str(len(value)) in result

    def test_note_preserves_correct_length_info(self):
        value = "a" * (MAX_CELL_LENGTH + 500)
        result = _truncate_content(value, max_len=MAX_CELL_LENGTH)
        assert f"[TRUNCATED: {len(value)} chars]" in result

    def test_empty_string_unchanged(self):
        assert _truncate_content("", max_len=MAX_CELL_LENGTH) == ""

    def test_non_string_passthrough(self):
        assert _truncate_content("12345", max_len=10) == "12345"


# ---------------------------------------------------------------------------
# _chunk_large_content
# ---------------------------------------------------------------------------


class TestChunkLargeContent:
    """Verify _chunk_large_content splits strings correctly."""

    def test_empty_content(self):
        assert _chunk_large_content("", chunk_size=100) == [""]

    def test_small_content(self):
        assert _chunk_large_content("hello world", chunk_size=100) == ["hello world"]

    def test_exact_chunk_size(self):
        content = "a" * 100
        assert _chunk_large_content(content, chunk_size=100) == [content]

    def test_two_chunks(self):
        content = "a" * 150
        chunks = _chunk_large_content(content, chunk_size=100)
        assert len(chunks) == 2
        assert len(chunks[0]) == 100
        assert len(chunks[1]) == 50
        assert chunks[0] + chunks[1] == content

    def test_multiple_chunks(self):
        content = "x" * 2500
        chunks = _chunk_large_content(content, chunk_size=1000)
        assert len(chunks) == 3
        assert all(len(c) <= 1000 for c in chunks)
        assert "".join(chunks) == content

    def test_uses_default_chunk_size(self):
        content = "a" * (MAX_CELL_LENGTH + 10)
        chunks = _chunk_large_content(content)
        assert len(chunks) == 2
        assert len(chunks[0]) == MAX_CELL_LENGTH
        assert len(chunks[1]) == 10

    def test_chunks_are_contiguous(self):
        content = "The quick brown fox jumps over the lazy dog. " * 500
        chunks = _chunk_large_content(content, chunk_size=50)
        assert "".join(chunks) == content


# ---------------------------------------------------------------------------
# _is_retryable_error
# ---------------------------------------------------------------------------


class TestIsRetryableError:
    """Verify _is_retryable_error correctly identifies transient errors."""

    def test_rate_limit_429(self):
        assert _is_retryable_error(Exception("429")) is True

    def test_server_error_500(self):
        assert _is_retryable_error(Exception("500")) is True

    def test_server_error_503(self):
        assert _is_retryable_error(Exception("503")) is True

    def test_timeout(self):
        assert _is_retryable_error(Exception("Connection timed out")) is True

    def test_quota_exceeded(self):
        assert _is_retryable_error(Exception("Quota exceeded")) is True

    def test_non_retryable_auth_401(self):
        assert _is_retryable_error(Exception("401")) is False

    def test_non_retryable_forbidden_403(self):
        assert _is_retryable_error(Exception("403")) is False

    def test_non_retryable_not_found_404(self):
        assert _is_retryable_error(Exception("404")) is False


# ---------------------------------------------------------------------------
# validate_content_length
# ---------------------------------------------------------------------------


class TestValidateContentLength:
    """Verify validate_content_length correctly identifies over-limit fields."""

    def test_no_over_limit(self):
        assert validate_content_length({"title": "short"}, max_cell_length=100) == []

    def test_one_field_over_limit(self):
        assert validate_content_length({"body": "x" * 200}, max_cell_length=100) == [("body", 200)]

    def test_multiple_fields_over_limit(self):
        result = validate_content_length({"a": "x" * 150, "b": "short", "c": "y" * 300}, max_cell_length=100)
        assert len(result) == 2
        assert ("a", 150) in result
        assert ("c", 300) in result

    def test_empty_record(self):
        assert validate_content_length({}, max_cell_length=100) == []

    def test_none_values(self):
        assert validate_content_length({"key": None}, max_cell_length=10) == []

    def test_integer_values(self):
        assert validate_content_length({"count": 123456789}, max_cell_length=5) == [("count", 9)]


# ---------------------------------------------------------------------------
# log_content_warning
# ---------------------------------------------------------------------------


class TestLogContentWarning:
    """Verify log_content_warning emits a structured warning message."""

    def test_logs_warning_with_field_names(self, caplog):
        caplog.set_level(logging.WARNING)
        log_content_warning({"id": "abc-123", "body": "x" * 60000}, truncated_fields=["body"])
        assert any("body" in str(r.msg) or "body" in str(r.args) for r in caplog.records)

    def test_logs_warning_with_preview(self, caplog):
        caplog.set_level(logging.WARNING)
        log_content_warning({"id": "test-preview-001", "content": "a" * 60000}, truncated_fields=["content"])
        assert any("test-preview-001" in str(r.msg) or "test-preview-001" in str(r.args) for r in caplog.records)

    def test_no_error_for_empty_fields(self, caplog):
        caplog.set_level(logging.WARNING)
        log_content_warning({"id": "noop"}, truncated_fields=[])
        assert any(r.levelno == logging.WARNING for r in caplog.records)


# ---------------------------------------------------------------------------
# safe_append_row (with mock worksheet)
# ---------------------------------------------------------------------------


class TestSafeAppendRow:
    """Verify safe_append_row splits over-long values and writes overflow rows."""

    def test_no_overflow_needed(self):
        ws = MagicMock()
        result = safe_append_row(ws, ["hello", "world"], max_cell_length=100)
        assert result is False
        ws.append_row.assert_called_once_with(["hello", "world"], value_input_option="RAW")

    def test_overflow_writes_overflow_rows(self):
        """A single over-long cell yields a base row + N overflow rows."""
        ws = MagicMock()
        ws.append_row.return_value = None
        long_val = "a" * 250
        result = safe_append_row(ws, ["short", long_val], max_cell_length=100)
        assert result is True
        # 1 base + 2 overflow (250/100 = 3 chunks, 2 overflow for base's 1st chunk)
        assert ws.append_row.call_count == 3

        calls = ws.append_row.call_args_list
        base_row = calls[0][0][0]
        assert base_row[0] == "short"
        assert base_row[1] == "a" * 100

        row1 = calls[1][0][0]
        row2 = calls[2][0][0]
        reconstructed = base_row[1] + row1[1] + row2[1]
        assert reconstructed == long_val

    def test_multiple_long_cells_combined(self):
        """Multiple over-long cells at the same overflow depth share one overflow row."""
        ws = MagicMock()
        ws.append_row.return_value = None
        # Both cols have 1 chunk of overflow each
        result = safe_append_row(ws, ["a" * 150, "b" * 160, "short"], max_cell_length=100)
        assert result is True
        # base + 1 combined overflow row (both fields at depth=0)
        assert ws.append_row.call_count == 2

        calls = ws.append_row.call_args_list
        base_row = calls[0][0][0]
        assert len(base_row[0]) == 100
        assert len(base_row[1]) == 100
        assert base_row[2] == "short"

        overflow_row = calls[1][0][0]
        assert len(overflow_row[0]) == 50  # remaining
        assert len(overflow_row[1]) == 60  # remaining

    def test_non_string_values_passthrough(self):
        ws = MagicMock()
        result = safe_append_row(ws, [42, 3.14, None, True], max_cell_length=5)
        assert result is False
        ws.append_row.assert_called_once_with([42, 3.14, None, True], value_input_option="RAW")


# ---------------------------------------------------------------------------
# write_large_content (with mock worksheet)
# ---------------------------------------------------------------------------


class TestWriteLargeContent:
    """Verify write_large_content splits content across cells."""

    def test_small_content(self):
        ws = MagicMock()
        assert write_large_content(ws, "hello", max_cell_length=100) == 1

    def test_large_content(self):
        ws = MagicMock()
        content = "a" * 2500
        n = write_large_content(ws, content, max_cell_length=1000)
        assert n == 3
        cells = ws.append_row.call_args[0][0]
        assert len(cells) == 3
        assert all(len(c) <= 1000 for c in cells)
        assert "".join(cells) == content

    def test_content_at_limit(self):
        ws = MagicMock()
        assert write_large_content(ws, "b" * 100, max_cell_length=100) == 1

    def test_empty_content(self):
        ws = MagicMock()
        assert write_large_content(ws, "", max_cell_length=100) == 1


# ---------------------------------------------------------------------------
# Integration-style: sheets_backend.append_record overflow rows
# ---------------------------------------------------------------------------


class TestAppendRecordOverflow:
    """Verify GoogleSheetsBackend.append_record splits long content into overflow rows."""

    def test_no_overflow(self):
        from app.tracking.sheets_backend import GoogleSheetsBackend, UNIFIED_HEADERS

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._gc = MagicMock()
        backend._sh = MagicMock()

        backend.append_record({"id": "t1", "type": "e", "timestamp": "now", "content_snippet": "short"})

        assert backend._ws.append_row.call_count == 1
        row = backend._ws.append_row.call_args[0][0]
        assert row[UNIFIED_HEADERS.index("content_overflow")] == ""

    def test_single_field_overflow(self):
        from app.tracking.sheets_backend import GoogleSheetsBackend, UNIFIED_HEADERS

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._gc = MagicMock()
        backend._sh = MagicMock()
        backend._ws.append_row.return_value = None

        backend.append_record({
            "id": "t2", "type": "e", "timestamp": "now",
            "content_snippet": "x" * (MAX_CELL_LENGTH + 500),
        })

        # 1 base + 1 overflow row
        assert backend._ws.append_row.call_count == 2
        base = backend._ws.append_row.call_args_list[0][0][0]
        assert base[UNIFIED_HEADERS.index("content_overflow")] == "TRUE"
        assert "[TRUNCATED:" not in base[UNIFIED_HEADERS.index("content_snippet")]

    def test_multiple_field_overflow_combined(self):
        """Multiple overflowing fields at same depth produce one combined overflow row."""
        from app.tracking.sheets_backend import GoogleSheetsBackend, UNIFIED_HEADERS

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._gc = MagicMock()
        backend._sh = MagicMock()
        backend._ws.append_row.return_value = None

        backend.append_record({
            "id": "t3", "type": "e", "timestamp": "now",
            "content_snippet": "x" * (MAX_CELL_LENGTH + 100),
            "raw_data": "y" * (MAX_CELL_LENGTH + 200),
        })

        # base + 1 combined overflow row
        assert backend._ws.append_row.call_count == 2

        overflow_row = backend._ws.append_row.call_args_list[1][0][0]
        overflow_val = overflow_row[UNIFIED_HEADERS.index("content_overflow")]
        assert "content_snippet" in overflow_val
        assert "raw_data" in overflow_val

    def test_content_reconstruction(self):
        """All chunks can be concatenated to reconstruct original content."""
        from app.tracking.sheets_backend import GoogleSheetsBackend, UNIFIED_HEADERS

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._gc = MagicMock()
        backend._sh = MagicMock()
        backend._ws.append_row.return_value = None

        original = "Marketing content that is very long. " * 2000
        backend.append_record({
            "id": "t4", "type": "e", "timestamp": "now",
            "content_snippet": original,
        })

        snippet_idx = UNIFIED_HEADERS.index("content_snippet")
        all_chunks = "".join(
            args[0][snippet_idx]
            for args, _ in backend._ws.append_row.call_args_list
            if args[0][snippet_idx]
        )
        assert all_chunks == original
        assert len(all_chunks) == len(original)

    def test_single_chunk_no_overflow(self):
        """Content fitting in one chunk produces no overflow rows."""
        from app.tracking.sheets_backend import GoogleSheetsBackend, UNIFIED_HEADERS

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._gc = MagicMock()
        backend._sh = MagicMock()

        exact = "x" * MAX_CELL_LENGTH
        backend.append_record({
            "id": "t5", "type": "e", "timestamp": "now",
            "content_snippet": exact,
        })

        assert backend._ws.append_row.call_count == 1
        snippet_idx = UNIFIED_HEADERS.index("content_snippet")
        assert backend._ws.append_row.call_args[0][0][snippet_idx] == exact


# ---------------------------------------------------------------------------
# _append_row_with_retry
# ---------------------------------------------------------------------------


class TestAppendRowWithRetry:
    """Verify _append_row_with_retry retries on transient errors."""

    def test_success_on_first_attempt(self):
        from app.tracking.sheets_backend import GoogleSheetsBackend

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._ws.append_row.return_value = None
        backend._append_row_with_retry(["a"])
        assert backend._ws.append_row.call_count == 1

    def test_retries_on_rate_limit(self):
        from app.tracking.sheets_backend import GoogleSheetsBackend

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._ws.append_row.side_effect = [Exception("429"), Exception("429"), None]
        slept = []
        orig_sleep = time.sleep
        def mock_sleep(s): slept.append(s)
        time.sleep = mock_sleep
        try:
            backend._append_row_with_retry(["a"])
        finally:
            time.sleep = orig_sleep
        assert backend._ws.append_row.call_count == 3
        assert len(slept) == 2

    def test_exhausts_retries_and_raises(self):
        from app.tracking.sheets_backend import GoogleSheetsBackend

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._ws.append_row.side_effect = Exception("429")

        with patch.object(time, "sleep"):
            with pytest.raises(Exception):
                backend._append_row_with_retry(["a"])

        assert backend._ws.append_row.call_count == MAX_RETRIES

    def test_non_retryable_error_raises_immediately(self):
        from app.tracking.sheets_backend import GoogleSheetsBackend

        backend = GoogleSheetsBackend()
        backend._ws = MagicMock()
        backend._ws.append_row.side_effect = Exception("401")

        with pytest.raises(Exception, match="401"):
            backend._append_row_with_retry(["a"])

        assert backend._ws.append_row.call_count == 1


# ---------------------------------------------------------------------------
# Module constants & public interface
# ---------------------------------------------------------------------------


def test_module_constants():
    assert MAX_CELL_LENGTH == 50000


def test_public_interface_exists():
    assert callable(_truncate_content)
    assert callable(_chunk_large_content)
    assert callable(_is_retryable_error)
    assert callable(safe_append_row)
    assert callable(write_large_content)
    assert callable(validate_content_length)
    assert callable(log_content_warning)
