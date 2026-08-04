/**
 * Unit tests for src/pricing/tiers.ts — Tier feature gate definitions.
 *
 * Coverage:
 *   - TIER_FEATURES values match requirements
 *   - getFeatureGate returns correct config per tier
 *   - Helper functions (canUsePremiumModels, getMonthlyQuota, etc.)
 *   - Edge cases: all tiers present, enterprise unlimited, pro webhooks disabled
 */

import { describe, expect, it } from 'vitest';
import {
  TIER_FEATURES,
  getFeatureGate,
  canUsePremiumModels,
  getMonthlyQuota,
  getConcurrentFixesLimit,
  getMaxRetries,
  getSandboxTimeoutMs,
} from '../../pricing/tiers.js';
import type { FeatureGate } from '../../pricing/tiers.js';

describe('TIER_FEATURES', () => {
  it('defines all four tiers', () => {
    const tiers = Object.keys(TIER_FEATURES);
    expect(tiers).toEqual(['free', 'pro', 'team', 'enterprise']);
  });

  // ---------------------------------------------------------------------------
  // Free tier
  // ---------------------------------------------------------------------------
  describe('free tier', () => {
    const free: FeatureGate = TIER_FEATURES.free;

    it('has 1 concurrent fix', () => {
      expect(free.concurrentFixes).toBe(1);
    });

    it('has monthly quota of 10 fixes', () => {
      expect(free.monthlyFixQuota).toBe(10);
    });

    it('does not have premium models', () => {
      expect(free.premiumModels).toBe(false);
    });

    it('has 2 max retries', () => {
      expect(free.maxRetries).toBe(2);
    });

    it('has 5-minute sandbox timeout', () => {
      expect(free.sandboxTimeoutMs).toBe(300_000);
    });

    it('does not have custom webhooks', () => {
      expect(free.customWebhooks).toBe(false);
    });

    it('does not have priority support', () => {
      expect(free.prioritySupport).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Pro tier
  // ---------------------------------------------------------------------------
  describe('pro tier', () => {
    const pro: FeatureGate = TIER_FEATURES.pro;

    it('has 3 concurrent fixes', () => {
      expect(pro.concurrentFixes).toBe(3);
    });

    it('has monthly quota of 100 fixes', () => {
      expect(pro.monthlyFixQuota).toBe(100);
    });

    it('has premium models', () => {
      expect(pro.premiumModels).toBe(true);
    });

    it('has 4 max retries', () => {
      expect(pro.maxRetries).toBe(4);
    });

    it('has 10-minute sandbox timeout', () => {
      expect(pro.sandboxTimeoutMs).toBe(600_000);
    });

    it('does not have custom webhooks (MVP limitation)', () => {
      expect(pro.customWebhooks).toBe(false);
    });

    it('has priority support', () => {
      expect(pro.prioritySupport).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Team tier
  // ---------------------------------------------------------------------------
  describe('team tier', () => {
    const team: FeatureGate = TIER_FEATURES.team;

    it('has 10 concurrent fixes', () => {
      expect(team.concurrentFixes).toBe(10);
    });

    it('has monthly quota of 500 fixes', () => {
      expect(team.monthlyFixQuota).toBe(500);
    });

    it('has premium models', () => {
      expect(team.premiumModels).toBe(true);
    });

    it('has 10 max retries', () => {
      expect(team.maxRetries).toBe(10);
    });

    it('has 15-minute sandbox timeout', () => {
      expect(team.sandboxTimeoutMs).toBe(900_000);
    });

    it('has custom webhooks', () => {
      expect(team.customWebhooks).toBe(true);
    });

    it('has priority support', () => {
      expect(team.prioritySupport).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Enterprise tier
  // ---------------------------------------------------------------------------
  describe('enterprise tier', () => {
    const enterprise: FeatureGate = TIER_FEATURES.enterprise;

    it('has 50 concurrent fixes', () => {
      expect(enterprise.concurrentFixes).toBe(50);
    });

    it('has effectively unlimited monthly quota (999_999+)', () => {
      expect(enterprise.monthlyFixQuota).toBeGreaterThanOrEqual(999_999);
    });

    it('has premium models', () => {
      expect(enterprise.premiumModels).toBe(true);
    });

    it('has 10 max retries', () => {
      expect(enterprise.maxRetries).toBe(10);
    });

    it('has 30-minute sandbox timeout', () => {
      expect(enterprise.sandboxTimeoutMs).toBe(1_800_000);
    });

    it('has custom webhooks', () => {
      expect(enterprise.customWebhooks).toBe(true);
    });

    it('has priority support', () => {
      expect(enterprise.prioritySupport).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
describe('getFeatureGate', () => {
  it('returns free config for free tier', () => {
    expect(getFeatureGate('free')).toBe(TIER_FEATURES.free);
  });

  it('returns pro config for pro tier', () => {
    expect(getFeatureGate('pro')).toBe(TIER_FEATURES.pro);
  });

  it('returns team config for team tier', () => {
    expect(getFeatureGate('team')).toBe(TIER_FEATURES.team);
  });

  it('returns enterprise config for enterprise tier', () => {
    expect(getFeatureGate('enterprise')).toBe(TIER_FEATURES.enterprise);
  });
});

describe('canUsePremiumModels', () => {
  it('returns false for free tier', () => {
    expect(canUsePremiumModels('free')).toBe(false);
  });

  it('returns true for pro tier', () => {
    expect(canUsePremiumModels('pro')).toBe(true);
  });

  it('returns true for team tier', () => {
    expect(canUsePremiumModels('team')).toBe(true);
  });

  it('returns true for enterprise tier', () => {
    expect(canUsePremiumModels('enterprise')).toBe(true);
  });
});

describe('getMonthlyQuota', () => {
  it('returns 50 for free tier', () => {
    expect(getMonthlyQuota('free')).toBe(10);
  });

  it('returns 100 for pro tier', () => {
    expect(getMonthlyQuota('pro')).toBe(100);
  });

  it('returns 500 for team tier', () => {
    expect(getMonthlyQuota('team')).toBe(500);
  });

  it('returns 999_999+ for enterprise tier', () => {
    expect(getMonthlyQuota('enterprise')).toBeGreaterThanOrEqual(999_999);
  });
});

describe('getConcurrentFixesLimit', () => {
  it('returns 1 for free tier', () => {
    expect(getConcurrentFixesLimit('free')).toBe(1);
  });

  it('returns 3 for pro tier', () => {
    expect(getConcurrentFixesLimit('pro')).toBe(3);
  });

  it('returns 10 for team tier', () => {
    expect(getConcurrentFixesLimit('team')).toBe(10);
  });

  it('returns 50 for enterprise tier', () => {
    expect(getConcurrentFixesLimit('enterprise')).toBe(50);
  });
});

describe('getMaxRetries', () => {
  it('returns 2 for free tier', () => {
    expect(getMaxRetries('free')).toBe(2);
  });

  it('returns 4 for pro tier', () => {
    expect(getMaxRetries('pro')).toBe(4);
  });

  it('returns 10 for team tier', () => {
    expect(getMaxRetries('team')).toBe(10);
  });

  it('returns 10 for enterprise tier', () => {
    expect(getMaxRetries('enterprise')).toBe(10);
  });
});

describe('getSandboxTimeoutMs', () => {
  it('returns 300_000 for free tier', () => {
    expect(getSandboxTimeoutMs('free')).toBe(300_000);
  });

  it('returns 600_000 for pro tier', () => {
    expect(getSandboxTimeoutMs('pro')).toBe(600_000);
  });

  it('returns 900_000 for team tier', () => {
    expect(getSandboxTimeoutMs('team')).toBe(900_000);
  });

  it('returns 1_800_000 for enterprise tier', () => {
    expect(getSandboxTimeoutMs('enterprise')).toBe(1_800_000);
  });
});

// ---------------------------------------------------------------------------
// Enforcement scenario tests
// ---------------------------------------------------------------------------
describe('Feature gating - enforcement scenarios', () => {
  it('free tier cannot use premium models', () => {
    const free = TIER_FEATURES.free;
    expect(free.premiumModels).toBe(false);
    expect(canUsePremiumModels('free')).toBe(false);
  });

  it('pro tier can use premium models', () => {
    const pro = TIER_FEATURES.pro;
    expect(pro.premiumModels).toBe(true);
    expect(canUsePremiumModels('pro')).toBe(true);
  });

  it('model selection is gated: team and enterprise can use all models', () => {
    expect(canUsePremiumModels('team')).toBe(true);
    expect(canUsePremiumModels('enterprise')).toBe(true);
  });

  it('sandbox timeout increases with tier', () => {
    const free = TIER_FEATURES.free.sandboxTimeoutMs;
    const pro = TIER_FEATURES.pro.sandboxTimeoutMs;
    const team = TIER_FEATURES.team.sandboxTimeoutMs;
    const enterprise = TIER_FEATURES.enterprise.sandboxTimeoutMs;

    expect(free).toBeLessThan(pro);
    expect(pro).toBeLessThan(team);
    expect(team).toBeLessThan(enterprise);
  });

  it('max retries increase with tier', () => {
    const free = TIER_FEATURES.free.maxRetries;
    const pro = TIER_FEATURES.pro.maxRetries;
    const team = TIER_FEATURES.team.maxRetries;
    const enterprise = TIER_FEATURES.enterprise.maxRetries;

    expect(free).toBeLessThan(pro);
    expect(pro).toBeLessThanOrEqual(team);
    expect(team).toBeLessThanOrEqual(enterprise);
  });

  it('team and enterprise have custom webhooks', () => {
    expect(TIER_FEATURES.free.customWebhooks).toBe(false);
    expect(TIER_FEATURES.pro.customWebhooks).toBe(false);
    expect(TIER_FEATURES.team.customWebhooks).toBe(true);
    expect(TIER_FEATURES.enterprise.customWebhooks).toBe(true);
  });

  it('concurrent fix limits are enforced by tier', () => {
    expect(TIER_FEATURES.free.concurrentFixes).toBe(1);
    expect(TIER_FEATURES.pro.concurrentFixes).toBe(3);
    expect(TIER_FEATURES.team.concurrentFixes).toBe(10);
    expect(TIER_FEATURES.enterprise.concurrentFixes).toBe(50);
  });
});
