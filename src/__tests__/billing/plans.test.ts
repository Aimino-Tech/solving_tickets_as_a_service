/**
 * Unit tests for src/billing/plans.ts — Subscription plan definitions.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock config — plans module reads from config for Stripe price IDs
vi.mock('../../config.js', () => ({
  config: {
    stripe: {
      soloPriceId: 'price_solo_mock',
      teamPriceId: 'price_team_mock',
    },
  },
}));

describe('billing/plans', () => {
  let plans: typeof import('../../billing/plans.js');

  beforeEach(async () => {
    plans = await import('../../billing/plans.js');
  });

  describe('PLANS', () => {
    it('exports all 4 plans: free, solo, team, enterprise', () => {
      expect(plans.PLANS).toHaveProperty('free');
      expect(plans.PLANS).toHaveProperty('solo');
      expect(plans.PLANS).toHaveProperty('team');
      expect(plans.PLANS).toHaveProperty('enterprise');
    });

    it('free plan has 0 amount cents and 10 monthly fix limit', () => {
      const free = plans.PLANS.free;
      expect(free.amountCents).toBe(0);
      expect(free.monthlyFixLimit).toBe(10);
      expect(free.premiumModels).toBe(false);
    });

    it('solo plan costs $49 (4900 cents) with 500 fixes/mo', () => {
      const solo = plans.PLANS.solo;
      expect(solo.amountCents).toBe(4900);
      expect(solo.monthlyFixLimit).toBe(500);
      expect(solo.premiumModels).toBe(true);
      expect(solo.concurrentFixes).toBe(3);
    });

    it('team plan costs $149 (14900 cents) with unlimited fixes', () => {
      const team = plans.PLANS.team;
      expect(team.amountCents).toBe(14900);
      expect(team.monthlyFixLimit).toBe(999_999);
      expect(team.premiumModels).toBe(true);
      expect(team.concurrentFixes).toBe(10);
    });

    it('enterprise plan has unlimited fixes', () => {
      const enterprise = plans.PLANS.enterprise;
      expect(enterprise.monthlyFixLimit).toBe(999_999);
      expect(enterprise.concurrentFixes).toBe(50);
      expect(enterprise.premiumModels).toBe(true);
    });

    it('solo and team plans get priceId from config', () => {
      expect(plans.PLANS.solo.priceId).toBe('price_solo_mock');
      expect(plans.PLANS.team.priceId).toBe('price_team_mock');
    });

    it('free and enterprise plans have empty priceId', () => {
      expect(plans.PLANS.free.priceId).toBe('');
      expect(plans.PLANS.enterprise.priceId).toBe('');
    });
  });

  describe('getPlanByPriceId', () => {
    it('returns the plan matching a Stripe price ID', () => {
      const plan = plans.getPlanByPriceId('price_solo_mock');
      expect(plan).toBeDefined();
      expect(plan!.id).toBe('solo');
    });

    it('returns undefined for unknown price IDs', () => {
      const plan = plans.getPlanByPriceId('price_unknown');
      expect(plan).toBeUndefined();
    });
  });

  describe('getPlan', () => {
    it('returns the plan for a given PlanId', () => {
      expect(plans.getPlan('solo').name).toBe('Solo');
      expect(plans.getPlan('team').name).toBe('Team');
      expect(plans.getPlan('free').name).toBe('Free');
    });
  });

  describe('getMonthlyFixLimit', () => {
    it('returns the correct monthly fix limit', () => {
      expect(plans.getMonthlyFixLimit('free')).toBe(10);
      expect(plans.getMonthlyFixLimit('solo')).toBe(500);
      expect(plans.getMonthlyFixLimit('team')).toBe(999_999);
      expect(plans.getMonthlyFixLimit('enterprise')).toBe(999_999);
    });
  });

  describe('planIdToTier', () => {
    it('maps free -> free', () => {
      expect(plans.planIdToTier('free')).toBe('free');
    });

    it('maps solo -> pro', () => {
      expect(plans.planIdToTier('solo')).toBe('pro');
    });

    it('maps team -> team', () => {
      expect(plans.planIdToTier('team')).toBe('team');
    });

    it('maps enterprise -> enterprise', () => {
      expect(plans.planIdToTier('enterprise')).toBe('enterprise');
    });
  });
});
