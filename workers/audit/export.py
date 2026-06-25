from __future__ import annotations

import csv
import io
import json
import logging
from typing import Any

from workers.audit.trail import AuditTrail

logger = logging.getLogger(__name__)


class AuditExporter:
    def __init__(self) -> None:
        self._trail = AuditTrail()

    def export_ndjson(
        self,
        scope: str = "",
        event_type: str = "",
        severity: str = "",
        limit: int = 10000,
    ) -> str:
        events = self._trail.get_events(
            limit=limit,
            event_type=event_type or None,
            scope=scope or None,
            severity=severity or None,
        )
        lines: list[str] = []
        for e in events:
            record = {
                "event_id": e.event_id,
                "prev_hash": e.prev_hash,
                "sha256_hash": e.sha256_hash,
                "timestamp": e.timestamp,
                "severity": e.severity if isinstance(e.severity, str) else e.severity.value,
                "event_type": e.event_type if isinstance(e.event_type, str) else e.event_type.value,
                "scope": e.scope,
                "payload": e.payload,
            }
            lines.append(json.dumps(record, separators=(",", ":")))
        return "\n".join(lines)

    def export_csv(
        self,
        scope: str = "",
        event_type: str = "",
        severity: str = "",
        limit: int = 10000,
    ) -> str:
        events = self._trail.get_events(
            limit=limit,
            event_type=event_type or None,
            scope=scope or None,
            severity=severity or None,
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["event_id", "prev_hash", "sha256_hash", "timestamp", "severity", "event_type", "scope", "payload"])
        for e in events:
            writer.writerow([
                e.event_id,
                e.prev_hash,
                e.sha256_hash,
                e.timestamp,
                e.severity if isinstance(e.severity, str) else e.severity.value,
                e.event_type if isinstance(e.event_type, str) else e.event_type.value,
                e.scope,
                json.dumps(e.payload),
            ])
        return output.getvalue()
