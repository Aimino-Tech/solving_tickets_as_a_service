/**
 * ReferralService — referral codes, redemption, and reward claiming (AIM-4643).
 *
 * Rewards are 10 fixes for both the referrer and the referee, granted as an
 * account-level fixes allowance (accounts.referral_fixes_remaining) that the
 * quota gate consumes past the plan limit — the product unit is FIXES with
 * metered usage, not prepaid credits.
 *
 * Anti-fraud rules (AIM-4656):
 *  - Redemption is blocked for disposable-email domains.
 *  - Emails are gmail-normalized (dots / +tags) before the idempotency check,
 *    so alias farming cannot mint multiple rewards for one person.
 *  - Both rewards only become claimable after the referee's account has
 *    completed at least one fix run (status 'completed'/'success').
 */

import { randomBytes, randomInt } from 'node:crypto';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import {
  DISPOSABLE_EMAIL_DOMAINS,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REWARD_FIXES,
} from './constants.js';

const log = rootLogger.child({ module: 'referral-service' });

// RFC 4648 base32 alphabet — omits 0/1/I/L/O so codes are unambiguous to read.
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Claim-block message used for rewards whose referee has not completed a run. */
const QUALIFICATION_MESSAGE =
  'Reward is pending qualification — your friend must complete their first fix run';

export class ReferralError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'ReferralError';
  }
}

export interface ReferralReward {
  id: number;
  accountId: number;
  referredEmail: string;
  refereeAccountId: number | null;
  amountCredits: number;
  amountFixes: number;
  status: 'pending' | 'qualified' | 'claimed' | 'expired' | 'fraud';
  /** Shown by the dashboard when present: 1/2 = invited, 2/2 = fix run done. */
  qualificationProgress?: { completedSteps: number; totalSteps: number };
  createdAt: Date;
  claimedAt: Date | null;
}

type RewardRow = {
  id: number;
  referrer_account_id: number;
  referred_email: string;
  referee_account_id: number | null;
  amount_credits: number;
  amount_fixes: number;
  status: string;
  created_at: Date;
  claimed_at: Date | null;
};

const REWARD_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'qualified',
  'claimed',
  'expired',
  'fraud',
]);

function mapRewardRow(row: RewardRow): ReferralReward {
  return {
    id: row.id,
    accountId: row.referrer_account_id,
    referredEmail: row.referred_email,
    refereeAccountId: row.referee_account_id,
    amountCredits: row.amount_credits,
    amountFixes: row.amount_fixes ?? 0,
    // The status TEXT column is free-form; collapse any unknown value to
    // 'pending' so future statuses never crash the API before they ship.
    status: REWARD_STATUSES.has(row.status) ? (row.status as ReferralReward['status']) : 'pending',
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
  };
}

/**
 * Normalize an email for identity checks: trim + lowercase, strip '+aliases'
 * for ALL domains (most providers support them — a farming vector), and for
 * gmail/googlemail additionally collapse dots, so `user+tag@gmail.com` and
 * `us.er@gmail.com` both equal `user@gmail.com`.
 */
function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf('@');
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const localNoAlias = local.split('+')[0];
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${localNoAlias.replace(/\./g, '')}@gmail.com`;
  }
  return `${localNoAlias}@${domain}`;
}

/**
 * Whether the referee account has completed at least one fix run. Returns
 * false for null accounts and on DB errors (safe default: block the claim).
 */
async function refereeCompletedRun(refereeAccountId: number | null): Promise<boolean> {
  if (refereeAccountId === null) return false;
  try {
    const result = await queryWithRetry<{ id: number }>(
      `SELECT id FROM runs
       WHERE account_id = $1 AND status IN ('completed', 'success')
       LIMIT 1`,
      [refereeAccountId],
    );
    return result.rows.length > 0;
  } catch (err) {
    log.error({ err: String(err), refereeAccountId }, 'refereeCompletedRun check failed — blocking claim');
    return false;
  }
}

function generateCode(): string {
  const bytes = randomBytes(REFERRAL_CODE_LENGTH);
  let code = '';
  for (const b of bytes) {
    code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return code;
}

export class ReferralService {
  /**
   * Resolve the accounts.id for an email, creating an accounts row lazily when
   * none exists (SaaS users only have accounts rows once they connect GitHub or
   * purchase credits — referral requires one). Synthetic installation IDs are
   * negative to never collide with real GitHub installation IDs.
   */
  async resolveAccountId(email: string, name?: string): Promise<number> {
    const byEmail = await queryWithRetry<{ id: number }>(
      'SELECT id FROM accounts WHERE email = $1 LIMIT 1',
      [email],
    );
    if (byEmail.rows[0]) return byEmail.rows[0].id;

    // No accounts row yet — create one with a synthetic installation id.
    for (let attempt = 0; attempt < 3; attempt++) {
      const syntheticInstallationId = -randomInt(1, 2_147_483_647);
      try {
        const inserted = await queryWithRetry<{ id: number }>(
          `INSERT INTO accounts (github_installation_id, email, name, tier)
           VALUES ($1, $2, $3, 'free')
           RETURNING id`,
          [syntheticInstallationId, email, name ?? null],
        );
        return inserted.rows[0].id;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('duplicate key') || message.includes('unique')) {
          const recheck = await queryWithRetry<{ id: number }>(
            'SELECT id FROM accounts WHERE email = $1 LIMIT 1',
            [email],
          );
          if (recheck.rows[0]) return recheck.rows[0].id;
          continue;
        }
        throw err;
      }
    }
    throw new ReferralError('Failed to create account for referral', 500);
  }

  /**
   * Return the caller's referral code, generating and storing one if needed.
   */
  async getOrCreateCode(accountId: number): Promise<string> {
    const existing = await queryWithRetry<{ code: string }>(
      'SELECT code FROM referral_codes WHERE account_id = $1',
      [accountId],
    );
    if (existing.rows[0]) return existing.rows[0].code;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        await queryWithRetry(
          'INSERT INTO referral_codes (account_id, code) VALUES ($1, $2)',
          [accountId, code],
        );
        return code;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('duplicate key') || message.includes('unique')) {
          continue; // code collision — regenerate
        }
        throw err;
      }
    }
    throw new ReferralError('Failed to generate referral code', 500);
  }

  /**
   * Count a click on a referral code (public tracking endpoint). Returns
   * false when no code matches, so the caller can respond 400.
   */
  async registerClick(code: string): Promise<boolean> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return false;
    const result = await queryWithRetry(
      'UPDATE referral_codes SET clicks = clicks + 1 WHERE code = $1',
      [normalized],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Aggregate referral stats for an account's dashboard.
   */
  async getStats(accountId: number): Promise<{
    totalClicks: number;
    totalInvited: number;
    totalEarnedFixes: number;
    pendingFixes: number;
  }> {
    const clicks = await queryWithRetry<{ clicks: number }>(
      'SELECT COALESCE(clicks, 0)::int AS clicks FROM referral_codes WHERE account_id = $1',
      [accountId],
    );
    const rewards = await queryWithRetry<{
      invited: number;
      earned: number;
      pending: number;
    }>(
      `SELECT COUNT(*)::int AS invited,
              COALESCE(SUM(amount_fixes) FILTER (WHERE status = 'claimed'), 0)::int AS earned,
              COALESCE(SUM(amount_fixes) FILTER (WHERE status IN ('pending', 'qualified')), 0)::int AS pending
       FROM referral_rewards
       WHERE referrer_account_id = $1`,
      [accountId],
    );

    return {
      totalClicks: clicks.rows[0]?.clicks ?? 0,
      totalInvited: rewards.rows[0]?.invited ?? 0,
      totalEarnedFixes: rewards.rows[0]?.earned ?? 0,
      pendingFixes: rewards.rows[0]?.pending ?? 0,
    };
  }

  /**
   * Validate a referral code and create pending rewards for BOTH the referrer
   * and the referee (10 fixes each). Called at signup.
   */
  async redeem(code: string, referredEmail: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    const email = normalizeEmail(referredEmail);
    if (!normalized || !email) {
      throw new ReferralError('Invalid referral code or email', 400);
    }

    const domain = email.slice(email.indexOf('@') + 1);
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      throw new ReferralError('Disposable email addresses are not allowed', 400);
    }

    const codeRow = await queryWithRetry<{ account_id: number }>(
      'SELECT account_id FROM referral_codes WHERE code = $1',
      [normalized],
    );
    if (!codeRow.rows[0]) {
      throw new ReferralError('Invalid referral code', 400);
    }
    const referrerAccountId = codeRow.rows[0].account_id;

    // Self-referral guard — accounts.email may be null (never matches).
    const referrer = await queryWithRetry<{ email: string | null }>(
      'SELECT email FROM accounts WHERE id = $1',
      [referrerAccountId],
    );
    if (referrer.rows[0]?.email && normalizeEmail(referrer.rows[0].email) === email) {
      throw new ReferralError('You cannot redeem your own referral code', 400);
    }

    // Idempotency — the normalized email can only be referred once, so
    // `user@gmail.com` and `u.ser+tag@gmail.com` cannot mint two rewards.
    const existing = await queryWithRetry<{ id: number }>(
      'SELECT id FROM referral_rewards WHERE LOWER(referred_email) = $1 LIMIT 1',
      [email.toLowerCase()],
    );
    if (existing.rows[0]) return;

    // Referee account — look up by the RAW email (the account the register
    // flow created), NOT the normalized form.
    const refereeAccountId = await this.resolveAccountId(referredEmail.trim().toLowerCase());

    // Referrer's reward (claimable by referrer once the referee completes a run).
    await queryWithRetry(
      `INSERT INTO referral_rewards (referrer_account_id, referred_email, referee_account_id, amount_credits, amount_fixes, status)
       VALUES ($1, $2, $3, 0, $4, 'pending')`,
      [referrerAccountId, email, refereeAccountId, REFERRAL_REWARD_FIXES],
    );
    // Referee's reward (claimable by referee once THEY complete a run).
    await queryWithRetry(
      `INSERT INTO referral_rewards (referrer_account_id, referred_email, referee_account_id, amount_credits, amount_fixes, status)
       VALUES ($1, $2, $3, 0, $4, 'pending')`,
      [refereeAccountId, email, refereeAccountId, REFERRAL_REWARD_FIXES],
    );

    log.info({ referrerAccountId, refereeAccountId, email }, 'Referral redeemed');
  }

  /**
   * List the caller's referral rewards (oldest first), annotating each with
   * qualification progress: 1/2 until the referee completes a fix run, 2/2
   * once they have (rows are opportunistically upgraded to 'qualified').
   */
  async listRewards(accountId: number): Promise<ReferralReward[]> {
    const result = await queryWithRetry<RewardRow>(
      `SELECT * FROM referral_rewards
       WHERE referrer_account_id = $1
       ORDER BY created_at ASC`,
      [accountId],
    );

    return Promise.all(
      result.rows.map(async (row) => {
        const base = mapRewardRow(row);
        if (row.status === 'claimed') return base;

        const completed = await refereeCompletedRun(row.referee_account_id);
        if (row.status === 'expired' || row.status === 'fraud') return base;

        if (completed) {
          // Opportunistic persistence so the DB matches the displayed state.
          await queryWithRetry(
            'UPDATE referral_rewards SET status = $1 WHERE id = $2 AND status = $3',
            ['qualified', row.id, 'pending'],
          );
          return {
            ...base,
            status: 'qualified',
            qualificationProgress: { completedSteps: 2, totalSteps: 2 },
          };
        }
        return {
          ...base,
          status: 'pending',
          qualificationProgress: { completedSteps: 1, totalSteps: 2 },
        };
      }),
    );
  }

  /**
   * Claim a qualified reward: grant referral fixes as an account-level
   * allowance (accounts.referral_fixes_remaining) and mark the reward
   * claimed. Returns the new fixes allowance.
   *
   * Rewards are claimable only after the referee's account completed a fix
   * run — this is the anti-farming gate.
   */
  async claimReward(
    accountId: number,
    rewardId: number,
  ): Promise<{ claimed: true; reward: ReferralReward; newAllowance: number }> {
    // Qualification gate — read the referee link BEFORE the atomic claim.
    const rewardRow = await queryWithRetry<{ referee_account_id: number | null }>(
      'SELECT referee_account_id FROM referral_rewards WHERE id = $1 AND referrer_account_id = $2',
      [rewardId, accountId],
    );
    if (!rewardRow.rows[0]) {
      throw new ReferralError('Reward not found', 404);
    }
    if (
      rewardRow.rows[0].referee_account_id === null ||
      !(await refereeCompletedRun(rewardRow.rows[0].referee_account_id))
    ) {
      throw new ReferralError(QUALIFICATION_MESSAGE, 400);
    }

    // Atomically claim the row — ownership and 'pending' check in one statement
    // so a concurrent double-claim cannot double-grant fixes.
    const claimed = await queryWithRetry<RewardRow>(
      `UPDATE referral_rewards
       SET status = 'claimed', claimed_at = NOW()
       WHERE id = $1 AND referrer_account_id = $2 AND (status = 'pending' OR status = 'qualified')
       RETURNING *`,
      [rewardId, accountId],
    );

    if (!claimed.rows[0]) {
      const exists = await queryWithRetry<{ id: number }>(
        'SELECT id FROM referral_rewards WHERE id = $1 AND referrer_account_id = $2',
        [rewardId, accountId],
      );
      if (!exists.rows[0]) {
        throw new ReferralError('Reward not found', 404);
      }
      throw new ReferralError('Reward already claimed', 400);
    }

    const reward = mapRewardRow(claimed.rows[0]);
    // Grant referral fixes (AIM-4643) — the quota gate consumes this
    // allowance past the plan limit, before any paid overage kicks in.
    const granted = await queryWithRetry<{ referral_fixes_remaining: number }>(
      `UPDATE accounts
       SET referral_fixes_remaining = referral_fixes_remaining + $1
       WHERE id = $2
       RETURNING referral_fixes_remaining`,
      [reward.amountFixes, accountId],
    );
    const newAllowance = granted.rows[0]?.referral_fixes_remaining ?? 0;

    log.info({ accountId, rewardId, fixes: reward.amountFixes, newAllowance }, 'Referral reward claimed');
    return { claimed: true, reward, newAllowance };
  }

  /**
   * Consume one referral-granted fix from the account's allowance. Resolves
   * the internal accounts.id the same way usage-limits enforcement does
   * (installation id first, direct id fallback), then decrements the
   * allowance only while it is positive.
   *
   * Fail-closed: returns false on any error or when no allowance remains, so
   * the quota gate keeps blocking the request.
   */
  async consumeReferralFix(accountId: number): Promise<boolean> {
    try {
      const internal = await queryWithRetry<{ id: number }>(
        'SELECT id FROM accounts WHERE github_installation_id = $1 OR github_app_installation_id = $1 LIMIT 1',
        [accountId],
      );
      let internalId: number | null = internal.rows[0]?.id ?? null;
      if (internalId === null) {
        const direct = await queryWithRetry<{ id: number }>(
          'SELECT id FROM accounts WHERE id = $1 LIMIT 1',
          [accountId],
        );
        internalId = direct.rows[0]?.id ?? null;
      }
      if (internalId === null) return false;

      const consumed = await queryWithRetry(
        'UPDATE accounts SET referral_fixes_remaining = referral_fixes_remaining - 1 WHERE id = $1 AND referral_fixes_remaining > 0',
        [internalId],
      );
      return (consumed.rowCount ?? 0) > 0;
    } catch (err) {
      log.error({ err: String(err), accountId }, 'consumeReferralFix failed — keeping quota gate closed');
      return false;
    }
  }
}

export const referralService = new ReferralService();

/**
 * Consume one referral-granted fix from the account's allowance. Named
 * export so the quota gate (src/pricing/middleware.ts) can call it without
 * importing the service singleton.
 */
export const consumeReferralFix = (accountId: number): Promise<boolean> =>
  referralService.consumeReferralFix(accountId);
