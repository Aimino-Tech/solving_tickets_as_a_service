/**
 * CreditsRepository — balance queries, transactions, deduct/credit operations.
 *
 * All credit mutations go through this repository to ensure consistency.
 */

import { getPool, queryWithRetry } from '../connection.js';
import type { CreditBalance } from '../types/index.js';

type CreditBalanceRow = {
  id: number;
  account_id: number;
  balance: number;
  lifetime_credits: number;
  created_at: Date;
  updated_at: Date;
};

export interface Coupon {
  id: number;
  code: string;
  amountCredits: number;
  active: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  createdAt: Date;
}

type CouponRow = {
  id: number;
  code: string;
  amount_credits: number;
  active: boolean;
  max_redemptions: number | null;
  times_redeemed: number;
  created_at: Date;
};

function mapBalanceRow(row: CreditBalanceRow): CreditBalance {
  return {
    id: row.id,
    accountId: row.account_id,
    balance: row.balance,
    lifetimeCredits: row.lifetime_credits,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCoupon(row: CouponRow): Coupon {
  return {
    id: row.id,
    code: row.code,
    amountCredits: row.amount_credits,
    active: row.active,
    maxRedemptions: row.max_redemptions,
    timesRedeemed: row.times_redeemed,
    createdAt: row.created_at,
  };
}

export class CreditsRepository {
  // -----------------------------------------------------------------------
  // Balance
  // -----------------------------------------------------------------------

  /**
   * Get the current credit balance for an account.
   * Returns a zero balance if no row exists yet.
   */
  async getBalance(accountId: number): Promise<CreditBalance> {
    const result = await queryWithRetry<CreditBalanceRow>('SELECT * FROM credit_balances WHERE account_id = $1', [
      accountId,
    ]);
    if (result.rows[0]) return mapBalanceRow(result.rows[0]);

    // Create an initial zero-balance row
    const inserted = await queryWithRetry<CreditBalanceRow>(
      `INSERT INTO credit_balances (account_id, balance, lifetime_credits)
       VALUES ($1, 0, 0)
       RETURNING *`,
      [accountId],
    );
    return mapBalanceRow(inserted.rows[0]);
  }

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  /**
   * Add credits to an account (purchase or admin adjustment).
   *
   * @returns The new balance.
   */
  async credit(
    accountId: number,
    amount: number,
    options?: {
      type?: string;
      description?: string;
      stripePaymentIntentId?: string;
    },
  ): Promise<CreditBalance> {
    if (amount <= 0) throw new Error('Credit amount must be positive');

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      // Upsert balance
      const balanceResult = await client.query<CreditBalance>(
        `INSERT INTO credit_balances (account_id, balance, lifetime_credits)
         VALUES ($1, $2, $2)
         ON CONFLICT (account_id)
         DO UPDATE SET
           balance = credit_balances.balance + $2,
           lifetime_credits = credit_balances.lifetime_credits + $2,
           updated_at = NOW()
         RETURNING *`,
        [accountId, amount],
      );

      // Record transaction
      await client.query(
        `INSERT INTO credit_transactions (account_id, amount, type, description, stripe_payment_intent_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          accountId,
          amount,
          options?.type ?? 'purchase',
          options?.description ?? null,
          options?.stripePaymentIntentId ?? null,
        ],
      );

      await client.query('COMMIT');
      return balanceResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Deduct credits from an account (for a fix run).
   *
   * @throws If the account has insufficient credits.
   * @returns The new balance.
   */
  async deduct(
    accountId: number,
    amount: number,
    options?: {
      description?: string;
    },
  ): Promise<CreditBalance> {
    if (amount <= 0) throw new Error('Deduction amount must be positive');

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      // Check current balance
      const balanceCheck = await client.query<CreditBalance>(
        'SELECT * FROM credit_balances WHERE account_id = $1 FOR UPDATE',
        [accountId],
      );

      const currentBalance = balanceCheck.rows[0]?.balance ?? 0;
      if (currentBalance < amount) {
        throw new Error(`Insufficient credits: ${currentBalance} available, ${amount} required`);
      }

      // Deduct
      const balanceResult = await client.query<CreditBalance>(
        `UPDATE credit_balances
         SET balance = balance - $2, updated_at = NOW()
         WHERE account_id = $1
         RETURNING *`,
        [accountId, amount],
      );

      // Record transaction (negative amount for deductions)
      await client.query(
        `INSERT INTO credit_transactions (account_id, amount, type, description)
         VALUES ($1, $2, 'usage', $3)`,
        [accountId, -amount, options?.description ?? null],
      );

      await client.query('COMMIT');
      return balanceResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Redeem a promo coupon atomically.
   *
   * Validates the coupon (exists, active, under redemption cap), increments
   * `times_redeemed`, and credits the account balance — all in one
   * transaction so a redemption can never be recorded without crediting.
   *
   * Coupon credits are added to the balance only (not lifetime_credits), so
   * promotional credits don't skew the low-balance ratio in
   * src/credits/lowCreditWarning.ts.
   *
   * @throws Error with a descriptive message for invalid/inactive/exhausted coupons.
   * @returns The coupon (post-redemption) and the account's new balance.
   */
  async redeemCoupon(
    accountId: number,
    code: string,
  ): Promise<{ coupon: Coupon; balance: number }> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      // Lock the coupon row so concurrent redemptions are serialized
      const couponResult = await client.query<CouponRow>(
        'SELECT * FROM coupons WHERE code = $1 FOR UPDATE',
        [code],
      );
      const coupon = couponResult.rows[0];
      if (!coupon) throw new Error('Coupon not found');
      if (!coupon.active) throw new Error('Coupon is inactive');
      if (coupon.max_redemptions !== null && coupon.times_redeemed >= coupon.max_redemptions) {
        throw new Error('Coupon has already been fully redeemed');
      }

      await client.query('UPDATE coupons SET times_redeemed = times_redeemed + 1 WHERE id = $1', [
        coupon.id,
      ]);

      // Credit balance (not lifetime_credits — promotional credits)
      const balanceResult = await client.query<CreditBalance>(
        `INSERT INTO credit_balances (account_id, balance, lifetime_credits)
         VALUES ($1, $2, 0)
         ON CONFLICT (account_id)
         DO UPDATE SET
           balance = credit_balances.balance + $2,
           updated_at = NOW()
         RETURNING *`,
        [accountId, coupon.amount_credits],
      );

      await client.query(
        `INSERT INTO credit_transactions (account_id, amount, type, description)
         VALUES ($1, $2, 'coupon', $3)`,
        [accountId, coupon.amount_credits, `Coupon redemption: ${coupon.code}`],
      );

      await client.query('COMMIT');
      return { coupon: mapCoupon({ ...coupon, times_redeemed: coupon.times_redeemed + 1 }), balance: balanceResult.rows[0].balance };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get the transaction history for an account.
   */
  async getTransactions(accountId: number, limit = 50, offset = 0) {
    const result = await queryWithRetry(
      `SELECT * FROM credit_transactions
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset],
    );
    return result.rows;
  }
}

export const creditsRepository = new CreditsRepository();
