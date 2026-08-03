import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const mockRedis = {
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  status: 'close' as string | undefined,
};

vi.mock('ioredis', () => ({
  Redis: vi.fn(function () {
    return mockRedis;
  }),
}));

describe('DedupEngine', () => {
  let DedupEngine: typeof import('../../mitigations/dedup.js').DedupEngine;
  let dedup: import('../../mitigations/dedup.js').DedupEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../mitigations/dedup.js');
    DedupEngine = mod.DedupEngine;
    dedup = new DedupEngine('redis://localhost:6379');
  });

  it('checkDelivery returns true for first-time delivery', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const result = await dedup.checkDelivery('delivery-123');
    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'syntaro:dedup:delivery:delivery-123', '1', 'PX', 24 * 60 * 60 * 1000, 'NX',
    );
  });

  it('checkDelivery returns false for duplicate delivery', async () => {
    mockRedis.set.mockResolvedValue(null);
    const result = await dedup.checkDelivery('delivery-123');
    expect(result).toBe(false);
  });

  it('checkDelivery is fail-closed (returns true on Redis error)', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis down'));
    const result = await dedup.checkDelivery('delivery-123');
    expect(result).toBe(true);
  });

  it('checkIssue returns true for first-time issue', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const result = await dedup.checkIssue('owner', 'repo', 42);
    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'syntaro:dedup:issue:owner:repo:42', '1', 'PX', 30 * 60 * 1000, 'NX',
    );
  });

  it('checkIssue returns false for duplicate issue', async () => {
    mockRedis.set.mockResolvedValue(null);
    const result = await dedup.checkIssue('owner', 'repo', 42);
    expect(result).toBe(false);
  });

  it('checkIssue uses custom pipeline duration TTL', async () => {
    mockRedis.set.mockResolvedValue('OK');
    await dedup.checkIssue('owner', 'repo', 42, 60_000);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'syntaro:dedup:issue:owner:repo:42', '1', 'PX', 60_000, 'NX',
    );
  });

  it('checkIssue is fail-closed (returns true on Redis error)', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis down'));
    const result = await dedup.checkIssue('owner', 'repo', 42);
    expect(result).toBe(true);
  });

  it('releaseIssue deletes the issue dedup key', async () => {
    await dedup.releaseIssue('owner', 'repo', 42);
    expect(mockRedis.del).toHaveBeenCalledWith('syntaro:dedup:issue:owner:repo:42');
  });

  it('releaseIssue handles errors gracefully', async () => {
    mockRedis.del.mockRejectedValue(new Error('Redis down'));
    await expect(dedup.releaseIssue('owner', 'repo', 42)).resolves.toBeUndefined();
  });

  it('close quits Redis connection', async () => {
    await dedup.close();
    expect(mockRedis.quit).toHaveBeenCalled();
  });
});
