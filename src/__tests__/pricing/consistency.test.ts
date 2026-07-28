import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLANS, planIdToTier } from '../../billing/plans.js';
import { TIER_FEATURES } from '../../pricing/tiers.js';

function projectPath(...parts: string[]): string {
  return resolve(import.meta.dirname, '..', '..', '..', ...parts);
}

describe('Pricing Consistency', () => {
  describe('planIdToTier mapping', () => {
    it('maps free -> free', () => {
      expect(planIdToTier('free')).toBe('free');
    });

    it('maps solo -> pro', () => {
      expect(planIdToTier('solo')).toBe('pro');
    });

    it('maps team -> team', () => {
      expect(planIdToTier('team')).toBe('team');
    });

    it('maps enterprise -> enterprise', () => {
      expect(planIdToTier('enterprise')).toBe('enterprise');
    });
  });

  describe('TIER_FEATURES matches PLANS', () => {
    it('TIER_FEATURES.team.monthlyFixQuota matches PLANS.team.monthlyFixLimit', () => {
      expect(TIER_FEATURES.team.monthlyFixQuota).toBe(PLANS.team.monthlyFixLimit);
    });

    it('TIER_FEATURES.pro.monthlyFixQuota matches PLANS.solo.monthlyFixLimit', () => {
      expect(TIER_FEATURES.pro.monthlyFixQuota).toBe(PLANS.solo.monthlyFixLimit);
    });

    it('TIER_FEATURES.free.monthlyFixQuota matches PLANS.free.monthlyFixLimit', () => {
      expect(TIER_FEATURES.free.monthlyFixQuota).toBe(PLANS.free.monthlyFixLimit);
    });

    it('Solo amountCents (4900) == $49', () => {
      expect(PLANS.solo.amountCents).toBe(4900);
    });

    it('Team amountCents (14900) == $149', () => {
      expect(PLANS.team.amountCents).toBe(14900);
    });
  });

  describe('documentation references $49 Solo price', () => {
    const docs = ['AGENTS.md', 'README.md', 'STRATEGY.md', 'ROADMAP.md'];

    for (const doc of docs) {
      it(`${doc} references $49 Solo price`, () => {
        const content = readFileSync(projectPath(doc), 'utf-8');
        expect(content).toMatch(/\$49/);
      });
    }
  });

  describe('documentation references $149 Team price', () => {
    const docs = ['STRATEGY.md', 'ROADMAP.md'];

    for (const doc of docs) {
      it(`${doc} references $149 Team price`, () => {
        const content = readFileSync(projectPath(doc), 'utf-8');
        expect(content).toMatch(/\$149/);
      });
    }
  });

  describe('Free tier consistency', () => {
    it('PLANS.free.monthlyFixLimit is 50 fixes', () => {
      expect(PLANS.free.monthlyFixLimit).toBe(50);
    });

    it('TIER_FEATURES.free.monthlyFixQuota is 50 fixes', () => {
      expect(TIER_FEATURES.free.monthlyFixQuota).toBe(50);
    });

    it('PLANS.free.trialFixLimit is 5 fixes', () => {
      expect(PLANS.free.trialFixLimit).toBe(5);
    });
  });
});
