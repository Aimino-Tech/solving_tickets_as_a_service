/**
 * Dispatch gate for fix runs (AIM-4647).
 *
 * The billing/quota enforcement functions existed but were never called in the
 * production dispatch path — `issues.labeled`/`issues.edited` only checked the
 * common-sense gate and the rate limiter. This module wires the existing
 * enforcement into that path:
 *
 *   1. `checkUsageBeforeFix` — monthly fix quota (Redis-backed, per plan)
 *   2. `applyBalanceAfterLimit` — AIM-4645 "use balance after limits" override
 *   3. `incrementBillingUsage` — accrue the quota counter after a real dispatch
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ All checks fail OPEN on errors (existing checkUsageBeforeFix semantics):
 *    a DB/Redis failure must not silently drop customer fix requests.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { checkUsageBeforeFix, incrementBillingUsage } from './usage.js';
import type { PlanId } from './plans.js';
import { applyBalanceAfterLimit } from '../usage-limits/enforcement.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'dispatch-gate' });

/**
 * Account tier (as resolved by the rate limiter) → billing PlanId.
 * Mirrors ACCOUNT_PLAN_TO_PLAN_ID used by the billing/usage-limits routes.
 */
const TIER_TO_PLAN_ID: Record<string, PlanId> = {
  free: 'free',
  pro: 'solo',
  solo: 'solo',
  team: 'team',
  enterprise: 'enterprise',
  selfHosted: 'selfHosted',
  'self-hosted': 'selfHosted',
};

export interface DispatchGateResult {
  /** Whether the fix run may proceed. */
  allowed: boolean;
  /** Billing plan the check ran against. */
  planId: PlanId;
  /** Current monthly usage count. */
  usage: number;
  /** Plan's monthly fix limit. */
  limit: number;
  /** Reason when blocked (or override consumed credits). */
  reason?: string;
  /** Credits consumed by the balance-after-limits override (0 when unused). */
  consumedCredits: number;
  /** Remaining balance after the override (0 when unused/blocked). */
  remainingBalance: number;
}

/**
 * Decide whether a fix run for the given account may be dispatched.
 *
 * Order:
 *   1. Resolve the plan from the tier and check the monthly fix quota.
 *   2. If over quota, try the balance-after-limits override (AIM-4645).
 *   3. Fail OPEN: any error while checking → allow (never drop requests on
 *      infra hiccups, matching the existing `checkUsageBeforeFix` behavior).
 */
export async function checkDispatchAllowed(
  accountId: number,
  tier: string,
): Promise<DispatchGateResult> {
  const planId = TIER_TO_PLAN_ID[tier] ?? 'free';

  try {
    const usageCheck = await checkUsageBeforeFix(accountId, planId);

    if (usageCheck.allowed) {
      return {
        allowed: true,
        planId,
        usage: usageCheck.usage,
        limit: usageCheck.limit,
        consumedCredits: 0,
        remainingBalance: 0,
      };
    }

    // Over quota — try the balance-after-limits override (AIM-4645).
    const override = await applyBalanceAfterLimit(accountId);
    if (override.allowed) {
      log.info(
        { accountId, tier, planId, consumedCredits: override.consumedCredits, remainingBalance: override.remainingBalance },
        'Quota exhausted — balance-after-limits override consumed credits and allowed dispatch',
      );
      return {
        allowed: true,
        planId,
        usage: usageCheck.usage,
        limit: usageCheck.limit,
        reason: `balance-after-limits override consumed ${override.consumedCredits} credits`,
        consumedCredits: override.consumedCredits,
        remainingBalance: override.remainingBalance,
      };
    }

    return {
      allowed: false,
      planId,
      usage: usageCheck.usage,
      limit: usageCheck.limit,
      reason: usageCheck.error ?? 'Monthly fix limit reached',
      consumedCredits: 0,
      remainingBalance: override.remainingBalance,
    };
  } catch (err) {
    // Fail open — a gate failure must not drop customer fix requests.
    log.error(
      { err: String(err), accountId, tier, planId },
      'Dispatch gate check failed — allowing fix (fail open)',
    );
    return {
      allowed: true,
      planId,
      usage: 0,
      limit: Number.MAX_SAFE_INTEGER,
      reason: 'gate-error-fail-open',
      consumedCredits: 0,
      remainingBalance: 0,
    };
  }
}

/**
 * Accrue the monthly billing usage counter after a fix was dispatched.
 * Best-effort — failures are logged and swallowed.
 */
export async function recordDispatchedFix(accountId: number): Promise<void> {
  await incrementBillingUsage(accountId);
}
