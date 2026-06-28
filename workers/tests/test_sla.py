"""Tests for SLA compliance & escalation tracker (AIM-2030)."""
from unittest.mock import MagicMock, patch
import pytest
from workers.billing.sla import (
    EscalationLevel, MonthlySlaRow, SlaTracker, TenantSlaState, TicketSlaEntry, _clear_memory_store,
)

@pytest.fixture(autouse=True)
def clear():
    _clear_memory_store()
    import workers.billing.sla as m; m._tracker = None
    yield

class TestSlaGoals:
    def test_free(self): g = SlaTracker.sla_goals_for_tier("free"); assert g["response_time_hours"] is None and g["resolution_time_hours"] is None
    def test_starter(self): g = SlaTracker.sla_goals_for_tier("starter"); assert g["response_time_hours"] == 24 and g["resolution_time_hours"] == 72
    def test_pro(self): g = SlaTracker.sla_goals_for_tier("pro"); assert g["response_time_hours"] == 4 and g["resolution_time_hours"] == 24
    def test_enterprise(self): g = SlaTracker.sla_goals_for_tier("enterprise"); assert g["response_time_hours"] == 1 and g["resolution_time_hours"] == 4
    def test_unknown(self): assert SlaTracker.response_time_goal_hours("platinum") is None
    def test_case(self): assert SlaTracker.response_time_goal_hours("PRO") == 4
    def test_free_none(self): assert SlaTracker.response_time_goal_hours("free") is None

class TestLifecycle:
    @patch("workers.billing.sla._get_redis")
    def test_create(self, m): m.return_value = None; e = SlaTracker().record_ticket_created("a", "pro", "T1"); assert e.ticket_id == "T1"
    @patch("workers.billing.sla._get_redis")
    def test_create_defaults_free(self, m): m.return_value = None; e = SlaTracker().record_ticket_created("a", "x", "T2"); assert e.tenant_tier == "free"
    @patch("workers.billing.sla._get_redis")
    def test_response_ok(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","T3","2026-06-15T10:00:00Z"); e = t.record_first_response("T3","2026-06-15T12:00:00Z"); assert e is not None and not e.response_breached
    @patch("workers.billing.sla._get_redis")
    def test_response_breach(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","T4","2026-06-15T10:00:00Z"); e = t.record_first_response("T4","2026-06-15T15:00:00Z"); assert e is not None and e.response_breached
    @patch("workers.billing.sla._get_redis")
    def test_resolution_ok(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","T5","2026-06-15T10:00:00Z"); t.record_first_response("T5","2026-06-15T12:00:00Z"); e = t.record_resolution("T5","2026-06-16T08:00:00Z"); assert e is not None and not e.resolution_breached
    @patch("workers.billing.sla._get_redis")
    def test_resolution_breach(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","T6","2026-06-15T10:00:00Z"); e = t.record_resolution("T6","2026-06-17T12:00:00Z"); assert e is not None and e.resolution_breached
    @patch("workers.billing.sla._get_redis")
    def test_not_found(self, m): m.return_value = None; assert SlaTracker().record_first_response("X") is None
    @patch("workers.billing.sla._get_redis")
    def test_free_no_breach(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","free","T7","2026-06-15T10:00:00Z"); e = t.record_first_response("T7","2026-06-20T10:00:00Z"); assert e is not None and not e.response_breached
    @patch("workers.billing.sla._get_redis")
    def test_enterprise_l3(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","enterprise","T8","2026-06-15T10:00:00Z"); e = t.record_first_response("T8","2026-06-15T12:00:00Z"); assert e is not None and e.response_breached and e.escalation_level == EscalationLevel.L3_ENGINEERING

class TestEscalation:
    @patch("workers.billing.sla._get_redis")
    def test_l1(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","E1","2026-06-15T10:00:00Z"); e = t.record_first_response("E1","2026-06-15T15:00:00Z"); assert e is not None and e.escalation_level == EscalationLevel.L1_AUTO
    @patch("workers.billing.sla._get_redis")
    def test_l2(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","E2","2026-06-15T10:00:00Z"); e = t.record_first_response("E2","2026-06-15T20:00:00Z"); assert e is not None and e.escalation_level == EscalationLevel.L2_HUMAN
    @patch("workers.billing.sla._get_redis")
    def test_l3(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","E3","2026-06-15T10:00:00Z"); e = t.record_first_response("E3","2026-06-16T01:00:00Z"); assert e is not None and e.escalation_level == EscalationLevel.L3_ENGINEERING and e.incident_created
    @patch("workers.billing.sla._get_redis")
    def test_manual_l2(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","M1","2026-06-15T10:00:00Z"); e = t.escalate_ticket("M1","L2_HUMAN","req"); assert e is not None and e.escalation_level == EscalationLevel.L2_HUMAN
    @patch("workers.billing.sla._get_redis")
    def test_manual_l3(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","M2","2026-06-15T10:00:00Z"); e = t.escalate_ticket("M2","L3_ENGINEERING"); assert e is not None and e.incident_created
    @patch("workers.billing.sla._get_redis")
    def test_invalid_level(self, m): m.return_value = None; assert SlaTracker().escalate_ticket("X","BAD") is None
    @patch("workers.billing.sla._get_redis")
    def test_not_found(self, m): m.return_value = None; assert SlaTracker().escalate_ticket("X","L2_HUMAN") is None

class TestReporting:
    @patch("workers.billing.sla._get_redis")
    def test_ticket_status(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","R1","2026-06-15T10:00:00Z"); s = t.get_ticket_status("R1"); assert s is not None and s["ticket_id"] == "R1" and s["response_goal_hours"] == 4
    @patch("workers.billing.sla._get_redis")
    def test_status_not_found(self, m): m.return_value = None; assert SlaTracker().get_ticket_status("X") is None
    @patch("workers.billing.sla._get_redis")
    def test_tenant_status(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","S1","2026-06-15T10:00:00Z"); t.record_ticket_created("a","pro","S2","2026-06-16T10:00:00Z"); s = t.get_tenant_status("a"); assert s.total_tickets == 2
    @patch("workers.billing.sla._get_redis")
    def test_tenant_breaches(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","starter","B1","2026-06-15T10:00:00Z"); t.record_first_response("B1","2026-06-16T12:00:00Z"); t.record_ticket_created("a","starter","B2","2026-06-16T10:00:00Z"); t.record_first_response("B2","2026-06-16T14:00:00Z"); s = t.get_tenant_status("a"); assert s.response_breaches == 1
    @patch("workers.billing.sla._get_redis")
    def test_empty(self, m): m.return_value = None; s = SlaTracker().get_tenant_status("x"); assert s.total_tickets == 0
    @patch("workers.billing.sla._get_redis")
    def test_monthly(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","M1","2026-06-01T10:00:00Z"); t.record_first_response("M1","2026-06-01T12:00:00Z"); t.record_resolution("M1","2026-06-02T10:00:00Z"); t.record_ticket_created("a","pro","M2","2026-06-15T10:00:00Z"); t.record_first_response("M2","2026-06-15T16:00:00Z"); r = t.get_monthly_report("a",2026,6); assert r.total_tickets == 2 and r.response_breaches == 1
    @patch("workers.billing.sla._get_redis")
    def test_monthly_empty(self, m): m.return_value = None; r = SlaTracker().get_monthly_report("a",2026,7); assert r.total_tickets == 0
    @patch("workers.billing.sla._get_redis")
    def test_compliance(self, m): m.return_value = None; t = SlaTracker(); [t.record_ticket_created("a","starter",f"C{i}","2026-06-01T10:00:00Z") for i in range(4)]; t.record_first_response("C0","2026-06-02T12:00:00Z"); [t.record_first_response(f"C{i}","2026-06-01T12:00:00Z") for i in range(1,4)]; r = t.get_monthly_report("a",2026,6); assert r.compliance_rate_pct == 75.0
    @patch("workers.billing.sla._get_redis")
    def test_all_ids(self, m): m.return_value = None; t = SlaTracker(); t.record_ticket_created("a","pro","A1","2026-06-01T10:00:00Z"); t.record_ticket_created("b","free","B1","2026-06-01T10:00:00Z"); ids = t.get_all_tenant_ids(); assert "a" in ids and "b" in ids
    @patch("workers.billing.sla._get_redis")
    def test_all_ids_empty(self, m): m.return_value = None; assert SlaTracker().get_all_tenant_ids() == []

class TestData:
    def test_ticket_defaults(self): e=TicketSlaEntry("T","a","pro","now"); assert not e.response_breached
    def test_tenant_defaults(self): s=TenantSlaState("a","free"); assert s.total_tickets == 0
    def test_monthly_defaults(self): r=MonthlySlaRow("a","free",2026,6); assert r.compliance_rate_pct==100.0
    def test_levels(self): assert EscalationLevel.L1_AUTO.value=="L1_AUTO"; assert EscalationLevel.L3_ENGINEERING.value=="L3_ENGINEERING"

class TestPersistence:
    @patch("workers.billing.sla._get_redis")
    def test_redis_get(self, m):
        mc=MagicMock(); mc.get.return_value='{"ticket_id":"RD1","tenant_id":"a","tenant_tier":"pro","created_at":"2026-06-15T10:00:00Z","first_response_at":null,"resolved_at":null,"response_time_seconds":null,"resolution_time_seconds":null,"response_breached":false,"resolution_breached":false,"escalation_level":null,"escalation_triggered_at":null,"incident_created":false,"incident_id":null,"notes":[]}'
        m.return_value=mc; e=SlaTracker()._get_entry("RD1"); assert e is not None and e.tenant_tier=="pro"
    @patch("workers.billing.sla._get_redis")
    def test_redis_escalation(self, m):
        mc=MagicMock(); mc.get.return_value='{"ticket_id":"RD2","tenant_id":"a","tenant_tier":"enterprise","created_at":"2026-06-15T10:00:00Z","first_response_at":"2026-06-15T11:30:00Z","resolved_at":null,"response_time_seconds":5400.0,"resolution_time_seconds":null,"response_breached":true,"resolution_breached":false,"escalation_level":"L3_ENGINEERING","escalation_triggered_at":"2026-06-15T11:30:00Z","incident_created":true,"incident_id":"INC-123","notes":[]}'
        m.return_value=mc; e=SlaTracker()._get_entry("RD2"); assert e is not None and e.escalation_level==EscalationLevel.L3_ENGINEERING
    @patch("workers.billing.sla._get_redis")
    def test_memory(self, m): m.return_value=None; t=SlaTracker(); t.record_ticket_created("a","pro","M1","2026-06-15T10:00:00Z"); assert t._get_entry("M1") is not None
    @patch("workers.billing.sla._get_redis")
    def test_entries(self, m): m.return_value=None; t=SlaTracker(); t.record_ticket_created("a","pro","TA1","2026-06-15T10:00:00Z"); t.record_ticket_created("a","pro","TA2","2026-06-16T10:00:00Z"); t.record_ticket_created("b","free","TB1","2026-06-17T10:00:00Z"); assert len(t._get_entries_for_tenant("a"))==2; assert len(t._get_entries_for_tenant("b"))==1

class TestIntegration:
    @patch("workers.billing.sla._get_redis")
    def test_full(self, m): m.return_value=None; t=SlaTracker(); t.record_ticket_created("a","pro","F1","2026-06-01T08:00:00Z"); t.record_first_response("F1","2026-06-01T10:00:00Z"); t.record_resolution("F1","2026-06-02T06:00:00Z"); s=t.get_ticket_status("F1"); assert s is not None and not s["response_breached"]
    @patch("workers.billing.sla._get_redis")
    def test_breach(self, m): m.return_value=None; t=SlaTracker(); t.record_ticket_created("a","starter","F2","2026-06-01T08:00:00Z"); t.record_first_response("F2","2026-06-02T14:00:00Z"); s=t.get_ticket_status("F2"); assert s is not None and s["response_breached"]
    @patch("workers.billing.sla._get_redis")
    def test_independent(self, m): m.return_value=None; t=SlaTracker(); t.record_ticket_created("a","pro","I1","2026-06-01T08:00:00Z"); t.record_first_response("I1","2026-06-01T10:00:00Z"); t.record_ticket_created("b","starter","I2","2026-06-01T08:00:00Z"); t.record_first_response("I2","2026-06-02T14:00:00Z"); assert t.get_tenant_status("a").response_breaches==0; assert t.get_tenant_status("b").response_breaches==1
    @patch("workers.billing.sla._get_redis")
    def test_both(self, m): m.return_value=None; t=SlaTracker(); t.record_ticket_created("a","starter","D1","2026-06-01T08:00:00Z"); t.record_first_response("D1","2026-06-02T14:00:00Z"); t.record_resolution("D1","2026-06-04T16:00:00Z"); s=t.get_ticket_status("D1"); assert s is not None and s["response_breached"] and s["resolution_breached"]
