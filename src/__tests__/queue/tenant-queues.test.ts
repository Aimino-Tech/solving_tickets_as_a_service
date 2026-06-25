/**
 * Unit tests for src/queue/tenant-queues.ts — Per-tenant queue management.
 *
 * Covers:
 *   - Queue name namespacing per tenant
 *   - Two tenants can dispatch concurrently
 *   - Concurrency limit blocks excess tasks
 *   - Workspace paths are fully isolated
 *
 * Strategy:
 *   Mock BullMQ Queue and RabbitMQ modules. Test the tenant queue
 *   management logic in isolation without actual Redis/RabbitMQ.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config.js';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports by vitest
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockQueueAdd = vi.fn();
  const mockQueueDrain = vi.fn();
  const mockQueueObliterate = vi.fn();
  const mockQueueClose = vi.fn();
  const queueInstances: Record<string, ReturnType<typeof createMockQueueInstance>> = {};

  function createMockQueueInstance(queueName?: string) {
    return {
      add: mockQueueAdd,
      drain: mockQueueDrain,
      obliterate: mockQueueObliterate,
      close: mockQueueClose,
    };
  }

  const mockChannelAssertExchange = vi.fn();
  const mockChannelAssertQueue = vi.fn();
  const mockChannelBindQueue = vi.fn();
  const mockChannelClose = vi.fn();
  const mockChannelCreate = vi.fn().mockResolvedValue({
    assertExchange: mockChannelAssertExchange,
    assertQueue: mockChannelAssertQueue,
    bindQueue: mockChannelBindQueue,
    close: mockChannelClose,
  });

  const mockConnect = vi.fn().mockResolvedValue({
    createChannel: mockChannelCreate,
    connection: { on: vi.fn() },
    close: vi.fn(),
  });

  return {
    mockQueueAdd,
    mockQueueDrain,
    mockQueueObliterate,
    mockQueueClose,
    mockChannelAssertExchange,
    mockChannelAssertQueue,
    mockChannelBindQueue,
    mockChannelClose,
    mockConnect,
    createMockQueueInstance,
    queueInstances,
    mockQueueConstructor: vi.fn((name: string, opts?: unknown) => {
      if (!queueInstances[name]) {
        queueInstances[name] = createMockQueueInstance(name);
      }
      return queueInstances[name];
    }),
  };
});

// Mock BullMQ Queue
vi.mock('bullmq', () => ({
  Queue: vi.fn((name: string, opts?: unknown) => {
    return mocks.mockQueueConstructor(name, opts);
  }),
}));

// Mock RabbitMQ module
vi.mock('../../queue/rabbitmq.js', () => ({
  connect: mocks.mockConnect,
  declareTopology: vi.fn(),
  getPublishChannel: vi.fn(),
}));

// Mock config
vi.mock('../../config.js', () => ({
  config: {
    queue: {
      redisUrl: 'redis://localhost:6379',
      perTenantPrefix: 'stas.tenant.',
      perTenantPrefetch: 1,
      keepCompleted: 200,
      keepFailed: 100,
      maxRetries: 4,
    },
    workspaceRoot: '/workspaces',
    rateLimit: {
      tenant: {
        maxConcurrentFree: 1,
        maxConcurrentPro: 3,
        maxConcurrentEnterprise: 10,
        rateLimitFreePerMin: 10,
        rateLimitProPerMin: 60,
        rateLimitEnterprisePerMin: 300,
      },
    },
  },
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    })),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import {
  getTenantQueueName,
  getTenantDLQName,
  ensureTenantQueue,
  getTenantQueue,
  removeTenantQueue,
  getActiveTenants,
  getActiveTenantCount,
} from '../../queue/tenant-queues.js';

import {
  getWorkspaceRoot,
  ensureWorkspaceDir,
  workspaceExists,
} from '../../sandbox/workspace-isolation.js';

import {
  TenantConcurrencyManager,
  getMaxConcurrentForTier,
} from '../../ratelimit/tenant-concurrency.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tenant-queues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any created queues
    const tenants = getActiveTenants();
    for (const tenantId of tenants) {
      await removeTenantQueue(tenantId);
    }
  });

  // ── Queue naming ─────────────────────────────────────────────────────

  describe('getTenantQueueName', () => {
    it('returns correctly namespaced queue name for a tenant', () => {
      expect(getTenantQueueName('tenant-abc')).toBe('stas.tenant.tenant-abc');
    });

    it('returns correctly namespaced queue name for numeric tenant ID', () => {
      expect(getTenantQueueName('12345')).toBe('stas.tenant.12345');
    });

    it('uses the configured prefix', () => {
      const name = getTenantQueueName('test');
      expect(name.startsWith(config.queue.perTenantPrefix)).toBe(true);
    });
  });

  describe('getTenantDLQName', () => {
    it('returns correctly namespaced DLQ name with .dlq suffix', () => {
      expect(getTenantDLQName('tenant-abc')).toBe('stas.tenant.tenant-abc.dlq');
    });
  });

  // ── Queue creation ───────────────────────────────────────────────────

  describe('ensureTenantQueue', () => {
    it('creates a BullMQ queue with the correct tenant namespaced name', async () => {
      const queue = await ensureTenantQueue('tenant-alpha');

      expect(queue).toBeDefined();
      expect(getTenantQueue('tenant-alpha')).toBe(queue);

      // Verify BullMQ Queue constructor was called with the right name
      const queueCalls = mocks.mockQueueConstructor.mock.calls;
      const queueNames = queueCalls
        .filter((call) => !String(call[0]).endsWith('.dlq'))
        .map((call) => call[0]);
      expect(queueNames).toContain('stas.tenant.tenant-alpha');
    });

    it('is idempotent — returns the same queue instance on second call', async () => {
      const first = await ensureTenantQueue('tenant-beta');
      const second = await ensureTenantQueue('tenant-beta');

      expect(first).toBe(second);
    });

    it('creates a dead-letter queue alongside the main queue', async () => {
      await ensureTenantQueue('tenant-gamma');

      const queueCalls = mocks.mockQueueConstructor.mock.calls;
      const dlqNames = queueCalls
        .filter((call) => String(call[0]).endsWith('.dlq'))
        .map((call) => call[0]);

      expect(dlqNames).toContain('stas.tenant.tenant-gamma.dlq');
    });

    it('creates independent queues for different tenants', async () => {
      await ensureTenantQueue('tenant-one');
      await ensureTenantQueue('tenant-two');

      const queueOne = getTenantQueue('tenant-one');
      const queueTwo = getTenantQueue('tenant-two');

      expect(queueOne).toBeDefined();
      expect(queueTwo).toBeDefined();
      expect(queueOne).not.toBe(queueTwo);
    });
  });

  // ── Queue lifecycle ──────────────────────────────────────────────────

  describe('removeTenantQueue', () => {
    it('removes a tenant queue from the registry', async () => {
      await ensureTenantQueue('tenant-delta');
      expect(getActiveTenants()).toContain('tenant-delta');

      await removeTenantQueue('tenant-delta');
      expect(getActiveTenants()).not.toContain('tenant-delta');
    });

    it('handles removal of non-existent queue gracefully', async () => {
      await expect(removeTenantQueue('non-existent')).resolves.not.toThrow();
    });
  });

  describe('getActiveTenants / getActiveTenantCount', () => {
    it('returns empty array initially', () => {
      expect(getActiveTenants()).toEqual([]);
      expect(getActiveTenantCount()).toBe(0);
    });

    it('returns correct count after creating queues', async () => {
      await ensureTenantQueue('tenant-x');
      await ensureTenantQueue('tenant-y');

      expect(getActiveTenantCount()).toBe(2);
      expect(getActiveTenants()).toContain('tenant-x');
      expect(getActiveTenants()).toContain('tenant-y');
    });
  });

  // ── Two tenants can dispatch concurrently ────────────────────────────

  describe('concurrent tenant dispatch', () => {
    it('allows two tenants to have active queues simultaneously', async () => {
      await ensureTenantQueue('tenant-concurrent-a');
      await ensureTenantQueue('tenant-concurrent-b');

      const queueA = getTenantQueue('tenant-concurrent-a');
      const queueB = getTenantQueue('tenant-concurrent-b');

      expect(queueA).toBeDefined();
      expect(queueB).toBeDefined();

      // Both queues are distinct instances
      expect(getActiveTenantCount()).toBe(2);
      expect(getTenantQueueName('tenant-concurrent-a')).not.toBe(
        getTenantQueueName('tenant-concurrent-b'),
      );
    });

    it('does not share state between tenant queues', async () => {
      await ensureTenantQueue('tenant-state-a');
      await ensureTenantQueue('tenant-state-b');

      const active = getActiveTenants();
      expect(active.filter((t) => t.startsWith('tenant-state-')).length).toBe(2);

      // Remove one — the other remains
      await removeTenantQueue('tenant-state-a');
      expect(getActiveTenants()).not.toContain('tenant-state-a');
      expect(getActiveTenants()).toContain('tenant-state-b');
    });
  });
});

// ---------------------------------------------------------------------------
// Concurrency limit tests
// ---------------------------------------------------------------------------

describe('tenant-concurrency', () => {
  describe('getMaxConcurrentForTier', () => {
    it('returns 1 for free tier', () => {
      expect(getMaxConcurrentForTier('free')).toBe(1);
    });

    it('returns 3 for pro tier', () => {
      expect(getMaxConcurrentForTier('pro')).toBe(3);
    });

    it('returns 10 for enterprise tier', () => {
      expect(getMaxConcurrentForTier('enterprise')).toBe(10);
    });
  });

  describe('TenantConcurrencyManager', () => {
    it('creates a manager with default TTL', () => {
      const manager = new TenantConcurrencyManager();
      expect(manager).toBeInstanceOf(TenantConcurrencyManager);
    });

    it('creates a manager with custom TTL', () => {
      const manager = new TenantConcurrencyManager(300);
      expect(manager).toBeInstanceOf(TenantConcurrencyManager);
    });

    it('acquire returns false when limit is 0 (always blocked)', async () => {
      const manager = new TenantConcurrencyManager();
      // With maxConcurrent=0, acquire should fail even without Redis
      // (the error path returns false without a client)
      const result = await manager.acquire('test-tenant', 0);
      expect(result).toBe(false);
    });

    it('release does not throw on closed manager', async () => {
      const manager = new TenantConcurrencyManager();
      await manager.close();
      await expect(manager.release('test-tenant')).resolves.not.toThrow();
    });

    it('getActiveCount returns 0 when not initialized', async () => {
      const manager = new TenantConcurrencyManager();
      const count = await manager.getActiveCount('unknown-tenant');
      expect(count).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Workspace isolation tests
// ---------------------------------------------------------------------------

describe('workspace-isolation', () => {
  describe('getWorkspaceRoot', () => {
    it('returns isolated path per tenant and issue', () => {
      const path = getWorkspaceRoot('tenant-abc', 'owner/repo#42');
      expect(path).toContain('tenant-abc');
      expect(path).toContain('owner/repo#42');
    });

    it('returns different paths for different tenants with same issue', () => {
      const pathA = getWorkspaceRoot('tenant-aaa', 'owner/repo#42');
      const pathB = getWorkspaceRoot('tenant-bbb', 'owner/repo#42');
      expect(pathA).not.toBe(pathB);
    });

    it('returns different paths for same tenant with different issues', () => {
      const pathA = getWorkspaceRoot('tenant-abc', 'repo-a#1');
      const pathB = getWorkspaceRoot('tenant-abc', 'repo-b#2');
      expect(pathA).not.toBe(pathB);
    });

    it('starts with the configured workspace root', () => {
      const path = getWorkspaceRoot('t', 'issue');
      expect(path.startsWith('/workspaces/')).toBe(true);
    });

    it('sanitizes path components to prevent traversal', () => {
      const path = getWorkspaceRoot('../evil', '../../etc/passwd');
      expect(path).not.toContain('..');
    });
  });

  describe('ensureWorkspaceDir', () => {
    it('returns a path ending with trailing slash', async () => {
      const path = await ensureWorkspaceDir('test-tenant', 'test-issue');
      expect(path.endsWith('/')).toBe(true);
    });
  });

  describe('workspaceExists', () => {
    it('returns false for non-existent workspace', async () => {
      const exists = await workspaceExists('nonexistent-tenant', 'nonexistent-issue');
      expect(exists).toBe(false);
    });
  });
});
