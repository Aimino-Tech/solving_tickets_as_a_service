"""
SYNTARO Billing & Multi-Tenant Isolation (AIM-2017, AIM-2018).

Per-tenant resource isolation:
    - Per-tenant RabbitMQ queues with ``tenant_{id}`` binding key
    - Per-tenant max_concurrent_agents ceiling
    - Per-tenant workspace root isolation: ``/workspaces/{tenant_id}/{issue_key}/``
    - Redis per-tenant rate limit counters

Onboarding automation:
    - OnboardingStateMachine — per-tenant onboarding state machine.
    - onboarding_middleware — Celery signal gating for incomplete onboarding.

Free tier & PQL conversion (AIM-2077):
    - Tier definitions: free=10/mo, solo=50/mo, team=unlimited, enterprise=unlimited
    - PQL scoring with nudge at fix #8, upgrade wall at fix #10
    - 14-day inactivity detection and re-engagement alerts
    - Celery pre-dispatch middleware for tier enforcement

Modules
-------
    tenant_isolation
        TenantIsolationManager — queue, concurrency, workspace root, and rate
        limit management for multi-tenant isolation.
    onboarding
        OnboardingStateMachine — per-tenant onboarding state machine.
    onboarding_middleware
        connect_onboarding_middleware — Celery signal hook that gates task
        dispatch until onboarding is complete.
    tiers
        Tier definitions, usage counter, and PQL scoring.
    pql
        PQL conversion nudges, upgrade wall, and inactivity alerts.
    middleware
        Celery pre-dispatch gate for plan limits.
    enterprise
        Enterprise tier management — pricing, Stripe product, feature flags,
        compliance artifacts, and SCIM provisioning.
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
from workers.billing.tiers import (
    TIER_DEFINITIONS,
    PqlScore,
    compute_pql_score,
    get_pql_score,
    get_tier_usage,
    increment_tier_usage,
    increment_tier_verified,
    is_inactive,
    resolve_tier,
    tier_display_name,
    tier_max_fixes,
)
from workers.billing.pql import (
    InactivityResult,
    NudgeResult,
    WallResult,
    check_inactivity,
    check_nudge,
    check_wall,
)
from workers.billing.middleware import (
    TierLimitExceeded,
    connect_tier_middleware,
    check_and_block,
)
from workers.billing.enterprise import (
    EnterprisePlan,
    EnterpriseFeature,
    EnterpriseFeatureFlag,
    EnterpriseProvisioningResult,
    ComplianceArtifact,
    get_enterprise_plan,
    get_enterprise_feature_flags,
    is_enterprise_feature_enabled,
    get_compliance_artifacts,
    create_enterprise_stripe_product,
    is_enterprise_tier,
    get_enterprise_tenant_ids,
    get_enterprise_queue_config,
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
    "TIER_DEFINITIONS",
    "PqlScore",
    "compute_pql_score",
    "get_pql_score",
    "get_tier_usage",
    "increment_tier_usage",
    "increment_tier_verified",
    "is_inactive",
    "resolve_tier",
    "tier_display_name",
    "tier_max_fixes",
    "InactivityResult",
    "NudgeResult",
    "WallResult",
    "check_inactivity",
    "check_nudge",
    "check_wall",
    "TierLimitExceeded",
    "connect_tier_middleware",
    "check_and_block",
    "EnterprisePlan",
    "EnterpriseFeature",
    "EnterpriseFeatureFlag",
    "EnterpriseProvisioningResult",
    "ComplianceArtifact",
    "get_enterprise_plan",
    "get_enterprise_feature_flags",
    "is_enterprise_feature_enabled",
    "get_compliance_artifacts",
    "create_enterprise_stripe_product",
    "is_enterprise_tier",
    "get_enterprise_tenant_ids",
    "get_enterprise_queue_config",
]
