"""Workflow receipt generation with SHA-256 chaining.

Each receipt carries a ``prev_hash`` that links it to the preceding receipt,
forming an append-only integrity-protected chain::

    chain_hash = SHA-256(prev_hash || payload_hash)

The genesis receipt uses ``prev_hash = ""`` (empty string).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class WorkflowReceipt(BaseModel):
    """A single receipt in a SHA-256 chained workflow audit trail.

    Each receipt is linked to its predecessor via ``prev_hash``, creating
    an immutable chain that can be verified independently.
    """

    id: str = Field(
        default_factory=lambda: uuid.uuid4().hex,
        description="Unique receipt identifier (hex UUID4)",
    )
    event: str = Field(
        ..., description="Event name that triggered this receipt"
    )
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary structured data attached to the receipt",
    )
    payload_hash: str = Field(
        ..., description="SHA-256 hex digest of the canonical JSON payload"
    )
    prev_hash: str = Field(
        default="",
        description=(
            "SHA-256 hex digest of the previous receipt in the chain. "
            "Empty string for the genesis receipt."
        ),
    )
    chain_hash: str = Field(
        ..., description="SHA-256 hex digest of this receipt for the next link"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp of receipt creation",
    )

    def to_dict(self) -> dict[str, Any]:
        """Return a serialisable dictionary representation."""
        return {
            "id": self.id,
            "event": self.event,
            "payload": self.payload,
            "payload_hash": self.payload_hash,
            "prev_hash": self.prev_hash,
            "chain_hash": self.chain_hash,
            "created_at": self.created_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Internal helpers  (mirror the approach in workers/audit/trail.py)
# ---------------------------------------------------------------------------


def _payload_hash(payload: dict[str, Any]) -> str:
    """SHA-256 hex digest of a canonical JSON payload.

    Canonical JSON uses sorted keys and no whitespace so the same data
    always produces the same hash.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _chain_hash(prev_hash: str, payload_hash: str) -> str:
    """Compute SHA-256(prev_hash || payload_hash).

    Both arguments are hex-encoded SHA-256 strings.  The concatenation
    is performed on the raw ASCII hex bytes so the result is deterministic.
    """
    raw = (prev_hash + payload_hash).encode("ascii")
    return hashlib.sha256(raw).hexdigest()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_receipt(
    event: str,
    payload: dict[str, Any] | None = None,
    *,
    prev_hash: str = "",
) -> WorkflowReceipt:
    """Generate a new SHA-256 chained workflow receipt.

    Parameters
    ----------
    event:
        Event name that triggered this receipt (e.g. ``"build.started"``).
    payload:
        Arbitrary structured data attached to the receipt.
    prev_hash:
        The ``chain_hash`` of the previous receipt in the chain.
        Pass an empty string (default) for the genesis receipt.

    Returns
    -------
    WorkflowReceipt
        A new receipt whose ``chain_hash`` can be passed as ``prev_hash``
        to the next ``generate_receipt`` call to extend the chain.
    """
    payload = payload or {}

    # 1 — payload hash (deterministic from canonical JSON)
    ph = _payload_hash(payload)

    # 2 — chain hash (SHA-256 of prev_hash || payload_hash)
    ch = _chain_hash(prev_hash, ph)

    # 3 — build receipt
    return WorkflowReceipt(
        event=event,
        payload=payload,
        payload_hash=ph,
        prev_hash=prev_hash,
        chain_hash=ch,
    )
