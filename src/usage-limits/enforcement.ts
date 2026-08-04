/**
 * Balance-after-limits enforcement (AIM-4645).
 *
 * When an account has exhausted its plan's monthly fix quota, the quota gate
 * normally returns 402. If the account enabled `use_balance_after_limits` on
 * the accounts table, this helper consumes one fix run's worth of credits
 * from the credit balance instead and lets the request through.
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ DB failures are logged and the request stays blocked (safe default —
 *    the account simply does not get the override).
 * ────────────────────────────────────────────────────────────────────────────
 */

import { queryWithRetry } from '../db/connection.js';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'usage-limits-enforcement' });

/**
 * Credit value of one fix run. Matches src/credits/deduction.ts
 * (CREDIT_COST_PER_FIX = 50).
 */
const FIX_RUN_CREDIT_COST = 50;

export interface BalanceAfterLimitDecision {
  allowed: boolean;
  consumedCredits: number;
  remainingBalance: number;
}

/**
 * Resolve the internal accounts.id for an account identifier.
 *
 * The quota gate works with GitHub installation IDs while the credits ledger
 * is keyed by the internal accounts.id. Try the installation columns first,
 * then fall back to a direct id match (covers callers that already hold the
 * internal id).
 */
async function resolveInternalAccountId(accountId: number): Promise<number | null> {
  try {
    const byInstall = await queryWithRetry<{ id: number }>(
      'SELECT id FROM accounts WHERE github_installation_id = $1 OR github_app_installation_id = $1 LIMIT 1',
      [accountId],
    );
    if (byInstall.rows.length > 0) return byInstall.rows[0].id;

    const direct = await queryWithRetry<{ id: number }>(
      'SELECT id FROM accounts WHERE id = $1 LIMIT 1',
      [accountId],
    );
    if (direct.rows.length > 0) return direct.rows[0].id;
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to resolve internal account id');
  }
  return null;
}

/**
 * Apply the balance-after-limits policy for an account at the quota gate.
 *
 * Returns allowed:true only when the preference is enabled AND the account
 * holds at least one fix run's worth of credits (which are then consumed).
 * Any failure to determine the policy keeps the request blocked.
 */
export async function applyBalanceAfterLimit(accountId: number): Promise<BalanceAfterLimitDecision> {
  const denied: BalanceAfterLimitDecision = { allowed: false, consumedCredits: 0, remainingBalance: 0 };
  const internalId = await resolveInternalAccountId(accountId);
  if (!internalId) return denied;

  try {
    const prefs = await queryWithRetry<{ use_balance_after_limits: boolean }>(
      'SELECT use_balance_after_limits FROM accounts WHERE id = $1',
      [internalId],
    );
    if (prefs.rows.length === 0 || !prefs.rows[0].use_balance_after_limits) {
      return denied;
    }

    const balance = await creditsRepository.getBalance(internalId);
    if (balance.balance < FIX_RUN_CREDIT_COST) {
      return { allowed: false, consumedCredits: 0, remainingBalance: balance.balance };
    }

    const newBalance = await creditsRepository.deduct(internalId, FIX_RUN_CREDIT_COST, {
      description: 'Fix run consumed balance after plan limit reached',
    });
    log.info(
      { accountId, internalId, consumedCredits: FIX_RUN_CREDIT_COST, newBalance: newBalance.balance },
      'Balance-after-limits consumed for fix run',
    );
    return {
      allowed: true,
      consumedCredits: FIX_RUN_CREDIT_COST,
      remainingBalance: newBalance.balance,
    };
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Balance-after-limit check failed — keeping request blocked');
    return denied;
  }
}
