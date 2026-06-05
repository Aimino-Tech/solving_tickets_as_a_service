/**
 * Credit transactions schema — immutable ledger of all credit movements.
 *
 * Every purchase, usage, refund, or adjustment creates a row here.
 * This table is append-only; never delete or update rows.
 */

import { pgTable, serial, integer, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const creditTransactions = pgTable('credit_transactions', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(), // positive = credit, negative = debit
  type: varchar('type', { length: 50 }).notNull(), // purchase | usage | refund | adjustment
  description: text('description'),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type NewCreditTransaction = typeof creditTransactions.$inferInsert;
