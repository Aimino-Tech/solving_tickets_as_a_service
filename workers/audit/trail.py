"""SHA-256 chained append-only audit trail.

Core chaining logic::

    chain_hash = SHA-256(prev_hash || payload_hash)

where ``payload_hash = SHA-256(canonical_json(event_payload))`` and
``prev_hash`` is the ``chain_hash`` of the previous event in the chain.
The genesis event uses ``prev_hash = ""`` (empty string).
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from workers.audit.models import AuditEvent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# In-memory audit store  (production would use PostgreSQL / ScyllaDB)
# ---------------------------------------------------------------------------

class AuditStore:
    """Thread-safe in-memory store for audit events.

    In production this would be replaced by a database-backed store.
    The interface (``append``, ``get_chain``, ``get_events_by_type``,
    ``get_events_since``) is designed to be implementable against SQL
    or a document store without changing callers.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: list[AuditEvent] = []
        self._by_tenant: dict[str, list[AuditEvent]] = defaultdict(list)

    # ---- write path -------------------------------------------------------

    def append(self, event: AuditEvent) -> AuditEvent:
        """Append an event to the store.

        This is an **INSERT-only** operation.  Once written, an event
        can never be modified or deleted from the trail.
        """
        with self._lock:
            self._events.append(event)
            self._by_tenant[event.tenant_id].append(event)
        return event

    # ---- read paths -------------------------------------------------------

    def get_chain(
        self,
        tenant_id: str | None = None,
        *,
        after_id: str | None = None,
        limit: int = 100,
    ) -> list[AuditEvent]:
        """Return ordered event chain, newest-first.

        Parameters
        ----------
        tenant_id:
            Optional tenant scope.
        after_id:
            Return only events after this event ID (for pagination).
        limit:
            Maximum number of events to return.
        """
        with self._lock:
            source = (
                self._by_tenant.get(tenant_id, [])
                if tenant_id
                else self._events
            )

            if after_id is not None:
                idx = self._find_index(source, after_id)
                if idx is not None:
                    source = source[idx + 1:]

            return list(reversed(source))[:limit]

    def get_events_by_type(self, event_type: str) -> list[AuditEvent]:
        """Return all events matching *event_type* across tenants."""
        with self._lock:
            return [e for e in self._events if e.event_type == event_type]

    def get_events_since(
        self,
        since: datetime,
        tenant_id: str | None = None,
    ) -> list[AuditEvent]:
        """Return events created at or after *since* (UTC)."""
        with self._lock:
            source = (
                self._by_tenant.get(tenant_id, [])
                if tenant_id
                else self._events
            )
            return [e for e in source if e.created_at >= since]

    def count(self, tenant_id: str | None = None) -> int:
        """Total number of events, optionally scoped to a tenant."""
        with self._lock:
            if tenant_id:
                return len(self._by_tenant.get(tenant_id, []))
            return len(self._events)

    def clear(self) -> None:
        """Remove all events (**testing only**)."""
        with self._lock:
            self._events.clear()
            self._by_tenant.clear()

    # ---- helpers ----------------------------------------------------------

    @staticmethod
    def _find_index(
        events: list[AuditEvent], event_id: str,
    ) -> int | None:
        for i, ev in enumerate(events):
            if ev.id == event_id:
                return i
        return None


# ---------------------------------------------------------------------------
# Module-level singleton (workers typically share one process-global store)
# ---------------------------------------------------------------------------

_store: AuditStore | None = None
_store_lock = threading.Lock()


def _get_store() -> AuditStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = AuditStore()
    return _store


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_payload_hash(payload: dict[str, Any]) -> str:
    """Return the SHA-256 hex digest of a canonical JSON payload.

    Canonical JSON uses sorted keys and no whitespace so the same data
    always produces the same hash.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compute_chain_hash(prev_hash: str, payload_hash: str) -> str:
    """Compute SHA-256(prev_hash || payload_hash).

    Both arguments are hex-encoded SHA-256 strings.  The concatenation
    is performed on the raw ASCII hex bytes so the result is deterministic.
    """
    raw = (prev_hash + payload_hash).encode("ascii")
    return hashlib.sha256(raw).hexdigest()


def append_event(
    tenant_id: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    store: AuditStore | None = None,
) -> AuditEvent:
    """Append a new event to the audit trail.

    This function:

    1. Computes ``payload_hash = SHA-256(canonical_json(payload))``.
    2. Retrieves the ``prev_hash`` from the most recent event in the
       chain for *tenant_id* (empty string for genesis).
    3. Creates an ``AuditEvent`` with the computed hashes.
    4. Appends it to the store (INSERT-only — the event is immutable
       once written).

    Parameters
    ----------
    tenant_id:
        Tenant or organisation scope.
    event_type:
        Categorical event type, e.g. ``"pipeline.start"``.
    payload:
        Arbitrary structured data (will be serialised to canonical JSON
        for hashing).
    store:
        Override the default store (useful for testing).

    Returns
    -------
    AuditEvent
        The newly appended (immutable) event.
    """
    store = store or _get_store()
    payload = payload or {}

    # 1 — payload hash
    payload_hash = compute_payload_hash(payload)

    # 2 — previous chain hash (most recent event for this tenant)
    chain = store.get_chain(tenant_id=tenant_id, limit=1)
    prev_hash = chain[0].chain_hash() if chain else ""

    # 3 — build event
    event = AuditEvent(
        tenant_id=tenant_id,
        event_type=event_type,
        payload=payload,
        payload_hash=payload_hash,
        prev_hash=prev_hash,
    )

    # 4 — INSERT-only write
    store.append(event)
    logger.debug(
        "Audit event appended — id=%s type=%s tenant=%s chain_hash=%s",
        event.id,
        event_type,
        tenant_id,
        event.chain_hash(),
    )
    return event


def get_chain(
    tenant_id: str | None = None,
    *,
    after_id: str | None = None,
    limit: int = 100,
    store: AuditStore | None = None,
) -> list[AuditEvent]:
    """Return the ordered event chain, newest-first.

    Parameters match :meth:`AuditStore.get_chain`.
    """
    return (store or _get_store()).get_chain(
        tenant_id=tenant_id, after_id=after_id, limit=limit,
    )


def verify_chain_integrity(
    tenant_id: str,
    *,
    store: AuditStore | None = None,
) -> bool:
    """Verify the integrity of the entire chain for a tenant.

    Re-computes every link and checks that ``chain_hash(prev)`` matches
    the stored ``prev_hash`` of the next event.  Returns ``True`` if
    the chain is intact.
    """
    s = store or _get_store()
    events = s.get_chain(tenant_id=tenant_id, limit=10_000)

    # Reverse to chronological order for sequential verification
    events = list(reversed(events))

    if not events:
        return True

    expected_prev = ""
    for event in events:
        if event.prev_hash != expected_prev:
            logger.error(
                "Chain integrity violation — event=%s expected_prev=%s got=%s",
                event.id,
                expected_prev,
                event.prev_hash,
            )
            return False
        expected_prev = event.chain_hash()

    return True
