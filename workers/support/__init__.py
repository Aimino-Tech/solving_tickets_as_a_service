"""Support package — auto-answer, escalation, and Jira Service Management ticketing."""

from workers.support.auto_answer import auto_answer, AutoAnswerResult
from workers.support.escalation import (
    EscalationAction,
    EscalationTrigger,
    TenantDegradationLevel,
    TenantHealthMetric,
    TenantHealthSnapshot,
    acknowledge_escalation,
    check_tenant_health,
    escalate_tenant,
    run_escalation_checks,
    validate_config,
)
from workers.support.ticketing import (
    CommentResult,
    RequestTypeResult,
    TicketResult,
    add_comment,
    check_config,
    create_ticket,
    get_ticket,
    list_request_types,
)

__all__ = [
    "auto_answer",
    "AutoAnswerResult",
    "EscalationAction",
    "EscalationTrigger",
    "TenantDegradationLevel",
    "TenantHealthMetric",
    "TenantHealthSnapshot",
    "acknowledge_escalation",
    "check_tenant_health",
    "escalate_tenant",
    "run_escalation_checks",
    "validate_config",
    "create_ticket",
    "get_ticket",
    "add_comment",
    "list_request_types",
    "check_config",
    "TicketResult",
    "CommentResult",
    "RequestTypeResult",
]
