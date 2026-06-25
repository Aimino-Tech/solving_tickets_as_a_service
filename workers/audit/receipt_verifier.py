"""Verification of SHA-256 chained workflow receipts.

Two entry points::

    verify_chain(receipts)       — verify an entire chain end-to-end
    verify_receipt(receipt, …)   — check a single link in the chain

Each verifier logs the reason for failure as a human-readable string
returned alongside the boolean pass/fail result.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from workers.audit.receipts import WorkflowReceipt, _chain_hash, _payload_hash

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def verify_receipt(
    receipt: WorkflowReceipt,
    previous_receipt: WorkflowReceipt | None = None,
) -> tuple[bool, str]:
    """Verify a single receipt's integrity.

    Checks:

    1. The receipt's ``payload_hash`` matches a re-computation over its
       ``payload`` (the payload has not been tampered with).
    2. The receipt's ``chain_hash`` matches ``SHA-256(prev_hash || payload_hash)``
       (the link has not been corrupted).
    3. If *previous_receipt* is provided, the receipt's ``prev_hash`` matches
       the previous receipt's ``chain_hash`` (the chain link is intact).

    Parameters
    ----------
    receipt:
        The receipt to verify.
    previous_receipt:
        The preceding receipt in the chain.  Pass ``None`` for the genesis
        receipt (only checks 1 & 2).

    Returns
    -------
    tuple[bool, str]
        ``(True, "")`` if the receipt is valid, or ``(False, reason)``
        if verification fails.
    """
    # --- Check 1: payload hash integrity ---
    expected_ph = _payload_hash(receipt.payload)
    if receipt.payload_hash != expected_ph:
        reason = (
            f"payload_hash mismatch — receipt={receipt.id} "
            f"expected={expected_ph} got={receipt.payload_hash}"
        )
        logger.warning("Receipt verification failed: %s", reason)
        return False, reason

    # --- Check 2: chain hash integrity ---
    expected_ch = _chain_hash(receipt.prev_hash, receipt.payload_hash)
    if receipt.chain_hash != expected_ch:
        reason = (
            f"chain_hash mismatch — receipt={receipt.id} "
            f"expected={expected_ch} got={receipt.chain_hash}"
        )
        logger.warning("Receipt verification failed: %s", reason)
        return False, reason

    # --- Check 3: chain link (optional) ---
    if previous_receipt is not None:
        if receipt.prev_hash != previous_receipt.chain_hash:
            reason = (
                f"prev_hash does not match previous receipt's chain_hash "
                f"— receipt={receipt.id} prev_hash={receipt.prev_hash} "
                f"expected_prev={previous_receipt.chain_hash}"
            )
            logger.warning("Receipt verification failed: %s", reason)
            return False, reason

    return True, ""


def verify_chain(receipts: list[WorkflowReceipt]) -> tuple[bool, str]:
    """Verify the integrity of an entire chain of receipts.

    Iterates through *receipts* in **chronological order** (index 0 = oldest)
    and verifies each link.  Returns ``True`` only if *every* link is valid.

    Parameters
    ----------
    receipts:
        The list of receipts to verify, **oldest-first** (index 0 is the
        genesis receipt).

    Returns
    -------
    tuple[bool, str]
        ``(True, "")`` if the chain is intact, or ``(False, reason)``
        with the first failure reason.
    """
    if not receipts:
        return True, ""

    # Verify genesis (index 0)
    ok, reason = verify_receipt(receipts[0], previous_receipt=None)
    if not ok:
        return False, f"Genesis receipt failed: {reason}"

    # Verify subsequent links
    for i in range(1, len(receipts)):
        ok, reason = verify_receipt(receipts[i], previous_receipt=receipts[i - 1])
        if not ok:
            return False, f"Receipt at index {i} failed: {reason}"

    return True, ""
