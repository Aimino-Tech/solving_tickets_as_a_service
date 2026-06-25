"""
STAS Billing & Multi-Tenant Isolation (AIM-2017, AIM-2018).

Per-tenant resource isolation:
    - Per-tenant RabbitMQ queues with ``tenant_{id}`` binding key
    - Per-tenant max_concurrent_agents ceiling
    - Per-tenant workspace root isolation: ``/workspaces/{tenant_id}/{issue_key}/``
    - Redis per-tenant rate limit counters

Onboarding automation:
    - OnboardingStateMachine -- per-tenant onboarding state machine.
    - onboarding_middleware -- Celery signal gating for incomplete onboarding.

Modules
-------
    tenant_isolation
        TenantIsolationManager -- queue, concurrency, workspace root, and rate
        limit management for multi-tenant isolation.
    onboarding
        OnboardingStateMachine -- per-tenant onboarding state machine.
    onboarding_middleware
        connect_onboarding_middleware -- Celery signal hook that gates task
        dispatch until onboarding is complete.
"""

from workers.billing.tenant_isolation import (
    TenantIsolationManager,
    get_tenant_manager,
)
from workers.billing.onboarding import (
    OnboardingState,
    OnboardingStateMachine,
    get_onboarding_machine,
)
from workers.billing.onboarding_middleware import (
    OnboardingIncomplete,
    connect_onboarding_middleware,
)
from workers.billing.sla import (
    SlaTracker,
    get_sla_tracker,
    EscalationLevel,
    SLA_GOALS,
)

__all__ = [
    "TenantIsolationManager",
    "get_tenant_manager",
    "OnboardingState",
    "OnboardingStateMachine",
    "get_onboarding_machine",
    "OnboardingIncomplete",
    "connect_onboarding_middleware",
    "SlaTracker",
    "get_sla_tracker",
    "EscalationLevel",
    "SLA_GOALS",
]
