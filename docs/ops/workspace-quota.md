# OSS Workspace Quota & Isolation

> **Disk quota enforcement, workspace isolation per tenant, and LRU-based
> cleanup for the OSS self-hosted tier.**

## Overview

SYNTARO enforces disk quotas and workspace isolation at the OSS (self-hosted)
tier to prevent any single tenant from consuming all available disk space.
The system provides three mechanisms:

1. **Disk quota per workspace** — Each workspace is limited to a configurable
   maximum size (default: 256 MB). Workspaces that exceed this limit are
   flagged and can trigger cleanup.
2. **Workspace isolation per tenant** — Every tenant's workspaces live in an
   isolated subdirectory: `/workspaces/{tenant_id}/{issue_key}/`. Path
   traversal attacks are detected and blocked.
3. **LRU cleanup** — When a tenant exceeds their tier's total disk quota or
   workspace count, the least-recently-used workspaces are automatically
   evicted.

### Architecture

```
                     +--------------------------+
                     |   Celery Worker           |
                     |   (oss_quota_middleware)  |
                     +-------+---------+--------+
                             |         |
                    +--------v-+   +---v----------+
                    |  Redis   |   |  Filesystem  |
                    |  (quota  |   |  (/workspaces)|
                    |  tracking|   |              |
                    |  + LRU)  |   |              |
                    +----------+   +--------------+
                             |         |
                    +--------v---------v--------+
                    |  OssDiskQuota             |
                    |  - check_quota()          |
                    |  - get_tenant_remaining() |
                    +--------+-----------------+
                             |
                    +--------v-----------------+
                    |  OssLruCleanup            |
                    |  - evict_lru()            |
                    |  - periodic_cleanup()     |
                    +--------+-----------------+
                             |
                    +--------v-----------------+
                    |  WorkspaceIsolation       |
                    |  - ensure_isolation()     |
                    |  - list_tenant_workspaces()|
                    +--------------------------+
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WORKSPACE_ROOT` | `/workspaces` | Root directory for all workspaces |
| `OSS_QUOTA_FREE_BYTES` | `536870912` (512 MB) | Total disk quota for free-tier tenants |
| `OSS_QUOTA_PRO_BYTES` | `2147483648` (2 GB) | Total disk quota for pro-tier tenants |
| `OSS_QUOTA_ENTERPRISE_BYTES` | `-1` (unlimited) | Total disk quota for enterprise-tier tenants (set positive value to cap) |
| `OSS_QUOTA_UNLIMITED_BYTES` | `-1` | Value representing unlimited quota |
| `OSS_QUOTA_PER_WORKSPACE_BYTES` | `268435456` (256 MB) | Max size of a single workspace |
| `OSS_LRU_CLEANUP_INTERVAL_S` | `300` (5 min) | Minimum interval between periodic LRU cleanup runs |
| `OSS_LRU_MAX_WORKSPACES_FREE` | `5` | Max workspaces per free tenant (triggers LRU) |
| `OSS_LRU_MAX_WORKSPACES_PRO` | `20` | Max workspaces per pro tenant |
| `OSS_LRU_MAX_WORKSPACES_ENTERPRISE` | `100` | Max workspaces per enterprise tenant |

### Per-Tenant Tier Override

Tenant tiers can be set via environment variables following the same pattern
as the existing tenant isolation system:

```bash
# Set tenant "acme-corp" to pro tier
TENANT_ACME_CORP_TIER=pro
```

## How It Works

### Disk Quota Enforcement

1. When a workspace creation task is about to execute, the
   `oss_quota_middleware` intercepts it via a Celery `task_prerun` signal.
2. It extracts the `tenant_id` and `tier` from the task kwargs.
3. It calls `OssDiskQuota.check_quota(tenant_id, tier)` which checks Redis
   for the tenant's current cumulative disk usage.
4. If the tenant would exceed their quota, the task is rejected with
   `Ignore()` (same pattern as the emergency stop and onboarding middleware).
5. An LRU eviction is attempted immediately to free space, but the current
   task is still rejected — subsequent retries may succeed.
6. Results are cached in-memory (up to 10,000 entries) to reduce Redis
   round-trips for repeated checks.

### Workspace Isolation

All workspaces are created under an isolated, tenant-specific subdirectory:

```
/workspaces/
  ├── acme_corp/           # Tenant root (sanitized tenant_id)
  │   ├── AIM_42/          # Workspace for issue AIM-42
  │   │   ├── .git/
  │   │   └── ...
  │   └── AIM_55/
  ├── my_tenant/
  │   └── gh_123/
  └── ...
```

The `WorkspaceIsolation.ensure_isolation()` method verifies that a given
workspace path is within the tenant's allowed subtree, preventing path
traversal attacks where a malicious issue key like `../../etc` could
escape the sandbox.

### LRU Cleanup

The LRU cleanup system maintains a Redis sorted set per tenant, where each
workspace path is scored by its last access timestamp (Unix epoch).

Eviction triggers:
- **On quota check failure** — When a workspace creation is blocked, the
  middleware immediately attempts LRU eviction to free space.
- **Periodic** — The `periodic_cleanup()` method (designed to be called from
  a Celery beat task) scans all tenants with tracked usage and evicts
  excess workspaces.
- **Manual** — Direct calls to `evict_lru(tenant_id)` or
  `evict_all_for_tenant(tenant_id)` (e.g. for tenant deprovisioning).

## Celery Middleware

The quota middleware (`oss_quota_middleware.py`) connects automatically when
imported — the `@signals.task_prerun.connect` decorator registers the
handler. To activate it at worker startup, import and call the connection
acknowledgment:

```python
# In workers/celery_app.py or worker startup
from workers.orchestrator.oss_quota_middleware import connect_oss_quota_middleware
connect_oss_quota_middleware()
```

The middleware targets the `workers.orchestrator.workspace.create_workspace`
task. All housekeeping and health-check tasks are exempt.

## Graceful Degradation

If Redis is unavailable, all quota checks return `True` (allow), and usage
tracking is skipped. This ensures the system continues to function without
Redis — quotas are a best-effort enforcement mechanism, not a hard gate.

## Monitoring

### Log Messages

| Log Level | Pattern | Meaning |
|---|---|---|
| `WARNING` | `OSS quota blocked workspace creation` | A workspace creation was rejected due to quota |
| `INFO` | `LRU evicted workspace` | A workspace was cleaned up by LRU eviction |
| `INFO` | `LRU eviction complete` | Summary of an eviction run |
| `WARNING` | `Per-workspace quota exceeded` | A single workspace grew beyond the limit |
| `ERROR` | `Workspace isolation violation` | Path traversal attempt detected |
| `DEBUG` | `Recorded usage` | New disk usage tracked in Redis |

### Metrics (future)

| Metric | Type | Description |
|---|---|---|
| `oss_quota_blocked_total` | Counter | Total workspace creations blocked by quota |
| `oss_lru_evicted_total` | Counter | Total workspaces evicted by LRU |
| `oss_quota_remaining_bytes` | Gauge | Remaining quota bytes per tenant/tier |
| `oss_workspace_count` | Gauge | Active workspace count per tenant |

## Related Documents

- [KEDA Auto-Scaling](keda-autoscaling.md) — Worker pod autoscaling
- [Runaway Protection](runaway-protection.md) — Agent runaway task limits
- [Architecture Overview](../ARCHITECTURE.md) — System architecture
- [Self-Hosting Guide](../SELF_HOSTING.md) — OSS deployment instructions
