"""
SLA Compliance & Escalation Matrix (AIM-2030).
"""

from __future__ import annotations
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger(__name__)

SLA_GOALS: dict[str, dict[str, int | None]] = {
    "free":       {"response_time_hours": None,  "resolution_time_hours": None},
    "starter":    {"response_time_hours": 24,     "resolution_time_hours": 72},
    "pro":        {"response_time_hours": 4,      "resolution_time_hours": 24},
    "enterprise": {"response_time_hours": 1,      "resolution_time_hours": 4},
}

_VALID_TIERS = frozenset(SLA_GOALS)

class EscalationLevel(str, Enum):
    L1_AUTO = "L1_AUTO"
    L2_HUMAN = "L2_HUMAN"
    L3_ENGINEERING = "L3_ENGINEERING"

@dataclass
class TicketSlaEntry:
    ticket_id: str; tenant_id: str; tenant_tier: str; created_at: str
    first_response_at: Optional[str] = None; resolved_at: Optional[str] = None
    response_time_seconds: Optional[float] = None; resolution_time_seconds: Optional[float] = None
    response_breached: bool = False; resolution_breached: bool = False
    escalation_level: Optional[EscalationLevel] = None; escalation_triggered_at: Optional[str] = None
    incident_created: bool = False; incident_id: Optional[str] = None
    notes: list[str] = field(default_factory=list)

@dataclass
class TenantSlaState:
    tenant_id: str; tier: str; total_tickets: int = 0
    response_breaches: int = 0; resolution_breaches: int = 0
    current_escalations: int = 0; total_escalations: int = 0
    active_tickets: int = 0; resolved_tickets: int = 0

@dataclass
class MonthlySlaRow:
    tenant_id: str; tier: str; year: int; month: int; total_tickets: int = 0
    resolved_tickets: int = 0; response_breaches: int = 0; resolution_breaches: int = 0
    total_escalations: int = 0
    avg_response_time_seconds: Optional[float] = None
    avg_resolution_time_seconds: Optional[float] = None
    compliance_rate_pct: float = 100.0

_REDIS_CLIENT: Optional[Any] = None
_REDIS_SLA_PREFIX = "syntaro:sla:ticket:"
_lock = threading.Lock()
_memory_store: dict[str, TicketSlaEntry] = {}

def _get_redis() -> Optional[Any]:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None: return _REDIS_CLIENT
    try:
        import redis as _redis_mod
        _REDIS_CLIENT = _redis_mod.from_url(os.getenv("REDIS_URL", os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")), decode_responses=True)
        _REDIS_CLIENT.ping(); return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("SLA Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None; return None

def _resolve_tier(tier: str | None) -> str:
    if tier and tier.lower() in _VALID_TIERS: return tier.lower()
    return "free"

def _iso_now() -> str: return datetime.now(timezone.utc).isoformat()
def _seconds_between(a: str, b: str) -> float: return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds()
def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if s is None: return None
    try: return datetime.fromisoformat(s)
    except (ValueError, TypeError): return None

try:
    from workers.metrics import record_counter, record_gauge
except ImportError:
    def record_counter(*a, **kw): pass
    def record_gauge(*a, **kw): pass

_tracker: Optional["SlaTracker"] = None

class SlaTracker:
    @staticmethod
    def sla_goals_for_tier(tier: str) -> dict[str, int | None]: return dict(SLA_GOALS[_resolve_tier(tier)])
    @staticmethod
    def response_time_goal_hours(tier: str) -> int | None: return SLA_GOALS.get(_resolve_tier(tier), {}).get("response_time_hours")
    @staticmethod
    def resolution_time_goal_hours(tier: str) -> int | None: return SLA_GOALS.get(_resolve_tier(tier), {}).get("resolution_time_hours")

    def record_ticket_created(self, tenant_id: str, tenant_tier: str, ticket_id: str, created_at: str | None = None) -> TicketSlaEntry:
        now = created_at or _iso_now()
        e = TicketSlaEntry(ticket_id=ticket_id, tenant_id=tenant_id, tenant_tier=_resolve_tier(tenant_tier), created_at=now)
        self._persist_entry(e); record_counter("syntaro_sla_tickets_created_total", 1, tenant_id=tenant_id, tier=e.tenant_tier); return e

    def record_first_response(self, ticket_id: str, responded_at: str | None = None) -> Optional[TicketSlaEntry]:
        e = self._get_entry(ticket_id)
        if e is None: return None
        now = responded_at or _iso_now(); e.first_response_at = now
        try: e.response_time_seconds = _seconds_between(e.created_at, now)
        except: e.response_time_seconds = None
        gh = self.response_time_goal_hours(e.tenant_tier)
        if gh is not None and e.response_time_seconds is not None and e.response_time_seconds > gh * 3600:
            e.response_breached = True; record_counter("syntaro_sla_response_breaches_total", 1, tenant_id=e.tenant_id, tier=e.tenant_tier)
            self._handle_breach(e, "response", e.response_time_seconds)
        self._persist_entry(e); return e

    def record_resolution(self, ticket_id: str, resolved_at: str | None = None) -> Optional[TicketSlaEntry]:
        e = self._get_entry(ticket_id)
        if e is None: return None
        now = resolved_at or _iso_now(); e.resolved_at = now
        try: e.resolution_time_seconds = _seconds_between(e.created_at, now)
        except: e.resolution_time_seconds = None
        gh = self.resolution_time_goal_hours(e.tenant_tier)
        if gh is not None and e.resolution_time_seconds is not None and e.resolution_time_seconds > gh * 3600:
            e.resolution_breached = True; record_counter("syntaro_sla_resolution_breaches_total", 1, tenant_id=e.tenant_id, tier=e.tenant_tier)
            self._handle_breach(e, "resolution", e.resolution_time_seconds)
        self._persist_entry(e); return e

    def _handle_breach(self, e: TicketSlaEntry, bt: str, sec: float) -> None:
        gh = self.response_time_goal_hours(e.tenant_tier) if bt == "response" else self.resolution_time_goal_hours(e.tenant_tier)
        gs = (gh or 0) * 3600; sr = sec / gs if gs > 0 else 1.0
        if sr >= 3.0 or (e.tenant_tier == "enterprise" and sr >= 1.5):
            e.escalation_level = EscalationLevel.L3_ENGINEERING; self._trigger_incident(e, bt)
        elif sr >= 1.5 or (e.response_breached and e.resolution_breached):
            e.escalation_level = EscalationLevel.L2_HUMAN
        else:
            e.escalation_level = EscalationLevel.L1_AUTO
        e.escalation_triggered_at = _iso_now()
        e.notes.append(f"{e.escalation_level.value}: {bt} breach on {e.tenant_tier} (ratio={sr:.1f}x)")
        record_counter("syntaro_sla_escalations_total", 1, tenant_id=e.tenant_id, tier=e.tenant_tier, level=e.escalation_level.value)

    def _trigger_incident(self, e: TicketSlaEntry, bt: str) -> None:
        e.incident_created = True; e.incident_id = f"INC-{int(time.time())}"
        e.notes.append(f"P1 incident {e.incident_id} created for {bt} breach")
        record_counter("syntaro_sla_incidents_created_total", 1, tenant_id=e.tenant_id, tier=e.tenant_tier)

    def escalate_ticket(self, ticket_id: str, level: str = "L2_HUMAN", reason: str = "") -> Optional[TicketSlaEntry]:
        e = self._get_entry(ticket_id)
        if e is None: return None
        try: el = EscalationLevel(level)
        except ValueError: return None
        e.escalation_level = el; e.escalation_triggered_at = _iso_now()
        e.notes.append(f"Manual escalation to {level}: {reason}" if reason else f"Manual escalation to {level}")
        if el == EscalationLevel.L3_ENGINEERING and not e.incident_created: self._trigger_incident(e, "manual")
        self._persist_entry(e); record_counter("syntaro_sla_manual_escalations_total", 1, tenant_id=e.tenant_id, tier=e.tenant_tier, level=level); return e

    def get_ticket_status(self, ticket_id: str) -> Optional[dict[str, Any]]:
        e = self._get_entry(ticket_id)
        if e is None: return None
        return {"ticket_id": e.ticket_id, "tenant_id": e.tenant_id, "tenant_tier": e.tenant_tier, "created_at": e.created_at, "first_response_at": e.first_response_at, "resolved_at": e.resolved_at, "response_time_seconds": e.response_time_seconds, "resolution_time_seconds": e.resolution_time_seconds, "response_goal_hours": self.response_time_goal_hours(e.tenant_tier), "resolution_goal_hours": self.resolution_time_goal_hours(e.tenant_tier), "response_breached": e.response_breached, "resolution_breached": e.resolution_breached, "escalation_level": e.escalation_level.value if e.escalation_level else None, "escalation_triggered_at": e.escalation_triggered_at, "incident_created": e.incident_created, "incident_id": e.incident_id, "notes": e.notes}

    def get_tenant_status(self, tenant_id: str) -> TenantSlaState:
        entries = self._get_entries_for_tenant(tenant_id)
        if not entries: return TenantSlaState(tenant_id=tenant_id, tier="free")
        lt = max(entries, key=lambda e: e.created_at)
        return TenantSlaState(tenant_id=tenant_id, tier=lt.tenant_tier, total_tickets=len(entries), response_breaches=sum(1 for e in entries if e.response_breached), resolution_breaches=sum(1 for e in entries if e.resolution_breached), current_escalations=sum(1 for e in entries if e.escalation_level is not None and e.resolved_at is None), total_escalations=sum(1 for e in entries if e.escalation_level is not None), active_tickets=sum(1 for e in entries if e.resolved_at is None), resolved_tickets=sum(1 for e in entries if e.resolved_at is not None))

    def get_monthly_report(self, tenant_id: str, year: int, month: int) -> MonthlySlaRow:
        entries = self._get_entries_for_tenant(tenant_id)
        fl = [e for e in entries if (d := _parse_iso(e.created_at)) and d.year == year and d.month == month]
        if not fl: return MonthlySlaRow(tenant_id=tenant_id, tier="free", year=year, month=month)
        rd = [e for e in fl if e.resolved_at is not None]
        rt = [e.response_time_seconds for e in fl if e.response_time_seconds is not None]
        rrt = [e.resolution_time_seconds for e in rd if e.resolution_time_seconds is not None]
        ar = sum(rt) / len(rt) if rt else None; arr = sum(rrt) / len(rrt) if rrt else None
        lt = max(fl, key=lambda e: e.created_at)
        bi = {e.ticket_id for e in fl if e.response_breached or e.resolution_breached}
        cc = len(fl) - len(bi); cr = (cc / len(fl)) * 100 if fl else 100.0
        return MonthlySlaRow(tenant_id=tenant_id, tier=lt.tenant_tier, year=year, month=month, total_tickets=len(fl), resolved_tickets=len(rd), response_breaches=sum(1 for e in fl if e.response_breached), resolution_breaches=sum(1 for e in fl if e.resolution_breached), total_escalations=sum(1 for e in fl if e.escalation_level is not None), avg_response_time_seconds=ar, avg_resolution_time_seconds=arr, compliance_rate_pct=round(cr, 2))

    def get_all_tenant_ids(self) -> list[str]:
        client = _get_redis()
        if client:
            try:
                ids: set[str] = set()
                for key in client.keys(f"{_REDIS_SLA_PREFIX}*") or []:
                    raw = client.get(key)
                    if raw:
                        try: ids.add(json.loads(raw).get("tenant_id", ""))
                        except: pass
                return sorted(tid for tid in ids if tid)
            except Exception as exc: logger.error("Failed to scan SLA tenants -- %s", exc)
        with _lock: return sorted({e.tenant_id for e in _memory_store.values() if e.tenant_id})

    def _persist_entry(self, entry: TicketSlaEntry) -> None:
        data = {"ticket_id": entry.ticket_id, "tenant_id": entry.tenant_id, "tenant_tier": entry.tenant_tier, "created_at": entry.created_at, "first_response_at": entry.first_response_at, "resolved_at": entry.resolved_at, "response_time_seconds": entry.response_time_seconds, "resolution_time_seconds": entry.resolution_time_seconds, "response_breached": entry.response_breached, "resolution_breached": entry.resolution_breached, "escalation_level": entry.escalation_level.value if entry.escalation_level else None, "escalation_triggered_at": entry.escalation_triggered_at, "incident_created": entry.incident_created, "incident_id": entry.incident_id, "notes": entry.notes}
        client = _get_redis()
        if client:
            try:
                key = f"{_REDIS_SLA_PREFIX}{entry.ticket_id}"; client.set(key, json.dumps(data)); client.expire(key, 86400 * 90)
            except Exception as exc:
                logger.error("Failed to persist -- %s", exc)
                with _lock: _memory_store[entry.ticket_id] = entry
        else:
            with _lock: _memory_store[entry.ticket_id] = entry

    def _get_entry(self, ticket_id: str) -> Optional[TicketSlaEntry]:
        client = _get_redis()
        if client:
            try:
                raw = client.get(f"{_REDIS_SLA_PREFIX}{ticket_id}")
                if raw: return self._deserialize(json.loads(raw))
            except Exception as exc: logger.error("Failed to read SLA entry -- %s", exc)
        with _lock: return _memory_store.get(ticket_id)

    def _get_entries_for_tenant(self, tenant_id: str) -> list[TicketSlaEntry]:
        client = _get_redis(); entries: list[TicketSlaEntry] = []
        if client:
            try:
                for key in client.keys(f"{_REDIS_SLA_PREFIX}*") or []:
                    raw = client.get(key)
                    if raw:
                        try:
                            d = json.loads(raw)
                            if d.get("tenant_id") == tenant_id: entries.append(self._deserialize(d))
                        except: pass
            except Exception as exc: logger.error("Failed to read SLA entries -- %s", exc)
        with _lock:
            for e in _memory_store.values():
                if e.tenant_id == tenant_id and not any(x.ticket_id == e.ticket_id for x in entries): entries.append(e)
        return entries

    @staticmethod
    def _deserialize(d: dict[str, Any]) -> TicketSlaEntry:
        el = None
        if d.get("escalation_level"):
            try: el = EscalationLevel(d["escalation_level"])
            except ValueError: pass
        return TicketSlaEntry(ticket_id=d.get("ticket_id", ""), tenant_id=d.get("tenant_id", ""), tenant_tier=d.get("tenant_tier", "free"), created_at=d.get("created_at", ""), first_response_at=d.get("first_response_at"), resolved_at=d.get("resolved_at"), response_time_seconds=d.get("response_time_seconds"), resolution_time_seconds=d.get("resolution_time_seconds"), response_breached=bool(d.get("response_breached", False)), resolution_breached=bool(d.get("resolution_breached", False)), escalation_level=el, escalation_triggered_at=d.get("escalation_triggered_at"), incident_created=bool(d.get("incident_created", False)), incident_id=d.get("incident_id"), notes=list(d.get("notes", [])))

def get_sla_tracker() -> SlaTracker:
    global _tracker
    if _tracker is None: _tracker = SlaTracker()
    return _tracker

def _clear_memory_store() -> None:
    global _REDIS_CLIENT; _REDIS_CLIENT = None
    with _lock: _memory_store.clear()

__all__ = ["SlaTracker", "get_sla_tracker", "_clear_memory_store", "TicketSlaEntry", "TenantSlaState", "MonthlySlaRow", "EscalationLevel", "SLA_GOALS"]
