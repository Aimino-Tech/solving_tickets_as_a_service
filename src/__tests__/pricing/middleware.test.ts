/**
 * Unit tests for src/pricing/middleware.ts — Quota enforcement middleware.
 *
 * Coverage:
 *   - quotaMiddleware allows requests within quota
 *   - quotaMiddleware rejects over-quota requests with 402
 *   - quotaMiddleware sets correct X-RateLimit-* headers
 *   - Bypass option works
 *   - No account ID falls through
 *   - Redis errors fall open
 *   - Enterprise tier not rate-limited
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock("../../config.js", () => ({
  config: {
    queue: { redisUrl: "redis://localhost:6379" },
    stas: { monthlyQuotaEnabled: true, defaultTier: "free", rateLimitWindowMs: 60000, rateLimitMax: 30 },
  },
}));

import type { Request, Response, NextFunction } from 'express';

// Mock dependencies
vi.mock('../../ratelimit/tiers.js', () => ({
  getTierForAccount: vi.fn(),
}));

vi.mock('../../pricing/tiers.js', () => ({
  getFeatureGate: vi.fn(),
}));

vi.mock('../../pricing/quota.js', () => ({
  getMonthlyUsage: vi.fn(),
}));

import { quotaMiddleware, defaultGetAccountId } from '../../pricing/middleware.js';
import { getTierForAccount } from '../../ratelimit/tiers.js';
import { getFeatureGate } from '../../pricing/tiers.js';
import { getMonthlyUsage } from '../../pricing/quota.js';

// Helper to create mock Express objects
function mockReq(overrides: Record<string, any> = {}): Partial<Request> {
  return {
    body: {},
    path: '/webhook',
    ...overrides,
  };
}

function mockRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

describe('defaultGetAccountId', () => {
  it('extracts installation id from body.installation.id', () => {
    const req = mockReq({ body: { installation: { id: 555 } } }) as Request;
    expect(defaultGetAccountId(req)).toBe(555);
  });

  it('falls back to body.installationId', () => {
    const req = mockReq({ body: { installationId: 999 } }) as Request;
    expect(defaultGetAccountId(req)).toBe(999);
  });

  it('returns 0 when no installation data exists', () => {
    const req = mockReq({ body: {} }) as Request;
    expect(defaultGetAccountId(req)).toBe(0);
  });
});

describe('quotaMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows request when within quota', async () => {
    const req = mockReq({ body: { installation: { id: 555 } } }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn() as NextFunction;

    vi.mocked(getTierForAccount).mockReturnValue('free');
    vi.mocked(getFeatureGate).mockReturnValue({
      concurrentFixes: 1,
      monthlyFixQuota: 10,
      premiumModels: false,
      maxRetries: 2,
      sandboxTimeoutMs: 300_000,
      customWebhooks: false,
      prioritySupport: false,
    });
    vi.mocked(getMonthlyUsage).mockResolvedValue(3);

    await quotaMiddleware()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-Tier', 'free');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '7');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expect.any(String),
    );
  });

  it('rejects request with 402 when quota exhausted', async () => {
    const req = mockReq({ body: { installation: { id: 555 } } }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn() as NextFunction;

    vi.mocked(getTierForAccount).mockReturnValue('free');
    vi.mocked(getFeatureGate).mockReturnValue({
      concurrentFixes: 1,
      monthlyFixQuota: 10,
      premiumModels: false,
      maxRetries: 2,
      sandboxTimeoutMs: 300_000,
      customWebhooks: false,
      prioritySupport: false,
    });
    vi.mocked(getMonthlyUsage).mockResolvedValue(10);

    await quotaMiddleware()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Monthly fix quota exhausted',
        remaining: 0,
        upgradeUrl: 'https://stas.ai/pricing',
      }),
    );
  });

  it('allows enterprise tier regardless of usage', async () => {
    const req = mockReq({ body: { installation: { id: 555 } } }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn() as NextFunction;

    vi.mocked(getTierForAccount).mockReturnValue('enterprise');
    vi.mocked(getFeatureGate).mockReturnValue({
      concurrentFixes: 10,
      monthlyFixQuota: 999_999,
      premiumModels: true,
      maxRetries: 10,
      sandboxTimeoutMs: 900_000,
      customWebhooks: true,
      prioritySupport: true,
    });
    vi.mocked(getMonthlyUsage).mockResolvedValue(500_000);

    await quotaMiddleware()(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('bypasses quota check when bypass function returns true', async () => {
    const req = mockReq() as Request;
    const res = mockRes() as Response;
    const next = vi.fn() as NextFunction;

    await quotaMiddleware({ bypass: () => true })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getTierForAccount).not.toHaveBeenCalled();
  });

  it('passes through when no account ID is found', async () => {
    const req = mockReq({ body: {} }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn() as NextFunction;

    await quotaMiddleware()(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('falls open (allows request) on Redis error', async () => {
    const req = mockReq({ body: { installation: { id: 555 } } }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn() as NextFunction;

    vi.mocked(getTierForAccount).mockReturnValue('free');
    vi.mocked(getFeatureGate).mockReturnValue({
      concurrentFixes: 1,
      monthlyFixQuota: 10,
      premiumModels: false,
      maxRetries: 2,
      sandboxTimeoutMs: 300_000,
      customWebhooks: false,
      prioritySupport: false,
    });
    vi.mocked(getMonthlyUsage).mockRejectedValue(new Error('Redis error'));

    await quotaMiddleware()(req, res, next);

    // Falls open — request goes through even on Redis failure
    expect(next).toHaveBeenCalled();
  });

  it('sets all expected rate limit headers on allowed request', async () => {
    const req = mockReq({ body: { installation: { id: 555 } } }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn() as NextFunction;

    vi.mocked(getTierForAccount).mockReturnValue('pro');
    vi.mocked(getFeatureGate).mockReturnValue({
      concurrentFixes: 3,
      monthlyFixQuota: 100,
      premiumModels: true,
      maxRetries: 4,
      sandboxTimeoutMs: 600_000,
      customWebhooks: false,
      prioritySupport: true,
    });
    vi.mocked(getMonthlyUsage).mockResolvedValue(25);

    await quotaMiddleware()(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Tier', 'pro');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '75');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expect.any(String),
    );
  });
});
