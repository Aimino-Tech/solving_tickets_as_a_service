/**
 * ReferralService — referral codes, redemption, and reward claiming (AIM-4643).
 *
 * Rewards are $5 (500 credits) for both the referrer and the referee.
 * Credits are granted through CreditsRepository so the balance ledger and
 * credit_transactions stay consistent (type 'referral').
 */

import { randomBytes, randomInt } from 'node:crypto';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import {
  REFERRAL_CODE_LENGTH,
  REFERRAL_REWARD_CREDITS,
} from './constants.js';

const log = rootLogger.child({ module: 'referral-service' });

// RFC 4648 base32 alphabet — omits 0/1/I/L/O so codes are unambiguous to read.
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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
  amountCredits: number;
  status: 'pending' | 'claimed';
  createdAt: Date;
  claimedAt: Date | null;
}

type RewardRow = {
  id: number;
  referrer_account_id: number;
  referred_email: string;
  amount_credits: number;
  status: string;
  created_at: Date;
  claimed_at: Date | null;
};

function mapRewardRow(row: RewardRow): ReferralReward {
  return {
    id: row.id,
    accountId: row.referrer_account_id,
    referredEmail: row.referred_email,
    amountCredits: row.amount_credits,
    status: row.status === 'claimed' ? 'claimed' : 'pending',
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
  };
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
   * Validate a referral code and create pending rewards for BOTH the referrer
   * and the referee ($5 = 500 credits each). Called at signup.
   */
  async redeem(code: string, referredEmail: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    const email = referredEmail.trim().toLowerCase();
    if (!normalized || !email) {
      throw new ReferralError('Invalid referral code or email', 400);
    }

    const codeRow = await queryWithRetry<{ account_id: number }>(
      'SELECT account_id FROM referral_codes WHERE code = $1',
      [normalized],
    );
    if (!codeRow.rows[0]) {
      throw new ReferralError('Invalid referral code', 400);
    }
    const referrerAccountId = codeRow.rows[0].account_id;

    // Self-referral guard.
    const referrer = await queryWithRetry<{ email: string | null }>(
      'SELECT email FROM accounts WHERE id = $1',
      [referrerAccountId],
    );
    if (referrer.rows[0]?.email?.toLowerCase() === email) {
      throw new ReferralError('You cannot redeem your own referral code', 400);
    }

    // Idempotency — a given email can only be referred once.
    const existing = await queryWithRetry<{ id: number }>(
      'SELECT id FROM referral_rewards WHERE referred_email = $1 LIMIT 1',
      [email],
    );
    if (existing.rows[0]) return;

    // Referee account (created lazily so their $5 reward is claimable).
    const refereeAccountId = await this.resolveAccountId(email);

    // Referrer's reward.
    await queryWithRetry(
      `INSERT INTO referral_rewards (referrer_account_id, referred_email, amount_credits, status)
       VALUES ($1, $2, $3, 'pending')`,
      [referrerAccountId, email, REFERRAL_REWARD_CREDITS],
    );
    // Referee's reward.
    await queryWithRetry(
      `INSERT INTO referral_rewards (referrer_account_id, referred_email, amount_credits, status)
       VALUES ($1, $2, $3, 'pending')`,
      [refereeAccountId, email, REFERRAL_REWARD_CREDITS],
    );

    log.info({ referrerAccountId, refereeAccountId, email }, 'Referral redeemed');
  }

  /**
   * List the caller's referral rewards (oldest first).
   */
  async listRewards(accountId: number): Promise<ReferralReward[]> {
    const result = await queryWithRetry<RewardRow>(
      `SELECT * FROM referral_rewards
       WHERE referrer_account_id = $1
       ORDER BY created_at ASC`,
      [accountId],
    );
    return result.rows.map(mapRewardRow);
  }

  /**
   * Claim a pending reward: grant credits via CreditsRepository (type
   * 'referral') and mark the reward claimed. Returns the new credit balance.
   */
  async claimReward(accountId: number, rewardId: number): Promise<{ newBalance: number; reward: ReferralReward }> {
    // Atomically claim the row — ownership and 'pending' check in one statement
    // so a concurrent double-claim cannot double-grant credits.
    const claimed = await queryWithRetry<RewardRow>(
      `UPDATE referral_rewards
       SET status = 'claimed', claimed_at = NOW()
       WHERE id = $1 AND referrer_account_id = $2 AND status = 'pending'
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
    const balance = await creditsRepository.credit(accountId, reward.amountCredits, {
      type: 'referral',
      description: `Referral reward — ${reward.referredEmail}`,
    });

    log.info({ accountId, rewardId, amount: reward.amountCredits }, 'Referral reward claimed');
    return { newBalance: balance.balance, reward };
  }
}

export const referralService = new ReferralService();
