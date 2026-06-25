"""Export audit trail data as NDJSON or CSV."""

from __future__ import annotations

import csv
import io
import json
import logging
from typing import Any, Iterable

from workers.audit.models import AuditEvent

logger = logging.getLogger(__name__)

CSV_COLUMNS = [
    "id",
    "tenant_id",
    "event_type",
    "created_at",
    "prev_hash",
    "payload_hash",
    "chain_hash",
    "payload",
]


def _serialise_event(event: AuditEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "tenant_id": event.tenant_id,
        "event_type": event.event_type,
        "created_at": event.created_at.isoformat(),
        "prev_hash": event.prev_hash,
        "payload_hash": event.payload_hash,
        "chain_hash": event.chain_hash(),
        "payload": json.dumps(event.payload, sort_keys=True),
    }


def export_ndjson(
    events: Iterable[AuditEvent],
    output: io.TextIOBase,
    *,
    pretty: bool = False,
) -> int:
    count = 0
    indent = 2 if pretty else None
    for event in events:
        row = _serialise_event(event)
        line = json.dumps(row, indent=indent)
        output.write(line)
        output.write("\n")
        count += 1
    return count


def export_csv(
    events: Iterable[AuditEvent],
    output: io.TextIOBase,
    *,
    delimiter: str = ",",
) -> int:
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS, delimiter=delimiter)
    writer.writeheader()
    count = 0
    for event in events:
        writer.writerow(_serialise_event(event))
        count += 1
    return count
