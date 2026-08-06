import { queryWithRetry } from '../db/connection.js';
import { PLANS } from './plans.js';
import type { PlanId } from './plans.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'fix-budget' });

const ACCOUNT_PLAN_TO_PLAN_ID: Record<string, PlanId> = {
  free: 'free',
  pro: 'solo',
  solo: 'solo',
  team: 'team',
  enterprise: 'enterprise',
  selfHosted: 'selfHosted',
};

export interface FixBudgetStatus {
  accountId: number;
  planId: PlanId;
  limit: number;
  used: number;
  unlimited: boolean;
  exhausted: boolean;
}

export async function resolveAccountIdByInstallation(installationId: number): Promise<number | null> {
  try {
    const r = await queryWithRetry<{ id: number }>(
      'SELECT id FROM accounts WHERE github_installation_id = $1 LIMIT 1',
      [installationId],
    );
    return r.rows[0]?.id ?? null;
  } catch (err) {
    log.warn({ err: String(err), installationId }, 'Failed to resolve account by installation');
    return null;
  }
}

export async function getFixBudgetStatus(accountId: number): Promise<FixBudgetStatus> {
  let planId: PlanId = 'free';
  try {
    const billingResult = await queryWithRetry<{ plan: string }>(
      'SELECT plan FROM billing WHERE account_id = $1',
      [accountId],
    );
    if (billingResult.rows[0]) {
      const dbPlan = billingResult.rows[0].plan as PlanId;
      if (PLANS[dbPlan]) planId = dbPlan;
    } else {
      const accountResult = await queryWithRetry<{ plan: string }>(
        'SELECT plan FROM accounts WHERE id = $1',
        [accountId],
      );
      const mapped = accountResult.rows[0] ? ACCOUNT_PLAN_TO_PLAN_ID[accountResult.rows[0].plan] : undefined;
      if (mapped && PLANS[mapped]) planId = mapped;
    }
  } catch (err) {
    log.warn({ err: String(err), accountId }, 'Failed to resolve plan, defaulting to free');
  }

  const limit = PLANS[planId]?.monthlyFixLimit ?? 10;
  const unlimited = limit >= 999_999;

  let used = 0;
  try {
    const u = await queryWithRetry<{ used: number | null }>(
      `SELECT COALESCE(SUM(credits_used), 0) AS used
       FROM usage_records
       WHERE account_id = $1 AND timestamp >= date_trunc('month', NOW())`,
      [accountId],
    );
    used = Number(u.rows[0]?.used ?? 0);
  } catch (err) {
    log.warn({ err: String(err), accountId }, 'Failed to compute monthly usage');
  }

  return { accountId, planId, limit, used, unlimited, exhausted: !unlimited && used >= limit };
}
