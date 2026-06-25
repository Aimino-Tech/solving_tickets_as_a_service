"""Export evidence receipts as JSON or NDJSON."""

from __future__ import annotations

import json
import logging
from typing import Any, Iterable

from workers.audit.evidence import EvidenceReceipt

logger = logging.getLogger(__name__)


def _serialise_receipt(
    receipt: EvidenceReceipt,
    *,
    include_hash: bool = True,
) -> dict[str, Any]:
    raw = receipt.model_dump(mode="json")
    if not include_hash:
        raw.pop("receipt_hash", None)
        raw.pop("prev_receipt_hash", None)
    return raw


# ---- JSON export ------------------------------------------------------------


def export_evidence_json(
    receipts: Iterable[EvidenceReceipt],
    *,
    pretty: bool = False,
    include_hash: bool = True,
) -> str:
    rows = [_serialise_receipt(r, include_hash=include_hash) for r in receipts]
    indent = 2 if pretty else None
    return json.dumps(rows, indent=indent, sort_keys=True, default=str)


def export_evidence_json_to_file(
    receipts: Iterable[EvidenceReceipt],
    output_path: str,
    *,
    pretty: bool = False,
    include_hash: bool = True,
) -> int:
    content = export_evidence_json(receipts, pretty=pretty, include_hash=include_hash)
    with open(output_path, "w") as f:
        f.write(content)
        f.write("\n")
    try:
        parsed = json.loads(content)
        count = len(parsed) if isinstance(parsed, list) else 1
    except json.JSONDecodeError:
        count = 0
    logger.info("Exported %d evidence receipts to %s", count, output_path)
    return count


# ---- NDJSON export ----------------------------------------------------------


def export_evidence_ndjson(
    receipts: Iterable[EvidenceReceipt],
    *,
    pretty: bool = False,
    include_hash: bool = True,
) -> str:
    lines: list[str] = []
    indent = 2 if pretty else None
    for receipt in receipts:
        row = _serialise_receipt(receipt, include_hash=include_hash)
        line = json.dumps(row, indent=indent, sort_keys=True, default=str)
        lines.append(line)
    return "\n".join(lines)


def export_evidence_ndjson_to_file(
    receipts: Iterable[EvidenceReceipt],
    output_path: str,
    *,
    pretty: bool = False,
    include_hash: bool = True,
) -> int:
    content = export_evidence_ndjson(receipts, pretty=pretty, include_hash=include_hash)
    with open(output_path, "w") as f:
        f.write(content)
        f.write("\n")
    count = len([l for l in content.split("\n") if l.strip()]) if content else 0
    logger.info("Exported %d evidence receipts (NDJSON) to %s", count, output_path)
    return count


# ---- Single receipt export --------------------------------------------------


def export_single_receipt(
    receipt: EvidenceReceipt,
    *,
    pretty: bool = False,
    include_hash: bool = True,
) -> str:
    row = _serialise_receipt(receipt, include_hash=include_hash)
    indent = 2 if pretty else None
    return json.dumps(row, indent=indent, sort_keys=True, default=str)
