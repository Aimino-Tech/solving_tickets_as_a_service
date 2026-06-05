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
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' })
    .unique(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  plan: varchar('plan', { length: 50 }).notNull().default('free'),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  usageCount: integer('usage_count').notNull().default(0),
});

export type Billing = typeof billing.$inferSelect;
export type NewBilling = typeof billing.$inferInsert;
