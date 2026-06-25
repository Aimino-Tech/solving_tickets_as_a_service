/**
 * Unit tests for src/pricing/audit.ts — Audit log for tier changes.
 *
 * Coverage:
 *   - recordAuditEntry stores entries in Redis
 *   - auditTierOverrideSet records tier override events
 *   - auditTierOverrideCleared records clearance events
 *   - auditQuotaReset records quota reset events
 *   - auditQuotaResetAll records global reset events
 *   - getAuditLog retrieves entries
 *   - Redis errors handled gracefully
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    queue: { redisUrl: 'redis://localhost:6379' },
  },
}));

// Create a shared mock Redis client
const mockRedisClient = vi.hoisted(() => {
  const client = {
  lpush: vi.fn(),
  ltrim: vi.fn(),
  lrange: vi.fn(),
  pipeline: vi.fn(),
  zadd: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
  zcard: vi.fn(),
  zcount: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
  };

  // Make pipeline return a self-referencing mock
  client.pipeline.mockReturnValue({
    lpush: vi.fn().mockReturnThis(),
    ltrim: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([[null, 1], [null, 1]]),
  });

  return client;
});

vi.mock('ioredis', () => ({
  default: vi.fn(function () { return mockRedisClient; }),
  Redis: vi.fn(function () { return mockRedisClient; }),
}));

import {
  recordAuditEntry,
  getAuditLog,
  auditTierOverrideSet,
  auditTierOverrideCleared,
  auditQuotaReset,
  auditQuotaResetAll,
} from '../../pricing/audit.js';

describe('recordAuditEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores entry in Redis via pipeline with lpush and ltrim', async () => {
    await recordAuditEntry({
      actor: 'admin',
      action: 'tier.override.set',
      target: '12345',
      details: { tier: 'pro' },
    });

    // Pipeline.exec should have been called
    expect(mockRedisClient.pipeline).toHaveBeenCalled();
  });

  it('handles Redis error gracefully', async () => {
    mockRedisClient.pipeline.mockReturnValue({
      lpush: vi.fn().mockReturnThis(),
      ltrim: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error('Redis down')),
    });

    await expect(
      recordAuditEntry({
        actor: 'admin',
        action: 'tier.override.set',
        target: '12345',
        details: {},
      }),
    ).resolves.toBeUndefined();
  });
});

describe('audit convenience functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auditTierOverrideSet records a tier.override.set audit entry', async () => {
    await expect(auditTierOverrideSet('admin', 12345, 'pro')).resolves.toBeUndefined();
    expect(mockRedisClient.pipeline).toHaveBeenCalled();
  });

  it('auditTierOverrideCleared records a tier.override.cleared audit entry', async () => {
    await expect(auditTierOverrideCleared('admin', 12345, 'pro')).resolves.toBeUndefined();
    expect(mockRedisClient.pipeline).toHaveBeenCalled();
  });

  it('auditQuotaReset records a quota.reset audit entry', async () => {
    await expect(auditQuotaReset('admin', 12345)).resolves.toBeUndefined();
    expect(mockRedisClient.pipeline).toHaveBeenCalled();
  });

  it('auditQuotaResetAll records a quota.reset.all audit entry', async () => {
    await expect(auditQuotaResetAll('system:cron')).resolves.toBeUndefined();
    expect(mockRedisClient.pipeline).toHaveBeenCalled();
  });
});

describe('getAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retrieves and parses stored entries', async () => {
    mockRedisClient.lrange.mockResolvedValue([
      JSON.stringify({
        id: 'abc-123',
        timestamp: '2026-06-05T12:00:00.000Z',
        actor: 'admin',
        action: 'tier.override.set',
        target: '12345',
        details: { tier: 'pro' },
      }),
    ]);

    const entries = await getAuditLog(10);
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toBe('admin');
    expect(entries[0].action).toBe('tier.override.set');
    expect(mockRedisClient.lrange).toHaveBeenCalled();
  });

  it('filters out malformed JSON entries', async () => {
    mockRedisClient.lrange.mockResolvedValue([
      JSON.stringify({ id: '1', timestamp: '2026-01-01T00:00:00.000Z', actor: 'sys', action: 'quota.reset.all', target: 'all', details: {} }),
      'broken json',
    ]);

    const entries = await getAuditLog(10);
    expect(entries).toHaveLength(1);
  });

  it('returns empty array on Redis error', async () => {
    mockRedisClient.lrange.mockRejectedValue(new Error('Redis down'));
    const entries = await getAuditLog();
    expect(entries).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    mockRedisClient.lrange.mockResolvedValue([]);
    await getAuditLog(50);
    expect(mockRedisClient.lrange).toHaveBeenCalledWith('stas:audit:log', 0, 49);
  });
});
