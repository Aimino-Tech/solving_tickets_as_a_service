import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    metering: {
      costTriage: 1,
      costOpencodePrimary: 10,
      costOpencodeFallback: 5,
      costPrCreation: 2,
      costRetryPenalty: 3,
      baselineSandboxMs: 300000,
      freeMonthlyCredits: 100,
      sandboxMultiplierMin: 0.5,
      sandboxMultiplierMax: 2.0,
    },
  },
}));
import {
  calculatePipelineCost,
  computeSandboxMultiplier,
  isWithinFreeTier,
  resetCostConfig,
  setCostConfig,
} from '../../metering/costs.js';

afterEach(() => {
  resetCostConfig();
});

describe('computeSandboxMultiplier', () => {
  it('returns 1.0 when actual equals baseline', () => {
    expect(computeSandboxMultiplier(300_000, 300_000)).toBe(1.0);
  });

  it('returns 0.5 when actual is below clamp floor', () => {
    expect(computeSandboxMultiplier(30_000, 300_000)).toBe(0.5);
  });

  it('returns 2.0 when actual is above clamp ceiling', () => {
    expect(computeSandboxMultiplier(900_000, 300_000)).toBe(2.0);
  });

  it('returns 1.5 for proportional middle values', () => {
    expect(computeSandboxMultiplier(450_000, 300_000)).toBe(1.5);
  });

  it('returns 1.0 when baseline is zero (safety check)', () => {
    expect(computeSandboxMultiplier(100_000, 0)).toBe(1.0);
  });

  it('uses config defaults when optional params are omitted', () => {
    setCostConfig({ baselineSandboxDurationMs: 200_000 });
    expect(computeSandboxMultiplier(100_000)).toBe(0.5);
  });
});

describe('calculatePipelineCost', () => {
  it('calculates a basic successful run', () => {
    const cost = calculatePipelineCost({
      triagePerformed: true,
      primaryRunCount: 1,
      fallbackRunCount: 0,
      retryCount: 0,
      prCreated: true,
      sandboxDurationMs: 300_000,
    });
    expect(cost).toBe(13); // 1 (triage) + 10 (primary) + 2 (pr)
  });

  it('includes sandbox multiplier for long runs', () => {
    const cost = calculatePipelineCost({
      triagePerformed: true,
      primaryRunCount: 1,
      fallbackRunCount: 0,
      retryCount: 0,
      prCreated: true,
      sandboxDurationMs: 600_000, // 2x baseline
    });
    expect(cost).toBe(23); // 1 + 20 (10*2) + 2
  });

  it('adds retry penalties', () => {
    const cost = calculatePipelineCost({
      triagePerformed: true,
      primaryRunCount: 2,
      fallbackRunCount: 0,
      retryCount: 2,
      prCreated: true,
      sandboxDurationMs: 300_000,
    });
    expect(cost).toBe(29); // 1 + 20 (10*2) + 6 (3*2 retries) + 2
  });

  it('adds fallback costs', () => {
    const cost = calculatePipelineCost({
      triagePerformed: true,
      primaryRunCount: 1,
      fallbackRunCount: 2,
      retryCount: 1,
      prCreated: true,
      sandboxDurationMs: 300_000,
    });
    expect(cost).toBe(26); // 1 + 10 + 10 (5*2 fallback) + 3 (retry) + 2
  });

  it('handles no triage and no PR', () => {
    const cost = calculatePipelineCost({
      triagePerformed: false,
      primaryRunCount: 1,
      fallbackRunCount: 0,
      retryCount: 0,
      prCreated: false,
      sandboxDurationMs: 300_000,
    });
    expect(cost).toBe(10); // just primary
  });

  it('uses custom cost config', () => {
    setCostConfig({ opencodePrimary: 20, triage: 5 });
    const cost = calculatePipelineCost({
      triagePerformed: true,
      primaryRunCount: 1,
      fallbackRunCount: 0,
      retryCount: 0,
      prCreated: false,
      sandboxDurationMs: 300_000,
    });
    expect(cost).toBe(25); // 5 + 20
  });
});

describe('isWithinFreeTier', () => {
  it('returns true when under the limit', () => {
    expect(isWithinFreeTier(50)).toBe(true);
  });

  it('returns false when at the limit', () => {
    expect(isWithinFreeTier(100)).toBe(false);
  });

  it('returns false when over the limit', () => {
    expect(isWithinFreeTier(150)).toBe(false);
  });

  it('returns true when limit is 0 (unlimited)', () => {
    setCostConfig({ freeMonthlyCredits: 0 });
    expect(isWithinFreeTier(9999)).toBe(true);
  });
});
