/**
 * BillingRepository — subscription and usage tracking per account.
 *
 * Provides methods for managing billing records, usage counters,
 * and Stripe subscription integration.
 */

import { queryWithRetry } from '../connection.js';
import type { Billing, NewBilling } from '../schema/index.js';

export class BillingRepository {
  /**
   * Get the billing record for an account.
   * Creates a default "free" tier record if none exists.
   */
  async getOrCreate(accountId: number): Promise<Billing> {
    const result = await queryWithRetry<Billing>(
      'SELECT * FROM billing WHERE account_id = $1',
      [accountId],
    );
    if (result.rows[0]) return result.rows[0];

    const created = await queryWithRetry<Billing>(
      `INSERT INTO billing (account_id, plan, status, usage_count)
       VALUES ($1, 'free', 'active', 0)
       RETURNING *`,
      [accountId],
    );
    return created.rows[0];
  }

  /**
   * Create a new billing record.
   */
  async create(data: NewBilling): Promise<Billing> {
    const result = await queryWithRetry<Billing>(
      `INSERT INTO billing (account_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, usage_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.accountId,
        data.stripeCustomerId ?? null,
        data.stripeSubscriptionId ?? null,
        data.plan ?? 'free',
        data.status ?? 'active',
        data.currentPeriodStart ?? null,
        data.currentPeriodEnd ?? null,
        data.usageCount ?? 0,
      ],
    );
    return result.rows[0];
  }

  /**
   * Update billing record (e.g. after Stripe webhook).
   */
  async update(accountId: number, data: Partial<Pick<Billing,
    'stripeCustomerId' | 'stripeSubscriptionId' | 'plan' | 'status'
    | 'currentPeriodStart' | 'currentPeriodEnd' | 'usageCount'
  >>): Promise<Billing | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.stripeCustomerId !== undefined) {
      sets.push(`stripe_customer_id = $${idx++}`);
      values.push(data.stripeCustomerId);
    }
    if (data.stripeSubscriptionId !== undefined) {
      sets.push(`stripe_subscription_id = $${idx++}`);
      values.push(data.stripeSubscriptionId);
    }
    if (data.plan !== undefined) {
      sets.push(`plan = $${idx++}`);
      values.push(data.plan);
    }
    if (data.status !== undefined) {
      sets.push(`status = $${idx++}`);
      values.push(data.status);
    }
    if (data.currentPeriodStart !== undefined) {
      sets.push(`current_period_start = $${idx++}`);
      values.push(data.currentPeriodStart);
    }
    if (data.currentPeriodEnd !== undefined) {
      sets.push(`current_period_end = $${idx++}`);
      values.push(data.currentPeriodEnd);
    }
    if (data.usageCount !== undefined) {
      sets.push(`usage_count = $${idx++}`);
      values.push(data.usageCount);
    }

    if (sets.length === 0) return this.getOrCreate(accountId);

    values.push(accountId);
    const result = await queryWithRetry<Billing>(
      `UPDATE billing SET ${sets.join(', ')} WHERE account_id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  /**
   * Increment the usage counter for an account.
   * Returns the updated billing record.
   */
  async incrementUsage(accountId: number): Promise<Billing> {
    const result = await queryWithRetry<Billing>(
      `UPDATE billing
       SET usage_count = usage_count + 1
       WHERE account_id = $1
       RETURNING *`,
      [accountId],
    );
    if (result.rows[0]) return result.rows[0];
    return this.getOrCreate(accountId);
  }

  /**
   * Reset the usage counter (e.g. at the start of a new billing period).
   */
  async resetUsage(accountId: number): Promise<Billing | undefined> {
    const result = await queryWithRetry<Billing>(
      `UPDATE billing
       SET usage_count = 0
       WHERE account_id = $1
       RETURNING *`,
      [accountId],
    );
    return result.rows[0];
  }

  /**
   * Check if an account has exceeded its plan's usage limit.
   * Returns true if the account can still use the service.
   */
  async checkUsageLimit(accountId: number, planLimits: Record<string, number>): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
  }> {
    const billing = await this.getOrCreate(accountId);
    const limit = planLimits[billing.plan] ?? planLimits['free'] ?? 100;
    return {
      allowed: billing.usageCount < limit,
      current: billing.usageCount,
      limit,
    };
  }

  /**
   * List all billing records (paginated, admin use).
   */
  async list(limit = 50, offset = 0): Promise<Billing[]> {
    const result = await queryWithRetry<Billing>(
      'SELECT * FROM billing ORDER BY id DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    return result.rows;
  }
}

export const billingRepository = new BillingRepository();
