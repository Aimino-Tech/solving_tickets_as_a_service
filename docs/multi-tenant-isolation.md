# Multi-Tenant Isolation

**AIM-2017** — Per-tenant queues, workspaces, and concurrency limits.

## Problem

STAS previously used a shared BullMQ queue for all tenants. A single noisy
tenant could starve others by flooding the queue with fix requests. There
was no mechanism to isolate:

- **Queue depth** — one tenant's backlog could delay other tenants
- **Concurrency** — one tenant could consume all worker slots
- **Workspace files** — concurrent runs could share or collide on disk
- **Rate limits** — no per-tenant API rate limiting

## Solution

Each tenant gets isolated resources at every layer:

### 1. Per-Tenant Queues (`src/queue/tenant-queues.ts`)

Each tenant gets a dedicated BullMQ queue:

```
stas.tenant.{tenantId}
stas.tenant.{tenantId}.dlq   (dead-letter queue)
```

- Queue names are namespaced with a configurable prefix (`stas.tenant.`)
- Each queue has per-queue prefetch (concurrency) control (default: 1)
- Dead-letter exchange is configured per queue for failed messages
- RabbitMQ binding: each tenant queue binds to `stas.agents` exchange
  with routing key `tenant.{tenantId}`

**API:**

| Function | Purpose |
|---|---|
| `ensureTenantQueue(tenantId)` | Create queue + DLQ, bind to exchange |
| `getTenantQueueName(tenantId)` | Get queue name string |
| `getTenantDLQName(tenantId)` | Get DLQ name string |
| `getTenantQueue(tenantId)` | Get BullMQ Queue instance |
| `removeTenantQueue(tenantId)` | Drain + obliterate queue |
| `getActiveTenants()` | List all active tenant IDs |
| `closeAllTenantQueues()` | Graceful shutdown |

### 2. Per-Tenant Workspace Isolation (`src/sandbox/workspace-isolation.ts`)

Each fix run gets a dedicated workspace directory:

```
{workspaceRoot}/{tenantId}/{issueKey}/
```

Default workspace root: `/workspaces` (configurable via `WORKSPACES_ROOT`)

- Paths are sanitized to prevent directory traversal
- Directories are created with `0700` permissions
- Workspace is removed after the fix completes
- Parent tenant directory is also removed if empty

**API:**

| Function | Purpose |
|---|---|
| `getWorkspaceRoot(tenantId, issueKey)` | Get workspace path |
| `ensureWorkspaceDir(tenantId, issueKey)` | Create workspace directory |
| `cleanupWorkspace(tenantId, issueKey)` | Remove workspace |
| `workspaceExists(tenantId, issueKey)` | Check if workspace exists |

### 3. Per-Tenant Concurrency Controller (`src/ratelimit/tenant-concurrency.ts`)

Redis-backed active agent count per tenant using atomic INCR/DECR with TTL.

**Concurrency limits by tier:**

| Tier | Max Concurrent |
|---|---|
| Free | 1 |
| Pro | 3 |
| Enterprise | 10 |

- TTL (10 minutes) auto-releases slots if an agent crashes
- Fail-closed on Redis errors (blocks request to be safe)

**API:**

| Method | Purpose |
|---|---|
| `acquire(tenantId, maxConcurrent)` | Atomically increment if under limit |
| `release(tenantId)` | Decrement count |
| `getActiveCount(tenantId)` | Current active agents |
| `resetCount(tenantId)` | Reset to 0 (admin recovery) |
| `close()` | Graceful shutdown |

### 4. Per-Tenant Rate Limiting (`src/ratelimit/tiers.ts` — enhanced)

Token bucket rate limiter per tenant using Redis sorted sets (sliding window).

**Rate limits by tier:**

| Tier | Requests/Minute |
|---|---|
| Free | 10 |
| Pro | 60 |
| Enterprise | 300 |

**API:**

| Function | Purpose |
|---|---|
| `checkTenantRateLimit(tenantId)` | Check + record request |
| `getTenantRateLimitForTier(tier)` | Get limit for a tier |

### 5. KEDA ScaledObject (`k8s/keda/scaledobject-tenant.yaml`)

Kubernetes ScaledObject that scales workers based on per-tenant queue length:

- Monitors RabbitMQ `stas.tenant.*` queues
- Configurable min/max replicas per tenant
- Cooldown period: 120s to avoid thundering-herd
- Polling interval: 15s
- Supports per-tenant ScaledObject templates

### 6. Configuration (`src/config.ts`)

New environment variables:

| Variable | Default | Description |
|---|---|---|
| `QUEUE_PER_TENANT_PREFIX` | `stas.tenant.` | Queue name prefix |
| `QUEUE_PER_TENANT_PREFETCH` | `1` | Prefetch count per queue |
| `TENANT_MAX_CONCURRENT_FREE` | `1` | Max concurrent agents (free) |
| `TENANT_MAX_CONCURRENT_PRO` | `3` | Max concurrent agents (pro) |
| `TENANT_MAX_CONCURRENT_ENTERPRISE` | `10` | Max concurrent agents (enterprise) |
| `WORKSPACES_ROOT` | `/workspaces` | Workspace root directory |
| `TENANT_RATE_LIMIT_FREE_PER_MIN` | `10` | Rate limit (free) |
| `TENANT_RATE_LIMIT_PRO_PER_MIN` | `60` | Rate limit (pro) |
| `TENANT_RATE_LIMIT_ENTERPRISE_PER_MIN` | `300` | Rate limit (enterprise) |

## Integration with Agent Dispatch

The agent dispatch flow now includes:

1. **Before dispatch**: Check tenant concurrency limit via `TenantConcurrencyManager.acquire()`
2. **Queue routing**: Route the task to the tenant-specific BullMQ queue via `ensureTenantQueue()`
3. **Execution**: Pass the isolated workspace root to the agent via `ensureWorkspaceDir()`
4. **Cleanup**: Release the concurrency slot and remove the workspace

### Example flow:

```typescript
import { tenantConcurrencyManager } from '../ratelimit/tenant-concurrency.js';
import { ensureTenantQueue } from '../queue/tenant-queues.js';
import { ensureWorkspaceDir, cleanupWorkspace } from '../sandbox/workspace-isolation.js';

async function dispatchToTenant(tenantId: string, issueKey: string, tier: string) {
  // 1. Check concurrency
  const maxConcurrent = getMaxConcurrentForTier(tier as TenantTier);
  const acquired = await tenantConcurrencyManager.acquire(tenantId, maxConcurrent);
  if (!acquired) {
    throw new Error('Tenant concurrency limit reached');
  }

  try {
    // 2. Ensure queue exists
    const queue = await ensureTenantQueue(tenantId);

    // 3. Create isolated workspace
    const workspaceRoot = await ensureWorkspaceDir(tenantId, issueKey);

    // 4. Enqueue to tenant-specific queue (with workspace root in job data)
    await queue.add('process-issue', {
      tenantId,
      workspaceRoot,
      // ... job data
    });
  } finally {
    // 5. Cleanup
    await cleanupWorkspace(tenantId, issueKey);
    await tenantConcurrencyManager.release(tenantId);
  }
}
```

## Testing

Run the tests:

```bash
npm test -- src/__tests__/queue/tenant-queues.test.ts
```

Tests cover:
- Queue names are correctly namespaced per tenant
- Two tenants can dispatch concurrently
- Concurrency limit blocks excess tasks
- Workspace paths are fully isolated
- DLQ creation alongside main queue
- Idempotent queue creation
- Graceful removal and cleanup

## Rollout

1. Deploy the code changes
2. Set the new environment variables if non-default values are needed
3. Apply the KEDA ScaledObject:
   ```bash
   kubectl apply -f k8s/keda/scaledobject-tenant.yaml
   ```
4. Verify per-tenant queues appear in RabbitMQ management UI
5. Monitor tenant concurrency metrics in Redis

## Future Improvements

- Dynamic tier changes without restart (Redis-backed tier config)
- Per-tenant priority scheduling within shared worker pools
- Tenant-level queue stats and monitoring dashboard
- Automatic tenant queue cleanup when a tenant is deactivated
- KEDA per-tenant ScaledObject controller (operator pattern)
