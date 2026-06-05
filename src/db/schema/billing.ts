/**
 * Billing schema — subscription and usage tracking per account.
 *
 * Integrates with Stripe for subscription management.
 * Tracks current plan, status, billing periods, and usage count.
 */

import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

export const billing = pgTable('billing', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull(),
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
