/**
 * Usage limits preferences API (AIM-4645).
 *
 * Three usage windows (continuous / weekly / monthly) computed from the `runs`
 * table (SUM of credits_used), the plan's monthly fix limit, and an
 * account-level toggle persisted on `accounts`:
 *   - use_balance_after_limits — consume credits past the plan limit
 *
 * ── Endpoints ───────────────────────────────────────────────────────────────
 *   GET  /api/v1/usage-limits             — usage windows + preference toggles
 *   POST /api/v1/usage-limits/preferences — update preference toggles
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── Authentication ──────────────────────────────────────────────────────────
 * JWT (Bearer) via requireAuth; account resolved from `x-account-id` header,
 * `accountId` query param, or the JWT email -> accounts.id lookup.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry, isTableNotFoundError } from '../db/connection.js';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { PLANS, getMonthlyFixLimit } from '../billing/plans.js';
import type { PlanId } from '../billing/plans.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'usage-limits-api' });

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// Account-level plan names (from accounts table) to billing PlanId mapping.
// Mirrors src/billing/routes.ts.
const ACCOUNT_PLAN_TO_PLAN_ID: Record<string, PlanId> = {
  free: 'free',
  pro: 'solo',
  solo: 'solo',
  team: 'team',
  enterprise: 'enterprise',
  selfHosted: 'selfHosted',
};

export const usageLimitsRouter: Router = Router();

usageLimitsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageWindow {
  /** Credits consumed in the window (SUM of runs.credits_used). */
  usedCredits: number;
  /** Plan's monthly fix limit (999_999 = unlimited). */
  limitCredits: number;
  /** ISO timestamp of the window end (reset point). */
  resetAt: string;
}

export interface UsageLimitsResponse {
  continuous: UsageWindow;
  weekly: UsageWindow;
  monthly: UsageWindow;
  useBalanceAfterLimits: boolean;
  /** Current credit balance (used to back the balance-after-limits toggle). */
  balance: number;
}

// ---------------------------------------------------------------------------
// Window helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Rolling 24h window: usage over the last 24h, reset 24h from now.
 */
export function computeContinuousWindow(nowMs: number = Date.now()): { startMs: number; endMs: number } {
  return { startMs: nowMs - DAY_MS, endMs: nowMs + DAY_MS };
}

/**
 * Rolling 7d window: usage over the last 7 days, reset 7 days from now.
 */
export function computeWeeklyWindow(nowMs: number = Date.now()): { startMs: number; endMs: number } {
  return { startMs: nowMs - WEEK_MS, endMs: nowMs + WEEK_MS };
}

/**
 * Calendar month window: usage since UTC month start, reset at next month start.
 */
export function computeMonthlyWindow(nowMs: number = Date.now()): { startMs: number; endMs: number } {
  const now = new Date(nowMs);
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
  const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  return { startMs, endMs };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Extract the authenticated account ID from the request.
 * Reads from `x-account-id` header, `accountId` query param, or JWT email.
 */
async function getAccountId(req: Request): Promise<number | undefined> {
  const headerId = req.headers['x-account-id'];
  if (headerId) {
    const id = Number(Array.isArray(headerId) ? headerId[0] : headerId);
    if (Number.isFinite(id) && id > 0 && Number.isInteger(id)) return id;
  }

  const queryId = req.query.accountId as string | undefined;
  if (queryId) {
    const id = Number(queryId);
    if (Number.isFinite(id) && id > 0 && Number.isInteger(id)) return id;
  }

  if (req.user) {
    try {
      const result = await queryWithRetry<{ id: number }>(
        'SELECT id FROM accounts WHERE email = $1 LIMIT 1',
        [req.user.email],
      );
      if (result.rows.length > 0) return result.rows[0].id;
    } catch {
      // DB table may not exist — return undefined
    }
  }

  return undefined;
}

/**
 * Resolve the account's plan ID: dedicated billing table first, then
 * accounts.plan. Mirrors src/billing/routes.ts plan resolution.
 */
async function resolveAccountPlan(accountId: number): Promise<PlanId> {
  let planId: PlanId = 'free';
  try {
    const billingResult = await queryWithRetry<{ plan: string }>(
      'SELECT plan FROM billing WHERE account_id = $1',
      [accountId],
    );
    if (billingResult.rows.length > 0) {
      const dbPlan = billingResult.rows[0].plan as PlanId;
      if (PLANS[dbPlan]) planId = dbPlan;
    } else {
      const accountResult = await queryWithRetry<{ plan: string }>(
        'SELECT plan FROM accounts WHERE id = $1',
        [accountId],
      );
      if (accountResult.rows.length > 0) {
        const mappedPlanId = ACCOUNT_PLAN_TO_PLAN_ID[accountResult.rows[0].plan];
        if (mappedPlanId && PLANS[mappedPlanId]) planId = mappedPlanId;
      }
    }
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to resolve account plan — defaulting to free');
  }
  return planId;
}

/**
 * Read the usage preference toggles from the accounts table.
 */
async function getAccountPrefs(accountId: number): Promise<{ useBalanceAfterLimits: boolean }> {
  try {
    const result = await queryWithRetry<{ use_balance_after_limits: boolean }>(
      'SELECT use_balance_after_limits FROM accounts WHERE id = $1',
      [accountId],
    );
    if (result.rows.length > 0) {
      return {
        useBalanceAfterLimits: result.rows[0].use_balance_after_limits,
      };
    }
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to read account usage prefs — returning defaults');
  }
  return { useBalanceAfterLimits: false };
}

// ---------------------------------------------------------------------------
// Usage computation
// ---------------------------------------------------------------------------

/**
 * Sum credits_used across the account's runs created at or after `sinceMs`.
 * Returns 0 when the runs table does not exist or on read failure.
 */
export async function sumCreditsSince(accountId: number, sinceMs: number): Promise<number> {
  try {
    const result = await queryWithRetry<{ total: number | null }>(
      `SELECT COALESCE(SUM(credits_used), 0) AS total
       FROM runs
       WHERE account_id = $1 AND created_at >= to_timestamp($2 / 1000.0)`,
      [accountId, sinceMs],
    );
    return Number(result.rows[0]?.total ?? 0);
  } catch (err) {
    if (isTableNotFoundError(err)) return 0;
    log.error({ err: String(err), accountId }, 'Failed to sum run credits — returning 0');
    return 0;
  }
}

async function buildWindow(
  accountId: number,
  planId: PlanId,
  window: { startMs: number; endMs: number },
): Promise<UsageWindow> {
  const [usedCredits] = await Promise.all([
    sumCreditsSince(accountId, window.startMs),
  ]);
  return {
    usedCredits,
    limitCredits: getMonthlyFixLimit(planId),
    resetAt: new Date(window.endMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/usage-limits — usage windows + preference toggles for the account.
 */
usageLimitsRouter.get('/', async (req: Request, res: Response) => {
  const accountId = await getAccountId(req);
  if (!accountId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Provide x-account-id header or valid JWT token.',
    });
    return;
  }

  try {
    const [planId, prefs, balance] = await Promise.all([
      resolveAccountPlan(accountId),
      getAccountPrefs(accountId),
      creditsRepository.getBalance(accountId),
    ]);

    const now = Date.now();
    const [continuous, weekly, monthly] = await Promise.all([
      buildWindow(accountId, planId, computeContinuousWindow(now)),
      buildWindow(accountId, planId, computeWeeklyWindow(now)),
      buildWindow(accountId, planId, computeMonthlyWindow(now)),
    ]);

    const response: UsageLimitsResponse = {
      continuous,
      weekly,
      monthly,
      useBalanceAfterLimits: prefs.useBalanceAfterLimits,
      balance: balance.balance,
    };
    res.json(response);
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to get usage limits');
    res.status(500).json({ error: 'Failed to get usage limits' });
  }
});

/**
 * POST /api/v1/usage-limits/preferences — update usage toggles.
 */
const PreferencesSchema = z.object({
  useBalanceAfterLimits: z.boolean(),
});

usageLimitsRouter.post('/preferences', async (req: Request, res: Response) => {
  const accountId = await getAccountId(req);
  if (!accountId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Provide x-account-id header or valid JWT token.',
    });
    return;
  }

  const parsed = PreferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  const { useBalanceAfterLimits } = parsed.data;

  try {
    await queryWithRetry(
      'UPDATE accounts SET use_balance_after_limits = $1 WHERE id = $2',
      [useBalanceAfterLimits, accountId],
    );

    const prefs = await getAccountPrefs(accountId);
    log.info({ accountId, useBalanceAfterLimits }, 'Usage limit preferences updated');
    res.json({ success: true, ...prefs });
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to update usage limit preferences');
    res.status(500).json({ error: 'Failed to update usage limit preferences' });
  }
});
