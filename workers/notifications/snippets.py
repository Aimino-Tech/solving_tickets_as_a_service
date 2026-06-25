"""
In-memory evidence snippet store for pipeline progress comments.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

_evidence_store: dict[str, list[dict[str, Any]]] = {}
_lock = threading.Lock()


def capture_evidence(
    issue_id: str,
    stage: str,
    file_path: str,
    snippet: str,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "issue_id": issue_id,
        "stage": stage,
        "file_path": file_path,
        "snippet": snippet,
        "timestamp": time.time(),
    }
    key = _store_key(issue_id, stage)
    with _lock:
        _evidence_store.setdefault(key, []).append(entry)
    logger.debug("Evidence captured stage=%s issue=%s file=%s", stage, issue_id, file_path)
    return {"status": "captured", "entry": entry}


def get_evidence(
    issue_id: str,
    stage: str | None = None,
) -> list[dict[str, Any]]:
    if stage is not None:
        key = _store_key(issue_id, stage)
        with _lock:
            return list(_evidence_store.get(key, []))
    else:
        prefix = f"{issue_id}:"
        results: list[dict[str, Any]] = []
        with _lock:
            for store_key, entries in _evidence_store.items():
                if store_key.startswith(prefix):
                    results.extend(entries)
        results.sort(key=lambda e: e.get("timestamp", 0.0))
        return results


def clear_evidence(
    issue_id: str,
    stage: str | None = None,
) -> dict[str, Any]:
    count = 0
    if stage is not None:
        key = _store_key(issue_id, stage)
        with _lock:
            entries = _evidence_store.pop(key, [])
            count = len(entries)
    else:
        prefix = f"{issue_id}:"
        with _lock:
            for store_key in list(_evidence_store.keys()):
                if store_key.startswith(prefix):
                    count += len(_evidence_store.pop(store_key, []))
    if count:
        logger.debug("Cleared %d evidence entries issue=%s stage=%s", count, issue_id, stage or "*")
    return {"status": "cleared", "count": count}


def evidence_count(issue_id: str, stage: str | None = None) -> int:
    if stage is not None:
        key = _store_key(issue_id, stage)
        with _lock:
            return len(_evidence_store.get(key, []))
    else:
        prefix = f"{issue_id}:"
        total = 0
        with _lock:
            for store_key in list(_evidence_store.keys()):
                if store_key.startswith(prefix):
                    total += len(_evidence_store[store_key])
        return total


EVIDENCE_LINE_LIMIT = 15


def format_evidence_section(
    evidence: list[dict[str, Any]],
    *,
    max_lines: int = EVIDENCE_LINE_LIMIT,
) -> str:
    if not evidence:
        return ""
    lines: list[str] = ["\n\U0001f4c1 **Files being analyzed:**\n"]
    for entry in evidence[:max_lines]:
        fp = entry.get("file_path", "?")
        snip = entry.get("snippet", "")
        lines.append(f"- `{fp}` \u2014 {snip}")
    remaining = len(evidence) - max_lines
    if remaining > 0:
        lines.append(f"\n\u2026 and {remaining} more file{'' if remaining == 1 else 's'}")
    return "\n".join(lines)


def _store_key(issue_id: str, stage: str) -> str:
    return f"{issue_id}:{stage}"
