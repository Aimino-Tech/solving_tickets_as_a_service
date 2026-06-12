"""Safe Google Sheet write utilities for large marketing content.

Provides wrappers around ``gspread`` worksheet methods that handle
cell-length limits, content chunking, and truncation logging.
"""

from __future__ import annotations

import logging
from typing import Any

from app.tracking.sheets_backend import (
    MAX_CELL_LENGTH,
    _chunk_large_content,
    _truncate_content,
)

logger = logging.getLogger(__name__)


def safe_append_row(
    ws: Any,
    row: list[Any],
    max_cell_length: int = MAX_CELL_LENGTH,
) -> bool:
    """Append a row to a worksheet, splitting over-long values into overflow rows.

    Each cell value that exceeds *max_cell_length* is split into chunks.
    The first chunk stays in the base row; remaining chunks are written as
    separate overflow rows beneath it.  Non-string values are left untouched.

    Args:
        ws: A ``gspread`` worksheet instance.
        row: List of cell values for the row.
        max_cell_length: Maximum character count per cell (default 50 000).

    Returns:
        ``True`` if at least one cell overflowed, ``False`` otherwise.
    """
    overflow_fields: dict[int, list[Any]] = {}
    base_row: list[Any] = list(row)

    for i, val in enumerate(row):
        if isinstance(val, str) and len(val) > max_cell_length:
            chunks = _chunk_large_content(val, max_cell_length)
            base_row[i] = chunks[0]
            overflow_fields[i] = chunks[1:]

    # Write base row
    ws.append_row(base_row, value_input_option="RAW")

    if not overflow_fields:
        return False

    # Write overflow rows — one per chunk depth
    max_depth = max(len(chunks) for chunks in overflow_fields.values())

    for depth in range(max_depth):
        overflow_row: list[Any] = [""] * len(row)
        for idx in overflow_fields:
            chunks = overflow_fields[idx]
            if depth < len(chunks):
                overflow_row[idx] = chunks[depth]
        ws.append_row(overflow_row, value_input_option="RAW")

    logger.info(
        "[sheet_content_writer] Wrote %d overflow rows for %d long cell(s)",
        max_depth,
        len(overflow_fields),
    )
    return True


def write_large_content(
    ws: Any,
    content: str,
    max_cell_length: int = MAX_CELL_LENGTH,
) -> int:
    """Write a large content string across multiple cells in a single row.

    If *content* fits within *max_cell_length*, it is written as a single
    cell.  Otherwise the content is split into chunks of *max_cell_length*
    characters each, and written as adjacent cells in one new row.

    Args:
        ws: A ``gspread`` worksheet instance.
        content: The string to write.
        max_cell_length: Maximum character count per cell (default 50 000).

    Returns:
        The number of cells written.
    """
    if len(content) <= max_cell_length:
        ws.append_row([content], value_input_option="RAW")
        return 1

    chunks = _chunk_large_content(content, max_cell_length)
    ws.append_row(chunks, value_input_option="RAW")
    logger.info(
        "[sheet_content_writer] Wrote %d cells for content of %d chars",
        len(chunks),
        len(content),
    )
    return len(chunks)


def validate_content_length(
    record: dict[str, Any],
    max_cell_length: int = MAX_CELL_LENGTH,
) -> list[tuple[str, int]]:
    """Check which fields in *record* exceed *max_cell_length*.

    Returns a list of ``(field_name, actual_length)`` tuples for every
    field whose string representation is over the limit.
    """
    over_limit: list[tuple[str, int]] = []
    for key, value in record.items():
        text = str(value)
        length = len(text)
        if length > max_cell_length:
            over_limit.append((key, length))
    return over_limit


def log_content_warning(
    record: dict[str, Any],
    truncated_fields: list[str],
) -> None:
    """Log a structured warning that certain fields were truncated.

    Args:
        record: The original record dict (or partial context).
        truncated_fields: List of field names / indices that were truncated.
    """
    details = {
        "record_preview": str(record.get("id", record.get("row", record)))[:120],
        "truncated_fields": truncated_fields,
        "field_lengths": {
            f: len(str(record.get(f, "")))
            for f in truncated_fields
            if isinstance(f, str)
        },
    }
    logger.warning(
        "[sheet_content_writer] Content truncated: %s",
        details,
    )
