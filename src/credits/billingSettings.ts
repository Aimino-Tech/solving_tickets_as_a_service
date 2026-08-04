/**
 * Billing balance settings — auto-reload, monthly usage limit, coupon rate.
 *
 * Shared by the credits REST routes (read/update settings) and the deduct
 * middleware (enforce monthly limit, trigger auto-reload after a deduction).
 *
 * All helpers fail closed by throwing; callers decide how to degrade
 * (middleware lets requests through on DB error — consistent with the
 * existing deduct-middleware behaviour).
 */

import { queryWithRetry } from '../db/connection.js';
import { createCheckoutSession } from '../stripe/checkout.js';
import { getCreditPacks } from '../stripe/credit-packs.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'billing-settings' });

// ---------------------------------------------------------------------------
// Credit ↔ cent rate
// ---------------------------------------------------------------------------

/**
 * Cents per credit, derived from the smallest credit pack (100 credits for
 * 1000 cents ⇒ 10 cents/credit). Kept in sync with src/stripe/credit-packs.ts.
 */
export function getCentsPerCredit(): number {
  const packs = getCreditPacks();
  const small = packs[0];
  if (small && small.credits > 0) {
    return small.amount / small.credits;
  }
  return 10;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BillingSettings {
  autoReloadEnabled: boolean;
  autoReloadThresholdCents: number | null;
  autoReloadTopupCents: number | null;
  monthlyLimitCents: number | null;
}

export interface AutoReloadResult {
  topUpRequired: boolean;
  checkoutUrl: string;
  topupCents: number;
}

const DEFAULT_SETTINGS: BillingSettings = {
  autoReloadEnabled: false,
  autoReloadThresholdCents: null,
  autoReloadTopupCents: null,
  monthlyLimitCents: null,
};

type BillingSettingsRow = {
  auto_reload_enabled: boolean | null;
  auto_reload_threshold_cents: number | null;
  auto_reload_topup_cents: number | null;
  monthly_limit_cents: number | null;
};

/** Cooldown between auto-reload checkout triggers per account. */
export const AUTO_RELOAD_COOLDOWN_MS = 10 * 60 * 1000;

/** Default redirect for auto-reload checkout sessions (no browser session in webhook context). */
const DEFAULT_CHECKOUT_REDIRECT = 'https://syntaro.io/dashboard/billing';

/** In-process guard so repeated deductions don't spawn duplicate top-ups. */
const autoReloadPending = new Map<number, number>();

/**
 * Clear the auto-reload cooldown for an account (mainly for tests).
 */
export function clearAutoReloadCooldown(accountId: number): void {
  autoReloadPending.delete(accountId);
}

// ---------------------------------------------------------------------------
// Settings access
// ---------------------------------------------------------------------------

/**
 * Read the account's billing balance settings.
 * Throws if the query fails (callers degrade as appropriate).
 */
export async function getBillingSettings(accountId: number): Promise<BillingSettings> {
  const result = await queryWithRetry<BillingSettingsRow>(
    `SELECT auto_reload_enabled, auto_reload_threshold_cents, auto_reload_topup_cents, monthly_limit_cents
     FROM accounts
     WHERE id = $1`,
    [accountId],
  );

  const row = result.rows[0];
  if (!row) return { ...DEFAULT_SETTINGS };

  return {
    autoReloadEnabled: row.auto_reload_enabled ?? false,
    autoReloadThresholdCents: row.auto_reload_threshold_cents ?? null,
    autoReloadTopupCents: row.auto_reload_topup_cents ?? null,
    monthlyLimitCents: row.monthly_limit_cents ?? null,
  };
}

/**
 * Total credits consumed this calendar month (SUM of negative credit
 * transactions), converted to cents using the credit-pack rate.
 */
export async function getMonthSpendCents(accountId: number): Promise<number> {
  const result = await queryWithRetry<{ spent: number | null }>(
    `SELECT ABS(SUM(amount))::int AS spent
     FROM credit_transactions
     WHERE account_id = $1
       AND amount < 0
       AND created_at >= DATE_TRUNC('month', NOW())`,
    [accountId],
  );

  const creditsSpent = result.rows[0]?.spent ?? 0;
  return Math.round(creditsSpent * getCentsPerCredit());
}

// ---------------------------------------------------------------------------
// Monthly limit
// ---------------------------------------------------------------------------

/**
 * True when a monthly limit is configured and current month spend has
 * reached (or passed) it.
 */
export function isMonthlyLimitExceeded(settings: BillingSettings, monthSpendCents: number): boolean {
  return (
    settings.monthlyLimitCents != null &&
    settings.monthlyLimitCents > 0 &&
    monthSpendCents >= settings.monthlyLimitCents
  );
}

// ---------------------------------------------------------------------------
// Auto-reload
// ---------------------------------------------------------------------------

/**
 * Pick the credit pack whose price is nearest the requested top-up amount.
 */
function pickCreditPackForAmount(topupCents: number) {
  const packs = getCreditPacks();
  let best = packs[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const pack of packs) {
    const diff = Math.abs(pack.amount - topupCents);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = pack;
    }
  }
  return best;
}

/**
 * Create an auto-reload checkout session when:
 *   - auto-reload is enabled with threshold + top-up configured,
 *   - current balance (in cents) is below the threshold,
 *   - no top-up was triggered for this account within the cooldown window.
 *
 * @returns The checkout details, or null when no top-up is required.
 */
export async function triggerAutoReload(
  accountId: number,
  settings: BillingSettings,
  balanceCredits: number,
  redirectUrls?: { successUrl?: string; cancelUrl?: string },
): Promise<AutoReloadResult | null> {
  if (!settings.autoReloadEnabled) return null;
  if (settings.autoReloadThresholdCents == null || settings.autoReloadTopupCents == null) return null;
  if (settings.autoReloadThresholdCents <= 0 || settings.autoReloadTopupCents <= 0) return null;

  const balanceCents = Math.round(balanceCredits * getCentsPerCredit());
  if (balanceCents >= settings.autoReloadThresholdCents) return null;

  const now = Date.now();
  const lastTriggered = autoReloadPending.get(accountId);
  if (lastTriggered !== undefined && now - lastTriggered < AUTO_RELOAD_COOLDOWN_MS) {
    log.info({ accountId }, 'Auto-reload skipped — top-up already triggered recently');
    return null;
  }

  try {
    const pack = pickCreditPackForAmount(settings.autoReloadTopupCents);
    const session = await createCheckoutSession({
      accountId,
      priceId: pack.priceId,
      successUrl: redirectUrls?.successUrl ?? DEFAULT_CHECKOUT_REDIRECT,
      cancelUrl: redirectUrls?.cancelUrl ?? DEFAULT_CHECKOUT_REDIRECT,
    });

    autoReloadPending.set(accountId, now);

    log.info(
      { accountId, topupCents: settings.autoReloadTopupCents, packLabel: pack.label },
      'Auto-reload checkout session created',
    );

    return {
      topUpRequired: true,
      checkoutUrl: session.url,
      topupCents: settings.autoReloadTopupCents,
    };
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to create auto-reload checkout session');
    return null;
  }
}
