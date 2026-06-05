/**
 * Billing repository — data access for the billing table.
 */

import { queryWithRetry } from '../connection.js';
import type { Billing, NewBilling } from '../schema/index.js';

export class BillingRepository {
  async findById(id: number): Promise<Billing | undefined> {
    const result = await queryWithRetry<Billing>('SELECT * FROM billing WHERE id = $1', [id]);
    return result.rows[0];
  }

  async findByAccountId(accountId: number): Promise<Billing | undefined> {
    const result = await queryWithRetry<Billing>(
      'SELECT * FROM billing WHERE account_id = $1',
      [accountId],
    );
    return result.rows[0];
  }

  async findByStripeCustomerId(stripeCustomerId: string): Promise<Billing | undefined> {
    const result = await queryWithRetry<Billing>(
      'SELECT * FROM billing WHERE stripe_customer_id = $1',
      [stripeCustomerId],
    );
    return result.rows[0];
  }

  async findByStripeSubscriptionId(stripeSubscriptionId: string): Promise<Billing | undefined> {
    const result = await queryWithRetry<Billing>(
      'SELECT * FROM billing WHERE stripe_subscription_id = $1',
      [stripeSubscriptionId],
    );
    return result.rows[0];
  }

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

  async update(
    accountId: number,
    data: Partial<Pick<Billing, 'stripeCustomerId' | 'stripeSubscriptionId' | 'plan' | 'status' | 'currentPeriodStart' | 'currentPeriodEnd' | 'usageCount'>>,
  ): Promise<Billing | undefined> {
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

    if (sets.length === 0) {
      return this.findByAccountId(accountId);
    }

    values.push(accountId);

    const result = await queryWithRetry<Billing>(
      `UPDATE billing SET ${sets.join(', ')} WHERE account_id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  async incrementUsage(accountId: number, amount = 1): Promise<Billing | undefined> {
    const result = await queryWithRetry<Billing>(
      `UPDATE billing SET usage_count = usage_count + $1 WHERE account_id = $2 RETURNING *`,
      [amount, accountId],
    );
    return result.rows[0];
  }

  async deleteByAccountId(accountId: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM billing WHERE account_id = $1', [accountId]);
    return (result.rowCount ?? 0) > 0;
  }

  async list(limit = 50, offset = 0): Promise<Billing[]> {
    const result = await queryWithRetry<Billing>('SELECT * FROM billing ORDER BY id DESC LIMIT $1 OFFSET $2', [
      limit,
      offset,
    ]);
    return result.rows;
  }
}

export const billingRepository = new BillingRepository();
