/**
 * CreditsRepository — balance queries, transactions, deduct/credit operations.
 *
 * All credit mutations go through this repository to ensure consistency.
 */

import { getPool, queryWithRetry } from '../connection.js';
import type { CreditBalance } from '../types/index.js';

export class CreditsRepository {
  // -----------------------------------------------------------------------
  // Balance
  // -----------------------------------------------------------------------

  /**
   * Get the current credit balance for an account.
   * Returns a zero balance if no row exists yet.
   */
  async getBalance(accountId: number): Promise<CreditBalance> {
    const result = await queryWithRetry<CreditBalance>('SELECT * FROM credit_balances WHERE account_id = $1', [
      accountId,
    ]);
    if (result.rows[0]) return result.rows[0];

    // Create an initial zero-balance row
    const inserted = await queryWithRetry<CreditBalance>(
      `INSERT INTO credit_balances (account_id, balance, lifetime_credits)
       VALUES ($1, 0, 0)
       RETURNING *`,
      [accountId],
    );
    return inserted.rows[0];
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
