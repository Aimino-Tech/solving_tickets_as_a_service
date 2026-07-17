"""
Lightweight dashboard for guardrail audit and memory data.

Reads from configurable SQLite database paths (defaulting to the same
paths used by audit_log.py and memory_service.py).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from guardrail import audit_log, memory_service

logger = logging.getLogger(__name__)

_DEFAULT_AUDIT_DB = os.environ.get(
    "GUARDRAIL_AUDIT_DB_PATH",
    str(Path.home() / ".guardrail" / "audit.db"),
)
_DEFAULT_MEMORY_DB = os.environ.get(
    "GUARDRAIL_MEMORY_DB_PATH",
    str(Path.home() / ".guardrail" / "memory.db"),
)


def get_audit_db_path() -> str:
    return os.environ.get("GUARDRAIL_AUDIT_DB_PATH") or _DEFAULT_AUDIT_DB


def get_memory_db_path() -> str:
    return os.environ.get("GUARDRAIL_MEMORY_DB_PATH") or _DEFAULT_MEMORY_DB


def summary() -> dict[str, Any]:
    audit_path = get_audit_db_path()
    memory_path = get_memory_db_path()
    audit_log.init_db(audit_path)
    memory_service.init_db(memory_path)

    return {
        "audit_db_path": audit_path,
        "memory_db_path": memory_path,
        "total_audit_events": audit_log.count_events(db_path=audit_path),
        "total_memory_entries": len(
            memory_service.query(limit=1, db_path=memory_path)
        ),
        "recent_audit_events": audit_log.query_events(
            limit=20, db_path=audit_path
        ),
        "audit_by_guardrail": _count_by_field(
            audit_log.query_events(limit=10000, db_path=audit_path),
            "guardrail",
        ),
        "audit_by_decision": _count_by_field(
            audit_log.query_events(limit=10000, db_path=audit_path),
            "decision",
        ),
    }


def _count_by_field(
    rows: list[dict[str, Any]], field: str
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for r in rows:
        val = r.get(field, "unknown") or "unknown"
        counts[val] = counts.get(val, 0) + 1
    return counts


def render_text() -> str:
    data = summary()
    lines = [
        "=== Guardrail Dashboard ===",
        f"Audit DB:  {data['audit_db_path']}",
        f"Memory DB: {data['memory_db_path']}",
        f"Total audit events: {data['total_audit_events']}",
        f"Total memory entries: {data['total_memory_entries']}",
        "",
        "Audit by guardrail:",
    ]
    for g, cnt in sorted(data["audit_by_guardrail"].items()):
        lines.append(f"  {g}: {cnt}")
    lines.append("")
    lines.append("Audit by decision:")
    for d, cnt in sorted(data["audit_by_decision"].items()):
        lines.append(f"  {d}: {cnt}")
    lines.append("")
    lines.append("Recent events:")
    for ev in data["recent_audit_events"][:10]:
        lines.append(
            f"  [{ev.get('timestamp','')}] {ev.get('guardrail','')}: "
            f"{ev.get('decision','')} — {ev.get('pattern','') or ev.get('source','')}"
        )
    return "\n".join(lines)


def render_json() -> str:
    return json.dumps(summary(), indent=2, default=str)
