/**
 * Admin API routes for tier configuration and quota management.
 *
 * Provides endpoints for inspecting and modifying account tiers and
 * quotas at runtime. These routes are intended for internal admin
 * dashboards or CLI tooling — they are NOT mounted by default and must
 * be explicitly wired by the consumer.
 *
 * ── Security ─────────────────────────────────────────────────────────────────
 * These routes are intentionally unprotected by default since they are
 * expected to be mounted behind an admin auth gateway (e.g. a reverse
 * proxy with basic auth, or Express middleware). Consumers MUST add
 * authentication middleware before mounting these routes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getTierForAccount, setTierOverride, clearTierOverride, TIER_CONFIGS } from '../ratelimit/tiers.js';
import type { Tier } from '../ratelimit/tiers.js';
import { getMonthlyUsage, getRemainingQuota, resetAccountQuota } from './quota.js';
import { TIER_FEATURES } from './tiers.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pricing-admin' });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminRouter: Router = Router();

// ---------------------------------------------------------------------------
// GET /admin/tiers/:accountId — Get account tier info
// ---------------------------------------------------------------------------

adminRouter.get('/admin/tiers/:accountId', async (req: Request, res: Response) => {
  const accountId = parseAccountId(req.params.accountId);
  if (accountId === null) {
    res.status(400).json({ error: 'Invalid accountId — must be a positive integer' });
    return;
  }

  try {
    const tier: Tier = getTierForAccount(accountId);
    const features = TIER_FEATURES[tier];
    const tierConfig = TIER_CONFIGS[tier];

    res.json({
      accountId,
      tier,
      label: tierConfig.label,
      features,
      rateLimit: {
        requestsPerWindow: tierConfig.requestsPerWindow,
        maxConcurrency: tierConfig.maxConcurrency,
        windowMs: tierConfig.windowMs,
      },
    });
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to get account tier info');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /admin/tiers/:accountId — Set account tier override
// ---------------------------------------------------------------------------

export interface SetTierOverrideBody {
  tier: Tier;
}

adminRouter.put('/admin/tiers/:accountId', async (req: Request, res: Response) => {
  const accountId = parseAccountId(req.params.accountId);
  if (accountId === null) {
    res.status(400).json({ error: 'Invalid accountId — must be a positive integer' });
    return;
  }

  const { tier } = req.body as SetTierOverrideBody;

  if (!tier || !TIER_CONFIGS[tier]) {
    res.status(400).json({
      error: 'Invalid tier',
      validTiers: Object.keys(TIER_CONFIGS),
    });
    return;
  }

  try {
    setTierOverride(accountId, tier as Tier);
    log.info({ accountId, tier }, 'Admin tier override applied');

    res.json({
      accountId,
      tier,
      message: `Tier override set to "${tier}" for account ${accountId}. ` +
        'This override is NOT persisted across restarts.',
    });
  } catch (err) {
    log.error({ err: String(err), accountId, tier }, 'Failed to set tier override');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/tiers/:accountId — Remove tier override (revert to default)
// ---------------------------------------------------------------------------

adminRouter.delete('/admin/tiers/:accountId', async (req: Request, res: Response) => {
  const accountId = parseAccountId(req.params.accountId);
  if (accountId === null) {
    res.status(400).json({ error: 'Invalid accountId — must be a positive integer' });
    return;
  }

  try {
    clearTierOverride(accountId);
    const revertedTier: Tier = getTierForAccount(accountId);

    res.json({
      accountId,
      tier: revertedTier,
      message: `Tier override cleared for account ${accountId}. Reverted to "${revertedTier}".`,
    });
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to clear tier override');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/quotas/:accountId — Get quota info
// ---------------------------------------------------------------------------

adminRouter.get('/admin/quotas/:accountId', async (req: Request, res: Response) => {
  const accountId = parseAccountId(req.params.accountId);
  if (accountId === null) {
    res.status(400).json({ error: 'Invalid accountId — must be a positive integer' });
    return;
  }

  try {
    const tier: Tier = getTierForAccount(accountId);
    const usage = await getMonthlyUsage(accountId);
    const remaining = await getRemainingQuota(accountId, tier);
    const features = TIER_FEATURES[tier];

    res.json({
      accountId,
      tier,
      usage,
      quota: features.monthlyFixQuota,
      remaining,
      isUnlimited: features.monthlyFixQuota >= 999_999,
      resetTimestamp: getNextMonthStartMs(),
    });
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to get quota info');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/quotas/:accountId/reset — Reset quota for an account
// ---------------------------------------------------------------------------

adminRouter.post('/admin/quotas/:accountId/reset', async (req: Request, res: Response) => {
  const accountId = parseAccountId(req.params.accountId);
  if (accountId === null) {
    res.status(400).json({ error: 'Invalid accountId — must be a positive integer' });
    return;
  }

  try {
    await resetAccountQuota(accountId);
    res.json({
      accountId,
      message: `Quota reset for account ${accountId}.`,
    });
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to reset quota');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/tiers — List all available tiers
// ---------------------------------------------------------------------------

adminRouter.get('/admin/tiers', async (_req: Request, res: Response) => {
  const tiers = Object.entries(TIER_FEATURES).map(([tier, features]) => ({
    tier,
    label: TIER_CONFIGS[tier as Tier].label,
    features,
    rateLimit: {
      requestsPerWindow: TIER_CONFIGS[tier as Tier].requestsPerWindow,
      maxConcurrency: TIER_CONFIGS[tier as Tier].maxConcurrency,
      windowMs: TIER_CONFIGS[tier as Tier].windowMs,
    },
  }));

  res.json({ tiers });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse accountId from a route parameter string.
 * Returns null if the value is not a positive integer.
 */
function parseAccountId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
    return null;
  }
  return id;
}

/**
 * Get the Unix timestamp (ms) for the start of the next UTC month.
 */
function getNextMonthStartMs(): number {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return nextMonth.getTime();
}
