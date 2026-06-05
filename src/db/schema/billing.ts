/**
 * Billing schema — subscription and usage tracking per account.
 *
 * One row per account with Stripe integration fields, current plan,
 * billing period, and usage counters for limit enforcement.
 */

import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const billing = pgTable('billing', {
  id: serial('id').primaryKey(),
  /** Account this billing record belongs to. */
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' })
    .unique(),
  /** Stripe customer ID for this account. */
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  /** Stripe subscription ID for recurring billing. */
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  /** Billing plan: free, pro, enterprise. */
  plan: varchar('plan', { length: 50 }).notNull().default('free'),
  /** Subscription status: active, past_due, canceled, trialing. */
  status: varchar('status', { length: 50 }).notNull().default('active'),
  /** Start of the current billing period. */
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  /** End of the current billing period. */
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  /** Number of fix runs used in this billing period. */
  usageCount: integer('usage_count').notNull().default(0),
});

export type Billing = typeof billing.$inferSelect;
export type NewBilling = typeof billing.$inferInsert;
