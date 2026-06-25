"""
STAS Billing & Multi-Tenant Isolation (AIM-2017).

Per-tenant resource isolation:
    - Per-tenant RabbitMQ queues with ``tenant_{id}`` binding key
    - Per-tenant max_concurrent_agents ceiling
    - Per-tenant workspace root isolation: ``/workspaces/{tenant_id}/{issue_key}/``
    - Redis per-tenant rate limit counters

Modules
-------
    tenant_isolation
        TenantIsolationManager — queue, concurrency, workspace root, and rate
        limit management for multi-tenant isolation.
"""

from workers.billing.tenant_isolation import (
    TenantIsolationManager,
    get_tenant_manager,
)

__all__ = [
    "TenantIsolationManager",
    "get_tenant_manager",
]
